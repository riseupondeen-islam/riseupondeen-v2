/* Install & browser guidance (Sections 2, 11 and 12).
 *
 *  - In-app browser card: Instagram/Facebook/… web views cannot install apps or keep sign-ins
 *    reliably. Android: "Open in Chrome" uses Chrome's intent:// hand-off (honoured by most in-app
 *    browsers; if it is not, the steps below it still work). iOS: there is no API to leave an in-app
 *    browser, so the card explains the ••• → "Open in browser" step and offers Copy link.
 *  - Android install card: appears once the visitor has settled in (not on page load), uses the
 *    browser's real install prompt, and shows only states the browser actually reports.
 *  - iOS walkthrough: Safari / Chrome / other-browser steps with illustrations of the controls, Back,
 *    Next, Skip and Close, and a completion step. It never claims to press anything for the user.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppDialog } from '../../components/overlay/AppDialog';
import { notify } from '../../services/ui/notify';
import {
  IN_APP_LABEL,
  androidChromeIntentUrl,
  canPromptInstall,
  detectInAppBrowser,
  dismissInAppCard,
  inAppCardAllowed,
  installCardAllowed,
  iosBrowser,
  isAndroid,
  isIOS,
  isStandalone,
  platform,
  promptInstall,
  readPrefs,
  safariMajor,
  iosMajor,
  snoozeInstallCard,
  subscribeInstall,
  writePrefs,
  type IosBrowser,
} from './installState';

type View = null | 'inapp' | 'android' | 'manual' | 'ios-suggest' | 'ios';
type InstallPhase = 'idle' | 'confirm' | 'installing' | 'done' | 'accepted' | 'cancelled' | 'error';

/** True while something else needs the visitor's attention (name prompt, tour, maintenance, admin). */
function busyElsewhere(): boolean {
  const body = document.body;
  return (
    body.classList.contains('rud-first-visit-open') ||
    body.classList.contains('rud-gx-open') ||
    body.classList.contains('df2-chat-open') ||
    document.documentElement.dataset.maintenance === 'active' ||
    !!document.querySelector('#preloader:not(.hide), #rudWelcomeIntro:not([hidden]), .rud-gx-welcome, .rud-dialog-backdrop') ||
    /^#(riseupondeen\.admin|admin)/i.test(location.hash)
  );
}

