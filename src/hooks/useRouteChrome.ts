import { useLayoutEffect, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

/* Route chrome: the floating Back lane on detail pages and the × on the Dua/Hadith/Saved libraries.
   Same rules and timing as the two original controllers: re-evaluated one frame after a hash
   change or page show, and synchronously whenever a route finishes rendering. */
const DETAIL_TYPES = new Set(['article', 'dua', 'hadith', 'reminder', 'heart', 'name']);
const LIBRARY_TYPES = new Set(['duas', 'hadith', 'saved']);

export interface RouteChrome {
  /** A single item is open (e.g. #dua/<id>): show Back. */
  detail: boolean;
  /** A library list is open (#duas, #hadith, #saved): show ×. */
  library: boolean;
}

export function readRouteChrome(hash: string): RouteChrome {
  const parts = String(hash || '#home')
    .replace(/^#/, '')
    .split('/')
    .filter(Boolean);
  const type = (parts[0] || 'home').toLowerCase();
  const id = parts.slice(1).join('/');
  return { detail: DETAIL_TYPES.has(type) && id.length > 0, library: LIBRARY_TYPES.has(type) && !id };
}

const STATES: Record<string, RouteChrome> = {};
function snapshot(): RouteChrome {
  const value = readRouteChrome(location.hash);
  const key = `${value.detail}|${value.library}`;
  return (STATES[key] ||= value);
}

/* One set of DOM listeners shared by every component that reads the route chrome. */
const subscribers = new Set<() => void>();
let frame = 0;
function notify(): void {
  flushSync(() => subscribers.forEach((fn) => fn()));
}
function notifyNextFrame(): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(notify);
}

function subscribe(onChange: () => void): () => void {
  if (subscribers.size === 0) {
    window.addEventListener('hashchange', notifyNextFrame, { passive: true });
    window.addEventListener('pageshow', notifyNextFrame, { passive: true });
    document.addEventListener('rud-route-rendered', notify);
  }
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
    if (subscribers.size === 0) {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', notifyNextFrame);
      window.removeEventListener('pageshow', notifyNextFrame);
      document.removeEventListener('rud-route-rendered', notify);
    }
  };
}

export function useRouteChrome(): RouteChrome {
  return useSyncExternalStore(subscribe, snapshot, () => STATES['false|false'] || { detail: false, library: false });
}

/** Body classes used by the stylesheet to make room for the route chrome. */
export function useRouteChromeBodyClasses(): void {
  const { detail, library } = useRouteChrome();
  useLayoutEffect(() => {
    document.body.classList.toggle('rud-detail-back-visible', detail);
    document.body.classList.toggle('rud-individual-detail-open', detail);
    document.body.classList.toggle('rud-library-x-visible', library);
  }, [detail, library]);
}
