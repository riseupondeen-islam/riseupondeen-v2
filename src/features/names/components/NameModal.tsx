import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { NAME_CARD_SELECTOR, readNameCard, type NameDetails } from '../nameDetails';
import { lockPageScroll } from '../../../services/ui/scrollLock';

const EMPTY: NameDetails = { arabic: '', name: '', meaning: '', reflection: '', when: '' };

/**
 * Details dialog for the Beautiful Names (#nameModal).
 * Replaces two overlapping legacy implementations (one bound at start-up to cards that did not
 * exist yet, one delegated). Behaviour kept: open from any name card by click or Enter/Space,
 * close with ×, the backdrop or Escape, body scroll locked while open, Tab kept inside the dialog.
 * Fixed: focus now returns to the card that opened the dialog when it closes, and moving focus
 * into the dialog no longer intermittently fails while its fade-in has not started.
 */
export function NameModal() {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<NameDetails>(EMPTY);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const releaseScroll = useRef<(() => void) | null>(null);

  const show = useCallback((card: Element) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Commit synchronously (as the original did) so the dialog is visible before focus moves into it.
    flushSync(() => {
      setDetails(readNameCard(card));
      setOpen(true);
    });
    openRef.current = true;
    // V3: iOS-safe, position-preserving lock (overflow:hidden alone let iOS scroll the page behind
    // the dialog, and the scroll restore on close made the page jump).
    releaseScroll.current?.();
    releaseScroll.current = lockPageScroll();
    // The dialog fades in (visibility is animated), and a still-hidden element cannot take focus.
    // The original focused once after 30 ms, which intermittently failed on slower frames; retry
    // on the following frames until focus has actually moved into the dialog.
    const focusClose = (attempt = 0) => {
      const button = closeRef.current;
      if (!button || !openRef.current) return;
      button.focus();
      if (document.activeElement !== button && attempt < 30) requestAnimationFrame(() => focusClose(attempt + 1));
    };
    window.setTimeout(focusClose, 30);
  }, []);

  const hide = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    flushSync(() => setOpen(false));
    releaseScroll.current?.();
    releaseScroll.current = null;
    let target = returnFocus.current;
    // The names grid may have been re-rendered by a content refresh while the dialog was open.
    if (target && !target.isConnected) {
      const name = target.getAttribute('data-name');
      target = name
        ? [...document.querySelectorAll<HTMLElement>(NAME_CARD_SELECTOR)].find((c) => c.getAttribute('data-name') === name) ?? null
        : null;
    }
    target?.focus({ preventScroll: true });
    returnFocus.current = null;
  }, []);

  useEffect(() => {
    const onClick = (e: globalThis.MouseEvent) => {
      const target = e.target as Element | null;
      const card = target?.closest?.(NAME_CARD_SELECTOR);
      if (card) {
        e.preventDefault();
        show(card);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const target = e.target as Element | null;
      const card = target?.closest ? target.closest(NAME_CARD_SELECTOR) : null;
      if (card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        show(card);
      }
      if (e.key === 'Escape' && openRef.current) hide();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    const w = window as unknown as { openNameModal?: (card: Element) => void };
    w.openNameModal = show;
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
      if (w.openNameModal === show) delete w.openNameModal;
    };
  }, [show, hide]);

  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) hide();
  };

  /* Keep keyboard focus inside the open dialog. */
  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !openRef.current || !modalRef.current) return;
    const focusables = [
      ...modalRef.current.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])'),
    ].filter((el) => !(el as HTMLButtonElement).disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  return (
    <div
      ref={modalRef}
      aria-hidden={open ? 'false' : 'true'}
      aria-labelledby="modalTitle"
      aria-modal="true"
      className={open ? 'modal open' : 'modal'}
      id="nameModal"
      role="dialog"
      onClick={onBackdropClick}
      onKeyDown={onDialogKeyDown}
    >
      <div className="modal-card glass">
        <button ref={closeRef} aria-label="Close modal" className="modal-close" id="modalClose" onClick={hide}>
          ×
        </button>
        <div className="modal-arabic" id="modalArabic" lang="ar">
          {details.arabic}
        </div>
        <h3 id="modalTitle">{details.name}</h3>
        <div className="modal-meaning" id="modalMeaning">
          {details.meaning}
        </div>
        <div className="modal-divider" />
        <div className="modal-label">Reflection</div>
        <p className="modal-copy" id="modalReflection">
          {details.reflection}
        </p>
        <div className="modal-label">When to remember this Name</div>
        <p className="modal-copy" id="modalWhen">
          {details.when}
        </p>
      </div>
    </div>
  );
}
