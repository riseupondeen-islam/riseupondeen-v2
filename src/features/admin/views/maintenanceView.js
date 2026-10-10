/**
 * Admin › Maintenance mode scheduling and allow-listed visitors.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../../runtime/store';
import { adminHeader, readAdminAnalyticsCache, writeAdminAnalyticsCache } from '../adminRouter';
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
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from '../../../services/firebase/sdk';
import { busy, esc, millis, toast } from '../../../utils/ui';

function maintenanceAdminView() {
  $('#adminTopTitle').textContent = 'Maintenance Mode';
  const cfg =
    S.adminContent.find((x) => x.id === MAINTENANCE_DOC_ID || (x.type === 'site' && x.siteKey === 'maintenance')) || {};
  const endMs = maintenanceEndMs(cfg);
  const endDate = endMs ? new Date(endMs) : null;
  let localValue = '';
  if (endDate && !Number.isNaN(endDate.getTime())) {
    const local = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000);
    localValue = local.toISOString().slice(0, 16);
  }
  const active = maintenanceIsActive(cfg);
  const initialAllowed = [
    ...new Set(
      (Array.isArray(cfg.maintenanceAllowedVisitorIds) ? cfg.maintenanceAllowedVisitorIds : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean),
    ),
  ];
  $('#adminMain').innerHTML =
    `${adminHeader('Maintenance Mode', 'Temporarily pause the public website while keeping Admin access available.', false)}
    <section class="admin-panel rud-maintenance-admin">
      <div class="admin-form-grid">
        <div class="field"><label>Maintenance</label><div class="toggle-line"><label class="switch"><input id="maintenanceEnabled" type="checkbox" ${cfg.maintenanceEnabled ? 'checked' : ''}><span></span></label><small class="muted" id="maintenanceAdminState">${active ? 'Active now' : cfg.maintenanceEnabled ? 'Scheduled time has ended' : 'Off'}</small></div></div>
        <div class="field"><label>End Date & Time</label><input class="input" id="maintenanceEndTime" type="datetime-local" value="${esc(localValue)}"></div>
        <div class="field wide"><label>Maintenance Message <small class="muted">(optional)</small></label><textarea class="textarea" id="maintenanceMessage" placeholder="Rise Upon Deen is currently under maintenance.">${esc(cfg.maintenanceMessage || '')}</textarea></div>
      </div>
      <div class="rud-maintenance-admin-preview"><small>PUBLIC COUNTDOWN</small><strong id="maintenanceAdminCountdown">${active ? formatMaintenanceRemaining(endMs - Date.now()) : '00:00:00'}</strong><span>${active ? 'Maintenance is currently blocking public access except allowed visitors.' : 'Public website is available.'}</span></div>
      <div class="form-actions"><button class="premium-btn primary" id="saveMaintenance" type="button">Save Maintenance Schedule</button><button class="premium-btn" id="endMaintenanceNow" type="button" ${cfg.maintenanceEnabled ? '' : 'disabled'}>End Maintenance Now</button></div>
    </section>
    <section class="admin-panel rud-maintenance-admin">
      <div class="admin-panel-head"><div><h2>Maintenance Access</h2><p class="muted">Allow selected existing visitors to use Rise Upon Deen while maintenance is active. Access is matched only by the existing stable visitor ID.</p></div><span class="status-pill" id="maintenanceAllowedCount">${initialAllowed.length} allowed</span></div>
      <div id="maintenanceAccessUsers"><div class="empty-live">Loading recent visitors…</div></div>
      <div class="form-actions"><button class="premium-btn primary" id="grantMaintenanceAccess" type="button">Grant Access</button><button class="premium-btn" id="removeMaintenanceAccess" type="button">Remove Access</button></div>
    </section>`;

  let autoEndWritten = false;
  let previewTimer = setInterval(async () => {
    const el = $('#maintenanceAdminCountdown');
    if (!el) {
      clearInterval(previewTimer);
      return;
    }
    const input = $('#maintenanceEndTime')?.value;
    const ms = input ? new Date(input).getTime() - Date.now() : 0;
    el.textContent = formatMaintenanceRemaining(ms);
    if ($('#maintenanceEnabled')?.checked && input && ms <= 0 && !autoEndWritten) {
      autoEndWritten = true;
      try {
        await setDoc(
          doc(S.db, COLLECTION, MAINTENANCE_DOC_ID),
          {
            type: 'site',
            siteKey: 'maintenance',
            title: 'Maintenance Configuration',
            published: true,
            maintenanceEnabled: false,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } catch {
        autoEndWritten = false;
      }
    }
  }, 1000);

  const currentMaintenanceCfg = () =>
    S.adminContent.find((x) => x.id === MAINTENANCE_DOC_ID || (x.type === 'site' && x.siteKey === 'maintenance')) ||
    cfg;
  const currentAllowed = () =>
    new Set(
      (Array.isArray(currentMaintenanceCfg().maintenanceAllowedVisitorIds)
        ? currentMaintenanceCfg().maintenanceAllowedVisitorIds
        : []
      )
        .map((x) => String(x || '').trim())
        .filter(Boolean),
    );
  const sessionSeenMs = (s) => Math.max(Number(s?.clientLastSeenMs) || 0, millis(s?.lastSeenAt), millis(s?.startedAt));
  const visitorRows = (sessions) => {
    const map = new Map();
    (Array.isArray(sessions) ? sessions : []).forEach((s) => {
      const visitorId = String(s?.visitorId || '').trim();
      if (!visitorId) return;
      const prev = map.get(visitorId);
      if (!prev || sessionSeenMs(s) > sessionSeenMs(prev)) map.set(visitorId, s);
    });
    currentAllowed().forEach((visitorId) => {
      if (!map.has(visitorId))
        map.set(visitorId, { visitorId, visitorName: '', city: '', country: '', clientLastSeenMs: 0 });
    });
    return [...map.values()].sort((a, b) => sessionSeenMs(b) - sessionSeenMs(a));
  };
  const renderAccessUsers = (sessions) => {
    const host = $('#maintenanceAccessUsers');
    if (!host) return;
    const allowed = currentAllowed(),
      rows = visitorRows(sessions);
    const count = $('#maintenanceAllowedCount');
    if (count) count.textContent = `${allowed.size} allowed`;
    host.innerHTML = rows.length
      ? `<div class="table-wrap"><table><thead><tr><th></th><th>User</th><th>Location</th><th>Access</th></tr></thead><tbody>${rows
          .map((s) => {
            const visitorId = String(s.visitorId || '').trim(),
              name = String(s.visitorName || '').trim() || `Visitor ${visitorId.slice(-6)}`,
              city = String(s.city || '').trim(),
              country = String(s.country || '').trim();
            return `<tr><td><input type="checkbox" data-maintenance-visitor="${esc(visitorId)}" aria-label="Select ${esc(name)}"></td><td><strong>${esc(name)}</strong><br><small>${esc(visitorId.slice(0, 8))}…${esc(visitorId.slice(-6))}</small></td><td>${esc([city, country].filter(Boolean).join(' · ') || '—')}</td><td><span class="status-pill ${allowed.has(visitorId) ? 'live' : ''}">${allowed.has(visitorId) ? 'Allowed' : 'Blocked'}</span></td></tr>`;
          })
          .join('')}</tbody></table></div>`
      : `<div class="empty-live">No recent visitors are available yet.</div>`;
  };
  const loadAccessUsers = async () => {
    let sessions = readAdminAnalyticsCache();
    renderAccessUsers(sessions);
    try {
      const snap = await getDocs(
        query(collection(S.db, RUD_ANALYTICS_COLLECTION), orderBy('lastSeenAt', 'desc'), limit(120)),
      );
      const fresh = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (fresh.length) {
        writeAdminAnalyticsCache(fresh);
        sessions = fresh;
      }
      renderAccessUsers(sessions);
    } catch (e) {
      console.warn('Maintenance visitor list could not refresh.', e);
      if (!sessions.length) {
        const host = $('#maintenanceAccessUsers');
        if (host)
          host.innerHTML =
            '<div class="empty-live">Recent visitors could not be loaded. Check analytics read permission.</div>';
      }
    }
  };
  const selectedVisitorIds = () =>
    $$('[data-maintenance-visitor]:checked')
      .map((el) => String(el.dataset.maintenanceVisitor || '').trim())
      .filter(Boolean);
  const updateMaintenanceAccess = async (mode) => {
    const ids = selectedVisitorIds();
    if (!ids.length) return toast('Select at least one visitor.', 'error');
    const allowed = currentAllowed();
    ids.forEach((id) => (mode === 'grant' ? allowed.add(id) : allowed.delete(id)));
    const btn = mode === 'grant' ? $('#grantMaintenanceAccess') : $('#removeMaintenanceAccess');
    busy(btn, true, mode === 'grant' ? 'Granting…' : 'Removing…');
    try {
      await setDoc(
        doc(S.db, COLLECTION, MAINTENANCE_DOC_ID),
        {
          type: 'site',
          siteKey: 'maintenance',
          title: 'Maintenance Configuration',
          published: true,
          maintenanceAllowedVisitorIds: [...allowed],
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      const local = currentMaintenanceCfg();
      local.maintenanceAllowedVisitorIds = [...allowed];
      renderAccessUsers(readAdminAnalyticsCache());
      toast(mode === 'grant' ? 'Maintenance access granted.' : 'Maintenance access removed.');
    } catch (e) {
      console.error(e);
      toast(
        e?.code === 'permission-denied'
          ? 'Permission denied. Check Firestore security rules.'
          : 'Unable to update maintenance access.',
        'error',
      );
    } finally {
      busy(btn, false);
    }
  };

  $('#saveMaintenance')?.addEventListener('click', async () => {
    const enabled = $('#maintenanceEnabled').checked,
      endRaw = $('#maintenanceEndTime').value,
      message = $('#maintenanceMessage').value.trim();
    const end = endRaw ? new Date(endRaw) : null;
    if (enabled && (!end || !Number.isFinite(end.getTime()) || end.getTime() <= Date.now()))
      return toast('Choose a future maintenance end date and time.', 'error');
    const btn = $('#saveMaintenance');
    busy(btn, true, 'Saving…');
    try {
      await setDoc(
        doc(S.db, COLLECTION, MAINTENANCE_DOC_ID),
        {
          type: 'site',
          siteKey: 'maintenance',
          title: 'Maintenance Configuration',
          published: true,
          maintenanceEnabled: enabled,
          maintenanceEndTime: end || null,
          maintenanceMessage: message,
          maintenanceAllowedVisitorIds: [...currentAllowed()],
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      toast(enabled ? 'Maintenance schedule saved.' : 'Maintenance is off.');
    } catch (e) {
      console.error(e);
      toast(
        e.code === 'permission-denied'
          ? 'Permission denied. Check Firestore rules.'
          : 'Unable to save maintenance settings.',
        'error',
      );
    } finally {
      busy(btn, false);
    }
  });
  $('#endMaintenanceNow')?.addEventListener('click', async () => {
    const btn = $('#endMaintenanceNow');
    busy(btn, true, 'Ending…');
    try {
      await setDoc(
        doc(S.db, COLLECTION, MAINTENANCE_DOC_ID),
        {
          type: 'site',
          siteKey: 'maintenance',
          title: 'Maintenance Configuration',
          published: true,
          maintenanceEnabled: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      toast('Maintenance ended. Public website is available.');
    } catch (e) {
      console.error(e);
      toast('Unable to end maintenance.', 'error');
    } finally {
      busy(btn, false);
    }
  });
  $('#grantMaintenanceAccess')?.addEventListener('click', () => updateMaintenanceAccess('grant'));
  $('#removeMaintenanceAccess')?.addEventListener('click', () => updateMaintenanceAccess('remove'));
  loadAccessUsers();
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { maintenanceAdminView };
