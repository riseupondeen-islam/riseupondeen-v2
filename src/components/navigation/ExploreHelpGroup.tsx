/* "Help" group of the Explore drawer: the App Guide (interactive tours). It reuses the tour engine
   (features/onboarding), so there is exactly one implementation. Light/Dark and Deen Friends are not
   repeated here — they are already in the top bar. */

function closeExplore() {
  document.querySelector<HTMLElement>('#rudExploreDrawer [data-rud-explore-close]')?.click();
}

export function ExploreHelpGroup() {
  return (
    <section className="rud-explore-group">
      <span className="rud-explore-group-title">{'Help'}</span>
      <nav aria-label="Help" className="rud-explore-links">
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
      </nav>
    </section>
  );
}
