/**
 * Admin › Analytics: visitor sessions (recent first, paged), online/offline, per-visitor deletion.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../../runtime/store';
import {
  adminDateTime,
  adminHeader,
  analyticsConfirm,
  clearAllAnalyticsLogs,
  deleteAnalyticsSessionById,
  deleteVisitorAnalyticsByVisitorIds,
  readAdminAnalyticsCache,
  writeAdminAnalyticsCache,
} from '../adminRouter';
import { RUD_ANALYTICS_COLLECTION } from '../../analytics/visitorAnalytics';
import { $, $$ } from '../../../runtime/core';
import { collection, getDocs, limit, onSnapshot, orderBy, query, startAfter } from '../../../services/firebase/sdk';
import { busy, esc, toast } from '../../../utils/ui';

function analyticsAdminView() {
  $('#adminTopTitle').textContent = 'Analytics';
  if (typeof S.adminAnalyticsUnsub === 'function') {
    try {
      S.adminAnalyticsUnsub();
    } catch {}
    S.adminAnalyticsUnsub = null;
  }

  const main = $('#adminMain');
  const asDate = (v) => (v?.toDate ? v.toDate() : v instanceof Date ? v : new Date(v || 0));
  const validDate = (v) => {
    const d = asDate(v);
    return Number.isFinite(d.getTime()) ? d : new Date(0);
  };
  const seenMs = (s) =>
    Math.max(
      validDate(s?.lastSeenAt).getTime() || 0,
      Number(s?.clientLastSeenMs) || 0,
      validDate(s?.startedAt).getTime() || 0,
    );
  const identityKey = (s) => {
    const visitorId = String(s?.visitorId || '').trim();
    if (visitorId) return `visitor:${visitorId}`;
    const legacy = String(s?.sessionId || s?.id || '').trim();
    return `legacy:${legacy || 'unknown'}`;
  };
  const installed = (s) =>
    s?.installedApp === true ||
    s?.installCaptured === true ||
    ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].includes(String(s?.appMode || '')) ||
    /ios_home_screen|android_installed_app|standalone_launch|android_or_browser_install/i.test(
      String(s?.installSource || ''),
    );
  const appSession = (s) =>
    s?.appSession === true ||
    ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].includes(String(s?.appMode || ''));
  const activeSession = (s, now = Date.now()) => {
    const seen = seenMs(s);
    return s?.active !== false && seen > 0 && now - seen <= 30000;
  };
  const fmtDur = (sec) => {
    sec = Math.max(0, Number(sec) || 0);
    if (sec < 60) return `${Math.round(sec)}s`;
    const m = Math.floor(sec / 60),
      rest = Math.round(sec % 60);
    return m < 60 ? `${m}m ${rest}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };
  const avg = (arr) =>
    arr.length ? Math.round(arr.reduce((n, s) => n + (Number(s.durationSeconds) || 0), 0) / arr.length) : 0;
  const unique = (arr) => new Set(arr.map(identityKey)).size;
  const routePretty = (r) => {
    const raw = String(r || 'home'),
      parts = raw.split('/');
    if (parts[0] === 'name') return 'Name of Allah';
    if (parts[0] === 'dua') return 'Dua';
    if (parts[0] === 'hadith') return 'Hadith';
    if (parts[0] === 'reminder') return 'Reminder';
    if (parts[0] === 'names') return 'Names of Allah';
    if (parts[0] === 'duas') return 'Duas';
    if (parts[0] === 'reminders') return 'Reminders';
    return raw || 'home';
  };
  const topMap = (arr, key) => {
    const m = new Map();
    arr.forEach((x) => {
      const v = String(x?.[key] || 'Unknown');
      m.set(v, (m.get(v) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  };
  const locationValue = (s, names) => {
    for (const name of names) {
      const parts = name.split('.');
      let value = s;
      for (const part of parts) value = value && typeof value === 'object' ? value[part] : undefined;
      const text = String(value ?? '').trim();
      if (text) return text.slice(0, 100);
    }
    return '';
  };
  const visitorNameFrom = (list) => {
    const ordered = [...list].sort((a, b) => seenMs(b) - seenMs(a));
    for (const session of ordered) {
      const name = String(session?.visitorName || '').trim();
      if (name) return name.slice(0, 50);
    }
    return '';
  };
  const summarizeVisitors = (sessions, now) => {
    const groups = new Map();
    sessions.forEach((session) => {
      const key = identityKey(session);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(session);
    });
    return [...groups.entries()]
      .map(([key, list]) => {
        const ordered = [...list].sort((a, b) => seenMs(b) - seenMs(a));
        const latest = ordered[0] || {};
        const activeSessions = ordered.filter((s) => activeSession(s, now));
        const activeAppSessions = activeSessions.filter(appSession);
        const installedSessions = ordered.filter(installed);
        const visitorId = String(ordered.find((s) => String(s?.visitorId || '').trim())?.visitorId || '').trim();
        const firstSeenMs = Math.min(...ordered.map((s) => validDate(s.startedAt).getTime()).filter((n) => n > 0));
        const lastSeenMs = Math.max(...ordered.map(seenMs), 0);
        return {
          key,
          visitorId,
          legacySessionId: visitorId ? '' : String(latest.id || latest.sessionId || ''),
          name: visitorNameFrom(ordered),
          latest,
          sessionCount: ordered.length,
          activitySeconds: ordered.reduce((sum, s) => sum + (Number(s.durationSeconds) || 0), 0),
          appSessionCount: ordered.filter(appSession).length,
          firstSeenMs: Number.isFinite(firstSeenMs) ? firstSeenMs : 0,
          lastSeenMs,
          active: activeSessions.length > 0,
          activeSession: activeSessions[0] || null,
          activeAppSession: activeAppSessions[0] || null,
          installed: installedSessions.length > 0,
          installedSession: installedSessions[0] || null,
          city: locationValue(latest, ['city', 'locationCity', 'location.city', 'geo.city', 'address.city']),
          region: locationValue(latest, [
            'state',
            'region',
            'stateRegion',
            'locationState',
            'locationRegion',
            'location.state',
            'location.region',
            'geo.state',
            'geo.region',
            'address.state',
            'address.region',
          ]),
          country: locationValue(latest, [
            'country',
            'countryName',
            'locationCountry',
            'location.country',
            'geo.country',
            'address.country',
          ]),
        };
      })
      .sort((a, b) => b.lastSeenMs - a.lastSeenMs);
  };
  const visitorLabel = (v) => v.name || `Visitor ${String(v.visitorId || v.key).slice(-6)}`;
  const ANALYTICS_PAGE_SIZE = 250;
  let analyticsRecentSessions = [];
  let analyticsOlderSessions = [];
  let analyticsLastDoc = null;
  let analyticsCanLoadMore = true;
  let analyticsPageLoading = false;
  const analyticsCombined = () => {
    const byId = new Map();
    [...analyticsRecentSessions, ...analyticsOlderSessions].forEach((s) => {
      const key = String(s?.id || s?.sessionId || identityKey(s));
      if (!byId.has(key)) byId.set(key, s);
    });
    return [...byId.values()].sort((a, b) => seenMs(b) - seenMs(a));
  };

  const ensureShell = () => {
    if (main.querySelector('#analyticsVisitorsBody')) return;
    main.innerHTML = `
      ${adminHeader('Visitor Analytics', 'Recent sessions load first. Older analytics load only when requested; unique users are grouped by the existing first-party visitor ID.', false)}
      <div class="stats analytics-stats">
        <article class="stat analytics-stat" data-analytics-stat="active"><small>Active Now</small><strong>0</strong><span>unique users · website + app</span></article>
        <article class="stat analytics-stat" data-analytics-stat="today"><small>Visitors Today</small><strong>0</strong><span>0 sessions</span></article>
        <article class="stat analytics-stat" data-analytics-stat="month"><small>This Month</small><strong>0</strong><span>0 sessions</span></article>
        <article class="stat analytics-stat" data-analytics-stat="all"><small>Loaded Visitors</small><strong>0</strong><span>0 sessions</span></article>
        <article class="stat analytics-stat" data-analytics-stat="avg"><small>Avg. Engagement</small><strong>0s</strong><span>this month</span></article>
        <article class="stat analytics-stat" data-analytics-stat="installs"><small>App Installs</small><strong>0</strong><span>captured installs</span></article>
        <article class="stat analytics-stat" data-analytics-stat="installed"><small>Installed App Users</small><strong>0</strong><span>0 this month</span></article>
        <article class="stat analytics-stat" data-analytics-stat="appsessions"><small>App Sessions</small><strong>0</strong><span>0 this month</span></article>
        <article class="stat analytics-stat" data-analytics-stat="usingapp"><small>Using App Now</small><strong>0</strong><span>unique users · live now</span></article>
        <article class="stat analytics-stat" data-analytics-stat="appavg"><small>Avg. App Usage</small><strong>0s</strong><span>installed app · this month</span></article>
      </div>

      <section class="admin-panel">
        <div class="manager-toolbar"><div><strong><span class="live-dot"></span>Live Installed App Users</strong><div class="muted">One row per unique user. Updates without rebuilding this section.</div></div><span class="status-pill live" data-analytics-count="live-app">0 active</span></div>
        <div class="table-wrap" id="analyticsLiveWrap"><table class="live-installed-table"><thead><tr><th>User</th><th>Device</th><th>Exploring Now</th><th>Current Session</th><th>Last Seen</th></tr></thead><tbody id="analyticsLiveBody"></tbody></table></div>
        <div class="empty-live" id="analyticsLiveEmpty" hidden>No installed-app users are active right now.</div>
      </section>

      <section class="admin-panel">
        <div class="manager-toolbar"><div><strong>Installed / Added to Home Screen</strong><div class="muted">Unique installed users; repeated app sessions are counted separately.</div></div><span class="status-pill" data-analytics-count="installed">0 users</span></div>
        <div class="table-wrap" id="analyticsInstalledWrap"><table><thead><tr><th>User</th><th>Platform</th><th>Install Source</th><th>Visits</th><th>Last Explored</th><th>Last Active</th></tr></thead><tbody id="analyticsInstalledBody"></tbody></table></div>
        <div class="empty-live" id="analyticsInstalledEmpty" hidden>No installed/Home Screen users recorded yet.</div>
      </section>

      <section class="admin-panel">
        <div class="manager-toolbar"><div><strong>Unique Users</strong><div class="muted">Names never define identity. City/region/country use the latest coarse access location when available; precise GPS is never requested for analytics.</div></div><span class="status-pill" data-analytics-count="visitors">0 users</span></div>
        <div class="analytics-bulk-bar" id="analyticsVisitorBulk"><div><span class="analytics-selected-count" id="analyticsSelectedVisitors">0 selected</span></div><button class="analytics-delete-btn" id="deleteSelectedVisitors" type="button" disabled>Delete Selected</button></div>
        <div class="table-wrap" id="analyticsVisitorsWrap"><table><thead><tr><th style="width:38px"><input class="analytics-check" id="analyticsSelectAllVisitors" type="checkbox" aria-label="Select all visitors"></th><th>Name / Status</th><th>City</th><th>State / Region</th><th>Country</th><th>Last Explored</th><th>Visits</th><th>Activity</th><th>Last Active</th><th>Device / Mode</th><th>Delete</th></tr></thead><tbody id="analyticsVisitorsBody"></tbody></table></div>
        <div class="empty-live" id="analyticsVisitorsEmpty" hidden>No unique visitors have been recorded yet.</div>
      </section>

      <section class="admin-panel">
        <div class="manager-toolbar"><div><strong>Recent Sessions</strong><div class="muted">Latest 250 load first. Older sessions are fetched only on demand.</div></div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="status-pill" data-analytics-count="sessions">0 sessions</span><button class="premium-btn small" id="analyticsLoadOlder" type="button">Load older</button></div></div>
        <div class="table-wrap" id="analyticsSessionsWrap"><table><thead><tr><th>Name</th><th>Route</th><th>Device</th><th>App / Browser</th><th>Duration</th><th>Last Seen</th><th>Delete</th></tr></thead><tbody id="analyticsSessionsBody"></tbody></table></div>
        <div class="empty-live" id="analyticsSessionsEmpty" hidden>No sessions recorded yet.</div>
      </section>

      <div class="analytics-grid">
        <article class="analytics-breakdown" data-analytics-breakdown="routes"><h3>Top Pages / Routes</h3></article>
        <article class="analytics-breakdown" data-analytics-breakdown="devices"><h3>Devices</h3></article>
        <article class="analytics-breakdown" data-analytics-breakdown="sources"><h3>Traffic Sources</h3></article>
        <article class="analytics-breakdown" data-analytics-breakdown="modes"><h3>App / Browser Mode</h3></article>
      </div>
      <section class="admin-panel analytics-note"><strong>Privacy-conscious unique usage</strong><p>Unique users are grouped only by the existing anonymous first-party visitor ID. A new session can increase visits without creating another user. Location is coarse city/region/country only when available; no fingerprinting, IP storage, coordinates, or automatic GPS permission request is used.</p></section>
      <section class="analytics-danger-bar"><div class="analytics-danger-copy"><strong>Clear Analytics Logs</strong><span>Permanently deletes all visitor sessions and broadcast view/dismiss receipts. Broadcast messages and website content are not deleted.</span></div><button class="analytics-delete-btn" id="clearAllAnalyticsLogs" type="button">Clear All Logs</button></section>`;
  };

  const updateSelection = () => {
    const checks = $$('.analytics-visitor-check', main);
    const selected = checks.filter((c) => c.checked);
    const label = $('#analyticsSelectedVisitors', main),
      btn = $('#deleteSelectedVisitors', main),
      all = $('#analyticsSelectAllVisitors', main);
    if (label) label.textContent = `${selected.length} selected`;
    if (btn) btn.disabled = !selected.length;
    if (all) {
      all.checked = checks.length > 0 && selected.length === checks.length;
      all.indeterminate = selected.length > 0 && selected.length < checks.length;
    }
  };

  if (main.dataset.analyticsEventsBound !== '1') {
    main.dataset.analyticsEventsBound = '1';
    main.addEventListener('change', (e) => {
      if (S.currentAdminView !== 'analytics') return;
      if (e.target?.id === 'analyticsSelectAllVisitors') {
        $$('.analytics-visitor-check', main).forEach((c) => (c.checked = e.target.checked));
        updateSelection();
        return;
      }
      if (e.target?.classList?.contains('analytics-visitor-check')) updateSelection();
    });
    main.addEventListener('click', async (e) => {
      if (S.currentAdminView !== 'analytics') return;
      const visitorBtn = e.target.closest?.('[data-delete-analytics-visitor]');
      if (visitorBtn) {
        const visitorId = visitorBtn.dataset.visitorId || '',
          sessionId = visitorBtn.dataset.legacySession || '',
          name = visitorBtn.dataset.visitorName || 'this visitor';
        if (
          !analyticsConfirm(
            `Delete all analytics logs for ${name}?\n\nThis permanently removes every recorded session for this visitor. This cannot be undone.`,
          )
        )
          return;
        busy(visitorBtn, true, 'Deleting…');
        try {
          const count = visitorId
            ? await deleteVisitorAnalyticsByVisitorIds([visitorId])
            : sessionId
              ? await deleteAnalyticsSessionById(sessionId)
              : 0;
          toast(`${count} analytics ${count === 1 ? 'log' : 'logs'} deleted for ${name}.`);
        } catch (err) {
          console.error(err);
          toast('Unable to delete visitor analytics.', 'error');
        } finally {
          busy(visitorBtn, false);
        }
        return;
      }
      const selectedBtn = e.target.closest?.('#deleteSelectedVisitors');
      if (selectedBtn) {
        const checks = $$('.analytics-visitor-check', main).filter((c) => c.checked);
        if (!checks.length) return;
        if (
          !analyticsConfirm(
            `Delete analytics logs for ${checks.length} selected visitor${checks.length === 1 ? '' : 's'}?\n\nEvery recorded session belonging to the selected visitors will be permanently deleted. This cannot be undone.`,
          )
        )
          return;
        const visitorIds = [...new Set(checks.map((c) => c.dataset.visitorId).filter(Boolean))];
        const legacySessions = [...new Set(checks.map((c) => c.dataset.legacySession).filter(Boolean))];
        busy(selectedBtn, true, 'Deleting…');
        try {
          let count = 0;
          if (visitorIds.length) count += await deleteVisitorAnalyticsByVisitorIds(visitorIds);
          for (const id of legacySessions) count += await deleteAnalyticsSessionById(id);
          toast(`${count} analytics ${count === 1 ? 'log' : 'logs'} deleted.`);
        } catch (err) {
          console.error(err);
          toast('Unable to delete selected analytics.', 'error');
        } finally {
          busy(selectedBtn, false);
        }
        return;
      }
      const sessionBtn = e.target.closest?.('[data-delete-analytics-session]');
      if (sessionBtn) {
        const id = sessionBtn.dataset.sessionId,
          name = sessionBtn.dataset.sessionName || 'this visitor';
        if (
          !analyticsConfirm(
            `Delete this session log for ${name}?\n\nOnly this one session will be removed. This cannot be undone.`,
          )
        )
          return;
        busy(sessionBtn, true, 'Deleting…');
        try {
          await deleteAnalyticsSessionById(id);
          toast('Session log deleted.');
        } catch (err) {
          console.error(err);
          toast('Unable to delete session log.', 'error');
        } finally {
          busy(sessionBtn, false);
        }
        return;
      }
      const clearBtn = e.target.closest?.('#clearAllAnalyticsLogs');
      if (clearBtn) {
        const warning = `WARNING — CLEAR ALL ANALYTICS LOGS\n\nThis will permanently delete:\n• All visitor session history\n• Names stored inside those analytics sessions\n• Device / route / engagement history\n• Installed-app usage session logs\n• Broadcast shown / dismissed receipt logs\n\nIt will NOT delete:\n• Broadcast messages\n• Names of Allah, Duas, Hadith or Reminders\n• Website content\n\nThis action cannot be undone.\n\nPress OK only if you want to permanently clear ALL analytics logs.`;
        if (!analyticsConfirm(warning)) return;
        const second = prompt('Type CLEAR ALL to confirm permanent deletion of all analytics logs:');
        if (second !== 'CLEAR ALL') {
          toast('Clear all cancelled.');
          return;
        }
        busy(clearBtn, true, 'Clearing…');
        try {
          const count = await clearAllAnalyticsLogs();
          toast(`${count} analytics ${count === 1 ? 'log' : 'logs'} permanently cleared.`);
        } catch (err) {
          console.error(err);
          toast('Unable to clear analytics logs.', 'error');
        } finally {
          busy(clearBtn, false);
        }
      }
    });
  }

  const syncRows = (tbodyId, wrapId, emptyId, rows) => {
    const tbody = document.getElementById(tbodyId),
      wrap = document.getElementById(wrapId),
      empty = document.getElementById(emptyId);
    if (!tbody) return;
    const existing = new Map([...tbody.children].map((row) => [row.dataset.analyticsKey, row]));
    rows.forEach((entry, index) => {
      let row = existing.get(entry.key);
      if (!row) {
        row = document.createElement('tr');
        row.dataset.analyticsKey = entry.key;
      }
      if (row.dataset.analyticsSignature !== entry.signature) {
        const checked = row.querySelector('.analytics-visitor-check')?.checked === true;
        row.innerHTML = entry.cells;
        row.dataset.analyticsSignature = entry.signature;
        const nextCheck = row.querySelector('.analytics-visitor-check');
        if (nextCheck) nextCheck.checked = checked;
      }
      const current = tbody.children[index];
      if (current !== row) tbody.insertBefore(row, current || null);
      existing.delete(entry.key);
    });
    existing.forEach((row) => row.remove());
    if (wrap) {
      wrap.hidden = !rows.length;
      if (!rows.length) {
        wrap.classList.remove('rud-admin-expanded');
        wrap.removeAttribute('data-rud-admin-limited');
        const control = wrap.nextElementSibling;
        if (control?.classList.contains('rud-admin-view-control')) control.remove();
      }
    }
    if (empty) empty.hidden = !!rows.length;
  };
  const updateStat = (key, value, note) => {
    const stat = main.querySelector(`[data-analytics-stat="${key}"]`);
    if (!stat) return;
    const strong = stat.querySelector('strong'),
      span = stat.querySelector('span');
    if (strong) strong.textContent = String(value);
    if (span) span.textContent = String(note || '');
  };
  const setCount = (key, value) => {
    const el = main.querySelector(`[data-analytics-count="${key}"]`);
    if (el) el.textContent = value;
  };
  const syncBreakdown = (key, title, rows) => {
    const box = main.querySelector(`[data-analytics-breakdown="${key}"]`);
    if (!box) return;
    const signature = JSON.stringify(rows);
    if (box.dataset.analyticsSignature === signature) return;
    box.dataset.analyticsSignature = signature;
    box.innerHTML = `<h3>${esc(title)}</h3>${rows.length ? rows.map(([name, count]) => `<div class="analytics-row"><span title="${esc(name)}">${esc(name)}</span><b>${count}</b></div>`).join('') : `<p class="muted">No data yet.</p>`}`;
  };

  const renderAnalyticsSessions = (sessions) => {
    if (S.currentAdminView !== 'analytics') return;
    ensureShell();
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const cleanSessions = (Array.isArray(sessions) ? sessions : []).filter(Boolean);
    const allSessions = [...cleanSessions].sort((a, b) => seenMs(b) - seenMs(a));
    const today = cleanSessions.filter((s) => validDate(s.startedAt) >= todayStart);
    const month = cleanSessions.filter((s) => validDate(s.startedAt) >= monthStart);
    const visitors = summarizeVisitors(cleanSessions, now);
    const visitorByKey = new Map(visitors.map((v) => [v.key, v]));
    const activeUsers = visitors.filter((v) => v.active);
    const installedUsers = visitors.filter((v) => v.installed);
    const liveAppUsers = visitors.filter((v) => v.activeAppSession);
    const installedSessions = cleanSessions.filter(installed),
      installedMonth = month.filter(installed),
      capturedInstalls = cleanSessions.filter((s) => s.installCaptured === true);

    updateStat('active', activeUsers.length, 'unique users · website + app');
    updateStat('today', unique(today), `${today.length} sessions`);
    updateStat('month', unique(month), `${month.length} sessions`);
    updateStat('all', visitors.length, `${cleanSessions.length} sessions`);
    updateStat('avg', fmtDur(avg(month)), 'this month');
    updateStat('installs', unique(capturedInstalls), 'captured installs');
    updateStat('installed', installedUsers.length, `${unique(installedMonth)} this month`);
    updateStat('appsessions', cleanSessions.filter(appSession).length, `${month.filter(appSession).length} this month`);
    updateStat('usingapp', liveAppUsers.length, 'unique users · live now');
    updateStat('appavg', fmtDur(avg(month.filter(appSession))), 'installed app · this month');
    setCount('live-app', `${liveAppUsers.length} active`);
    setCount('installed', `${installedUsers.length} users`);
    setCount('visitors', `${visitors.length} users`);
    setCount('sessions', `${cleanSessions.length} sessions`);

    syncRows(
      'analyticsLiveBody',
      'analyticsLiveWrap',
      'analyticsLiveEmpty',
      liveAppUsers.map((v) => {
        const session = v.activeAppSession || v.latest;
        const cells = `<td><strong>${esc(visitorLabel(v))}</strong></td><td>${esc(session.installedPlatform || session.device || 'mobile')} · ${esc(String(session.installSource || session.appMode || 'App').replaceAll('_', ' '))}</td><td><span class="route-live" title="${esc(session.route || 'home')}">${esc(routePretty(session.route || 'home'))}</span></td><td>${esc(fmtDur(session.durationSeconds || 0))}</td><td>${esc(adminDateTime(new Date(v.lastSeenMs)))}</td>`;
        return {
          key: v.key,
          signature: JSON.stringify([
            visitorLabel(v),
            session.device,
            session.installedPlatform,
            session.installSource,
            session.appMode,
            session.route,
            session.durationSeconds,
            v.lastSeenMs,
          ]),
          cells,
        };
      }),
    );

    syncRows(
      'analyticsInstalledBody',
      'analyticsInstalledWrap',
      'analyticsInstalledEmpty',
      installedUsers.map((v) => {
        const session = v.installedSession || v.latest;
        const cells = `<td><strong>${esc(visitorLabel(v))}</strong></td><td>${esc(session.installedPlatform || session.device || '—')}</td><td>${esc(String(session.installSource || session.appMode || 'Installed App').replaceAll('_', ' '))}</td><td>${v.sessionCount}</td><td><span class="route-live">${esc(routePretty(v.latest.route || 'home'))}</span></td><td>${esc(adminDateTime(new Date(v.lastSeenMs)))}</td>`;
        return {
          key: v.key,
          signature: JSON.stringify([
            visitorLabel(v),
            session.installedPlatform,
            session.device,
            session.installSource,
            session.appMode,
            v.sessionCount,
            v.latest.route,
            v.lastSeenMs,
          ]),
          cells,
        };
      }),
    );

    syncRows(
      'analyticsVisitorsBody',
      'analyticsVisitorsWrap',
      'analyticsVisitorsEmpty',
      visitors.map((v) => {
        const online = v.active,
          mode = v.latest.installedApp ? 'Installed App' : String(v.latest.appMode || 'browser').replaceAll('_', ' ');
        const cells = `<td><input class="analytics-check analytics-visitor-check" type="checkbox" data-visitor-id="${esc(v.visitorId)}" data-legacy-session="${esc(v.legacySessionId)}" aria-label="Select ${esc(visitorLabel(v))}"></td><td><strong class="analytics-visitor-name ${online ? 'is-online' : 'is-offline'}"><span class="analytics-presence-dot" aria-hidden="true"></span>${esc(visitorLabel(v))}</strong><small class="analytics-presence-text">${online ? 'Online' : 'Offline'}</small></td><td>${esc(v.city || '—')}</td><td>${esc(v.region || '—')}</td><td>${esc(v.country || '—')}</td><td><span class="route-live" title="${esc(v.latest.route || 'home')}">${esc(routePretty(v.latest.route || 'home'))}</span></td><td>${v.sessionCount}</td><td>${esc(fmtDur(v.activitySeconds))}</td><td>${esc(adminDateTime(new Date(v.lastSeenMs)))}</td><td>${esc(v.latest.device || '—')} · ${esc(mode)}</td><td><button class="analytics-delete-btn" type="button" data-delete-analytics-visitor data-visitor-id="${esc(v.visitorId)}" data-legacy-session="${esc(v.legacySessionId)}" data-visitor-name="${esc(visitorLabel(v))}">Delete</button></td>`;
        return {
          key: v.key,
          signature: JSON.stringify([
            online,
            visitorLabel(v),
            v.city,
            v.region,
            v.country,
            v.latest.route,
            v.sessionCount,
            v.activitySeconds,
            v.lastSeenMs,
            v.latest.device,
            mode,
            v.visitorId,
            v.legacySessionId,
          ]),
          cells,
        };
      }),
    );

    syncRows(
      'analyticsSessionsBody',
      'analyticsSessionsWrap',
      'analyticsSessionsEmpty',
      allSessions.slice(0, 100).map((session) => {
        const key = String(session.id || session.sessionId || identityKey(session));
        const v = visitorByKey.get(identityKey(session));
        const labelText = v
          ? visitorLabel(v)
          : String(session.visitorName || '').trim() || `Visitor ${String(session.visitorId || key).slice(-6)}`;
        const cells = `<td><strong>${esc(labelText)}</strong></td><td><span class="route-live" title="${esc(session.route || 'home')}">${esc(session.route || 'home')}</span></td><td>${esc(session.device || '—')}</td><td>${esc(session.installedApp ? 'Installed App' : String(session.appMode || 'browser').replaceAll('_', ' '))}</td><td>${esc(fmtDur(session.durationSeconds || 0))}</td><td>${esc(adminDateTime(session.lastSeenAt || session.clientLastSeenMs || session.startedAt))}</td><td><button class="analytics-delete-btn" type="button" data-delete-analytics-session data-session-id="${esc(String(session.id || ''))}" data-session-name="${esc(labelText)}">Delete</button></td>`;
        return {
          key,
          signature: JSON.stringify([
            labelText,
            session.route,
            session.device,
            session.installedApp,
            session.appMode,
            session.durationSeconds,
            seenMs(session),
          ]),
          cells,
        };
      }),
    );

    const bulk = document.getElementById('analyticsVisitorBulk');
    if (bulk) bulk.hidden = !visitors.length;
    updateSelection();
    syncBreakdown('routes', 'Top Pages / Routes', topMap(month, 'route'));
    syncBreakdown('devices', 'Devices', topMap(month, 'device'));
    syncBreakdown('sources', 'Traffic Sources', topMap(month, 'referrer'));
    syncBreakdown('modes', 'App / Browser Mode', topMap(month, 'appMode'));
  };

  ensureShell();
  const cachedSessions = readAdminAnalyticsCache();
  if (cachedSessions.length) renderAnalyticsSessions(cachedSessions);

  let analyticsRenderFrame = 0,
    analyticsPendingSessions = null;
  const recentAnalyticsQuery = query(
    collection(S.db, RUD_ANALYTICS_COLLECTION),
    orderBy('lastSeenAt', 'desc'),
    limit(ANALYTICS_PAGE_SIZE),
  );
  const queueAnalyticsRender = (sessions) => {
    analyticsPendingSessions = sessions;
    writeAdminAnalyticsCache(sessions);
    if (analyticsRenderFrame) return;
    analyticsRenderFrame = requestAnimationFrame(() => {
      analyticsRenderFrame = 0;
      const next = analyticsPendingSessions || [];
      analyticsPendingSessions = null;
      renderAnalyticsSessions(next);
    });
  };
  const updateLoadOlderButton = () => {
    const btn = document.getElementById('analyticsLoadOlder');
    if (!btn) return;
    btn.disabled = analyticsPageLoading || !analyticsCanLoadMore || !analyticsLastDoc;
    btn.textContent = analyticsPageLoading ? 'Loading…' : analyticsCanLoadMore ? 'Load older' : 'All loaded';
  };
  document.getElementById('analyticsLoadOlder')?.addEventListener('click', async () => {
    if (analyticsPageLoading || !analyticsCanLoadMore || !analyticsLastDoc) return;
    analyticsPageLoading = true;
    updateLoadOlderButton();
    try {
      const olderSnap = await getDocs(
        query(
          collection(S.db, RUD_ANALYTICS_COLLECTION),
          orderBy('lastSeenAt', 'desc'),
          startAfter(analyticsLastDoc),
          limit(ANALYTICS_PAGE_SIZE),
        ),
      );
      analyticsLastDoc = olderSnap.docs[olderSnap.docs.length - 1] || analyticsLastDoc;
      analyticsCanLoadMore = olderSnap.size === ANALYTICS_PAGE_SIZE;
      analyticsOlderSessions.push(...olderSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      queueAnalyticsRender(analyticsCombined());
    } catch (err) {
      console.error('Older analytics load failed', err);
      toast('Unable to load older analytics right now.', 'error');
    } finally {
      analyticsPageLoading = false;
      updateLoadOlderButton();
    }
  });
  S.adminAnalyticsUnsub = onSnapshot(
    recentAnalyticsQuery,
    (snap) => {
      analyticsRecentSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      analyticsLastDoc = snap.docs[snap.docs.length - 1] || analyticsLastDoc;
      if (!analyticsOlderSessions.length) analyticsCanLoadMore = snap.size === ANALYTICS_PAGE_SIZE;
      queueAnalyticsRender(analyticsCombined());
      updateLoadOlderButton();
    },
    (err) => {
      console.error('Live analytics failed', err);
      if (!cachedSessions.length) {
        const empty = document.getElementById('analyticsVisitorsEmpty');
        if (empty) {
          empty.hidden = false;
          empty.textContent = 'Analytics could not load. Check visitor_sessions Firestore rules.';
        }
      } else toast('Live analytics is reconnecting. Showing the latest saved analytics snapshot.');
    },
  );
  updateLoadOlderButton();
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { analyticsAdminView };
