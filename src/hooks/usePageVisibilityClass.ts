import { useEffect } from 'react';

/** html.rud-page-inactive pauses decorative animations while the page is hidden. */
export function usePageVisibilityClass(): void {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.classList.toggle('rud-page-inactive', document.visibilityState !== 'visible');
    const onHide = () => root.classList.add('rud-page-inactive');
    document.addEventListener('visibilitychange', sync, { passive: true } as AddEventListenerOptions);
    window.addEventListener('pagehide', onHide, { passive: true });
    window.addEventListener('pageshow', sync, { passive: true });
    sync();
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', sync);
    };
  }, []);
}
