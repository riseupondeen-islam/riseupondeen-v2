/* One reference-counted page scroll lock for every overlay (chats, sheets, dialogs, tours).
 *
 * Why not just `body { overflow: hidden }`: iOS Safari ignores it for touch scrolling, so the page
 * behind a full-screen chat still moved, and when two overlays were open, closing the inner one
 * removed the class and unlocked the page underneath the outer one.
 *
 * How it works:
 *  - The first lock pins <body> with position:fixed at the current scroll offset (works on iOS
 *    Safari, Android Chrome, desktop and installed PWAs) and remembers the offset.
 *  - Nested locks only increase a counter. The page unlocks when the last one is released, and the
 *    reader is put back exactly where they were.
 *  - While locked, touch moves that would scroll the page (instead of a scrollable area inside the
 *    overlay) are cancelled, so momentum never "chains" to the page.
 *  - window.__RUD_SCROLL_LOCK_DEPTH tells the history scroll engine not to record the temporary
 *    position 0 while the body is pinned.
 */

let depth = 0;
let savedY = 0;
let savedX = 0;
let savedStyle = '';

declare global {
  interface Window {
    __RUD_SCROLL_LOCK_DEPTH?: number;
  }
}

function scrollableAncestor(start: EventTarget | null, dy: number): boolean {
  let el = start instanceof Element ? start : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    const canScrollX = /(auto|scroll|overlay)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
    if (canScrollX) return true;
    if (canScrollY) {
      // Allow when this area can still move in the gesture's direction. At its edge, keep looking
      // outward: a list inside a scrolling sheet must hand the gesture to the sheet, not freeze.
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((dy > 0 && !atTop) || (dy < 0 && !atBottom) || dy === 0) return true;
    }
    if (el.matches('input,textarea,select,[contenteditable="true"],[data-scroll-lock-allow]')) return true;
    el = el.parentElement;
  }
  return false;
}

let touchStartY = 0;
function onTouchStart(event: TouchEvent): void {
  touchStartY = event.touches[0]?.clientY ?? 0;
}
function onTouchMove(event: TouchEvent): void {
  if (event.touches.length > 1) return; // pinch zoom is handled by the browser
  const dy = (event.touches[0]?.clientY ?? 0) - touchStartY;
  if (!scrollableAncestor(event.target, dy) && event.cancelable) event.preventDefault();
}

export function lockPageScroll(): () => void {
  depth += 1;
  window.__RUD_SCROLL_LOCK_DEPTH = depth;
  if (depth === 1) {
    const body = document.body;
    savedY = window.scrollY || window.pageYOffset || 0;
    savedX = window.scrollX || 0;
    savedStyle = body.getAttribute('style') || '';
    // Inline !important: the legacy stylesheets pin `body { position: relative !important; inset: auto
    // !important }`, which silently beat plain inline styles (the page then was not pinned at all).
    const pin = (prop: string, value: string) => body.style.setProperty(prop, value, 'important');
    pin('position', 'fixed');
    pin('top', `-${savedY}px`);
    pin('left', `-${savedX}px`);
    pin('right', '0');
    pin('width', '100%');
    pin('overflow', 'hidden');
    document.documentElement.classList.add('rud-scroll-locked');
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    window.__RUD_SCROLL_LOCK_DEPTH = depth;
    if (depth === 0) {
      const body = document.body;
      if (savedStyle) body.setAttribute('style', savedStyle);
      else body.removeAttribute('style');
      document.documentElement.classList.remove('rud-scroll-locked');
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      const html = document.documentElement;
      const previous = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      window.scrollTo(savedX, savedY);
      html.style.scrollBehavior = previous;
    }
  };
}

export function pageScrollLocked(): boolean {
  return depth > 0;
}
