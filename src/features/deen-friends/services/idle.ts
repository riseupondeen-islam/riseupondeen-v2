/* Runs non-essential work when the browser is idle (or after a short delay where requestIdleCallback
 * is missing, e.g. Safari). Returns a cancel function for effect cleanup. */
export function whenIdle(run: () => void, timeout = 2500): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(run, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(run, Math.min(timeout, 1200));
  return () => clearTimeout(id);
}
