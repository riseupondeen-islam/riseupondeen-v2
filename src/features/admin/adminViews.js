/**
 * Admin view dispatcher (renderAdminView) and the fatal-error recovery panel.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { rudIsAdminRoute } from '../../app/routing/routeState';
import { renderAdminRoute } from './adminRouter';
import { analyticsAdminView } from './views/analyticsView';
import { broadcastAdminView } from './views/broadcastView';
import { bulkUploadView } from './views/bulkUpload';
import { editor } from './views/contentEditor';
import { manager } from './views/contentManager';
import { deenFriendsAdminView } from './views/deenFriendsAdminView';
import { maintenanceAdminView } from './views/maintenanceView';
import { notificationAdminView } from './views/notificationsView';
import { scheduledAdminView } from './views/scheduledView';
import { trashAdminView } from './views/trashView';
import { renderReactAdminView, unmountReactAdminView } from './react/reactAdminViews';
import { $ } from '../../runtime/core';
import { esc, label } from '../../utils/ui';

function renderAdminFatal(err) {
  const main = $('#adminMain');
  if (!main) return;
  const message = String(err?.message || 'The Admin Console could not render this section.');
  main.innerHTML = `<section class="admin-panel" style="padding:28px"><div class="admin-head"><div><h1>Admin Console</h1><p>Something went wrong while opening this section.</p></div></div><div class="admin-persist-note"><strong>Safe recovery:</strong> Firebase authentication is still active. Refresh the section or sign out and sign in again.</div><pre style="white-space:pre-wrap;overflow:auto;opacity:.7">${esc(message)}</pre><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="premium-btn primary" type="button" id="rudAdminRetry">Retry</button><button class="premium-btn" type="button" id="rudAdminReload">Reload Admin</button></div></section>`;
  $('#rudAdminRetry')?.addEventListener('click', () => {
    try {
      renderAdminView(S.currentAdminView);
    } catch (e) {
      renderAdminFatal(e);
    }
  });
  $('#rudAdminReload')?.addEventListener('click', () => {
    if (rudIsAdminRoute()) renderAdminRoute();
  });
}
function renderAdminView(v) {
  /* React-based admin views (Daily Deen Challenges, RISE Inbox) are unmounted before any other view renders. */
  unmountReactAdminView();
  if (v === 'daily-challenges' || v === 'rise-inbox' || v === 'app-guide' || v === 'monthly-winner') {
    S.currentAdminView = v;
    $('#adminTopTitle').textContent =
      v === 'daily-challenges'
        ? 'Daily Deen Challenges'
        : v === 'app-guide'
          ? 'App Guide'
          : v === 'monthly-winner'
            ? 'Monthly Winner'
            : 'RISE Inbox';
    return renderReactAdminView(v);
  }
  if (v !== 'analytics' && typeof S.adminAnalyticsUnsub === 'function') {
    try {
      S.adminAnalyticsUnsub();
    } catch {}
    S.adminAnalyticsUnsub = null;
  }
  const pages = {
    names: ['name', 'Names of Allah'],
    duas: ['dua', 'Duas'],
    hadith: ['hadith', 'Hadith'],
    reminders: ['reminder', 'Reminders'],
    zikr: ['zikr', 'Zikr'],
    sadaqah: ['sadaqah', 'Sadaqah Requests'],
  };
  if (v === 'analytics') {
    S.currentAdminView = 'analytics';
    return analyticsAdminView();
  }
  if (v === 'broadcast') {
    S.currentAdminView = 'broadcast';
    return broadcastAdminView();
  }
  if (v === 'notifications') {
    S.currentAdminView = 'notifications';
    return notificationAdminView();
  }
  if (v === 'deen-friends') {
    S.currentAdminView = 'deen-friends';
    $('#adminTopTitle').textContent = 'Deen Friends · Trust & Safety';
    return deenFriendsAdminView();
  }
  if (v === 'maintenance') {
    S.currentAdminView = 'maintenance';
    return maintenanceAdminView();
  }
  if (v === 'scheduled') {
    S.currentAdminView = 'scheduled';
    return scheduledAdminView();
  }
  if (v === 'trash') {
    S.currentAdminView = 'trash';
    return trashAdminView();
  }

  if (v === 'upload') {
    S.currentAdminView = 'upload';
    $('#adminTopTitle').textContent = S.bulkPresetType ? `Upload ${label(S.bulkPresetType)}` : 'Upload Content';
    return bulkUploadView(S.bulkPresetType || '');
  }
  if (v === 'editor') {
    S.currentAdminView = 'editor';
    $('#adminTopTitle').textContent = 'Content Editor';
    return editor();
  }
  if (v === 'manage') {
    S.currentAdminView = 'manage';
    $('#adminTopTitle').textContent = 'Manage Content';
    return manager({});
  }
  if (!pages[v]) v = 'names';
  S.currentAdminView = v;
  $('#adminTopTitle').textContent = pages[v][1];
  return manager({ type: pages[v][0], title: pages[v][1] });
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { renderAdminFatal, renderAdminView };
