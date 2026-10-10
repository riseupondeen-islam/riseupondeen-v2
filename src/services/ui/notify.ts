/* In-app notification cards (the app's "toast" popups) — one implementation for the whole app.
 *
 * Used by utils/ui.js `toast()` (legacy controllers, admin console, foreground push messages) and by
 * Deen Friends' useToast(). Operating-system push notifications are a separate system
 * (features/notifications) and are not affected.
 *
 * - Tones: success, info, warning, error (legacy 'ok' maps to success).
 * - At most three cards are visible; newer ones push the oldest out. An identical message shown again
 *   within 1.5 s refreshes the existing card instead of stacking a duplicate.
 * - Each card has a dismiss button and a progress bar; the timer pauses while the card is hovered or
 *   focused (so it can be read and reached by keyboard). Errors stay longer.
 * - Errors are announced assertively (role="alert"), everything else politely.
 * - Entrance/exit use transform + opacity only; prefers-reduced-motion turns them into fades.
 */

export type NotifyTone = 'success' | 'info' | 'warning' | 'error';

export interface NotifyOptions {
  title?: string;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /** Extra class names (kept for compatibility hooks). */
  className?: string;
}

const MAX_VISIBLE = 3;
const DEFAULT_DURATION: Record<NotifyTone, number> = { success: 3600, info: 4200, warning: 5200, error: 6400 };
const TITLES: Record<NotifyTone, string> = { success: 'Done', info: 'Notice', warning: 'Please note', error: 'Something went wrong' };

const ICONS: Record<NotifyTone, string> = {
  success: '<path d="m7 12.5 3.2 3.2L17 9" />',
  info: '<path d="M12 11v5.2M12 7.8v.1" />',
  warning: '<path d="M12 8.4v4.4M12 16v.1" />',
  error: '<path d="m9 9 6 6M15 9l-6 6" />',
};

interface Live {
  el: HTMLElement;
  key: string;
  remaining: number;
  started: number;
  timer: number;
  paused: boolean;
  createdAt: number;
}

const live: Live[] = [];

export function normalizeTone(tone: string | undefined): NotifyTone {
  if (tone === 'error' || tone === 'warning' || tone === 'info') return tone;
  if (tone === 'warn') return 'warning';
  return 'success';
}

function container(): HTMLElement | null {
  let stack = document.getElementById('toastStack');
  if (!stack && document.body) {
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.setAttribute('aria-live', 'polite');
    stack.setAttribute('aria-atomic', 'true');
    document.body.appendChild(stack);
  }
  return stack;
}

function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function remove(entry: Live): void {
  const index = live.indexOf(entry);
  if (index >= 0) live.splice(index, 1);
  window.clearTimeout(entry.timer);
  const el = entry.el;
  el.classList.add('is-leaving');
  const done = () => el.remove();
  if (reducedMotion()) window.setTimeout(done, 120);
  else {
    el.addEventListener('animationend', done, { once: true });
    window.setTimeout(done, 400); // safety net if the animation never runs
  }
}

function schedule(entry: Live): void {
  window.clearTimeout(entry.timer);
  if (!entry.remaining) return;
  entry.started = Date.now();
  entry.timer = window.setTimeout(() => remove(entry), entry.remaining);
  const bar = entry.el.querySelector<HTMLElement>('.rud-note-progress i');
  if (bar) {
    bar.style.animationDuration = `${entry.remaining}ms`;
    bar.style.animationPlayState = 'running';
  }
}

function pause(entry: Live): void {
  if (entry.paused || !entry.remaining) return;
  entry.paused = true;
  window.clearTimeout(entry.timer);
  entry.remaining = Math.max(800, entry.remaining - (Date.now() - entry.started));
  const bar = entry.el.querySelector<HTMLElement>('.rud-note-progress i');
  if (bar) bar.style.animationPlayState = 'paused';
}

function resume(entry: Live): void {
  if (!entry.paused) return;
  entry.paused = false;
  window.clearTimeout(entry.timer);
  entry.started = Date.now();
  entry.timer = window.setTimeout(() => remove(entry), entry.remaining);
  const bar = entry.el.querySelector<HTMLElement>('.rud-note-progress i');
  if (bar) bar.style.animationPlayState = 'running';
}

/** Shows an in-app notification card. Returns a function that dismisses it. */
export function notify(message: string, toneInput: string = 'success', options: NotifyOptions = {}): () => void {
  const stack = container();
  const text = String(message ?? '').trim();
  if (!stack || !text) return () => undefined;
  const tone = normalizeTone(toneInput);
  const key = `${tone}|${options.title || ''}|${text}`;
  const duration = options.duration ?? DEFAULT_DURATION[tone];

  const existing = live.find((e) => e.key === key && Date.now() - e.createdAt < 1500);
  if (existing) {
    existing.remaining = duration;
    existing.paused = false;
    existing.createdAt = Date.now();
    const bar = existing.el.querySelector<HTMLElement>('.rud-note-progress i');
    if (bar) {
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
    }
    schedule(existing);
    return () => remove(existing);
  }

  const el = document.createElement('div');
  el.className = `rud-note rud-note-${tone}${options.className ? ` ${options.className}` : ''}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');

  const icon = document.createElement('span');
  icon.className = 'rud-note-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[tone]}</svg>`;

  const body = document.createElement('div');
  body.className = 'rud-note-body';
  const title = document.createElement('strong');
  title.className = 'rud-note-title';
  title.textContent = options.title || TITLES[tone];
  const copy = document.createElement('p');
  copy.className = 'rud-note-text';
  copy.textContent = text;
  body.append(title, copy);

  if (options.action) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'rud-note-action';
    action.textContent = options.action.label;
    const run = options.action.onClick;
    action.addEventListener('click', () => {
      run();
      remove(entry);
    });
    body.append(action);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'rud-note-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';

  el.append(icon, body, close);
  if (duration) {
    const progress = document.createElement('span');
    progress.className = 'rud-note-progress';
    progress.setAttribute('aria-hidden', 'true');
    progress.append(document.createElement('i'));
    el.append(progress);
  }

  const entry: Live = { el, key, remaining: duration, started: Date.now(), timer: 0, paused: false, createdAt: Date.now() };
  close.addEventListener('click', () => remove(entry));
  el.addEventListener('mouseenter', () => pause(entry));
  el.addEventListener('mouseleave', () => resume(entry));
  el.addEventListener('focusin', () => pause(entry));
  el.addEventListener('focusout', (e) => {
    if (!el.contains(e.relatedTarget as Node | null)) resume(entry);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') remove(entry);
  });

  stack.append(el);
  live.push(entry);
  while (live.length > MAX_VISIBLE) remove(live[0]);
  schedule(entry);
  return () => remove(entry);
}

/** Removes every visible notification (used when the app shell is torn down in tests). */
export function clearNotifications(): void {
  [...live].forEach(remove);
}
