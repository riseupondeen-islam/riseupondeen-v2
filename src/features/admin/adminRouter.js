/**
 * Admin console shell: route entry (renderAdminRoute), login vs dashboard, live content listener, navigation, analytics deletion helpers.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { rudIsAdminRoute } from '../../app/routing/routeState';
import { cacheAdminContent, readAdminCache } from './adminPersistence';
import { renderAdminFatal, renderAdminView } from './adminViews';
import { RUD_ANALYTICS_COLLECTION } from '../analytics/visitorAnalytics';
import { rudHideBroadcast, rudStopBroadcastListener } from '../broadcast/broadcast';
import { stopMaintenanceLive } from '../maintenance/maintenance';
import { ensureLegacyZikrSeed } from '../zikr/legacyZikrSeed';
import { $, COLLECTION, publicFooter, publicMain } from '../../runtime/core';
import { rudDeduplicateContent } from '../../services/content/publicContentCache';
import { ADMIN_EMAIL } from '../../services/firebase/config';
import { configured, firebaseInitPromise } from '../../services/firebase/firebaseInit';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from '../../services/firebase/sdk';
import { esc, millis, sorted, toast } from '../../utils/ui';

let RUD_ADMIN_ANALYTICS_CACHE_KEY;

/* ==============================
   ADMIN ROUTING + LISTENER
================================ */
function renderAdminRoute() {
  try {
    rudStopBroadcastListener();
    rudHideBroadcast(false);
  } catch {}
  try {
    S.publicUnsub?.();
    S.publicUnsub = null;
  } catch {}
  try {
    stopMaintenanceLive();
  } catch {}
  document.documentElement.removeAttribute('data-maintenance');
  document.body.style.visibility = '';
  document.documentElement.style.visibility = '';
  publicMain.hidden = true;
  publicFooter.hidden = true;
  $('#dynamicPage').hidden = true;
  $('#adminApp').hidden = false;
  document.title = 'Content Administration | Rise Upon Deen';
  bindAdminNavigation();
  if (!configured()) return showAdminLogin();
  if (!S.firebaseReady) {
    showAdminLogin();
    /* FIX: only re-render once Firebase is actually ready. Re-rendering unconditionally looped forever
       (renderAdminRoute -> resolved promise -> renderAdminRoute ...) and froze the tab when the SDK could not load. */
    Promise.resolve(firebaseInitPromise)
      .then(() => {
        if (S.firebaseReady && rudIsAdminRoute()) renderAdminRoute();
      })
      .catch((err) => {
        console.error('[Admin] Firebase init failed', err);
        showAdminLogin();
      });
    return;
  }
  const u = S.auth?.currentUser;
  if (u && String(u.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase()) showAdminDashboard();
  else showAdminLogin();
}
function showAdminLogin() {
  $('#adminApp').hidden = false;
  $('#adminLoginView').hidden = false;
  $('#adminDashboard').hidden = true;
  $('#firebaseConfigNote').hidden = configured();
}
function showAdminDashboard() {
  const u = S.auth?.currentUser;
  if (!u || String(u.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return showAdminLogin();
  $('#adminApp').hidden = false;
  $('#adminLoginView').hidden = true;
  $('#adminDashboard').hidden = false;
  document.documentElement.removeAttribute('data-maintenance');
  document.body.style.visibility = '';
  document.documentElement.style.visibility = '';
  $('#adminUserEmail').textContent = u.email || '';
  bindAdminNavigation();
  try {
    renderAdminView(S.currentAdminView);
  } catch (err) {
    console.error('[Admin] initial render failed', err);
    renderAdminFatal(err);
  }
  if (!S.adminUnsub) {
    try {
      startAdmin();
    } catch (err) {
      console.error('[Admin] realtime startup failed', err);
    }
  }
}
function startAdmin() {
  if (!S.firebaseReady || !S.auth?.currentUser) return;
  const cached = readAdminCache();
  if (!S.adminContent.length && cached.length) S.adminContent = cached;
  if (!$('#adminDashboard').hidden) {
    try {
      renderAdminView(S.currentAdminView);
    } catch (err) {
      console.warn('[Admin] cached render failed', err);
    }
  }
  S.adminUnsub?.();
  clearTimeout(S.adminScheduleTimer);
  S.adminScheduleTimer = null;
  S.adminUnsub = onSnapshot(
    collection(S.db, COLLECTION),
    (snap) => {
      S.adminContent = rudDeduplicateContent(sorted(snap));
      cacheAdminContent(S.adminContent);
      ensureLegacyZikrSeed();
      clearTimeout(S.adminScheduleTimer);
      S.adminScheduleTimer = null;
      const scheduled = S.adminContent
        .filter((i) => !i.published && i.scheduleStatus === 'scheduled' && millis(i.scheduledAt) > 0)
        .sort((a, b) => millis(a.scheduledAt) - millis(b.scheduledAt));
      const publishDue = () => {
        const due = scheduled.filter((i) => millis(i.scheduledAt) <= Date.now());
        if (due.length)
          Promise.all(
            due.map((i) =>
              updateDoc(doc(S.db, COLLECTION, i.id), {
                published: true,
                scheduledAt: null,
                scheduleStatus: null,
                updatedAt: serverTimestamp(),
              }),
            ),
          ).catch((e) => console.error('Scheduled publishing failed', e));
      };
      publishDue();
      const next = scheduled.find((i) => millis(i.scheduledAt) > Date.now());
      if (next)
        S.adminScheduleTimer = setTimeout(publishDue, Math.max(250, millis(next.scheduledAt) - Date.now() + 100));
      if (
        !$('#adminDashboard').hidden &&
        !['analytics', 'editor', 'upload', 'broadcast', 'notifications', 'trash'].includes(S.currentAdminView)
      )
        renderAdminView(S.currentAdminView);
    },
    (e) => {
      console.error(e);
      S.adminUnsub = null;
      clearTimeout(S.adminScheduleTimer);
      S.adminScheduleTimer = null;
      const cachedNow = readAdminCache();
      if (cachedNow.length) {
        S.adminContent = cachedNow;
        if (
          !$('#adminDashboard').hidden &&
          !['analytics', 'editor', 'upload', 'broadcast', 'notifications', 'trash'].includes(S.currentAdminView)
        )
          renderAdminView(S.currentAdminView);
        toast('Showing your last saved admin data while the database reconnects.');
      } else {
        toast(
          e.code === 'permission-denied'
            ? 'Database permission denied. Check Firestore security rules.'
            : 'Unable to load admin content.',
          'error',
        );
      }
    },
  );
}
function adminHeader(t, c, button = true) {
  return `<div class="admin-head"><div><h1>${esc(t)}</h1><p>${esc(c)}</p></div>${button ? `<button class="premium-btn primary" id="newContent">+ Create Content</button>` : ''}</div>`;
}
function setAdminDrawer(open) {
  $('#adminSidebar')?.classList.toggle('open', !!open);
  $('#adminBackdrop')?.classList.toggle('open', !!open);
}
function openAdminViewButton(button) {
  if (!button?.dataset?.adminView) return;
  const view = String(button.dataset.adminView);
  S.currentAdminView = view;
  S.editingId = null;
  document
    .querySelectorAll('.admin-nav button[data-admin-view]')
    .forEach((x) => x.classList.toggle('active', x === button));
  try {
    renderAdminView(view);
  } catch (err) {
    console.error('[Admin] View render failed', err);
    renderAdminFatal(err);
  }
  setAdminDrawer(false);
}
function bindAdminNavigation() {
  const menu = $('#adminMenuBtn'),
    backdrop = $('#adminBackdrop'),
    nav = document.querySelector('.admin-nav');
  if (menu && !menu.dataset.bound) {
    menu.dataset.bound = '1';
    menu.addEventListener('click', () => setAdminDrawer(true));
  }
  if (backdrop && !backdrop.dataset.bound) {
    backdrop.dataset.bound = '1';
    backdrop.addEventListener('click', () => setAdminDrawer(false));
  }
  if (nav && !nav.dataset.bound) {
    nav.dataset.bound = '1';
    nav.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-admin-view]');
      if (!button) return;
      e.preventDefault();
      openAdminViewButton(button);
    });
    nav.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const button = e.target.closest('button[data-admin-view]');
      if (!button) return;
      e.preventDefault();
      openAdminViewButton(button);
    });
  }
}
function adminDateTime(v) {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
async function deleteFirestoreDocsInChunks(refs) {
  const clean = [...new Map(refs.filter(Boolean).map((r) => [r.path, r])).values()];
  if (!clean.length) return 0;
  const CHUNK = 400;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const batch = writeBatch(S.db);
    clean.slice(i, i + CHUNK).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return clean.length;
}
async function deleteVisitorAnalyticsByVisitorIds(visitorIds) {
  const ids = new Set(visitorIds.filter(Boolean));
  if (!ids.size) return 0;
  const snap = await getDocs(collection(S.db, RUD_ANALYTICS_COLLECTION));
  const refs = snap.docs.filter((d) => ids.has(String(d.data().visitorId || ''))).map((d) => d.ref);
  return deleteFirestoreDocsInChunks(refs);
}
async function deleteAnalyticsSessionById(sessionDocId) {
  if (!sessionDocId) return 0;
  await deleteDoc(doc(S.db, RUD_ANALYTICS_COLLECTION, sessionDocId));
  return 1;
}
async function clearAllAnalyticsLogs() {
  const [sessionSnap, receiptSnap] = await Promise.all([
    getDocs(collection(S.db, RUD_ANALYTICS_COLLECTION)),
    getDocs(collection(S.db, 'broadcast_receipts')),
  ]);
  const refs = [...sessionSnap.docs.map((d) => d.ref), ...receiptSnap.docs.map((d) => d.ref)];
  return deleteFirestoreDocsInChunks(refs);
}
function analyticsConfirm(message) {
  return window.confirm(message);
}
function readAdminAnalyticsCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(RUD_ADMIN_ANALYTICS_CACHE_KEY) || 'null');
    if (!raw || !Array.isArray(raw.sessions)) return [];
    return raw.sessions;
  } catch {
    return [];
  }
}
function writeAdminAnalyticsCache(sessions) {
  try {
    const clean = (Array.isArray(sessions) ? sessions : []).slice(0, 500).map((s) => ({
      ...s,
      startedAt: millis(s.startedAt),
      lastSeenAt: millis(s.lastSeenAt),
    }));
    localStorage.setItem(RUD_ADMIN_ANALYTICS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), sessions: clean }));
  } catch {}
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  RUD_ADMIN_ANALYTICS_CACHE_KEY = 'rud_admin_analytics_cache_v1';
}

export {
  adminDateTime,
  adminHeader,
  analyticsConfirm,
  clearAllAnalyticsLogs,
  deleteAnalyticsSessionById,
  deleteVisitorAnalyticsByVisitorIds,
  readAdminAnalyticsCache,
  renderAdminRoute,
  setAdminDrawer,
  showAdminDashboard,
  showAdminLogin,
  writeAdminAnalyticsCache,
};
