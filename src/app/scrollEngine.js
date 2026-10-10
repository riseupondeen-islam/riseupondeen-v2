/**
 * History-aware scroll restoration and the shared Back behaviour (window.RUD_goBack).
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { openSearch } from '../features/ask-rise/askRise';
import { legacyDocumentLoading, onLegacyDomContentLoaded } from '../runtime/lifecycle';

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  (function () {
    const POS_KEY = 'rud_master_scroll_positions_v1';
    let saveTimer = 0;
    let restoring = false;
    let forwardPrepared = false;
    let restorationQueued = false;
    let lastSavedHash = '',
      lastSavedX = -1,
      lastSavedY = -1;

    function hash() {
      return location.hash || '#home';
    }

    function readMap() {
      try {
        const v = JSON.parse(sessionStorage.getItem(POS_KEY) || '{}');
        return v && typeof v === 'object' ? v : {};
      } catch {
        return {};
      }
    }

    function writeMap(map) {
      try {
        sessionStorage.setItem(POS_KEY, JSON.stringify(map));
      } catch {}
    }

    function saveNow() {
      if (restoring) return;

      const x = window.scrollX || 0;
      const y = window.scrollY || 0;
      const currentHash = hash();
      if (currentHash === lastSavedHash && Math.abs(x - lastSavedX) < 2 && Math.abs(y - lastSavedY) < 2) return;
      const map = readMap();
      map[currentHash] = { x, y, t: Date.now() };
      writeMap(map);

      /* Store the position directly on THIS browser-history entry. */
      try {
        history.replaceState(
          { ...(history.state || {}), rudScrollX: x, rudScrollY: y, rudRoute: currentHash },
          '',
          location.href,
        );
        lastSavedHash = currentHash;
        lastSavedX = x;
        lastSavedY = y;
      } catch {}
    }

    function destinationPosition(eventState) {
      const state = eventState || history.state || {};
      if (Number.isFinite(state.rudScrollY)) {
        return {
          x: Number(state.rudScrollX) || 0,
          y: Number(state.rudScrollY) || 0,
        };
      }

      const saved = readMap()[hash()];
      if (saved && Number.isFinite(saved.y)) {
        return { x: Number(saved.x) || 0, y: Number(saved.y) || 0 };
      }

      return { x: 0, y: 0 };
    }

    function hide() {
      restoring = true;
      window.__RUD_SCROLL_RESTORING = true;
    }

    function reveal() {
      restoring = false;
      window.__RUD_SCROLL_RESTORING = false;
    }

    function applyRestore(position) {
      if (restorationQueued) return;
      restorationQueued = true;

      const targetX = Math.max(0, Number(position?.x) || 0);
      const targetY = Math.max(0, Number(position?.y) || 0);
      const dynamic = document.getElementById('dynamicPage');

      /* The route renderer has already run in this hashchange turn. Restore now
       so no incorrect scroll position can be painted when X/back is used. */
      if (dynamic && !dynamic.hidden) dynamic.classList.add('rud-view-ready');
      window.scrollTo(targetX, targetY);
      requestAnimationFrame(() => {
        if (Math.abs((window.scrollX || 0) - targetX) > 1 || Math.abs((window.scrollY || 0) - targetY) > 1) {
          window.scrollTo(targetX, targetY);
        }
        window.__RUD_PENDING_SCROLL_POSITION = null;
        restorationQueued = false;
        reveal();
      });
    }

    function isPublicHashLink(a) {
      if (!a) return false;
      const href = a.getAttribute('href') || '';
      return href.startsWith('#') && href !== '#' && !href.startsWith('#riseupondeen.admin.login.1722');
    }

    function prepareForward(target) {
      if (!target) return;

      const next = target.matches?.('[data-search-route]')
        ? target.getAttribute('data-search-route')
        : isPublicHashLink(target)
          ? target.getAttribute('href')
          : '';

      if (!next || !next.startsWith('#') || next === hash()) return;

      saveNow();
      forwardPrepared = true;
    }

    /* Capture position before the route click changes the URL. */
    document.addEventListener(
      'click',
      (e) => {
        const target = e.target.closest?.('a[href],[data-search-route]');
        if (!forwardPrepared) prepareForward(target);
      },
      true,
    );

    /*
     * Back controls are all routed through one function.
     * The capture handler prevents older bubble handlers from running.
     */
    function goBack() {
      if (restoring) return;
      saveNow();
      hide();
      if (history.length > 1) history.back();
      else {
        reveal();
        location.hash = '#home';
      }
    }

    window.RUD_goBack = goBack;

    document.addEventListener(
      'click',
      (e) => {
        const back = e.target.closest?.(
          '[data-history-back],[data-rud-feature-back],#rudLibraryClose,#namesRouteClose,#dynamicPage .rud-detail-close',
        );
        if (!back) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        if (back.matches('#dynamicPage .rud-detail-close') && document.body.dataset.askRiseReturn === '1') {
          document.body.dataset.askRiseReturn = 'reopen';
        }
        goBack();
      },
      true,
    );

    /*
     * popstate fires before the hashchange route render.
     * Mark restore immediately so showPage/showHome skip all top/anchor scrolling.
     */
    addEventListener(
      'popstate',
      (e) => {
        /* Forward hash clicks use the normal route transition. */
        if (forwardPrepared) {
          reveal();
          window.__RUD_PENDING_SCROLL_POSITION = null;
          return;
        }

        if (!restoring) hide();
        window.__RUD_PENDING_SCROLL_POSITION = destinationPosition(e.state);
      },
      { passive: true },
    );

    /*
     * Existing handleRoute() listener was registered earlier and therefore
     * rebuilds the destination DOM before this listener executes.
     */
    addEventListener(
      'hashchange',
      () => {
        if (restoring || window.__RUD_SCROLL_RESTORING) {
          const pos = window.__RUD_PENDING_SCROLL_POSITION || destinationPosition();
          window.__RUD_PENDING_SCROLL_POSITION = null;
          applyRestore(pos);
          forwardPrepared = false;
          if (document.body.dataset.askRiseReturn === 'reopen') {
            delete document.body.dataset.askRiseReturn;
            requestAnimationFrame(() => openSearch());
          } else if (document.body.dataset.askRiseReturn === '1' && !/^#(?:dua|hadith|reminder)\//.test(hash())) {
            delete document.body.dataset.askRiseReturn;
          }
          return;
        }

        forwardPrepared = false;

        /* Store the new entry after its initial top/section placement settles. */
        requestAnimationFrame(() => requestAnimationFrame(saveNow));
      },
      { passive: true },
    );

    /*
     * Real overlays are not route history. Closing X keeps underlying position
     * exactly where it is and never invokes history restoration.
     */
    document.addEventListener(
      'click',
      (e) => {
        const x = e.target.closest?.("#searchClose,.modal-close,[data-close-layer],button[aria-label*='Close' i]");
        if (!x) return;
        if (x.closest('.search-overlay,.app-overlay,.modal')) {
          window.__RUD_PENDING_SCROLL_POSITION = null;
        }
      },
      true,
    );

    /* Lightweight position persistence. */
    addEventListener(
      'scroll',
      () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 320);
      },
      { passive: true },
    );

    addEventListener('pagehide', saveNow, { passive: true });

    addEventListener(
      'pageshow',
      (e) => {
        if (e.persisted) {
          requestAnimationFrame(() => {
            const pos = destinationPosition();
            window.scrollTo(pos.x, pos.y);
          });
        }
      },
      { passive: true },
    );

    try {
      history.scrollRestoration = 'manual';
    } catch {}

    /* Seed the current entry. */
    if (legacyDocumentLoading()) {
      onLegacyDomContentLoaded(() => {
        requestAnimationFrame(saveNow);
      });
    } else {
      requestAnimationFrame(saveNow);
    }
  })();
}
