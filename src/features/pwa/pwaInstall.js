/**
 * PWA install wiring and service-worker registration.
 *
 * V3: the install UI (Android install card with real install states, the iOS Add-to-Home-Screen
 * walkthrough and the in-app-browser card) moved to React (features/pwa/InstallExperience.tsx). This
 * controller keeps the parts that must run at start-up, in the original order:
 *   - capture `beforeinstallprompt` (so the browser's real prompt can be shown at a calm moment
 *     instead of on page load), and `appinstalled` (analytics + hide install actions);
 *   - show/hide the Explore → "Install Rise Upon Deen" action;
 *   - register the service worker (unchanged), and drop the manifest on the admin shortcut route.
 */
import { rudMarkPwaInstalled } from '../analytics/visitorAnalytics';
import { legacyDocumentLoading, onLegacyDomContentLoaded } from '../../runtime/lifecycle';
import {
  canPromptInstall,
  isAndroid,
  isIOS,
  isStandalone,
  markInstalled,
  requestInstallExperience,
  setDeferredPrompt,
  subscribeInstall,
} from './installState';

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  const adminShortcut =
    (location.hash || '').toLowerCase() === '#riseupondeen.admin.login.1722' ||
    (location.hash || '').toLowerCase() === '#admin';
  if (adminShortcut) document.querySelector('link[rel="manifest"]')?.remove();

  function syncInstallAction() {
    const action = document.getElementById('rudExploreInstall');
    if (!action) return;
    // Android without a captured prompt still gets the action: it opens accurate manual steps.
    const available = !adminShortcut && !isStandalone() && (isIOS() || isAndroid() || canPromptInstall());
    action.hidden = !available;
    action.setAttribute('aria-hidden', available ? 'false' : 'true');
  }

  function openInstallExperience() {
    document.querySelector('[data-rud-explore-close]')?.click();
    if (isStandalone()) return;
    requestInstallExperience('explore');
  }
  window.rudOpenInstallExperience = openInstallExperience;

  function bindInstallAction() {
    const action = document.getElementById('rudExploreInstall');
    if (action && !action.dataset.rudInstallBound) {
      action.dataset.rudInstallBound = '1';
      action.addEventListener('click', openInstallExperience);
    }
    syncInstallAction();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    if (adminShortcut || isStandalone()) return;
    // Keep the browser's real prompt for the install card (shown after the visitor has settled in).
    event.preventDefault();
    setDeferredPrompt(event);
  });
  subscribeInstall(syncInstallAction);

  window.addEventListener('appinstalled', () => {
    markInstalled();
    try {
      localStorage.setItem('rud_pwa_installed', '1');
    } catch {}
    try {
      rudMarkPwaInstalled('appinstalled');
    } catch {}
    syncInstallAction();
  });

  if (legacyDocumentLoading()) onLegacyDomContentLoaded(bindInstallAction);
  else bindInstallAction();
  if (isIOS() && isStandalone()) {
    try {
      localStorage.setItem('rud_pwa_installed', '1');
    } catch {}
    syncInstallAction();
  }

  if (!adminShortcut && 'serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('Service worker registration failed:', err));
  }
}
