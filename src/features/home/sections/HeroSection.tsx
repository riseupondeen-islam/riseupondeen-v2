/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */

export function HeroSection() {
  return (
    <section className="hero" id="home">
      <div aria-hidden="true" className="stars" id="heroStars" />
      <div aria-hidden="true" className="moon-glow parallax" data-depth="0.14" />
      <div aria-hidden="true" className="hero-geo parallax" data-depth="0.06" />
      <div aria-label="Respectful animated architectural scene inspired by Makkah" className="makkah-scene">
        <div aria-hidden="true" className="makkah-noor" />
        <div aria-hidden="true" className="makkah-horizon" />
        <div aria-hidden="true" className="masjid-architecture architecture-back">
          <span className="arch a1" />
          <span className="arch a2" />
          <span className="arch a3" />
          <span className="arch a4" />
          <span className="arch a5" />
          <span className="arch a6" />
          <span className="arch a7" />
        </div>
        <div aria-hidden="true" className="minaret premium-minaret pm1">
          <i />
          <b />
        </div>
        <div aria-hidden="true" className="minaret premium-minaret pm2">
          <i />
          <b />
        </div>
        <div aria-hidden="true" className="minaret premium-minaret pm3">
          <i />
          <b />
        </div>
        <div aria-hidden="true" className="minaret premium-minaret pm4">
          <i />
          <b />
        </div>
        <div aria-hidden="true" className="courtyard courtyard-back" />
        <div aria-hidden="true" className="courtyard courtyard-mid" />
        <div aria-hidden="true" className="makkah-platform" />
        <div className="kaaba-wrap">
          <div aria-hidden="true" className="kaaba" />
          <div aria-hidden="true" className="kaaba-ground-light" />
        </div>
        <div aria-hidden="true" className="masjid-architecture architecture-front">
          <span className="arch a1" />
          <span className="arch a2" />
          <span className="arch a3" />
          <span className="arch a4" />
          <span className="arch a5" />
          <span className="arch a6" />
          <span className="arch a7" />
          <span className="arch a8" />
          <span className="arch a9" />
        </div>
        <div aria-hidden="true" className="courtyard-light-paths">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div aria-hidden="true" className="mist-layer" />
      <div className="hero-content parallax premium-hero-intro" data-depth="0.018">
        <div className="hero-kicker">
          <i />
          {' RISE UPON DEEN'}
        </div>
        <h1 className="display hero-title-simple">
          {'RISE UPON'}
          <br />
          {'DEEN'}
        </h1>
        <p className="hero-tagline">{'Return your heart to what truly matters.'}</p>
        <p className="hero-support">{'Reminders. Knowledge. Reflection.'}</p>
        <div aria-label="Contextual Deen shortcuts" className="rud-smart-home" id="rudSmartHome" />
        <div aria-label="Rise Upon Deen tools" className="rud-quick-actions">
          {'\n'}
          <a aria-label="Open Quran" className="rud-circle-action" data-rud-route="quran" href="#quran">
            <span aria-hidden="true" className="rud-circle-icon">
              <svg fill="none" viewBox="0 0 40 40">
                <path
                  d="M6.5 9.5c5.2-1.1 9.6.2 13.5 3.1 3.9-2.9 8.3-4.2 13.5-3.1v21c-5.1-.9-9.6.3-13.5 3.1-3.9-2.8-8.4-4-13.5-3.1v-21Z"
                  stroke="currentColor"
                  strokeLinejoin="round"
                  strokeWidth="1.55"
                />
                <path
                  d="M20 12.6v21M10.5 14.2c2.4-.2 4.5.35 6.6 1.65M29.5 14.2c-2.4-.2-4.5.35-6.6 1.65M10.5 19c2.4-.2 4.5.35 6.6 1.65M29.5 19c-2.4-.2-4.5.35-6.6 1.65"
                  opacity=".72"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.15"
                />
              </svg>
            </span>
            <span>{'Qur’an'}</span>
          </a>
          {'\n'}
          <a aria-label="Open Prayer tools" className="rud-circle-action" data-rud-route="prayer" href="#prayer">
            <span aria-hidden="true" className="rud-circle-icon">
              <svg fill="none" viewBox="0 0 40 40">
                <path d="M10.5 31.5h19" stroke="currentColor" strokeLinecap="round" strokeWidth="1.55" />
                <path
                  d="M12.8 30.8V18.7c0-4.8 3.2-8.45 7.2-11.25 4 2.8 7.2 6.45 7.2 11.25v12.1"
                  stroke="currentColor"
                  strokeLinejoin="round"
                  strokeWidth="1.55"
                />
                <path
                  d="M16.1 30.8V21c0-2.75 1.55-5.2 3.9-7.05 2.35 1.85 3.9 4.3 3.9 7.05v9.8"
                  stroke="currentColor"
                  strokeLinejoin="round"
                  strokeWidth="1.35"
                />
                <path
                  d="M30.1 10.1l3.35-2.35-.8 4M32.8 8.2l-4.7 4.7"
                  opacity=".9"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.3"
                />
              </svg>
            </span>
            <span>{'Prayer'}</span>
          </a>
          {'\n'}
          <a aria-label="Open Tasbih" className="rud-circle-action" data-rud-route="tasbih" href="#tasbih">
            <span aria-hidden="true" className="rud-circle-icon">
              <svg fill="none" viewBox="0 0 40 40">
                <path
                  d="M12.3 9.4c-4.15 2.8-6.15 7.15-5.45 11.55 1.05 6.45 6.5 10.9 12.9 10.9 6.2 0 11.55-4.25 12.75-10.45.85-4.45-1-8.95-5.05-11.7"
                  opacity=".5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.15"
                />
                <g stroke="currentColor" strokeWidth="1.35">
                  <circle cx="12.5" cy="9.4" r="2.05" />
                  <circle cx="17.45" cy="7.2" r="2.05" />
                  <circle cx="22.7" cy="7.25" r="2.05" />
                  <circle cx="27.55" cy="9.55" r="2.05" />
                  <circle cx="31.1" cy="13.5" r="2" />
                  <circle cx="32.35" cy="18.45" r="2" />
                  <circle cx="31.3" cy="23.35" r="2" />
                  <circle cx="28" cy="27.45" r="2" />
                  <circle cx="23.35" cy="30" r="2" />
                  <circle cx="18.15" cy="30" r="2" />
                  <circle cx="13.4" cy="27.65" r="2" />
                  <circle cx="9.95" cy="23.65" r="2" />
                  <circle cx="8.7" cy="18.75" r="2" />
                  <circle cx="9.7" cy="13.8" r="2" />
                </g>
                <path
                  d="M20.75 32v2.2m0 0h3m-3 0h-3m3 .05v2.35"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.2"
                />
              </svg>
            </span>
            <span>{'Tasbih'}</span>
          </a>
          {'\n'}
          <a aria-label="Open Zakat" className="rud-circle-action" data-rud-route="tracker" href="#tracker">
            <span aria-hidden="true" className="rud-circle-icon">
              <svg fill="none" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="12" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M15.5 16.2h9M15.5 20h7M18.2 13.6v12.8M14.8 27.2c2.2 1.2 4.3 1.8 6.4 1.8 2.4 0 4.3-.7 5.8-2"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.25"
                />
              </svg>
            </span>
            <span>{'Zakat'}</span>
          </a>
          {'\n'}
          <a aria-label="Open Hajj and Umrah" className="rud-circle-action" data-rud-route="umrah" href="#umrah">
            <span aria-hidden="true" className="rud-circle-icon">
              <svg fill="none" viewBox="0 0 40 40">
                <path d="M12 17.5h16v14H12z" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 21h16M21.3 22.5h3.8v9" stroke="currentColor" strokeWidth="1.25" />
                <path
                  d="M8.2 15.2a13.2 13.2 0 0 1 22.2-4.4M31.8 8.2l-.8 4.8-4.6-1.5M31.8 24.8a13.2 13.2 0 0 1-22.2 4.4M8.2 31.8l.8-4.8 4.6 1.5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.35"
                />
              </svg>
            </span>
            <span>{'Hajj & Umrah'}</span>
          </a>
          {'\n'}
          <a aria-label="Open Sadaqah" className="rud-circle-action" data-rud-route="sadaqah" href="#sadaqah">
            <span aria-hidden="true" className="rud-circle-icon">
              <svg fill="none" viewBox="0 0 40 40">
                <path
                  d="M20 31.8s-10-5.55-10-13c0-3.6 2.5-6.2 5.75-6.2 1.95 0 3.55.95 4.25 2.3.7-1.35 2.3-2.3 4.25-2.3 3.25 0 5.75 2.6 5.75 6.2 0 7.45-10 13-10 13Z"
                  stroke="currentColor"
                  strokeLinejoin="round"
                  strokeWidth="1.45"
                />
                <path
                  d="M12.2 29.2c2.4 2.2 5.05 3.5 7.8 4.35M27.8 29.2c-2.4 2.2-5.05 3.5-7.8 4.35"
                  opacity=".58"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.2"
                />
              </svg>
            </span>
            <span>{'Sadaqah'}</span>
          </a>
          {'\n'}
        </div>
        <button
          aria-controls="searchOverlay"
          aria-label="Open Ask Rise AI"
          className="mood-launcher"
          data-open-search=""
          id="heroMoodSearch"
          type="button"
        >
          <span className="mood-launcher-copy">
            <small>
              <span aria-hidden="true" className="mood-ai-logo">
                {'AI'}
              </span>
              <span>{'Ask Rise'}</span>
            </small>
          </span>
          <span aria-hidden="true" className="mood-search-icon">
            <svg fill="none" height="19" viewBox="0 0 24 24" width="19">
              <path
                d="M7.4 17.2 4 20l.8-4.4A7.9 7.9 0 0 1 3 10.6C3 6.4 6.9 3 11.8 3S20.5 6.4 20.5 10.6s-3.9 7.6-8.7 7.6c-1.6 0-3.1-.3-4.4-1Z"
                stroke="currentColor"
                strokeLinejoin="round"
                strokeWidth="1.45"
              />
              <path
                d="M9 10.6h.01M12 10.6h.01M15 10.6h.01"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
              />
            </svg>
          </span>
        </button>
        {'\n'}
        <a aria-label="Explore the page" className="hero-explore-cue" href="#spotlight">
          {'\n'}
          <span>{'Explore'}</span>
          {'\n'}
          <span aria-hidden="true" className="hero-explore-arrow">
            {'↓'}
          </span>
          {'\n'}
        </a>
      </div>
    </section>
  );
}
