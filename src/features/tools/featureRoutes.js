/**
 * Direct-link rendering for feature routes and cleanup (compass/clock, Qur'an focus) when leaving them.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { stopCompass, stopPrayerClock } from '../prayer/prayerQibla';
import { rudQuranMinimizePlayer } from '../quran/quran';
import { legacyDocumentLoading, onLegacyDomContentLoaded } from '../../runtime/lifecycle';

function renderFromHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  const [route, idRaw] = raw.split('/');
  if (route === 'quran') {
    window.rudRenderQuran?.();
    return true;
  }
  if (route === 'prayer') {
    window.rudRenderPrayer();
    return true;
  }
  if (route === 'tasbih') {
    const id = idRaw ? decodeURIComponent(idRaw) : '';
    window.rudRenderTasbih(id === 'choose' ? '__choose__' : id);
    return true;
  }
  if (route === 'tracker') {
    window.rudRenderZakat?.();
    return true;
  }
  if (route === 'sadaqah') {
    window.rudRenderSadaqah?.();
    return true;
  }
  if (route === 'umrah' || route === 'hajj') {
    window.rudRenderUmrah?.();
    return true;
  }
  return false;
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  window.addEventListener('hashchange', () => {
    const r = (location.hash || '').replace(/^#/, '').split('/')[0];
    if (r !== 'prayer' && r !== 'tasbih') {
      stopCompass();
      stopPrayerClock();
    }
    if (r !== 'quran') {
      document.body.classList.remove('rud-quran-focus');
      rudQuranMinimizePlayer();
    }
  });
  window.addEventListener('rud:public-content-updated', (event) => {
    const r = (location.hash || '').replace(/^#/, '').split('/')[0];
    if (r === 'tasbih' && !event?.detail?.routerRendered) renderFromHash();
  });
  if (legacyDocumentLoading()) onLegacyDomContentLoaded(renderFromHash);
  else renderFromHash();
}
