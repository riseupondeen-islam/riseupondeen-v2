/* Intro shown when the app opens (V3.1 premium design).
 *
 * - In a browser tab it plays once per session.
 * - It stays 4 seconds so the greeting can be read, and follows the light / dark mode.
 * - In the installed app (Home Screen) it plays at most once every 12 hours, so an ordinary
 *   launch from the Home Screen opens straight into the app.
 * The same rule is applied by the pre-paint script in index.html and by the home controller
 * (features/home/homeInteractions.js) via introAlreadySeen(). */
import { useState } from 'react';
import appLogoUrl from '../../assets/images/app-logo.png';

const STANDALONE_REPEAT_MS = 12 * 60 * 60 * 1000;

function standalone(): boolean {
  try {
    return (
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      matchMedia('(display-mode: standalone)').matches ||
      matchMedia('(display-mode: fullscreen)').matches
    );
  } catch {
    return false;
  }
}

/** True when the intro should not play now. */
export function introAlreadySeen(): boolean {
  try {
    if (sessionStorage.getItem('rud_intro_seen_session_v1') === '1') return true;
    if (standalone()) return Date.now() - Number(localStorage.getItem('rud_intro_seen_at') || 0) < STANDALONE_REPEAT_MS;
  } catch {
    /* storage blocked: play it */
  }
  return false;
}

/** How long the intro stays (ms) — long enough to read the greeting. */
export function introDuration(): number {
  return 4000;
}

export function Preloader() {
  /* Already seen: render it hidden so it never flashes while the feature controllers load. */
  const [seen] = useState(introAlreadySeen);
  return (
    <div
      aria-hidden="true"
      id="preloader"
      className={`rud-intro${seen ? ' hide' : ''}`}
      style={seen ? { transition: 'none' } : undefined}
    >
      <div className="rud-intro-sky" />
      <svg className="rud-intro-arch" viewBox="0 0 200 280" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        <path d="M14 280V118C14 58 56 18 100 6c44 12 86 52 86 112v162" fill="none" stroke="currentColor" strokeWidth="1" />
        <path d="M30 280V124C30 74 64 40 100 28c36 12 70 46 70 96v156" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />
      </svg>
      <div className="rud-intro-inner">
        <span className="rud-intro-mark">
          <img src={appLogoUrl} alt="" width="96" height="96" decoding="async" />
        </span>
        <div className="rud-intro-arabic" lang="ar" dir="rtl">
          {'السَّلَامُ عَلَيْكُمْ'}
        </div>
        <div className="loader-salaam rud-intro-title">{'Assalamu Alaikum'}</div>
        <div className="rud-intro-sub">{'Peace, mercy and blessings of Allah be upon you'}</div>
        <div className="rud-intro-rule" />
        <div className="loader-brand rud-intro-brand">{'RISE UPON DEEN'}</div>
        <div aria-hidden="true" className="rud-intro-progress" />
      </div>
    </div>
  );
}
