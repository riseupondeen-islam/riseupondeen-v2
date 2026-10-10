/* Intro shown when the app opens (V3.1 premium design).
 *
 * - In a browser tab it plays once per session.
 * - In the installed app (Home Screen) it plays at most once every 12 hours and is shorter, so a
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

/** How long the intro stays (ms): shorter in the installed app. */
export function introDuration(): number {
  return standalone() ? 1150 : 1700;
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
      <svg className="rud-intro-star" viewBox="0 0 200 200" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="0.6">
          <rect x="40" y="40" width="120" height="120" />
          <rect x="40" y="40" width="120" height="120" transform="rotate(45 100 100)" />
          <circle cx="100" cy="100" r="58" />
          <circle cx="100" cy="100" r="84" />
        </g>
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
