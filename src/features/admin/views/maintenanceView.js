/**
 * Admin › Maintenance mode scheduling and Maintenance Access (allow-listed visitors).
 *
 * Maintenance Access is the maintenanceAllowedVisitorIds list on content/rud_maintenance_config.
 * - Grants and revocations run in a Firestore transaction that re-reads the current list, so two
 *   admins (or two tabs) changing access at the same time never overwrite each other.
 * - Visitors' apps hold a live listener on that document (features/maintenance/maintenance.js), so
 *   a grant or revocation takes effect on their screen as soon as the server confirms it — no
 *   sign-out, refresh or reinstall needed.
 * - Only the Super Admin may change this document (firestore.rules), not just any admin role.
 * This view also follows the document live, so its status and access list are always current.
 */
import { S } from '../../../runtime/store';
import { adminHeader, readAdminAnalyticsCache, writeAdminAnalyticsCache } from '../adminRouter';
import { onViewCleanup } from '../adminViews';
import { RUD_ANALYTICS_COLLECTION } from '../../analytics/visitorAnalytics';
import {
  MAINTENANCE_DOC_ID,
  formatMaintenanceRemaining,
  maintenanceEndMs,
  maintenanceIsActive,
} from '../../maintenance/maintenance';
import { $, $$, COLLECTION } from '../../../runtime/core';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from '../../../services/firebase/sdk';
import { busy, esc, millis, toast } from '../../../utils/ui';

const BASE = { type: 'site', siteKey: 'maintenance', title: 'Maintenance Configuration', published: true };
const cleanIds = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x || '').trim()).filter(Boolean))];
const errorText = (e, fallback) =>
  e?.code === 'permission-denied' || /permission/i.test(String(e?.code || ''))
    ? 'Permission denied. Only the Super Admin can change maintenance settings.'
    : !navigator.onLine
      ? 'You appear to be offline. Nothing was changed.'
      : fallback;

