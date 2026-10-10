/* React pages rendered into the route surface (#dynamicPage).
 *
 * Most routes are still rendered by the migrated feature controllers via showPage(html). Routes
 * that have been converted to React components are shown with showReactPage(), which portals the
 * component into the same #dynamicPage element, so layout, CSS selectors and transitions are
 * identical. Before any controller replaces #dynamicPage's contents, releaseReactPage() unmounts
 * the active React page synchronously so React never holds references to detached nodes.
 */
import { Fragment, useSyncExternalStore, type ReactElement } from 'react';
import { createPortal, flushSync } from 'react-dom';

interface ActivePage {
  key: number;
  element: ReactElement;
}

let active: ActivePage | null = null;
let nextKey = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function snapshot(): ActivePage | null {
  return active;
}

/** Mounts `element` into #dynamicPage (replacing any previous React page) and commits synchronously. */
export function mountReactPage(element: ReactElement): void {
  flushSync(() => {
    active = { key: nextKey++, element };
    emit();
  });
}

/** Unmounts the active React page, if any. Safe to call at any time outside React rendering. */
export function releaseReactPage(): void {
  if (!active) return;
  flushSync(() => {
    active = null;
    emit();
  });
}

export function hasReactPage(): boolean {
  return active !== null;
}

/** Rendered once by <App/>; portals the active React page into the route surface. */
export function ReactPageOutlet() {
  const page = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (!page) return null;
  const surface = document.getElementById('dynamicPage');
  if (!surface) return null;
  return createPortal(<Fragment key={page.key}>{page.element}</Fragment>, surface);
}
