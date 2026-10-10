/**
 * Global keyboard/scroll/resize behaviour: Escape closes overlays, Ctrl/⌘+K opens Ask Rise, the scroll progress bar, and closing the admin drawer on wide screens.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { setAdminDrawer } from '../features/admin/adminLoader';
import { openSearch } from '../features/ask-rise/askRise';
import { $ } from '../runtime/core';
import { closeLayer } from '../utils/ui';

let scrollTick;

function updateProgress() {
  const max = document.documentElement.scrollHeight - innerHeight;
  const bar = $('#scrollProgress');
  if (bar) bar.style.width = (max > 0 ? Math.min(100, (scrollY / max) * 100) : 0) + '%';
  scrollTick = false;
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  /* ==============================
   GLOBAL UI
================================ */
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.RUD_askRiseCloseVoice?.();
      closeLayer('searchOverlay');
      closeLayer('deleteOverlay');
      setAdminDrawer(false);
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'k' &&
      !location.hash.startsWith('#riseupondeen.admin.login.1722')
    ) {
      e.preventDefault();
      openSearch();
    }
  });
  scrollTick = false;
  addEventListener(
    'scroll',
    () => {
      if (!scrollTick) {
        scrollTick = true;
        requestAnimationFrame(updateProgress);
      }
    },
    { passive: true },
  );
  updateProgress();
  addEventListener(
    'resize',
    () => {
      if (innerWidth > 900) setAdminDrawer(false);
    },
    { passive: true },
  );
}
