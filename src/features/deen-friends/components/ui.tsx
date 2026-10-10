/* Small presentational building blocks shared by the Deen Friends screens. */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AvatarConfig, AvatarKey } from '../types';
import { AvatarArt } from '../../../components/avatar/AvatarArt';
import { initials } from '../services/format';
import { notify } from '../../../services/ui/notify';
import { lockPageScroll } from '../../../services/ui/scrollLock';

/* ---------- icons (inline SVG, inherit currentColor) ---------- */

const ICON_PATHS: Record<string, ReactNode> = {
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="16.5" cy="9.5" r="2.3" />
      <path d="M3.8 18.4c.7-3 2.4-4.6 5.2-4.6s4.5 1.6 5.2 4.6M14.3 14.5c2.8-.1 4.7 1.2 5.4 3.9" />
    </>
  ),
  flame: (
    <path d="M12.2 21c4.2 0 7-2.6 7-6.5 0-3.3-2.1-5.2-4.2-7.6-.1 2.2-.9 3.3-2.1 4.1.1-3.6-1.6-6.6-4.1-8.5.1 3.5-3.1 5.3-3.1 9.1C5.7 17.7 8.3 21 12.2 21Z" />
  ),
  chat: <path d="M5 6.5h14v10H9l-4 3v-13Z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.8" />
    </>
  ),
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m6 12 4 4 8-9" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="m15 5-7 7 7 7" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  share: (
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="m8.2 10.8 7.5-4.3M8.2 13.2l7.5 4.3" />
    </>
  ),
  inbox: (
    <>
      <circle cx="9" cy="8" r="3.1" />
      <path d="M3.7 18.2c.8-3 2.5-4.6 5.3-4.6s4.5 1.6 5.2 4.6M17 8v6M14 11h6" />
    </>
  ),
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 16.9V20Zm10.5-12.5 2 2" />,
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  send: <path d="M21 3 10.8 13.2M21 3l-6.4 18-3.8-7.8L3 9.4 21 3Z" />,
  book: (
    <path d="M4 5.5c3-1.5 5.5-1.2 8 .8v13c-2.5-2-5-2.3-8-.8v-13Zm16 0c-3-1.5-5.5-1.2-8 .8v13c2.5-2 5-2.3 8-.8v-13Z" />
  ),
  hands: <path d="M8 21v-6l-3-4V6.5a1.5 1.5 0 0 1 3 0V11M16 21v-6l3-4V6.5a1.5 1.5 0 0 0-3 0V11M12 4v7" />,
  beads: (
    <>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="17" cy="8" r="1.8" />
      <circle cx="17" cy="14" r="1.8" />
      <circle cx="12" cy="17" r="1.8" />
      <circle cx="7" cy="14" r="1.8" />
      <circle cx="7" cy="8" r="1.8" />
      <path d="M12 19v2.5" />
    </>
  ),
  scroll: (
    <path d="M7 4h11v13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-1h11v1a3 3 0 0 0 3 3M7 4a3 3 0 0 0-3 3v1M10 9h5M10 12h5" />
  ),
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  shield: <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" />,
  bell: <path d="M6.8 9.5a5.2 5.2 0 0 1 10.4 0c0 6 2.1 6.2 2.1 6.2H4.7s2.1-.2 2.1-6.2ZM9.8 18.2c.4 1 1.1 1.5 2.2 1.5s1.8-.5 2.2-1.5" />,
  trash: <path d="M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  verified: (
    <path d="m12 2.8 2.4 1.7 2.9-.1.9 2.8 2.4 1.7-.9 2.8.9 2.8-2.4 1.7-.9 2.8-2.9-.1L12 21.2l-2.4-1.7-2.9.1-.9-2.8-2.4-1.7.9-2.8-.9-2.8 2.4-1.7.9-2.8 2.9.1L12 2.8Zm-3.4 9.3 2.3 2.3 4.6-4.6" />
  ),
  heart: <path d="M20.8 8.8c0 5.4-8.8 10.4-8.8 10.4S3.2 14.2 3.2 8.8A4.7 4.7 0 0 1 12 6.2a4.7 4.7 0 0 1 8.8 2.6Z" />,
};

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size = 20, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      className="df2-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* ---------- avatars (the seven modest avatars V1 offered, unchanged artwork) ---------- */

