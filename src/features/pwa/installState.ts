/* PWA installation state: platform detection, the browser's real install prompt, and the user's
 * choices (dismissed / installed). The UI lives in InstallExperience.tsx; this module has no DOM UI.
 *
 * Honesty rules (Sections 11 and 12):
 *  - "Install" only ever calls the browser's own beforeinstallprompt.prompt(); progress states are
 *    driven by its userChoice promise and the `appinstalled` event, never by a timer.
 *  - On iOS there is no install API. We can only explain the Share → Add to Home Screen steps.
 *  - In-app browsers (Instagram, Facebook, …) cannot be forced to open Chrome/Safari from JavaScript.
 *    Android offers an intent:// hand-off that Chrome honours in most in-app browsers; iOS does not,
 *    so iOS users get the "••• → Open in browser" instructions instead.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export type Platform = 'android' | 'ios' | 'desktop' | 'other';
export type IosBrowser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'other';
export type InAppBrowser = 'instagram' | 'facebook' | 'threads' | 'tiktok' | 'snapchat' | 'linkedin' | 'line' | 'wechat' | 'generic' | null;

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');

export function isIOS(): boolean {
  const n = typeof navigator === 'undefined' ? null : navigator;
  return /iPhone|iPad|iPod/i.test(ua()) || (!!n && n.platform === 'MacIntel' && n.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return /Android/i.test(ua());
}

export function platform(): Platform {
  if (isIOS()) return 'ios';
  if (isAndroid()) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua())) return 'desktop';
  return 'other';
}

/** The browser shell on iOS (all use WebKit; their menus differ). */
export function iosBrowser(): IosBrowser {
  const u = ua();
  if (/CriOS/i.test(u)) return 'chrome';
  if (/FxiOS/i.test(u)) return 'firefox';
  if (/EdgiOS/i.test(u)) return 'edge';
  if (detectInAppBrowser()) return 'other';
  if (/Safari/i.test(u) && !/(OPiOS|DuckDuckGo|GSA|YaBrowser)/i.test(u)) return 'safari';
  return 'other';
}

/** iOS major version from "OS 17_4 like Mac OS X" (Safari 26 freezes this at 18; see safariMajor). */
export function iosMajor(): number {
  const m = ua().match(/OS (\d+)[_.]\d+/i);
  return m ? Number(m[1]) : 0;
}

/** Safari's own version ("Version/26.0"), which keeps advancing after the OS token was frozen. */
export function safariMajor(): number {
  const m = ua().match(/Version\/(\d+)/);
  return m ? Number(m[1]) : 0;
}

/**
 * In-app browser detection. User-agent tokens are the primary signal (Instagram, Facebook and others
 * add them), backed by capability checks: in-app web views on iOS lack `navigator.standalone`
 * semantics of Safari and usually report no "Safari" token; on Android they are "; wv)" WebViews.
 */
export function detectInAppBrowser(): InAppBrowser {
  const u = ua();
  if (/Instagram/i.test(u)) return 'instagram';
  if (/Barcelona|Threads/i.test(u)) return 'threads';
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(u)) return 'facebook';
  if (/musical_ly|TikTok|BytedanceWebview|trill/i.test(u)) return 'tiktok';
  if (/Snapchat/i.test(u)) return 'snapchat';
  if (/LinkedInApp/i.test(u)) return 'linkedin';
  if (/\bLine\//i.test(u)) return 'line';
  if (/MicroMessenger/i.test(u)) return 'wechat';
  // Capability fallback: an Android WebView ("; wv)") or an iOS WKWebView without the Safari token.
  if (isAndroid() && /; wv\)/i.test(u)) return 'generic';
  if (isIOS() && !/Safari/i.test(u) && /AppleWebKit/i.test(u) && !/(CriOS|FxiOS|EdgiOS)/i.test(u)) return 'generic';
  return null;
}

export const IN_APP_LABEL: Record<Exclude<InAppBrowser, null>, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  linkedin: 'LinkedIn',
  line: 'LINE',
  wechat: 'WeChat',
  generic: 'this app',
};

export function isStandalone(): boolean {
  try {
    return (
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      matchMedia('(display-mode: standalone)').matches ||
      matchMedia('(display-mode: fullscreen)').matches ||
      matchMedia('(display-mode: minimal-ui)').matches ||
      /^android-app:\/\//i.test(document.referrer || '')
    );
  } catch {
    return false;
  }
}

/** Android Chrome intent that opens the current page in Chrome (falls back to the system browser). */
export function androidChromeIntentUrl(href = location.href): string {
  const url = new URL(href);
  const fallback = encodeURIComponent(url.href);
  return `intent://${url.host}${url.pathname}${url.search}${url.hash}#Intent;scheme=${url.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
}

/* ---------- persisted choices ---------- */

const KEY = 'rud_install_prefs_v3';
interface Prefs {
  installed?: boolean;
  dismissedAt?: number;
  dismissCount?: number;
  inAppDismissedAt?: number;
  iosGuideSeenAt?: number;
  standaloneWelcomed?: boolean;
}

export function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function writePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* private mode: choices last for this page only */
  }
}

const DAY = 86400000;

/** The automatic install card may appear: not installed, not snoozed (14 days), not refused twice. */
export function installCardAllowed(): boolean {
  const p = readPrefs();
  if (p.installed || isStandalone()) return false;
  try {
    if (localStorage.getItem('rud_pwa_installed') === '1') return false;
  } catch {
    /* ignore */
  }
  if ((p.dismissCount || 0) >= 4) return false;
  return !p.dismissedAt || Date.now() - p.dismissedAt > 3 * DAY;
}

export function snoozeInstallCard(): void {
  const p = readPrefs();
  writePrefs({ dismissedAt: Date.now(), dismissCount: (p.dismissCount || 0) + 1 });
}

/** The in-app-browser card: once per session, and at most once every 3 days after "Continue here". */
export function inAppCardAllowed(): boolean {
  try {
    if (sessionStorage.getItem('rud_inapp_card_seen') === '1') return false;
  } catch {
    /* ignore */
  }
  const p = readPrefs();
  return !p.inAppDismissedAt || Date.now() - p.inAppDismissedAt > 3 * DAY;
}

export function dismissInAppCard(): void {
  writePrefs({ inAppDismissedAt: Date.now() });
  try {
    sessionStorage.setItem('rud_inapp_card_seen', '1');
  } catch {
    /* ignore */
  }
}

/* ---------- the browser's install prompt ---------- */

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let installedThisSession = false;

function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDeferredPrompt(event: BeforeInstallPromptEvent | null): void {
  deferred = event;
  emit();
}

export function canPromptInstall(): boolean {
  return !!deferred;
}

export function markInstalled(): void {
  installedThisSession = true;
  deferred = null;
  writePrefs({ installed: true });
  emit();
}

export function installedNow(): boolean {
  return installedThisSession || isStandalone();
}

/** Shows the browser's install dialog. Resolves with the user's real choice. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  // A prompt event can be used once; the browser fires a new one later if the app is still installable.
  deferred = null;
  emit();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
}

/** Lets the UI open the install experience (Explore → Install, the App Guide, …). */
export function requestInstallExperience(source: 'explore' | 'guide' | 'auto' = 'explore'): void {
  window.dispatchEvent(new CustomEvent('rud:open-install', { detail: { source } }));
}
