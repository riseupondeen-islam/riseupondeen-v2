/* Document lifecycle emulation for the migrated feature controllers.
 *
 * In the original page every <script> ran while the HTML was still being parsed, so
 * `document.readyState === "loading"` was true and "DOMContentLoaded"/"load" listeners fired only
 * after ALL scripts had run. In the React app the controllers start after the first commit, when
 * those events have usually already fired. These helpers keep the original ordering: callbacks
 * are queued and flushed by the runtime once every controller has been initialised.
 */
type Callback = (event?: Event) => void;

let domFlushed = false;
let loadFlushed = false;
const domQueue: Callback[] = [];
const loadQueue: Callback[] = [];

/** Replacement for `document.readyState === "loading"` inside migrated controllers. */
export function legacyDocumentLoading(): boolean {
  return !domFlushed;
}

/** Replacement for `document.addEventListener("DOMContentLoaded", cb)`. */
export function onLegacyDomContentLoaded(cb: Callback): void {
  if (domFlushed) queueMicrotask(() => cb(new Event('DOMContentLoaded')));
  else domQueue.push(cb);
}

/** Replacement for `window.addEventListener("load", cb)`. */
export function onLegacyWindowLoad(cb: Callback): void {
  if (loadFlushed) queueMicrotask(() => cb(new Event('load')));
  else loadQueue.push(cb);
}

function runAll(queue: Callback[], type: string): void {
  const event = new Event(type);
  for (const cb of queue.splice(0)) {
    try {
      cb(event);
    } catch (error) {
      // One failing listener must not stop the others (same as independent DOM listeners).
      console.error(`[Rise Upon Deen] ${type} handler failed`, error);
    }
  }
}

export function flushDomContentLoaded(): void {
  if (domFlushed) return;
  domFlushed = true;
  runAll(domQueue, 'DOMContentLoaded');
}

/** Runs queued "load" callbacks once the window has actually finished loading. */
export function flushWindowLoadWhenReady(): void {
  const run = () => {
    if (loadFlushed) return;
    loadFlushed = true;
    runAll(loadQueue, 'load');
  };
  if (document.readyState === 'complete') setTimeout(run, 0);
  else window.addEventListener('load', run, { once: true });
}
