/**
 * Route helpers shared by the router: active-nav syncing, admin-route detection/normalisation, scroll-restoration flags and the top bar's current-route state.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { $$ } from '../../runtime/core';

function syncPublicNav(routeName) {
  const routeMap = {
    article: 'articles',
    reminder: 'reminders',
    dua: 'duas',
    hadith: 'hadith',
    'featured-live': 'home',
    spotlight: 'home',
    reflection: 'home',
    about: 'about',
    names: 'names',
    saved: 'saved',
    prayer: 'home',
    tasbih: 'home',
    'my-deen': 'my-deen',
    home: 'home',
  };
  const active = routeMap[routeName] || routeName;
  $$('.nav-link').forEach((a) => {
    const target = (a.getAttribute('href') || '').replace('#', '');
    a.classList.toggle('active', target === active);
  });
}
function rudHistoryRestoreActive() {
  return window.__RUD_SCROLL_RESTORING === true;
}
function rudCanAutoScroll() {
  return window.__RUD_SCROLL_RESTORING !== true;
}
function rudFinalRestoreActive() {
  return window.__RUD_SCROLL_RESTORING === true;
}
function rudIsAdminRoute() {
  const h = (location.hash || '').toLowerCase();
  return h === '#riseupondeen.admin.login.1722' || h === '#admin';
}
function rudNormalizeAdminRoute() {
  if ((location.hash || '').toLowerCase() === '#admin')
    history.replaceState(
      history.state || {},
      '',
      location.pathname + location.search + '#riseupondeen.admin.login.1722',
    );
}
function rudSyncTopbarCurrent(routeName) {
  const route = String(routeName || 'home').split('/')[0] || 'home';
  const map = {
    home: 'home',
    'my-deen': 'my-deen',
    'deen-friends': 'deen-friends',
  };
  document.querySelectorAll('.rud-topbar-icon[href^="#"]').forEach((el) => {
    const href = (el.getAttribute('href') || '').slice(1).split('/')[0] || 'home';
    const isCurrent = map[route] === href;
    el.classList.toggle('rud-nav-current', isCurrent);
    if (isCurrent) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}
function rudBindTopbarCurrentRoute() {
  if (window.__rudTopbarCurrentBound) return;
  window.__rudTopbarCurrentBound = true;
  document.addEventListener(
    'click',
    (e) => {
      const link = e.target.closest?.('.rud-topbar-icon[href^="#"]');
      if (!link) return;
      const target = (link.getAttribute('href') || '#home').slice(1).split('/')[0] || 'home';
      const current = (location.hash || '#home').slice(1).split('/')[0] || 'home';
      if (target !== current) return;
      e.preventDefault();
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    },
    { passive: false },
  );
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  rudBindTopbarCurrentRoute();
}

export {
  rudCanAutoScroll,
  rudFinalRestoreActive,
  rudIsAdminRoute,
  rudNormalizeAdminRoute,
  rudSyncTopbarCurrent,
  syncPublicNav,
};
