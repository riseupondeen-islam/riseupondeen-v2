/* Full-screen conversation container (friend chat and RISE chat).
 *
 * - Portalled to <body>, so no page transform or overflow rule can move it.
 * - Hides the site navbar while open (body.df2-chat-open) and restores it on close.
 * - Sized to window.visualViewport, so the on-screen keyboard never covers the composer and the
 *   layout does not jump when the mobile address bar shows or hides.
 * - Escape closes it (unless a sheet is open on top). */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChatThemeContext, useBodyScrollLock } from './ui';

export function FullScreen({
  label,
  theme,
  onClose,
  children,
}: {
  label: string;
  theme?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useBodyScrollLock(true, 'df2-chat-open');

  useEffect(() => {
    const panel = ref.current;
    const viewport = window.visualViewport;
    if (!panel) return;
    let frame = 0;
    let lastH = -1;
    let lastTop = -1;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!viewport) return;
        const h = Math.round(viewport.height);
        const top = Math.max(0, Math.round(viewport.offsetTop));
        // Write only real changes: repeated identical writes during the keyboard animation made the
        // conversation shake.
        if (h !== lastH) {
          lastH = h;
          panel.style.setProperty('--df2-vh', `${h}px`);
        }
        if (top !== lastTop) {
          lastTop = top;
          panel.style.setProperty('--df2-vtop', `${top}px`);
        }
        // The page behind is pinned; if the browser still scrolled the window for the keyboard, put
        // it back so nothing behind the chat moves.
        if (window.scrollY !== 0 && document.body.style.position === 'fixed') window.scrollTo(0, 0);
      });
    };
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    // Keep the newest message in view when the keyboard opens.
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches('textarea, input')) return;
      window.setTimeout(() => {
        const list = panel.querySelector<HTMLElement>('.df2-chat-body');
        if (list) list.scrollTop = list.scrollHeight;
      }, 320);
    };
    panel.addEventListener('focusin', onFocus);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.df2-sheet-backdrop')) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      panel.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return createPortal(
    <div
      className="df2-root df2-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      ref={ref}
      data-chat-theme={theme || 'ivory'}
    >
      <ChatThemeContext.Provider value={theme || 'ivory'}>{children}</ChatThemeContext.Provider>
    </div>,
    document.body,
  );
}
