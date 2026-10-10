/* "Help & display" group of the Explore drawer: the App Guide (interactive tour) and the
   Light/Dark switch. Both reuse the existing systems — the tour engine (features/onboarding) and the
   theme service — so there is still exactly one implementation of each. */
import { applyTheme, currentTheme } from '../../services/theme/theme';
import { useDocumentTheme } from '../../hooks/useDocumentTheme';

function closeExplore() {
  document.querySelector<HTMLElement>('#rudExploreDrawer [data-rud-explore-close]')?.click();
}

export function ExploreHelpGroup() {
  const light = useDocumentTheme() === 'light';
  return (
    <section className="rud-explore-group">
      <span className="rud-explore-group-title">{'Help & display'}</span>
      <nav aria-label="Help and display" className="rud-explore-links">
        <button
          className="rud-explore-link"
          data-tour="explore-guide"
          id="rudExploreGuide"
          type="button"
          onClick={() => {
            closeExplore();
            window.dispatchEvent(new CustomEvent('rud:open-guide'));
          }}
        >
          {'App Guide'}
        </button>
        <button
          aria-pressed={light ? 'false' : 'true'}
          className="rud-explore-link rud-explore-theme"
          id="rudExploreTheme"
          type="button"
          onClick={() => applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true)}
        >
          {light ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
        </button>
      </nav>
    </section>
  );
}
