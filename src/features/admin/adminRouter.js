/**
 * Admin console shell: route entry (renderAdminRoute), the authentication gate, the live content
 * listener, navigation (fixed sidebar / mobile drawer) and shared analytics deletion helpers.
 *
 * Authentication gate — #adminApp[data-auth]:
 *   checking    Firebase or the saved session is still being restored. Only a neutral
 *               "verifying" screen is visible: never the login form, never the console.
 *   signed-out  Only the login page.
 *   authorized  The console. Set only after the signed-in user's ID token has been verified to
 *               belong to the administrator account. Every admin read/write is still enforced by
 *               firestore.rules on the server; this gate only decides what is rendered.
 * A sequence number makes every asynchronous decision "last one wins", so a slow verification can
 * never re-open the console after the administrator has signed out.
 */
import { S } from '../../runtime/store';
import { rudIsAdminRoute } from '../../app/routing/routeState';
import { cacheAdminContent, readAdminCache } from './adminPersistence';
import { renderAdminFatal, renderAdminView, suspendAdminView } from './adminViews';
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
const VIEW_KEY = 'rud_admin_view_v1';
let gateSeq = 0;
let verifiedUid = '';

/* ==============================
   AUTHENTICATION GATE
================================ */
function isAdminEmail(email) {
  return String(email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
function setAuthState(state) {
  const app = $('#adminApp');
  if (!app) return;
  app.dataset.auth = state;
  // The hidden attributes are kept in sync for assistive technology and older selectors.
  $('#adminAuthGate').hidden = state !== 'checking';
  $('#adminLoginView').hidden = state !== 'signed-out';
  $('#adminDashboard').hidden = state !== 'authorized';
}
/** Resolves once Firebase has restored (or failed to restore) the saved session. */
async function authSettled() {
  if (!S.auth) return;
  if (typeof S.auth.authStateReady === 'function') {
    await S.auth.authStateReady();
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}
/** True only when the signed-in user's ID token is the administrator's. Cached per uid. */
async function verifyAdministrator(user) {
  if (!user || user.isAnonymous || !isAdminEmail(user.email)) return false;
  if (verifiedUid === user.uid) return true;
  try {
    const token = await user.getIdTokenResult();
    const ok = isAdminEmail(token?.claims?.email);
    if (ok) verifiedUid = user.uid;
    return ok;
  } catch (err) {
    console.warn('[Admin] token verification failed', err);
    return false;
  }
}

/* ==============================
   ADMIN ROUTING + LISTENER
================================ */
function enterAdminSurface() {
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
  document.title = 'Admin Console | Rise Upon Deen';
  bindAdminNavigation();
}
function renderAdminRoute() {
  enterAdminSurface();
  const seq = ++gateSeq;
  if (!configured()) return showAdminLogin();
  if (!S.firebaseReady) {
    setAuthState('checking');
    /* Re-render only once Firebase is actually ready (an unconditional re-render looped forever
       and froze the tab when the SDK could not load). */
    Promise.resolve(firebaseInitPromise)
      .then(() => {
        if (seq !== gateSeq || !rudIsAdminRoute()) return;
        if (S.firebaseReady) renderAdminRoute();
        else showAdminLogin('Firebase could not connect. Check your internet connection and try again.');
      })
      .catch((err) => {
        console.error('[Admin] Firebase init failed', err);
        if (seq === gateSeq) showAdminLogin('Firebase could not connect. Check your internet connection and try again.');
      });
    return;
  }
  if (S.auth?.currentUser) return showAdminDashboard();
  setAuthState('checking');
  authSettled()
    .catch(() => undefined)
    .then(() => {
      if (seq !== gateSeq || !rudIsAdminRoute()) return;
      if (S.auth?.currentUser) showAdminDashboard();
      else showAdminLogin();
    });
}
/** Shows the login page (and only the login page). Optional message is shown inline. */
function showAdminLogin(message = '') {
  gateSeq++;
  clearAdminWorkspace();
  $('#adminApp').hidden = false;
  setAuthState('signed-out');
  $('#firebaseConfigNote').hidden = configured() && S.firebaseReady !== false;
  // Keep an error that is already shown (e.g. the auth listener signing out a refused account).
  if (message) showLoginError(message);
}
function showLoginError(message) {
  const box = $('#adminLoginError');
  if (!box) return;
  box.textContent = message || '';
  box.hidden = !message;
}
/** Verifies the signed-in user, then reveals the console. Unverified users only ever see login. */
function showAdminDashboard() {
  const u = S.auth?.currentUser;
  if (!u || !isAdminEmail(u.email)) return showAdminLogin();
  const seq = ++gateSeq;
  $('#adminApp').hidden = false;
  if ($('#adminApp').dataset.auth !== 'authorized') setAuthState('checking');
  verifyAdministrator(u).then((ok) => {
    if (seq !== gateSeq || !rudIsAdminRoute()) return;
    if (S.auth?.currentUser !== u) return showAdminLogin();
    if (!ok) return showAdminLogin('This account is not authorized for the Admin Console.');
    openAuthorizedConsole(u);
  });
}
function openAuthorizedConsole(u) {
  const wasAuthorized = $('#adminApp').dataset.auth === 'authorized';
  setAuthState('authorized');
  showLoginError('');
  document.documentElement.removeAttribute('data-maintenance');
  document.body.style.visibility = '';
  document.documentElement.style.visibility = '';
  $('#adminUserEmail').textContent = u.email || '';
  bindAdminNavigation();
  if (!wasAuthorized || !$('#adminMain').childElementCount) {
    S.currentAdminView = restoreView();
    syncNav(S.currentAdminView);
    try {
      renderAdminView(S.currentAdminView);
    } catch (err) {
      console.error('[Admin] initial render failed', err);
      renderAdminFatal(err);
    }
  }
  if (!S.adminUnsub) {
    try {
      startAdmin();
    } catch (err) {
      console.error('[Admin] realtime startup failed', err);
    }
  }
}
/** Removes every administrative screen and listener (sign-out, unauthorized account). */
function clearAdminWorkspace() {
  try {
    suspendAdminView();
  } catch {}
  try {
    S.adminUnsub?.();
  } catch {}
  S.adminUnsub = null;
  clearTimeout(S.adminScheduleTimer);
  S.adminScheduleTimer = null;
  try {
    S.adminAnalyticsUnsub?.();
  } catch {}
  S.adminAnalyticsUnsub = null;
  const main = $('#adminMain');
  if (main) main.innerHTML = '';
  const email = $('#adminUserEmail');
  if (email) email.textContent = '';
  setAdminDrawer(false);
  verifiedUid = '';
}
function restoreView() {
  try {
    const v = sessionStorage.getItem(VIEW_KEY);
    if (v && document.querySelector(`.admin-nav [data-admin-view="${CSS.escape(v)}"]`)) return v;
  } catch {}
  return S.currentAdminView && S.currentAdminView !== 'names' ? S.currentAdminView : 'dashboard';
}
function rememberView(v) {
  try {
    sessionStorage.setItem(VIEW_KEY, v);
  } catch {}
}

function startAdmin() {
  if (!S.firebaseReady || !S.auth?.currentUser) return;
  const cached = readAdminCache();
  if (!S.adminContent.length && cached.length) S.adminContent = cached;
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
      if ($('#adminApp')?.dataset.auth === 'authorized' && LIVE_CONTENT_VIEWS.has(S.currentAdminView))
        renderAdminView(S.currentAdminView, { live: true });
    },
    (e) => {
      console.error(e);
      S.adminUnsub = null;
      clearTimeout(S.adminScheduleTimer);
      S.adminScheduleTimer = null;
      const cachedNow = readAdminCache();
      if (cachedNow.length) {
        S.adminContent = cachedNow;
        if ($('#adminApp')?.dataset.auth === 'authorized' && LIVE_CONTENT_VIEWS.has(S.currentAdminView))
          renderAdminView(S.currentAdminView, { live: true });
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
/** Views that re-render from the live content list (the content library tables and Scheduled). */
const LIVE_CONTENT_VIEWS = new Set(['names', 'duas', 'hadith', 'reminders', 'zikr', 'sadaqah', 'scheduled', 'manage']);

function adminHeader(t, c, button = true) {
  return `<div class="admin-head"><div><h1>${esc(t)}</h1><p>${esc(c)}</p></div>${button ? `<button class="premium-btn primary" id="newContent" type="button">+ Create Content</button>` : ''}</div>`;
}

/* ==============================
   NAVIGATION
================================ */
function setAdminDrawer(open) {
  const sidebar = $('#adminSidebar');
  if (!sidebar) return;
  const wasOpen = sidebar.classList.contains('open');
  sidebar.classList.toggle('open', !!open);
  $('#adminBackdrop')?.classList.toggle('open', !!open);
  $('#adminMenuBtn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && !wasOpen) sidebar.querySelector('.admin-nav button.active, .admin-nav button')?.focus({ preventScroll: true });
  if (!open && wasOpen && sidebar.contains(document.activeElement)) $('#adminMenuBtn')?.focus({ preventScroll: true });
}
function syncNav(view) {
  document.querySelectorAll('.admin-nav button[data-admin-view]').forEach((x) => {
    const on = x.dataset.adminView === view;
    x.classList.toggle('active', on);
    if (on) x.setAttribute('aria-current', 'page');
    else x.removeAttribute('aria-current');
  });
}
function openAdminViewButton(button) {
  if (!button?.dataset?.adminView) return;
  if ($('#adminApp')?.dataset.auth !== 'authorized') return;
  const view = String(button.dataset.adminView);
  S.currentAdminView = view;
  S.editingId = null;
  rememberView(view);
  syncNav(view);
  try {
    renderAdminView(view);
  } catch (err) {
    console.error('[Admin] View render failed', err);
    renderAdminFatal(err);
  }
  const main = $('#adminMain');
  if (main) main.scrollTop = 0;
  setAdminDrawer(false);
}
function bindAdminNavigation() {
  const menu = $('#adminMenuBtn'),
    close = $('#adminMenuClose'),
    backdrop = $('#adminBackdrop'),
    nav = document.querySelector('.admin-nav'),
    passwordToggle = $('#adminPasswordToggle');
  if (menu && !menu.dataset.bound) {
    menu.dataset.bound = '1';
    menu.addEventListener('click', () => setAdminDrawer(!$('#adminSidebar')?.classList.contains('open')));
  }
  if (close && !close.dataset.bound) {
    close.dataset.bound = '1';
    close.addEventListener('click', () => setAdminDrawer(false));
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
  }
  if (passwordToggle && !passwordToggle.dataset.bound) {
    passwordToggle.dataset.bound = '1';
    passwordToggle.addEventListener('click', () => {
      const input = $('#adminPassword');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      passwordToggle.setAttribute('aria-pressed', show ? 'true' : 'false');
      passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      passwordToggle.classList.toggle('is-on', show);
      input.focus({ preventScroll: true });
    });
  }
}

/* ==============================
   ANALYTICS HELPERS (shared by Analytics and Maintenance)
================================ */
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
/** Visitor analytics contain visitor names and coarse locations: never leave them behind on sign-out. */
function clearAdminAnalyticsCache() {
  try {
    localStorage.removeItem(RUD_ADMIN_ANALYTICS_CACHE_KEY);
  } catch {}
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  RUD_ADMIN_ANALYTICS_CACHE_KEY = 'rud_admin_analytics_cache_v1';
  // Leaving the admin route stops the current view's listeners (they restart when the admin returns).
  addEventListener('hashchange', () => {
    if (!rudIsAdminRoute()) {
      try {
        suspendAdminView();
      } catch {}
      setAdminDrawer(false);
    }
  });
}

export {
  adminDateTime,
  adminHeader,
  analyticsConfirm,
  clearAdminAnalyticsCache,
  clearAdminWorkspace,
  clearAllAnalyticsLogs,
  deleteAnalyticsSessionById,
  deleteVisitorAnalyticsByVisitorIds,
  readAdminAnalyticsCache,
  rememberView,
  renderAdminRoute,
  setAdminDrawer,
  showAdminDashboard,
  showAdminLogin,
  showLoginError,
  syncNav,
  writeAdminAnalyticsCache,
};
