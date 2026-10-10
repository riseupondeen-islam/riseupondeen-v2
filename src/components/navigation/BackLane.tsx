import type { MouseEvent } from 'react';
import { useRouteChrome } from '../../hooks/useRouteChrome';

/** Returns to the previous screen: the scroll-restoring history helper when present, else history/home. */
function goBack(): void {
  const w = window as unknown as { RUD_goBack?: () => void };
  if (typeof w.RUD_goBack === 'function') {
    w.RUD_goBack();
    return;
  }
  if (history.length > 1) {
    history.back();
    return;
  }
  location.hash = '#home';
}

/** Floating "← Back" lane shown on every detail route (#dua/…, #hadith/…, #name/…, …). */
export function BackLane() {
  const { detail } = useRouteChrome();
  const onBack = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    goBack();
  };
  return (
    <section
      aria-hidden={detail ? 'false' : 'true'}
      className={detail ? 'rud-back-lane rud-visible' : 'rud-back-lane'}
      hidden={!detail}
      id="rudBackLane"
    >
      {'\n'}
      <div className="rud-back-lane-inner">
        {'\n'}
        <button
          aria-label="Go to previous page"
          className="rud-premium-back"
          id="rudUniversalBack"
          type="button"
          onClick={onBack}
        >
          {'\n'}
          <span aria-hidden="true" className="rud-back-arrow">
            {'←'}
          </span>
          {'\n'}
          <span>{'Back'}</span>
          {'\n'}
        </button>
        {'\n'}
      </div>
      {'\n'}
    </section>
  );
}
