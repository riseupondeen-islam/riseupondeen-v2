/* App-level dialog/bottom-sheet primitive for V3 overlays (install guides, in-app browser card,
 * App Guide index). Portalled to <body>, focus-trapped, Escape and backdrop close, and uses the shared
 * reference-counted scroll lock so nested overlays never unlock the page early. */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { lockPageScroll } from '../../services/ui/scrollLock';

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
const stack: number[] = [];
let counter = 0;

export function AppDialog({
  label,
  title,
  kicker,
  onClose,
  children,
  footer,
  className = '',
  closeLabel = 'Close',
  dismissible = true,
}: {
  label?: string;
  title?: ReactNode;
  kicker?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeLabel?: string;
  dismissible?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = ++counter;
    stack.push(id);
    const release = lockPageScroll();
    const previous = document.activeElement as HTMLElement | null;
    const el = panel.current;
    requestAnimationFrame(() => {
      const first = el?.querySelector<HTMLElement>('[data-autofocus]') || el?.querySelector<HTMLElement>(FOCUSABLE);
      (first || el)?.focus({ preventScroll: true });
    });
    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || !el) return;
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      stack.splice(stack.indexOf(id), 1);
      release();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [dismissible]);

  return createPortal(
    <div
      className={`rud-v3 rud-dialog-backdrop ${className}`}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="rud-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : label}
        aria-labelledby={title ? titleId : undefined}
        ref={panel}
        tabIndex={-1}
      >
        {dismissible ? (
          <button type="button" className="rud-dialog-close" onClick={onClose} aria-label={closeLabel}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        ) : null}
        {kicker || title ? (
          <header className="rud-dialog-head">
            {kicker ? <span className="rud-dialog-kicker">{kicker}</span> : null}
            {title ? <h2 id={titleId}>{title}</h2> : null}
          </header>
        ) : null}
        <div className="rud-dialog-body">{children}</div>
        {footer ? <footer className="rud-dialog-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