async function copyLink(): Promise<boolean> {
  const link = location.href;
  try {
    await navigator.clipboard.writeText(link);
    return true;
  } catch {
    try {
      const field = document.createElement('textarea');
      field.value = link;
      field.setAttribute('readonly', '');
      field.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      field.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const AppIcon = () => <img className="rud-ix-appicon" src="/icon-192.png" alt="" width="56" height="56" />;

function sessionSeen(): boolean {
  try {
    return sessionStorage.getItem('rud_install_card_session') === '1';
  } catch {
    return false;
  }
}
function markSessionSeen(): void {
  try {
    sessionStorage.setItem('rud_install_card_session', '1');
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------------------------------ */

export function InstallExperience() {
  const [view, setView] = useState<View>(null);
  const viewRef = useRef<View>(null);
  viewRef.current = view;

  const open = useCallback((next: View) => {
    if (viewRef.current && next !== viewRef.current && viewRef.current !== 'ios-suggest' && viewRef.current !== 'android')
      return; // never stack two guides
    setView(next);
  }, []);

  /* Manual entry points (Explore → Install, App Guide). */
  useEffect(() => {
    const onOpen = () => {
      if (isStandalone()) {
        notify('Rise Upon Deen is already installed on this device.', 'info');
        return;
      }
      if (detectInAppBrowser()) setView('inapp');
      else if (isIOS()) setView('ios');
      else if (canPromptInstall()) setView('android');
      else setView('manual');
    };
    window.addEventListener('rud:open-install', onOpen);
    return () => window.removeEventListener('rud:open-install', onOpen);
  }, []);

  /* Automatic suggestions, at a calm moment. */
  useEffect(() => {
    if (isStandalone()) {
      const prefs = readPrefs();
      if (!prefs.standaloneWelcomed) {
        writePrefs({ standaloneWelcomed: true, installed: true });
        window.setTimeout(
          () => notify('Rise Upon Deen is on your Home Screen. It opens full-screen, like an app.', 'success', { title: 'Installed' }),
          1800,
        );
      }
      return;
    }
    const timers: number[] = [];
    const inApp = detectInAppBrowser();
    if (inApp && inAppCardAllowed()) {
      timers.push(
        window.setTimeout(function tryShow() {
          if (busyElsewhere()) {
            timers.push(window.setTimeout(tryShow, 3000));
            return;
          }
          open('inapp');
        }, 1200),
      );
      return () => timers.forEach(clearTimeout);
    }
    if (inApp) return;

    /* Browser visitors on a phone (link opened in Safari, Chrome, Samsung Internet…): offer the
       install guide a few seconds after the page settles. Never in the installed app, never in an
       in-app browser (that gets the "open in your browser" card above), at most once per session,
       and a dismissal snoozes it for 3 days. */
    const mobile = isIOS() || isAndroid();
    let shown = false;
    let tries = 0;
    const consider = () => {
      if (shown || viewRef.current || !installCardAllowed() || sessionSeen()) return;
      if (busyElsewhere()) {
        if (++tries < 40) timers.push(window.setTimeout(consider, 2500));
        return;
      }
      if (isIOS()) {
        shown = true;
        markSessionSeen();
        open('ios-suggest');
      } else if (isAndroid()) {
        shown = true;
        markSessionSeen();
        open(canPromptInstall() ? 'android' : 'manual');
      } else if (canPromptInstall()) {
        shown = true;
        markSessionSeen();
        open('android'); // desktop Chrome/Edge with a real install prompt
      }
    };
    // Android: give Chrome a moment to fire beforeinstallprompt so the one-tap install is used.
    timers.push(window.setTimeout(consider, mobile ? (isAndroid() && !canPromptInstall() ? 6500 : 4000) : 45000));
    const stop = subscribeInstall(() => {
      if (isAndroid() && viewRef.current === 'manual' && canPromptInstall()) setView('android');
    });
    return () => {
      timers.forEach(clearTimeout);
      stop();
    };
  }, [open]);

  if (view === 'inapp') return <InAppBrowserCard onClose={() => setView(null)} />;
  if (view === 'android') return <AndroidInstallCard onClose={() => setView(null)} onManual={() => setView('manual')} />;
  if (view === 'manual') return <ManualInstallGuide onClose={() => setView(null)} />;
  if (view === 'ios-suggest')
    return (
      <IosSuggestion
        onOpen={() => setView('ios')}
        onClose={() => {
          snoozeInstallCard();
          setView(null);
        }}
      />
    );
  if (view === 'ios') return <IosWalkthrough onClose={() => setView(null)} />;
  return null;
}

/* ------------------------------------------------------------------------------------------ */
/* In-app browser card (Section 2)                                                              */

function InAppBrowserCard({ onClose }: { onClose: () => void }) {
  const which = detectInAppBrowser();
  const app = which ? IN_APP_LABEL[which] : 'this app';
  const ios = isIOS();
  const [copied, setCopied] = useState(false);
  const close = () => {
    dismissInAppCard();
    onClose();
  };
  return (
    <AppDialog
      className="rud-ix-sheet"
      kicker="Rise Upon Deen"
      title={ios ? 'Open in Safari for the full app' : 'Open in Chrome for the full app'}
      onClose={close}
      closeLabel="Continue here"
      footer={
        <>
          {ios ? (
            <button type="button" className="rud-btn rud-btn-primary" data-autofocus onClick={async () => setCopied(await copyLink())}>
              {copied ? 'Link copied' : 'Copy link'}
            </button>
          ) : (
            <a className="rud-btn rud-btn-primary" data-autofocus href={androidChromeIntentUrl()} onClick={() => dismissInAppCard()}>
              Open in Chrome
            </a>
          )}
          <button type="button" className="rud-btn rud-btn-quiet" onClick={close}>
            Continue in {app}
          </button>
        </>
      }
    >
      <div className="rud-ix-hero">
        <AppIcon />
        <p>
          You opened Rise Upon Deen inside <strong>{app}</strong>. Its built-in browser can’t install the app, may
          not keep you signed in, and can block reminders. {ios ? 'Safari' : 'Chrome'} gives you the complete
          experience.
        </p>
      </div>
      <ol className="rud-ix-steps">
        {ios ? (
          <>
            <li>
              Tap <span className="rud-ix-key" aria-label="the more button">•••</span> or the share/compass icon in {app}
              ’s top or bottom bar.
            </li>
            <li>
              Choose <strong>Open in external browser</strong> (or <strong>Open in Safari</strong>).
            </li>
            <li>If that option isn’t there, tap Copy link, open Safari and paste it into the address bar.</li>
          </>
        ) : (
          <>
            <li>
              Tap <strong>Open in Chrome</strong>. Most apps hand the page straight to Chrome.
            </li>
            <li>
              If nothing happens, tap <span className="rud-ix-key" aria-label="the menu button">⋮</span> in {app}’s
              top bar and choose <strong>Open in Chrome</strong> or <strong>Open in browser</strong>.
            </li>
          </>
        )}
      </ol>
      <p className="rud-ix-note">You can keep reading here — nothing is blocked.</p>
    </AppDialog>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Android install card with real install states (Section 11)                                  */

const BENEFITS: Array<[string, string]> = [
  ['Opens like an app', 'Full screen, from your Home Screen — no browser bars.'],
  ['Ready offline', 'The Qur’an text and saved content keep working without a connection.'],
  ['Gentle reminders', 'Prayer and Deen reminders can reach you on this device.'],
];

function AndroidInstallCard({ onClose, onManual }: { onClose: () => void; onManual: () => void }) {
  const [phase, setPhase] = useState<InstallPhase>('idle');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const onInstalled = () => setPhase('done');
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  useEffect(() => {
    if (phase !== 'installing') return;
    // The browser accepted; `appinstalled` normally follows within seconds. If it doesn't, say so
    // honestly instead of pretending to show progress.
    const timer = window.setTimeout(() => {
      if (phaseRef.current === 'installing') setPhase('accepted');
    }, 15000);
    return () => clearTimeout(timer);
  }, [phase]);

  const install = async () => {
    if (!canPromptInstall()) {
      onManual();
      return;
    }
    setPhase('confirm');
    try {
      const outcome = await promptInstall();
      if (outcome === 'accepted') setPhase((p) => (p === 'done' ? p : 'installing'));
      else if (outcome === 'dismissed') setPhase('cancelled');
      else onManual();
    } catch {
      setPhase('error');
    }
  };

  const later = () => {
    if (phase === 'idle' || phase === 'cancelled') snoozeInstallCard();
    onClose();
  };

  return (
    <div className="rud-v3 rud-ix-card" role="dialog" aria-modal="false" aria-labelledby="rudIxAndroidTitle" data-phase={phase}>
      <button type="button" className="rud-dialog-close" onClick={later} aria-label="Close install card">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      <div className="rud-ix-card-head">
        <span className={`rud-ix-iconwrap phase-${phase}`} aria-hidden="true">
          <AppIcon />
          <svg className="rud-ix-ring" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="29" />
          </svg>
          {phase === 'done' ? (
            <span className="rud-ix-check">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 12.5 4 4 8-9" />
              </svg>
            </span>
          ) : null}
        </span>
        <div>
          <span className="rud-dialog-kicker">Rise Upon Deen app</span>
          <h2 id="rudIxAndroidTitle">
            {phase === 'done'
              ? 'Installed — alhamdulillah'
              : phase === 'installing'
                ? 'Installing…'
                : phase === 'confirm'
                  ? 'Confirm in the dialog'
                  : phase === 'accepted'
                    ? 'Almost there'
                    : 'Install the app'}
          </h2>
        </div>
      </div>
      <div className="rud-ix-card-body" aria-live="polite">
        {phase === 'idle' ? (
          <ul className="rud-ix-benefits">
            {BENEFITS.map(([title, text]) => (
              <li key={title}>
                <strong>{title}</strong>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {phase === 'confirm' ? <p>Your browser is asking for permission. Tap <strong>Install</strong> in its dialog to continue.</p> : null}
        {phase === 'installing' ? <p>Your browser accepted and is adding Rise Upon Deen to your device.</p> : null}
        {phase === 'accepted' ? (
          <p>Your browser accepted the install and finishes it in the background. Look for the icon on your Home Screen or app drawer.</p>
        ) : null}
        {phase === 'done' ? <p>Find Rise Upon Deen on your Home Screen. It opens full-screen, like any app.</p> : null}
        {phase === 'cancelled' ? <p>No problem — you can install any time from Explore → Install Rise Upon Deen.</p> : null}
        {phase === 'error' ? <p>The browser couldn’t show its install dialog. You can still add the app from the browser menu.</p> : null}
      </div>
      <div className="rud-ix-card-actions">
        {phase === 'idle' ? (
          <>
            <button type="button" className="rud-btn rud-btn-primary" onClick={install}>
              Install App
            </button>
            <button type="button" className="rud-btn rud-btn-quiet" onClick={later}>
              Not now
            </button>
          </>
        ) : null}
        {phase === 'error' ? (
          <button type="button" className="rud-btn rud-btn-primary" onClick={onManual}>
            Show me how
          </button>
        ) : null}
        {phase === 'done' || phase === 'accepted' || phase === 'cancelled' || phase === 'error' ? (
          <button type="button" className="rud-btn rud-btn-quiet" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* Manual steps when the browser offers no install prompt (Firefox, Samsung Internet, desktop, …). */
function ManualInstallGuide({ onClose }: { onClose: () => void }) {
  const p = platform();
  const samsung = /SamsungBrowser/i.test(navigator.userAgent);
  const firefox = /Firefox/i.test(navigator.userAgent);
  return (
    <AppDialog className="rud-ix-sheet" kicker="Install" title="Add Rise Upon Deen to your device" onClose={onClose}>
      <div className="rud-ix-hero">
        <AppIcon />
        <p>Your browser didn’t offer its one-tap install right now. You can add the app from its menu instead:</p>
      </div>
      <ol className="rud-ix-steps">
        {p === 'android' ? (
          samsung ? (
            <>
              <li>Tap the <span className="rud-ix-key">≡</span> menu at the bottom right.</li>
              <li>Choose <strong>Add page to</strong> → <strong>Home screen</strong>.</li>
            </>
          ) : firefox ? (
            <>
              <li>Tap the <span className="rud-ix-key">⋮</span> menu.</li>
              <li>Choose <strong>Add app to Home screen</strong> (or <strong>Install</strong>).</li>
            </>
          ) : (
            <>
              <li>Tap the <span className="rud-ix-key">⋮</span> menu in Chrome’s top bar.</li>
              <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm.</li>
            </>
          )
        ) : (
          <>
            <li>In Chrome or Edge, click the install icon at the right end of the address bar.</li>
            <li>Or open the browser menu and choose <strong>Install Rise Upon Deen…</strong> (Chrome: Cast, save and share → Install page as app).</li>
          </>
        )}
      </ol>
      <p className="rud-ix-note">If you just dismissed the browser’s dialog, it may take a while before the browser offers it again.</p>
    </AppDialog>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* iOS (Section 12)                                                                             */

function IosSuggestion({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  return (
    <div className="rud-v3 rud-ix-card" role="dialog" aria-modal="false" aria-labelledby="rudIxIosSuggest">
      <button type="button" className="rud-dialog-close" onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      <div className="rud-ix-card-head">
        <span className="rud-ix-iconwrap" aria-hidden="true">
          <AppIcon />
        </span>
        <div>
          <span className="rud-dialog-kicker">Install the app</span>
          <h2 id="rudIxIosSuggest">Add Rise Upon Deen to your Home Screen</h2>
        </div>
      </div>
      <div className="rud-ix-card-body">
        <p>It opens full-screen like an app and keeps your Qur’an and saved content close. It takes a few taps.</p>
      </div>
      <div className="rud-ix-card-actions">
        <button type="button" className="rud-btn rud-btn-primary" onClick={onOpen}>
          Show me how
        </button>
        <button type="button" className="rud-btn rud-btn-quiet" onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}

interface Step {
  key: string;
  title: string;
  body: ReactNode;
  art?: ReactNode;
  manual?: boolean;
}

/* Illustrations (drawn, not screenshots) of the controls the visitor needs to find. */
function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5v11M8 7.2 12 3.5l4 3.7" />
      <path d="M8.5 10.5H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1.5" />
    </svg>
  );
}
function SafariBar({ modern }: { modern: boolean }) {
  return (
    <div className="rud-ix-phone" aria-hidden="true">
      <div className="rud-ix-phone-screen">
        <span className="rud-ix-phone-line" />
        <span className="rud-ix-phone-line short" />
      </div>
      {modern ? (
        <div className="rud-ix-toolbar">
          <span className="rud-ix-tb">‹</span>
          <span className="rud-ix-addr">riseupondeen.web.app</span>
          <span className="rud-ix-tb rud-ix-target">•••</span>
        </div>
      ) : (
        <div className="rud-ix-toolbar">
          <span className="rud-ix-tb">‹</span>
          <span className="rud-ix-tb">›</span>
          <span className="rud-ix-tb rud-ix-target">
            <ShareGlyph />
          </span>
          <span className="rud-ix-tb">□</span>
          <span className="rud-ix-tb">⧉</span>
        </div>
      )}
    </div>
  );
}
function ChromeIosBar() {
  return (
    <div className="rud-ix-phone" aria-hidden="true">
      <div className="rud-ix-toolbar rud-ix-toolbar-top">
        <span className="rud-ix-addr">riseupondeen.web.app</span>
        <span className="rud-ix-tb rud-ix-target">
          <ShareGlyph />
        </span>
      </div>
      <div className="rud-ix-phone-screen">
        <span className="rud-ix-phone-line" />
        <span className="rud-ix-phone-line short" />
      </div>
    </div>
  );
}
function ShareSheetArt() {
  return (
    <div className="rud-ix-sharesheet" aria-hidden="true">
      <span className="rud-ix-grab" />
      <div className="rud-ix-row">
        <span>Copy</span>
        <i>⧉</i>
      </div>
      <div className="rud-ix-row">
        <span>Add to Favourites</span>
        <i>☆</i>
      </div>
      <div className="rud-ix-row rud-ix-target">
        <span>Add to Home Screen</span>
        <i>⊞</i>
      </div>
    </div>
  );
}
function AddConfirmArt() {
  return (
    <div className="rud-ix-sharesheet rud-ix-confirm" aria-hidden="true">
      <div className="rud-ix-confirm-head">
        <span>Cancel</span>
        <b>Add to Home Screen</b>
        <span className="rud-ix-target">Add</span>
      </div>
      <div className="rud-ix-confirm-app">
        <img src="/icon-192.png" alt="" width="40" height="40" />
        <span>Rise Upon Deen</span>
      </div>
    </div>
  );
}

function iosSteps(browser: IosBrowser): Step[] {
  const modernSafari = safariMajor() >= 26;
  const intro: Step = {
    key: 'intro',
    title: 'Use Rise Upon Deen like an app',
    body: (
      <>
        <p>Adding it to your Home Screen gives you a full-screen app with its own icon, faster start-up and offline access to the Qur’an and your saved content.</p>
        <p className="rud-ix-note">Apple lets only you add apps to the Home Screen, so this guide shows you where to tap — it can’t tap for you.</p>
      </>
    ),
  };
  const done: Step = {
    key: 'done',
    title: 'That’s it',
    body: (
      <>
        <p>Open <strong>Rise Upon Deen</strong> from your Home Screen. It runs full-screen, without the browser bars.</p>
        <p className="rud-ix-note">Signed in to Deen Friends? The Home Screen app keeps its own storage on iOS, so sign in once there too.</p>
      </>
    ),
  };
  if (browser === 'safari') {
    return [
      intro,
      {
        key: 'share',
        manual: true,
        title: modernSafari ? 'Open the ••• menu, then Share' : 'Tap the Share button',
        art: <SafariBar modern={modernSafari} />,
        body: modernSafari ? (
          <p>
            In Safari’s bar, tap <span className="rud-ix-key">•••</span>, then <strong>Share</strong>. On some layouts the
            Share button <span className="rud-ix-key"><ShareGlyph /></span> is shown directly — tap that instead.
          </p>
        ) : (
          <p>
            Tap <span className="rud-ix-key"><ShareGlyph /></span> in Safari’s toolbar — at the bottom on iPhone, at the top on
            iPad. If the toolbar is hidden, scroll up a little to bring it back.
          </p>
        ),
      },
      {
        key: 'add',
        manual: true,
        title: 'Choose “Add to Home Screen”',
        art: <ShareSheetArt />,
        body: (
          <p>
            Scroll down the list and tap <strong>Add to Home Screen</strong>. Not there? Tap <strong>Edit Actions…</strong> at the
            bottom and add it.
          </p>
        ),
      },
      {
        key: 'confirm',
        manual: true,
        title: 'Tap “Add”',
        art: <AddConfirmArt />,
        body: (
          <p>
            Check the name and tap <strong>Add</strong> at the top right. If you see <strong>Open as Web App</strong>, keep it switched
            on.
          </p>
        ),
      },
      done,
    ];
  }
  if (browser === 'chrome' || browser === 'edge' || browser === 'firefox') {
    const name = browser === 'chrome' ? 'Chrome' : browser === 'edge' ? 'Edge' : 'Firefox';
    const supported = iosMajor() === 0 || iosMajor() >= 16;
    return [
      intro,
      supported
        ? {
            key: 'share',
            manual: true,
            title: `Tap Share in ${name}`,
            art: <ChromeIosBar />,
            body:
              browser === 'chrome' ? (
                <p>
                  Tap <span className="rud-ix-key"><ShareGlyph /></span> at the right of the address bar.
                </p>
              ) : (
                <p>
                  Open {name}’s menu (<span className="rud-ix-key">≡</span> or <span className="rud-ix-key">•••</span>) and tap{' '}
                  <strong>Share</strong>.
                </p>
              ),
          }
        : {
            key: 'safari',
            manual: true,
            title: 'Open this page in Safari',
            body: <p>Your iOS version only allows adding apps from Safari. Copy the link below and open it in Safari.</p>,
          },
      {
        key: 'add',
        manual: true,
        title: 'Choose “Add to Home Screen”',
        art: <ShareSheetArt />,
        body: <p>Scroll the share options and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</p>,
      },
      done,
    ];
  }
  return [
    intro,
    {
      key: 'safari',
      manual: true,
      title: 'Open this page in Safari first',
      body: (
        <p>
          This browser can’t add apps to the Home Screen. Copy the link, open <strong>Safari</strong>, paste it into the address bar, then
          open this guide again from Explore → Install.
        </p>
      ),
    },
    done,
  ];
}

function IosWalkthrough({ onClose }: { onClose: () => void }) {
  const browser = iosBrowser();
  const steps = iosSteps(browser);
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index === steps.length - 1;
  const finish = () => {
    writePrefs({ iosGuideSeenAt: Date.now() });
    onClose();
  };
  const needsLink = step.key === 'safari';
  return (
    <AppDialog
      className="rud-ix-sheet rud-ix-walk"
      kicker={`Add to Home Screen · Step ${index + 1} of ${steps.length}`}
      title={step.title}
      onClose={finish}
      closeLabel="Close the guide"
      footer={
        <>
          <div className="rud-ix-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <i key={s.key} className={i === index ? 'active' : i < index ? 'done' : ''} />
            ))}
          </div>
          <div className="rud-ix-nav">
            {index > 0 ? (
              <button type="button" className="rud-btn rud-btn-quiet" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            ) : (
              <button type="button" className="rud-btn rud-btn-quiet" onClick={finish}>
                Skip
              </button>
            )}
            {needsLink ? (
              <button type="button" className="rud-btn" onClick={async () => setCopied(await copyLink())}>
                {copied ? 'Link copied' : 'Copy link'}
              </button>
            ) : null}
            <button type="button" className="rud-btn rud-btn-primary" data-autofocus onClick={() => (last ? finish() : setIndex(index + 1))}>
              {last ? 'Done' : step.manual ? 'I’ve done this' : 'Next'}
            </button>
          </div>
        </>
      }
    >
      <div className="rud-ix-walk-body" aria-live="polite" key={step.key}>
        {step.art ? <div className="rud-ix-art">{step.art}</div> : <div className="rud-ix-hero"><AppIcon /></div>}
        {step.body}
        {step.manual ? <p className="rud-ix-you">This step happens in {browser === 'safari' ? 'Safari' : 'your browser'} — the guide stays here when you come back.</p> : null}
      </div>
    </AppDialog>
  );
}
