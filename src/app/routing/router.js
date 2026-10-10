/**
 * Hash router. handleRoute() is the single owner of every public route (#home, #quran, #duas, #dua/<id>, …) and of the admin route.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { releaseReactPage } from '../pages/reactPageOutlet';
import { S } from '../../runtime/store';
import { rudFinalRestoreActive, rudNormalizeAdminRoute, rudSyncTopbarCurrent, syncPublicNav } from './routeState';
import { showHome, showPage } from './surfaces';
import { renderAdminRoute } from '../../features/admin/adminLoader';
import { findPublicItem, openSearch } from '../../features/ask-rise/askRise';
import {
  renderDetail,
  renderHeartReflection,
  renderLibrary,
  renderNameDetail,
  renderSaved,
} from '../../features/library/readers';
import {
  hideMaintenance,
  maintenanceConfigFrom,
  maintenanceIsActive,
  showMaintenance,
  startMaintenanceLive,
} from '../../features/maintenance/maintenance';
import { rudRenderMyDeen } from '../../features/my-deen/myDeen';
import { rudSyncExploreNav } from '../../features/navigation/exploreDrawer';
import { $, publicFooter, publicMain } from '../../runtime/core';
import { startPublic } from '../../services/content/publicContentSync';

function rudRouteName() {
  return (
    String(location.hash || '#home')
      .slice(1, 180)
      .split('/')[0] || 'home'
  );
}
function rudRouteIsHomeSurface(r) {
  return ['home', 'ask-rise', 'reminder', 'reflection', 'about', 'featured-live', 'spotlight'].includes(
    String(r || ''),
  );
}
function rudBeginRoute(r) {
  const version = ++window.__RUD_ROUTE_VERSION;
  const admin = r === 'admin' || r === 'riseupondeen.admin.login.1722';
  const dynamic = $('#dynamicPage');
  if (admin) {
    document.body.classList.remove('route-view');
    return version;
  }
  if (rudRouteIsHomeSurface(r)) {
    if (dynamic) {
      dynamic.hidden = true;
      releaseReactPage();
      dynamic.innerHTML = '';
      dynamic.classList.remove('rud-view-ready');
      dynamic.removeAttribute('data-rud-route-version');
    }
    publicMain.hidden = false;
    publicFooter.hidden = false;
    document.body.classList.remove('route-view');
  }
  /* Non-home routes: the current surface stays on screen until the destination
     commits through showPage(). Blanking it here (before the destination had
     anything to show) was the white-screen gap. */
  return version;
}
function handleRoute() {
  const raw = (location.hash || '#home').slice(1);
  const routeVersion = rudBeginRoute(raw.split('/')[0] || 'home');
  if (raw.split('/')[0] !== 'deen-friends')
    try {
      window.RUD_DEEN_FRIENDS?.cleanup?.();
    } catch {}
  const [r, idRaw] = raw.split('/');
  const id = idRaw ? decodeURIComponent(idRaw) : '';
  const restoringPosition = rudFinalRestoreActive();

  if (r === 'admin') {
    rudNormalizeAdminRoute();
    syncPublicNav('');
    return renderAdminRoute();
  }
  if (r === 'riseupondeen.admin.login.1722') {
    syncPublicNav('');
    return renderAdminRoute();
  }
  try {
    if (S.adminUnsub) {
      S.adminUnsub();
      S.adminUnsub = null;
    }
    clearTimeout(S.adminScheduleTimer);
    S.adminScheduleTimer = null;
  } catch {}
  if (S.firebaseReady) {
    startPublic();
    try {
      startMaintenanceLive();
    } catch (e) {
      console.warn('Maintenance live sync restart deferred.', e);
    }
  }
  if (window.RUD_MAINTENANCE_ACTIVE) {
    syncPublicNav('');
    const cfg = maintenanceConfigFrom(S.publicContent);
    if (maintenanceIsActive(cfg)) return showMaintenance(cfg);
    hideMaintenance();
  }
  syncPublicNav(r);
  rudSyncTopbarCurrent(r);
  const deenFriendsNav = document.getElementById('rudDeenFriendsNav');
  if (deenFriendsNav) deenFriendsNav.classList.toggle('rud-df-nav-active', r === 'deen-friends');
  rudSyncExploreNav(r);
  if (r !== 'names' && r !== 'name') {
    window.rudLastPublicHash = location.hash || '#home';
    window.rudNamesEntered = false;
  }

  try {
    if (['article', 'hadith', 'dua', 'reminder', 'name'].includes(r) && id) {
      try {
        history.scrollRestoration = 'manual';
      } catch {}
      const item = findPublicItem(id);
      if (!item && !navigator.onLine)
        return showPage(
          `<section class="route-hero"><div class="shell"><span class="eyebrow">OFFLINE</span><h1>This content needs an internet connection.</h1><p class="section-copy">Your cached Rise Upon Deen content is still available.</p><a class="premium-btn" href="#home">Back Home</a></div></section>`,
          `Offline | Rise Upon Deen`,
        );
      return r === 'name' ? renderNameDetail(item) : renderDetail(item);
    }

    if (r === 'heart') {
      return renderHeartReflection(id);
    }

    if (r === 'my-deen') {
      if (['morning', 'evening'].includes(id)) window.__rudOpenAdhkar = id;
      return rudRenderMyDeen();
    }
    if (r === 'deen-friends') {
      if (typeof window.rudRenderDeenFriends !== 'function') {
        showPage(
          `<section class="rud-df-route-loading" aria-live="polite"><div class="rud-df-route-loading-card"><span class="rud-df-kicker">RISE UPON DEEN · DEEN FRIENDS</span><strong>Opening Deen Friends…</strong><span>Preparing your secure private space.</span></div></section>`,
          `Deen Friends | Rise Upon Deen`,
        );
        return;
      }
      return window.rudRenderDeenFriends();
    }
    if (r === 'quran') return window.rudRenderQuran && window.rudRenderQuran();
    if (r === 'prayer') return window.rudRenderPrayer && window.rudRenderPrayer();
    if (r === 'tasbih') return window.rudRenderTasbih && window.rudRenderTasbih(id === 'choose' ? '__choose__' : id);
    if (r === 'tracker') return window.rudRenderZakat && window.rudRenderZakat();
    if (r === 'sadaqah') return window.rudRenderSadaqah && window.rudRenderSadaqah();
    if (r === 'umrah' || r === 'hajj') return window.rudRenderUmrah && window.rudRenderUmrah();
    if (r === 'ask-rise') {
      showHome('');
      requestAnimationFrame(() => openSearch());
      return;
    }
    if (r === 'home') {
      showHome('');
      return;
    }
    if (['reminder', 'reflection', 'about', 'featured-live', 'spotlight'].includes(r)) {
      showHome(r);
      return;
    }
    if (r === 'hadith') return renderLibrary('hadith', 'Prophetic Guidance', 'Published Hadith from Admin.');
    if (r === 'duas') return renderLibrary('dua', 'Turn to Allah', 'Published Duas from Admin.');
    if (r === 'reminders')
      return renderLibrary('reminder', 'Reminders for the Heart', 'Published reminders from Admin.');
    if (r === 'names') {
      if (!window.rudNamesEntered) {
        const prevHash =
          window.rudLastPublicHash && window.rudLastPublicHash !== '#names' ? window.rudLastPublicHash : '#home';
        window.rudRouteBeforeNames = prevHash;
        window.rudNamesEntered = true;
      }
      renderLibrary('name', 'The Beautiful Names', 'Published Names of Allah from Admin.');
      return;
    }
    if (r === 'saved') return renderSaved();
    location.hash = '#home';
  } catch (routeError) {
    console.error('[Rise Upon Deen] Route render failed:', routeError);
    const dynamic = document.getElementById('dynamicPage');
    if (dynamic) {
      dynamic.hidden = true;
      releaseReactPage();
      dynamic.innerHTML = '';
      dynamic.classList.remove('rud-view-ready');
    }
    try {
      history.replaceState(history.state || {}, '', location.pathname + location.search + '#home');
    } catch {
      location.hash = '#home';
    }
    try {
      showHome('');
    } catch (homeError) {
      console.error('[Rise Upon Deen] Home recovery failed:', homeError);
    }
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  /* ==============================
   CANONICAL PUBLIC ROUTE SHELL
   One route owner for every public page.
   Prevents stale async renderers and old Home/footer DOM from resurfacing.
================================ */
  window.__RUD_ROUTE_VERSION = Number(window.__RUD_ROUTE_VERSION || 0);
  addEventListener('hashchange', handleRoute);
}

export { handleRoute, rudRouteIsHomeSurface };
