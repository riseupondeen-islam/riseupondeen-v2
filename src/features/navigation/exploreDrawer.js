/**
 * Explore drawer: open/close, route links, Ask Rise and reminder shortcuts.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { openSearch } from '../ask-rise/askRise';
import { rudRenderMyDeen } from '../my-deen/myDeen';

function rudSyncExploreNav(routeName) {
  const normalized = routeName === 'hajj' ? 'umrah' : routeName;
  const links = [...document.querySelectorAll('#rudExploreDrawer [data-rud-explore-route]')];
  links.forEach((el) => el.removeAttribute('aria-current'));
  links.find((el) => el.dataset.rudExploreRoute === normalized)?.setAttribute('aria-current', 'page');
}
function rudOpenExplore() {
  const drawer = document.getElementById('rudExploreDrawer'),
    button = document.getElementById('rudExploreBtn');
  if (!drawer) return;
  document
    .querySelectorAll(
      '.rud-quran-player-overlay.open,.rud-quran-sheet-overlay.open,.search-overlay.open,.app-overlay.open,.modal.open,.all-names-modal.open',
    )
    .forEach((el) => {
      el.classList.remove('open');
      el.setAttribute('aria-hidden', 'true');
    });
  document.body.classList.remove('search-open');
  rudSyncExploreNav((location.hash || '#home').slice(1).split('/')[0] || 'home');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  button?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('rud-explore-open');
  requestAnimationFrame(() => drawer.querySelector('.rud-explore-close')?.focus());
}
function rudCloseExplore({ restoreFocus = false } = {}) {
  const drawer = document.getElementById('rudExploreDrawer'),
    button = document.getElementById('rudExploreBtn');
  if (!drawer) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  button?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('rud-explore-open');
  if (restoreFocus) button?.focus();
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  document
    .getElementById('rudExploreBtn')
    ?.addEventListener('click', () =>
      document.getElementById('rudExploreDrawer')?.classList.contains('open')
        ? rudCloseExplore({ restoreFocus: true })
        : rudOpenExplore(),
    );
  document.getElementById('rudExploreDrawer')?.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[data-rud-explore-route]');
    if (!link) return;
    rudCloseExplore();
    const href = link.getAttribute('href');
    if (href && href.startsWith('#') && location.hash !== href) location.hash = href;
  });
  document
    .querySelectorAll('[data-rud-explore-close]')
    .forEach((el) => el.addEventListener('click', () => rudCloseExplore({ restoreFocus: true })));
  document.getElementById('rudExploreAskRise')?.addEventListener('click', () => {
    rudCloseExplore();
    openSearch();
  });
  document.getElementById('rudNotificationShortcut')?.addEventListener('click', () => {
    rudCloseExplore();
    window.__rudOpenReminderSettings = true;
    if ((location.hash || '') !== '#my-deen') location.hash = '#my-deen';
    else {
      rudRenderMyDeen();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('rudExploreDrawer')?.classList.contains('open'))
      rudCloseExplore({ restoreFocus: true });
  });
}

export { rudSyncExploreNav };
