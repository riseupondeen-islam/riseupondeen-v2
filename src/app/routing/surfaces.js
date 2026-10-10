/**
 * Route surfaces: showHome() (the home page) and showPage()/showReactPage() (the #dynamicPage surface every other route renders into).
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { mountReactPage, releaseReactPage } from '../pages/reactPageOutlet';
import { rudCanAutoScroll, rudFinalRestoreActive } from './routeState';
import { handleRoute, rudRouteIsHomeSurface } from './router';
import { rudSyncFridayMode, rudSyncSmartHome } from '../../features/my-deen/myDeen';
import { $, DEFAULT_TITLE, publicFooter, publicMain } from '../../runtime/core';

/* ==============================
   PUBLIC ROUTING + READERS
================================ */
/* Hero entrance animations are first-visit only. Un-hiding Home (display:none ->
   block) restarts CSS animations, so every return to Home replayed the entrance
   (visible movement). When the finite entrance animations have finished the root
   is marked settled and CSS keeps the final state without replaying. */
function rudSettleHeroEntrance() {
  const root = document.documentElement;
  if (root.classList.contains('rud-hero-settled') || window.__rudHeroSettling) return;
  const hero = document.getElementById('home');
  if (!hero || publicMain.hidden) return;
  window.__rudHeroSettling = true;
  requestAnimationFrame(() => {
    let anims = [];
    try {
      anims = hero.getAnimations({ subtree: true }).filter((a) => {
        try {
          return a.effect.getComputedTiming().iterations !== Infinity;
        } catch {
          return false;
        }
      });
    } catch {}
    Promise.allSettled(anims.map((a) => a.finished)).then(() => root.classList.add('rud-hero-settled'));
  });
}
/* Content refreshes (cache, shared cache, network) must not re-run the route
   renderer while Home is already on screen: that re-scrolled to top and rebuilt
   the page. Non-home routes still re-render because their content may have changed. */
function rudRouteAfterContent() {
  if (location.hash.startsWith('#riseupondeen.admin.login.1722')) return;
  const r = (location.hash || '#home').slice(1).split('/')[0] || 'home';
  const homeVisible = !publicMain.hidden && !document.body.classList.contains('route-view');
  const maintenance = !!window.RUD_MAINTENANCE_ACTIVE || document.documentElement.dataset.maintenance === 'active';
  if (homeVisible && rudRouteIsHomeSurface(r) && !maintenance) return;
  handleRoute();
}
function showHome(scrollId = '') {
  const restoringPosition = rudFinalRestoreActive();

  publicMain.hidden = false;
  publicFooter.hidden = false;
  $('#dynamicPage').hidden = true;
  $('#adminApp').hidden = true;
  document.body.classList.remove('route-view');
  document.title = DEFAULT_TITLE;
  try {
    document.dispatchEvent(new Event('rud-route-rendered'));
  } catch {}
  rudSyncFridayMode();
  rudSyncSmartHome();
  rudSettleHeroEntrance();

  /* Forward navigation keeps the existing behavior.
     Back navigation must not force top/section before saved scroll restoration. */
  if (restoringPosition) return;

  if (scrollId) {
    setTimeout(() => {
      const target = document.getElementById(scrollId);
      if (target && rudCanAutoScroll())
        target.scrollIntoView({
          behavior: 'auto',
          block: 'start',
        });
    }, 20);
  } else {
    if (rudCanAutoScroll()) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }
}
function showPage(html, title, routeVersion = window.__RUD_ROUTE_VERSION) {
  /* A route renderer may finish after the user has already navigated away.
     Never allow that stale renderer to put its old page back into the shell. */
  if (Number(routeVersion) !== Number(window.__RUD_ROUTE_VERSION)) return false;
  try {
    history.scrollRestoration = 'manual';
  } catch {}

  const restoringPosition = rudFinalRestoreActive();
  document.documentElement.style.scrollBehavior = 'auto';
  publicMain.hidden = true;
  publicFooter.hidden = true;

  const dynamic = $('#dynamicPage');
  if (!dynamic) return false;
  dynamic.hidden = false;
  if (html === null || html === undefined || String(html).trim() === '') {
    console.warn('[Rise Upon Deen] Empty route payload; keeping the route shell safe.');
    return false;
  }
  releaseReactPage();
  dynamic.innerHTML = String(html);
  dynamic.classList.add('rud-view-ready');

  $('#adminApp').hidden = true;
  document.body.classList.add('route-view');
  document.title = title || DEFAULT_TITLE;
  dynamic.dataset.rudRouteVersion = String(routeVersion);

  try {
    document.dispatchEvent(new Event('rud-route-rendered'));
  } catch {}

  if (!restoringPosition && rudCanAutoScroll()) {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.style.scrollBehavior = '';
  } else {
    requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = '';
    });
  }
  return true;
}

/* Same contract as showPage(), for routes implemented as React components: the component is
   portalled into #dynamicPage instead of being written as an HTML string. */
function showReactPage(element, title, routeVersion = window.__RUD_ROUTE_VERSION) {
  if (Number(routeVersion) !== Number(window.__RUD_ROUTE_VERSION)) return false;
  try {
    history.scrollRestoration = 'manual';
  } catch {}

  const restoringPosition = rudFinalRestoreActive();
  document.documentElement.style.scrollBehavior = 'auto';
  publicMain.hidden = true;
  publicFooter.hidden = true;

  const dynamic = $('#dynamicPage');
  if (!dynamic) return false;
  dynamic.hidden = false;
  releaseReactPage();
  dynamic.replaceChildren();
  mountReactPage(element);
  dynamic.classList.add('rud-view-ready');

  $('#adminApp').hidden = true;
  document.body.classList.add('route-view');
  document.title = title || DEFAULT_TITLE;
  dynamic.dataset.rudRouteVersion = String(routeVersion);

  try {
    document.dispatchEvent(new Event('rud-route-rendered'));
  } catch {}

  if (!restoringPosition && rudCanAutoScroll()) {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.style.scrollBehavior = '';
  } else {
    requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = '';
    });
  }
  return true;
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { rudRouteAfterContent, showHome, showPage, showReactPage };
