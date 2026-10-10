/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */

export function SiteFooter() {
  return (
    <footer className="instagram-footer">
      <div className="instagram-signoff">
        <div aria-hidden="true" className="instagram-signoff-light">
          <div className="instagram-heart-quote">
            {'\n            Come back whenever your heart needs a reminder.\n          '}
          </div>
        </div>
        <span className="instagram-eyebrow">{'CONTINUE THE JOURNEY'}</span>
        <a
          aria-label="Follow Rise Upon Deen on Instagram"
          className="instagram-profile"
          href="https://www.instagram.com/riseupondeen/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <span aria-hidden="true" className="instagram-profile-icon">
            <svg fill="none" viewBox="0 0 24 24">
              <rect height="17.5" rx="5" stroke="currentColor" strokeWidth="1.35" width="17.5" x="3.25" y="3.25" />
              <circle cx="12" cy="12" r="4.15" stroke="currentColor" strokeWidth="1.35" />
              <circle cx="17.45" cy="6.65" fill="currentColor" r=".95" />
            </svg>
          </span>
          <span className="instagram-profile-text">
            <strong>{'Rise Upon Deen'}</strong>
            <small>{'@riseupondeen'}</small>
          </span>
          <span className="instagram-profile-action">
            {'\n          Follow '}
            <i>{'↗'}</i>
          </span>
        </a>
        <div aria-hidden="true" className="instagram-signoff-line" />
        <p className="instagram-copyright">
          {'© '}
          <span id="year" />
          {' Rise Upon Deen. All rights reserved.'}
        </p>
      </div>
    </footer>
  );
}