function maintenanceAdminView() {
  $('#adminTopTitle').textContent = 'Maintenance Mode';
  let cfg =
    S.adminContent.find((x) => x.id === MAINTENANCE_DOC_ID || (x.type === 'site' && x.siteKey === 'maintenance')) || {};
  const endMs = maintenanceEndMs(cfg);
  const endDate = endMs ? new Date(endMs) : null;
  let localValue = '';
  if (endDate && !Number.isNaN(endDate.getTime())) {
    const local = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000);
    localValue = local.toISOString().slice(0, 16);
  }
  const selected = new Set();
  let sessions = readAdminAnalyticsCache();

  $('#adminMain').innerHTML =
    `${adminHeader('Maintenance Mode', 'Temporarily pause the public website while keeping Admin access available.', false)}
    <section class="admin-panel rud-maintenance-admin">
      <div class="admin-panel-head"><div><h2>Schedule</h2><p class="muted">While maintenance is on, visitors see a countdown page until the end time. Allowed visitors keep full access.</p></div><span class="status-pill" id="maintenanceAdminState"></span></div>
      <div class="admin-form-grid">
        <div class="field"><label for="maintenanceEnabled">Maintenance</label><div class="toggle-line"><label class="switch"><input id="maintenanceEnabled" type="checkbox" ${cfg.maintenanceEnabled ? 'checked' : ''}><span></span></label><small class="muted">Turn on, choose an end time, then save.</small></div></div>
        <div class="field"><label for="maintenanceEndTime">End date &amp; time</label><input class="input" id="maintenanceEndTime" type="datetime-local" value="${esc(localValue)}"></div>
        <div class="field wide"><label for="maintenanceMessage">Maintenance message <small class="muted">(optional)</small></label><textarea class="textarea" id="maintenanceMessage" placeholder="Rise Upon Deen is currently under maintenance.">${esc(cfg.maintenanceMessage || '')}</textarea></div>
      </div>
      <div class="rud-maintenance-admin-preview"><small>PUBLIC COUNTDOWN</small><strong id="maintenanceAdminCountdown">00:00:00</strong><span id="maintenanceAdminSummary"></span></div>
      <div class="form-actions"><button class="premium-btn primary" id="saveMaintenance" type="button">Save maintenance schedule</button><button class="premium-btn" id="endMaintenanceNow" type="button">End maintenance now</button></div>
    </section>
    <section class="admin-panel rud-maintenance-admin">
      <div class="admin-panel-head"><div><h2>Maintenance Access</h2><p class="muted">Let selected visitors keep using Rise Upon Deen while maintenance is active. Access is matched by the visitor’s stable visitor ID and takes effect on their open app immediately.</p></div><span class="status-pill" id="maintenanceAllowedCount">0 allowed</span></div>
      <div class="manager-toolbar"><div style="display:flex;gap:8px;flex-wrap:wrap;flex:1 1 360px"><input class="input" id="maintenanceGrantId" placeholder="Grant by visitor ID (e.g. from Analytics)" autocomplete="off" spellcheck="false" style="flex:1 1 240px"><button class="premium-btn" id="maintenanceGrantIdBtn" type="button">Grant ID</button></div><button class="premium-btn small" id="maintenanceRefreshVisitors" type="button">Refresh visitors</button></div>
      <div id="maintenanceAccessUsers"><div class="empty-live">Loading recent visitors…</div></div>
      <div class="form-actions"><span class="muted" id="maintenanceSelected">0 selected</span><button class="premium-btn primary" id="grantMaintenanceAccess" type="button" disabled>Grant access</button><button class="premium-btn" id="removeMaintenanceAccess" type="button" disabled>Remove access</button></div>
    </section>`;

  const currentAllowed = () => new Set(cleanIds(cfg.maintenanceAllowedVisitorIds));
  const renderState = () => {
    const active = maintenanceIsActive(cfg);
    const state = $('#maintenanceAdminState');
    if (state) {
      state.textContent = active ? 'Active now' : cfg.maintenanceEnabled ? 'Scheduled time has ended' : 'Off';
      state.className = `status-pill ${active ? 'live' : ''}`;
    }
    const summary = $('#maintenanceAdminSummary');
    if (summary)
      summary.textContent = active
        ? 'Maintenance is blocking public access except allowed visitors.'
        : 'The public website is available.';
    const end = $('#endMaintenanceNow');
    if (end) end.disabled = !cfg.maintenanceEnabled;
  };

  let autoEndWritten = false;
  const previewTimer = setInterval(async () => {
    const el = $('#maintenanceAdminCountdown');
    if (!el) return;
    const input = $('#maintenanceEndTime')?.value;
    const ms = input ? new Date(input).getTime() - Date.now() : 0;
    el.textContent = formatMaintenanceRemaining(ms);
    // When the saved end time passes while this page is open, switch maintenance off (as before).
    if (cfg.maintenanceEnabled && maintenanceEndMs(cfg) && maintenanceEndMs(cfg) <= Date.now() && !autoEndWritten) {
      autoEndWritten = true;
      try {
        await setDoc(doc(S.db, COLLECTION, MAINTENANCE_DOC_ID), { ...BASE, maintenanceEnabled: false, updatedAt: serverTimestamp() }, { merge: true });
      } catch {
        autoEndWritten = false;
      }
    }
  }, 1000);
  onViewCleanup(() => clearInterval(previewTimer));

  const sessionSeenMs = (s) => Math.max(Number(s?.clientLastSeenMs) || 0, millis(s?.lastSeenAt), millis(s?.startedAt));
  const visitorRows = () => {
    const map = new Map();
    (Array.isArray(sessions) ? sessions : []).forEach((s) => {
      const visitorId = String(s?.visitorId || '').trim();
      if (!visitorId) return;
      const prev = map.get(visitorId);
      if (!prev || sessionSeenMs(s) > sessionSeenMs(prev)) map.set(visitorId, s);
    });
    currentAllowed().forEach((visitorId) => {
      if (!map.has(visitorId)) map.set(visitorId, { visitorId, visitorName: '', city: '', country: '', clientLastSeenMs: 0 });
    });
    return [...map.values()].sort((a, b) => sessionSeenMs(b) - sessionSeenMs(a));
  };
  const syncSelection = () => {
    const n = selected.size;
    const label = $('#maintenanceSelected');
    if (label) label.textContent = `${n} selected`;
    const g = $('#grantMaintenanceAccess'),
      r = $('#removeMaintenanceAccess');
    if (g && !g.dataset.busy) g.disabled = !n;
    if (r && !r.dataset.busy) r.disabled = !n;
  };
  const renderAccessUsers = () => {
    const host = $('#maintenanceAccessUsers');
    if (!host) return;
    const allowed = currentAllowed(),
      rows = visitorRows();
    const count = $('#maintenanceAllowedCount');
    if (count) count.textContent = `${allowed.size} allowed`;
    host.innerHTML = rows.length
      ? `<div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="maintenanceSelectAll" aria-label="Select all visitors"></th><th>Visitor</th><th>Location</th><th>Last seen</th><th>Access</th></tr></thead><tbody>${rows
          .map((s) => {
            const visitorId = String(s.visitorId || '').trim(),
              name = String(s.visitorName || '').trim() || `Visitor ${visitorId.slice(-6)}`,
              city = String(s.city || '').trim(),
              country = String(s.country || '').trim(),
              seen = sessionSeenMs(s);
            return `<tr><td><input type="checkbox" data-maintenance-visitor="${esc(visitorId)}" ${selected.has(visitorId) ? 'checked' : ''} aria-label="Select ${esc(name)}"></td><td><strong>${esc(name)}</strong><br><small class="muted" title="${esc(visitorId)}">${esc(visitorId.slice(0, 8))}…${esc(visitorId.slice(-6))}</small></td><td>${esc([city, country].filter(Boolean).join(' · ') || '—')}</td><td>${seen ? esc(new Date(seen).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })) : '—'}</td><td><span class="status-pill ${allowed.has(visitorId) ? 'live' : ''}">${allowed.has(visitorId) ? 'Allowed' : 'Blocked'}</span></td></tr>`;
          })
          .join('')}</tbody></table></div>`
      : `<div class="empty-live">No recent visitors are available yet. You can still grant access by visitor ID.</div>`;
    syncSelection();
  };
  const loadAccessUsers = async () => {
    const btn = $('#maintenanceRefreshVisitors');
    if (btn?.disabled) return;
    busy(btn, true, 'Refreshing…');
    renderAccessUsers();
    try {
      const snap = await getDocs(query(collection(S.db, RUD_ANALYTICS_COLLECTION), orderBy('lastSeenAt', 'desc'), limit(120)));
      const fresh = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      writeAdminAnalyticsCache(fresh);
      sessions = fresh;
      renderAccessUsers();
    } catch (e) {
      console.warn('Maintenance visitor list could not refresh.', e);
      if (!sessions.length) {
        const host = $('#maintenanceAccessUsers');
        if (host) host.innerHTML = '<div class="empty-live">Recent visitors could not be loaded. Check analytics read permission.</div>';
      } else toast('Visitors could not be refreshed. Showing the last loaded list.', 'error');
    } finally {
      busy(btn, false);
    }
  };

  /** Adds or removes visitor IDs atomically against the server's current list. */
  const changeAccess = async (mode, ids, btn) => {
    if (!ids.length) return toast('Select at least one visitor.', 'error');
    if (btn?.dataset.busy) return;
    if (btn) btn.dataset.busy = '1';
    busy(btn, true, mode === 'grant' ? 'Granting…' : 'Removing…');
    try {
      const ref = doc(S.db, COLLECTION, MAINTENANCE_DOC_ID);
      const next = await runTransaction(S.db, async (tx) => {
        const snap = await tx.get(ref);
        const allowed = new Set(cleanIds(snap.exists() ? snap.data().maintenanceAllowedVisitorIds : []));
        ids.forEach((id) => (mode === 'grant' ? allowed.add(id) : allowed.delete(id)));
        const list = [...allowed];
        tx.set(ref, { ...BASE, maintenanceAllowedVisitorIds: list, updatedAt: serverTimestamp() }, { merge: true });
        return list;
      });
      cfg = { ...cfg, maintenanceAllowedVisitorIds: next };
      ids.forEach((id) => selected.delete(id));
      renderAccessUsers();
      toast(
        mode === 'grant'
          ? `Access granted to ${ids.length} visitor${ids.length === 1 ? '' : 's'}. Their open app updates now.`
          : `Access removed for ${ids.length} visitor${ids.length === 1 ? '' : 's'}. Their open app updates now.`,
      );
    } catch (e) {
      console.error(e);
      toast(errorText(e, 'Unable to update maintenance access. Nothing was changed.'), 'error');
    } finally {
      if (btn) delete btn.dataset.busy;
      busy(btn, false);
      syncSelection();
    }
  };

  const host = $('#maintenanceAccessUsers');
  host?.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'maintenanceSelectAll') {
      $$('[data-maintenance-visitor]').forEach((box) => {
        if (box.closest('tr')?.hasAttribute('data-rad-out')) return; // respect active filters
        box.checked = t.checked;
        t.checked ? selected.add(box.dataset.maintenanceVisitor) : selected.delete(box.dataset.maintenanceVisitor);
      });
      return syncSelection();
    }
    if (t.matches?.('[data-maintenance-visitor]')) {
      const id = String(t.dataset.maintenanceVisitor || '').trim();
      t.checked ? selected.add(id) : selected.delete(id);
      syncSelection();
    }
  });

  $('#grantMaintenanceAccess')?.addEventListener('click', (e) => changeAccess('grant', [...selected], e.currentTarget));
  $('#removeMaintenanceAccess')?.addEventListener('click', (e) => changeAccess('remove', [...selected], e.currentTarget));
  $('#maintenanceGrantIdBtn')?.addEventListener('click', (e) => {
    const input = $('#maintenanceGrantId');
    const id = String(input?.value || '').trim();
    if (!/^[A-Za-z0-9_-]{6,120}$/.test(id)) return toast('Enter a valid visitor ID (letters, numbers, - or _).', 'error');
    changeAccess('grant', [id], e.currentTarget).then(() => {
      if (input) input.value = '';
    });
  });
  $('#maintenanceRefreshVisitors')?.addEventListener('click', loadAccessUsers);

  $('#saveMaintenance')?.addEventListener('click', async () => {
    const enabled = $('#maintenanceEnabled').checked,
      endRaw = $('#maintenanceEndTime').value,
      message = $('#maintenanceMessage').value.trim();
    const end = endRaw ? new Date(endRaw) : null;
    if (enabled && (!end || !Number.isFinite(end.getTime()) || end.getTime() <= Date.now()))
      return toast('Choose a future maintenance end date and time.', 'error');
    const btn = $('#saveMaintenance');
    if (btn.disabled) return;
    busy(btn, true, 'Saving…');
    try {
      // The access list is not written here, so a concurrent grant is never overwritten.
      await setDoc(
        doc(S.db, COLLECTION, MAINTENANCE_DOC_ID),
        { ...BASE, maintenanceEnabled: enabled, maintenanceEndTime: end || null, maintenanceMessage: message, updatedAt: serverTimestamp() },
        { merge: true },
      );
      autoEndWritten = false;
      toast(enabled ? 'Maintenance schedule saved.' : 'Maintenance is off.');
    } catch (e) {
      console.error(e);
      toast(errorText(e, 'Unable to save maintenance settings.'), 'error');
    } finally {
      busy(btn, false);
    }
  });
  $('#endMaintenanceNow')?.addEventListener('click', async () => {
    const btn = $('#endMaintenanceNow');
    if (btn.disabled) return;
    busy(btn, true, 'Ending…');
    try {
      await setDoc(doc(S.db, COLLECTION, MAINTENANCE_DOC_ID), { ...BASE, maintenanceEnabled: false, updatedAt: serverTimestamp() }, { merge: true });
      $('#maintenanceEnabled').checked = false;
      toast('Maintenance ended. The public website is available.');
    } catch (e) {
      console.error(e);
      toast(errorText(e, 'Unable to end maintenance.'), 'error');
    } finally {
      busy(btn, false);
      renderState();
    }
  });

  // Follow the configuration live (other admins, other tabs, the scheduler's auto-end).
  const unsub = onSnapshot(
    doc(S.db, COLLECTION, MAINTENANCE_DOC_ID),
    (snap) => {
      cfg = snap.exists() ? { id: snap.id, ...snap.data() } : {};
      renderState();
      renderAccessUsers();
    },
    (e) => console.warn('Maintenance config listener failed', e),
  );
  onViewCleanup(unsub);

  renderState();
  renderAccessUsers();
  loadAccessUsers();
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { maintenanceAdminView };
