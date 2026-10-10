/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */
/* Canonical app header: logo, then Home · My Deen · Notifications · Deen Friends · Light/Dark · Explore.
   (V3 order and icons; ids, routes and handlers are unchanged.) */
import brandLogoUrl from '../../assets/images/brand-logo.png';
import { ThemeToggle } from '../controls/ThemeToggle';

export function AppHeader() {
  return (
    <div aria-label="Rise Upon Deen app header" className="rud-minimal-topbar">
      {'\n'}
      <a aria-label="Rise Upon Deen home" className="rud-minimal-logo" href="#home">
        <img
          alt="AK Islamic logo — Rise Upon Deen"
          className="brand-logo"
          decoding="async"
          height="128"
          src={brandLogoUrl}
          width="128"
        />
        <span className="rud-minimal-wordmark">{'Rise Upon Deen'}</span>
      </a>
      {'\n'}
      <div className="rud-topbar-actions">
        {'\n'}
        <a aria-label="Home" className="rud-topbar-icon" data-tour="nav-home" href="#home" title="Home">
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path
              d="M4.5 10.6 12 4.5l7.5 6.1v8.2a.7.7 0 0 1-.7.7H5.2a.7.7 0 0 1-.7-.7v-8.2Z"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
            <path d="M9.3 19.5v-5.7h5.4v5.7" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
          </svg>
        </a>
        {'\n'}
        <a aria-label="My Deen" className="rud-topbar-icon" data-tour="nav-my-deen" href="#my-deen" title="My Deen">
          {/* Lantern (fanous) — the personal light of My Deen. */}
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path d="M12 2.2v1.7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
            <path d="M8.4 7.3 12 3.9l3.6 3.4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
            <path d="M8.1 7.3h7.8l1.4 5.1-2.3 5.6H9l-2.3-5.6 1.4-5.1Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
            <path d="M12 10.2c.95 1.05 1.35 1.95 1.35 2.75a1.35 1.35 0 0 1-2.7 0c0-.8.4-1.7 1.35-2.75Z" fill="currentColor" />
            <path d="M10.2 20.6h3.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
          </svg>
        </a>
        {'\n'}
        <button
          aria-label="Notifications and reminders"
          className="rud-topbar-icon"
          data-tour="nav-notifications"
          id="rudNotificationShortcut"
          title="Notifications"
          type="button"
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path
              d="M6.8 9.5a5.2 5.2 0 0 1 10.4 0c0 6 2.1 6.2 2.1 6.2H4.7s2.1-.2 2.1-6.2Z"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
            <path
              d="M9.8 18.2c.4 1 1.1 1.5 2.2 1.5s1.8-.5 2.2-1.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        {'\n'}
        <a
          aria-label="Deen Friends"
          className="rud-topbar-icon rud-deen-friends-nav"
          data-tour="nav-deen-friends"
          href="#deen-friends"
          id="rudDeenFriendsNav"
          title="Deen Friends"
        >
          {/* Two companions joined by a heart — friends for the sake of Allah. */}
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <circle cx="7.6" cy="10.4" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="16.4" cy="10.4" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M2.9 20c.5-2.8 2.2-4.3 4.7-4.3 1.5 0 2.7.5 3.6 1.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
            <path d="M21.1 20c-.5-2.8-2.2-4.3-4.7-4.3-1.5 0-2.7.5-3.6 1.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
            <path d="M12 7.1s-2.3-1.35-2.3-3a1.15 1.15 0 0 1 2.3-.45 1.15 1.15 0 0 1 2.3.45c0 1.65-2.3 3-2.3 3Z" fill="currentColor" />
          </svg>
          <span aria-hidden="true" className="rud-nav-badge" hidden id="rudDfNavBadge" />
        </a>
        {'\n'}
        <ThemeToggle />
        {'\n'}
        <button
          aria-controls="rudExploreDrawer"
          aria-expanded="false"
          aria-label="Open Explore"
          className="rud-topbar-icon"
          data-tour="nav-explore"
          id="rudExploreBtn"
          title="Explore"
          type="button"
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
          </svg>
        </button>
        {'\n'}
      </div>
      {'\n'}
    </div>
  );
}
