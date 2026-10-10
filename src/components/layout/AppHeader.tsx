/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */
/* Canonical app header: logo, Home/notifications/Explore/theme actions. */
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
        <a aria-label="Home" className="rud-topbar-icon" href="#home" title="Home">
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
        <button
          aria-label="Reminder settings"
          className="rud-topbar-icon"
          id="rudNotificationShortcut"
          title="Reminder settings"
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
        <a aria-label="My Deen" className="rud-topbar-icon" href="#my-deen" title="My Deen">
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path
              d="M5.5 7.5 12 4l6.5 3.5v11L12 21l-6.5-2.5v-11Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
            <path
              d="M12 4v17M5.5 9.4 12 12l6.5-2.6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
            <path
              d="M6.2 8.2 12 10.5l5.8-2.3"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.15"
            />
          </svg>
        </a>
        {'\n'}
        <a
          aria-label="Deen Friends"
          className="rud-topbar-icon rud-deen-friends-nav"
          href="#deen-friends"
          id="rudDeenFriendsNav"
          title="Deen Friends"
        >
          {'\n'}
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            {'\n'}
            <circle cx="9" cy="8.5" r="3" stroke="currentColor" strokeWidth="1.55" />
            {'\n'}
            <circle cx="16.2" cy="9.7" r="2.25" stroke="currentColor" strokeWidth="1.45" />
            {'\n'}
            <path
              d="M3.8 18.4c.7-3 2.45-4.55 5.2-4.55s4.5 1.55 5.2 4.55"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.55"
            />
            {'\n'}
            <path
              d="M14.2 14.2c2.9-.25 4.95 1.05 5.7 3.75"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.45"
            />
            {'\n'}
            <path
              d="M12 4.1v2.8M10.6 5.5h2.8"
              opacity=".7"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.15"
            />
            {'\n'}
          </svg>
          {'\n'}
          <span aria-hidden="true" className="rud-nav-badge" hidden id="rudDfNavBadge" />
          {'\n'}
        </a>
        {'\n'}
        <ThemeToggle />
        {'\n'}
        <button
          aria-controls="rudExploreDrawer"
          aria-expanded="false"
          aria-label="Open Explore"
          className="rud-topbar-icon"
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