const AVATAR_ART: Record<AvatarKey, ReactNode> = {
  crescent: (
    <>
      <circle cx="36" cy="36" r="36" fill="#F6EBD5" />
      <circle cx="34" cy="34" r="17" fill="#B27D27" />
      <circle cx="42" cy="28" r="17" fill="#F6EBD5" />
      <path d="M49 17l2 4.6 4.6 2-4.6 2-2 4.6-4.6-2 4.6-2 2-4.6Z" fill="#8E631F" />
      <circle cx="53" cy="43" r="2" fill="#B27D27" />
    </>
  ),
  mecca: (
    <>
      <circle cx="36" cy="36" r="36" fill="#F3E9D5" />
      <path d="M13 50h46v8H13z" fill="#B88A3A" />
      <path d="M19 49V29h34v20H19Z" fill="#171816" />
      <path d="M19 31h34" stroke="#C9A055" strokeWidth="3" />
      <path d="M22 36h28" stroke="#D9B66C" strokeWidth="1.5" />
      <path d="M31 49v-6h10v6" fill="#E8DCC5" />
      <path d="M14 27c8-6 15-9 22-9s14 3 22 9" fill="none" stroke="#B27D27" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  madina: (
    <>
      <circle cx="36" cy="36" r="36" fill="#E8F0EA" />
      <path d="M13 51h46v7H13z" fill="#718C7C" />
      <path d="M18 50V34c4-7 10-10 18-10s14 3 18 10v16" fill="#547364" />
      <path d="M30 50V39c0-3.3 2.7-6 6-6s6 2.7 6 6v11" fill="#F8F0E3" />
      <path d="M22 34h28" stroke="#D1A858" strokeWidth="2" />
      <path d="M36 14l-8 11h16z" fill="#B27D27" />
      <path d="M36 9v7" stroke="#B27D27" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  mosque: (
    <>
      <circle cx="36" cy="36" r="36" fill="#E9F0EA" />
      <path d="M17 48h38v8H17z" fill="#789181" />
      <path d="M22 48V36c3-5 8-8 14-8s11 3 14 8v12" fill="#587464" />
      <path d="M31 48V39c0-3 2-5 5-5s5 2 5 5v9" fill="#F7F1E6" />
      <path d="M17 36h4v20h-4zm34 0h4v20h-4z" fill="#496758" />
      <path d="M36 19l-7 10h14z" fill="#A9792D" />
    </>
  ),
  quran: (
    <>
      <circle cx="36" cy="36" r="36" fill="#F1E8D4" />
      <path d="M14 23c8-4 15-3 22 2v30c-7-5-14-6-22-2V23Z" fill="#A9792D" />
      <path d="M58 23c-8-4-15-3-22 2v30c7-5 14-6 22-2V23Z" fill="#8E631F" />
      <path d="M36 25v30" stroke="#F8F1E5" strokeWidth="2" />
      <path
        d="M21 31c4-2 8-2 12 1M21 36c4-2 8-2 12 1M51 31c-4-2-8-2-12 1M51 36c-4-2-8-2-12 1"
        fill="none"
        stroke="#F8F1E5"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  ),
  lantern: (
    <>
      <circle cx="36" cy="36" r="36" fill="#F5E9D2" />
      <path d="M29 16h14l-2 5H31l-2-5Z" fill="#A9792D" />
      <path d="M27 21h18l5 11v18H22V32l5-11Z" fill="#8E631F" />
      <path d="M30 27h12v18H30z" fill="#F3D78F" opacity=".92" />
      <path d="M26 51h20l-3 5H29l-3-5Z" fill="#A9792D" />
    </>
  ),
  minaret: (
    <>
      <circle cx="36" cy="36" r="36" fill="#E8F0EA" />
      <path d="M27 55h18V27H27z" fill="#668273" />
      <path d="M24 27h24v5H24z" fill="#A9792D" />
      <path d="M29 21h14v6H29z" fill="#789181" />
      <path d="M36 12l-6 9h12z" fill="#A9792D" />
      <path d="M31 37h10v18H31z" fill="#F7F1E6" />
    </>
  ),
};

export const AVATAR_LABELS: Record<AvatarKey, string> = {
  crescent: 'Crescent',
  mecca: 'Makkah',
  madina: 'Madinah',
  mosque: 'Masjid',
  quran: 'Qur’an',
  lantern: 'Lantern',
  minaret: 'Minaret',
};

export function Avatar({
  avatar,
  config,
  name,
  size = 44,
  online = false,
}: {
  avatar?: AvatarKey | null;
  /** V3 built avatar; shown instead of the classic artwork when present. */
  config?: AvatarConfig | null;
  name: string;
  size?: number;
  online?: boolean;
}) {
  return (
    <span className={`df2-avatar${config ? ' df2-avatar-built' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      {config ? (
        <AvatarArt config={config} name={name} size={size} />
      ) : avatar ? (
        <svg viewBox="0 0 72 72" width={size} height={size}>
          {AVATAR_ART[avatar]}
        </svg>
      ) : (
        <span className="df2-avatar-initials">{initials(name)}</span>
      )}
      {online ? <i className="df2-avatar-online" /> : null}
    </span>
  );
}

/* ---------- toasts (rendered by the app-wide notification cards, services/ui/notify.ts) ---------- */

type ToastTone = 'info' | 'success' | 'error' | 'warning';

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const show = useCallback((text: string, tone: ToastTone = 'info') => {
    notify(text, tone, { className: 'df2-note' });
  }, []);
  return <ToastContext.Provider value={show}>{children}</ToastContext.Provider>;
}

export function useToast() {
  return useContext(ToastContext);
}

/* ---------- chat theme context (V3) ----------
   Sheets and dialogs are portalled to <body>, outside the themed full-screen chat, so they used to
   keep the app's colours while the messages used the chat theme. FullScreen provides its theme here
   and every Sheet opened inside a chat applies the same theme tokens. */
export const ChatThemeContext = createContext<string>('');

/* ---------- modal sheet (bottom sheet on phones, dialog on larger screens) ---------- */

/** Open sheets, top-most last: only the top one reacts to Escape and Tab. */
const sheetStack: number[] = [];
let sheetCounter = 0;
/** How many mounted overlays currently want each body class (so nested overlays never remove it early). */
const bodyClassUsers = new Map<string, number>();

/**
 * Locks page scroll while at least one sheet or full-screen chat is open (reference-counted, iOS-safe:
 * services/ui/scrollLock.ts) and keeps a body class for styling (e.g. hiding the site navbar).
 */
export function useBodyScrollLock(active: boolean, className = 'df2-sheet-open') {
  useEffect(() => {
    if (!active) return;
    const release = lockPageScroll();
    bodyClassUsers.set(className, (bodyClassUsers.get(className) || 0) + 1);
    document.body.classList.add(className);
    return () => {
      const left = (bodyClassUsers.get(className) || 1) - 1;
      bodyClassUsers.set(className, left);
      if (left <= 0) document.body.classList.remove(className);
      release();
    };
  }, [active, className]);
}

export function Sheet({
  title,
  kicker,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  kicker?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the focus effect on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useBodyScrollLock(true);
  const chatTheme = useContext(ChatThemeContext);
  useEffect(() => {
    const sheetId = ++sheetCounter;
    sheetStack.push(sheetId);
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'),
          ).filter((el) => !el.hasAttribute('disabled'))
        : [];
    const first = focusable()[0];
    (first || panel)?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (sheetStack[sheetStack.length - 1] !== sheetId) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
      if (event.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      sheetStack.splice(sheetStack.indexOf(sheetId), 1);
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      className="df2-root df2-sheet-backdrop"
      data-chat-theme={chatTheme || undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`df2-sheet${wide ? ' df2-sheet-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="df2-sheet-head">
          <div>
            {kicker ? <span className="df2-kicker">{kicker}</span> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="df2-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="df2-sheet-body">{children}</div>
        {footer ? <footer className="df2-sheet-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

/** A confirmation step for destructive actions (no browser confirm(), which blocks the page). */
export function ConfirmSheet({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      title={title}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="df2-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`df2-btn ${danger ? 'df2-btn-danger' : 'df2-btn-primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="df2-confirm-text">{message}</div>
    </Sheet>
  );
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="df2-empty">
      <span className="df2-empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <strong>{title}</strong>
      {children ? <div className="df2-empty-copy">{children}</div> : null}
    </div>
  );
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="df2-skeletons" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="df2-skeleton-row" key={i}>
          <span className="df2-skeleton-circle" />
          <span className="df2-skeleton-lines">
            <i />
            <i />
          </span>
        </div>
      ))}
    </div>
  );
}

export function Badge({ count }: { count: number }) {
  if (!count) return null;
  return <span className="df2-badge">{count > 99 ? '99+' : count}</span>;
}
