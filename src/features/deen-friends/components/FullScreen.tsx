/* Full-screen conversation container (friend chat and RISE chat).
 *
 * - Portalled to <body>, so no page transform or overflow rule can move it.
 * - Hides the site navbar while open (body.df2-chat-open) and restores it on close.
 * - Sized to window.visualViewport, so the on-screen keyboard never covers the composer and the
 *   layout does not jump when the mobile address bar shows or hides.
 * - Escape closes it (unless a sheet is open on top). */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from './ui';

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
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!viewport) return;
        panel.style.setProperty('--df2-vh', `${Math.round(viewport.height)}px`);
        panel.style.setProperty('--df2-vtop', `${Math.round(viewport.offsetTop)}px`);
      });
    };
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.df2-sheet-backdrop')) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
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
      {children}
    </div>,
    document.body,
  );
}
