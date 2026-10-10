import { useEffect } from 'react';

/** Keeps the app at 100% zoom (Ctrl/Cmd + wheel or +/−/0, Safari pinch, double-tap) — as before. */
export function useZoomLock(): void {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = String(e.key || '').toLowerCase();
      if (['+', '-', '=', '0', 'add', 'subtract'].includes(k)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onGesture = (e: Event) => e.preventDefault();
    let lastTouchEnd = 0;
    const onTouchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    };
    const gestures = ['gesturestart', 'gesturechange', 'gestureend'] as const;
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    gestures.forEach((type) => document.addEventListener(type, onGesture, { passive: false, capture: true }));
    document.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      gestures.forEach((type) => document.removeEventListener(type, onGesture, { capture: true }));
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
    };
  }, []);
}
