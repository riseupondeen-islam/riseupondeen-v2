/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */
import { useState } from 'react';

/* Intro preloader shown once per session. */

/** The intro plays once per browser session (same flag the home controller sets). */
function introAlreadySeen(): boolean {
  try {
    return sessionStorage.getItem('rud_intro_seen_session_v1') === '1';
  } catch {
    return false;
  }
}

export function Preloader() {
  /* Returning within the same session: render it already hidden, so it never flashes while the
     feature controllers load (they apply the same "hide" state once they start). */
  const [seen] = useState(introAlreadySeen);
  return (
    <div
      aria-hidden="true"
      id="preloader"
      className={seen ? 'hide' : undefined}
      style={seen ? { transition: 'none' } : undefined}
    >
      <div aria-hidden="true" className="intro-noor" />
      <div aria-hidden="true" className="intro-makkah">
        <div className="intro-minaret left" />
        <div className="intro-minaret right" />
        <div className="intro-kaaba" />
        <div className="intro-floor" />
      </div>
      <div className="preloader-inner">
        <div className="intro-kicker">{'Welcome to Rise Upon Deen'}</div>
        <div className="loader-salaam">{'Assalamualaikum'}</div>
        <div className="loader-salaam-en">{'Peace be upon you, and the mercy and blessings of Allah'}</div>
        <div className="loader-divider" />
        <div className="loader-bismillah" lang="ar">
          {'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ'}
        </div>
        <div className="loader-bismillah-en">{'In the name of Allah, the Most Compassionate, the Most Merciful'}</div>
        <div className="loader-brand">{'RISE UPON DEEN'}</div>
        <div aria-hidden="true" className="intro-progress" />
      </div>
    </div>
  );
}
