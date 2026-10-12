/**
 * Admin view dispatcher (renderAdminView), the per-view lifecycle and the fatal-error recovery panel.
 *
 * Lifecycle: every view that attaches listeners, timers or Firestore subscriptions registers their
 * cleanup with onViewCleanup()/viewSignal(). Before ANY view renders, the previous view's cleanups
 * run and the React root is unmounted, so listeners are never duplicated when a section is opened
 * again (previously every visit to Deen Friends added another click handler to #adminMain, and
 * every handler ran on every click).
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
import { REACT_ADMIN_VIEWS, renderReactAdminView, unmountReactAdminView } from './react/reactAdminViews';
import { $ } from '../../runtime/core';
import { esc, label } from '../../utils/ui';

let cleanups = [];

/** Registers a function to run when the current view is replaced or the console is closed. */
export function onViewCleanup(fn) {
  if (typeof fn === 'function') cleanups.push(fn);
}
/** An AbortSignal that aborts when the current view is replaced (use for addEventListener). */
export function viewSignal() {
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  return controller.signal;
}
function runViewCleanups() {
  const list = cleanups;
  cleanups = [];
  for (const fn of list) {
    try {
      fn();
    } catch (err) {
      console.warn('[Admin] view cleanup failed', err);
    }
  }
}
/** Stops the current view completely (leaving the admin route, signing out). */
function suspendAdminView() {
  runViewCleanups();
  unmountReactAdminView();
  if (typeof S.adminAnalyticsUnsub === 'function') {
    try {
      S.adminAnalyticsUnsub();
    } catch {}
    S.adminAnalyticsUnsub = null;
  }
  const main = $('#adminMain');
  if (main) main.innerHTML = '';
}

const TITLES = {
  dashboard: 'Dashboard',
  analytics: 'Visitor Analytics',
  broadcast: 'Broadcast Message',
  notifications: 'Send Notification',
  'deen-friends': 'Deen Friends · Trust & Safety',
  maintenance: 'Maintenance Mode',
  scheduled: 'Scheduled Publishing',
  trash: 'Recycle Bin',
  'daily-challenges': 'Daily Deen Challenges',
  'rise-inbox': 'RISE Inbox',
  'rise-messages': 'RISE Messages',
  'app-guide': 'App Guide',
  'monthly-winner': 'Monthly Winner',
  'data-reset': 'Data & Accounts',
};

function renderAdminFatal(err) {
  const main = $('#adminMain');
  if (!main) return;
  const message = String(err?.message || 'The Admin Console could not render this section.');
  main.innerHTML = `<section class="admin-panel rad-fatal"><div class="admin-head"><div><h1>Something went wrong</h1><p>This section could not be opened. Your sign-in is still active.</p></div></div><div class="rad-alert rad-alert-error">${esc(message)}</div><div class="form-actions"><button class="premium-btn primary" type="button" id="rudAdminRetry">Retry</button><button class="premium-btn" type="button" id="rudAdminReload">Reload console</button></div></section>`;
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

/**
 * Renders a view into #adminMain. `live: true` is a refresh of the same view caused by new data
 * (the content listener); views keep their search/filter state across it.
 */
function renderAdminView(v, opts = {}) {
  runViewCleanups();
  unmountReactAdminView();
  const main = $('#adminMain');
  if (main && !opts.live) main.removeAttribute('aria-busy');
  if (REACT_ADMIN_VIEWS.includes(v)) {
    S.currentAdminView = v;
    $('#adminTopTitle').textContent = TITLES[v] || 'Admin';
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
  const simple = {
    analytics: analyticsAdminView,
    broadcast: broadcastAdminView,
    notifications: notificationAdminView,
    'deen-friends': deenFriendsAdminView,
    maintenance: maintenanceAdminView,
    scheduled: scheduledAdminView,
    trash: trashAdminView,
  };
  if (simple[v]) {
    S.currentAdminView = v;
    $('#adminTopTitle').textContent = TITLES[v];
    return simple[v]();
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
    return manager({ live: !!opts.live });
  }
  if (!pages[v]) v = 'dashboard';
  if (v === 'dashboard') return renderAdminView('dashboard');
  S.currentAdminView = v;
  $('#adminTopTitle').textContent = pages[v][1];
  return manager({ type: pages[v][0], title: pages[v][1], live: !!opts.live });
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { renderAdminFatal, renderAdminView, suspendAdminView };
