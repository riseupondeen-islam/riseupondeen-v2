/**
 * PWA install experience (Android prompt, iOS tutorial) and service-worker registration.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { rudMarkPwaInstalled } from '../analytics/visitorAnalytics';
import { legacyDocumentLoading, onLegacyDomContentLoaded } from '../../runtime/lifecycle';

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  (function () {
    const adminShortcut =
      (location.hash || '').toLowerCase() === '#riseupondeen.admin.login.1722' ||
      (location.hash || '').toLowerCase() === '#admin';
    if (adminShortcut) document.querySelector('link[rel="manifest"]')?.remove();
    let deferredInstallPrompt = null;
    let installOverlay = null;
    let installButton = null;
    let installPreviousOverflow = '';
    let iosStep = 0;

    const ua = () => navigator.userAgent || '';
    const isAndroid = () => /Android/i.test(ua());
    const isIOS = () =>
      /iPhone|iPad/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isIOSSafari = () =>
      isIOS() &&
      /Safari/i.test(ua()) &&
      !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Instagram|FBAN|FBAV|FB_IAB|WhatsApp|GSA)/i.test(ua());
    const isStandalone = () => {
      try {
        return (
          navigator.standalone === true ||
          window.matchMedia('(display-mode: standalone)').matches ||
          window.matchMedia('(display-mode: fullscreen)').matches ||
          window.matchMedia('(display-mode: minimal-ui)').matches ||
          /^android-app:\/\//i.test(document.referrer || '')
        );
      } catch {
        return false;
      }
    };
    const isInstalled = () => isStandalone();
    const maintenanceActive = () => {
      if (window.RUD_MAINTENANCE_ACTIVE === true || document.documentElement.dataset.maintenance === 'active')
        return true;
      try {
        const c = JSON.parse(localStorage.getItem('rud_public_firestore_v2') || 'null');
        const m = (c?.items || []).find(
          (x) => x?.id === 'rud_maintenance_config' || (x?.type === 'site' && x?.siteKey === 'maintenance'),
        );
        const v = m?.maintenanceEndTime,
          end = v?.seconds ? Number(v.seconds) * 1000 : new Date(v || 0).getTime();
        return !!m?.maintenanceEnabled && Number.isFinite(end) && end > Date.now();
      } catch {
        return false;
      }
    };

    function syncInstallAction() {
      const action = document.getElementById('rudExploreInstall');
      if (!action) return;
      const available = !adminShortcut && !isInstalled() && (isIOS() || (isAndroid() && !!deferredInstallPrompt));
      action.hidden = !available;
      action.setAttribute('aria-hidden', available ? 'false' : 'true');
    }

    function closeInstallPrompt() {
      if (!installOverlay) return;
      const overlay = installOverlay;
      overlay.classList?.remove('open');
      overlay.style.opacity = '0';
      overlay.style.visibility = 'hidden';
      overlay.style.pointerEvents = 'none';
      document.body.style.overflow = installPreviousOverflow;
      setTimeout(() => overlay.remove(), 240);
      installOverlay = null;
      installButton = null;
      iosStep = 0;
    }

    async function copyInstallLink(button) {
      const link = location.href.split('#')[0];
      let copied = false;
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch {}
      if (!copied) {
        try {
          const field = document.createElement('textarea');
          field.value = link;
          field.setAttribute('readonly', '');
          field.style.cssText = 'position:fixed;left:-9999px;top:0';
          document.body.appendChild(field);
          field.select();
          copied = document.execCommand('copy');
          field.remove();
        } catch {}
      }
      if (button) {
        const old = button.textContent;
        button.textContent = copied ? 'Link Copied' : 'Copy this link';
        setTimeout(() => {
          if (button.isConnected) button.textContent = old;
        }, 1500);
      }
    }

    const safariIcon = () =>
      `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="26" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="32" r="21" stroke="currentColor" stroke-width="1" opacity=".35"/><path d="M38.8 25.2 35 35l-9.8 3.8L29 29l9.8-3.8Z" fill="currentColor" opacity=".9"/><circle cx="32" cy="32" r="2.4" fill="var(--ios-card)"/><path d="M32 7v4M32 53v4M7 32h4M53 32h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    const shareIcon = () =>
      `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 37V9m0 0-9 9m9-9 9 9" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 25h-4a6 6 0 0 0-6 6v20a6 6 0 0 0 6 6h30a6 6 0 0 0 6-6V31a6 6 0 0 0-6-6h-4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;

    function renderIosStep() {
      if (!installOverlay) return;
      const body = installOverlay.querySelector('#rudIosStepBody'),
        stepLabel = installOverlay.querySelector('#rudIosStepLabel'),
        progress = installOverlay.querySelector('#rudIosProgress'),
        prev = installOverlay.querySelector('#rudIosPrev'),
        next = installOverlay.querySelector('#rudIosNext');
      if (!body || !stepLabel || !progress || !prev || !next) return;
      stepLabel.textContent = `Step ${iosStep + 1} of 4`;
      progress.innerHTML = Array.from(
        { length: 4 },
        (_, i) =>
          `${i ? '<b aria-hidden="true"></b>' : ''}<i class="${i < iosStep ? 'done' : i === iosStep ? 'active' : ''}" aria-hidden="true"></i>`,
      ).join('');
      prev.hidden = iosStep === 0;
      next.textContent = iosStep === 3 ? 'Finish' : 'Next';
      const safari = isIOSSafari();
      const steps = [
        `<section class="rud-ios-step" aria-labelledby="rudIosStepTitle"><div class="rud-ios-visual ${safari ? '' : 'rud-ios-target-pulse'}">${safariIcon()}</div><div class="rud-ios-look">Safari</div><h3 id="rudIosStepTitle">Open in Safari</h3><p>Rise Upon Deen must be opened in Safari to add it to your Home Screen.</p>${safari ? '<div class="rud-ios-safari-state">You are viewing this guide in Safari.</div>' : '<div class="rud-ios-safari-state">Open this link in Safari first.</div><button class="rud-ios-copy-btn" id="rudIosCopyLink" type="button">Copy Link</button>'}</section>`,
        `<section class="rud-ios-step" aria-labelledby="rudIosStepTitle"><div class="rud-ios-visual rud-ios-target-pulse">${shareIcon()}</div><div class="rud-ios-look">Look for this icon</div><h3 id="rudIosStepTitle">Tap the Share button</h3><p>In Safari, tap the Share icon in the browser controls. Its exact position can vary with your Safari layout.</p></section>`,
        `<section class="rud-ios-step" aria-labelledby="rudIosStepTitle"><div class="rud-ios-share-sheet" aria-hidden="true"><div class="rud-ios-share-grab"></div><div class="rud-ios-share-row"><span>＋</span><strong>Add to Home Screen</strong></div></div><h3 id="rudIosStepTitle">Choose “Add to Home Screen”</h3><p>Scroll through the Share options and tap Add to Home Screen.</p><button class="rud-ios-help-btn" id="rudIosHelpToggle" type="button" aria-expanded="false">Can't find it?</button><div class="rud-ios-help" id="rudIosHelp" hidden>Scroll to the bottom → <strong>Edit Actions</strong> → <strong>Add to Home Screen</strong>.</div></section>`,
        `<section class="rud-ios-step" aria-labelledby="rudIosStepTitle"><div class="rud-ios-final-card" aria-hidden="true"><div class="rud-ios-app-row"><img src="/icon-192.png" alt=""><div><strong>Rise Upon Deen</strong><small>riseupondeen.web.app</small></div></div><div class="rud-ios-webapp-row"><span>Open as Web App <strong>— ON</strong></span><i class="rud-ios-toggle-on"></i></div><button class="rud-ios-system-add" type="button" tabindex="-1">Add</button></div><h3 id="rudIosStepTitle">Add Rise Upon Deen</h3><p>Keep “Open as Web App” enabled, then tap Add in Safari.</p></section>`,
      ];
      body.innerHTML = steps[iosStep];
      body.querySelector('#rudIosCopyLink')?.addEventListener('click', (e) => copyInstallLink(e.currentTarget));
      body.querySelector('#rudIosHelpToggle')?.addEventListener('click', (e) => {
        const help = body.querySelector('#rudIosHelp'),
          open = e.currentTarget.getAttribute('aria-expanded') === 'true';
        e.currentTarget.setAttribute('aria-expanded', String(!open));
        if (help) help.hidden = open;
      });
    }

    function showIosSuccess() {
      if (!installOverlay) return;
      const card = installOverlay.querySelector('.rud-ios-tutorial-card');
      if (!card) return;
      card.innerHTML = `<button class="rud-ios-tutorial-close" type="button" data-rud-install-close aria-label="Close installation guide">×</button><section class="rud-ios-success"><img src="/icon-192.png" alt="Rise Upon Deen app icon"><h3>You’re Ready</h3><p>Rise Upon Deen will appear on your Home Screen and open like an app after you complete Safari’s Add action.</p><button id="rudIosDone" type="button">Done</button></section>`;
      card.querySelector('[data-rud-install-close]')?.addEventListener('click', closeInstallPrompt);
      card.querySelector('#rudIosDone')?.addEventListener('click', closeInstallPrompt);
    }

    function buildIosTutorial() {
      if (installOverlay || isInstalled() || maintenanceActive()) return;
      iosStep = 0;
      installPreviousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      installOverlay = document.createElement('div');
      installOverlay.id = 'rudIosInstallPrompt';
      installOverlay.setAttribute('role', 'dialog');
      installOverlay.setAttribute('aria-modal', 'true');
      installOverlay.setAttribute('aria-labelledby', 'rudIosInstallTitle');
      installOverlay.innerHTML = `<div class="rud-ios-tutorial-card"><button class="rud-ios-tutorial-close" type="button" data-rud-install-close aria-label="Close installation guide">×</button><header class="rud-ios-tutorial-brand"><img class="rud-ios-tutorial-logo" src="/icon-192.png" alt="Rise Upon Deen app icon"><span class="rud-ios-tutorial-kicker">Rise Upon Deen</span><h2 id="rudIosInstallTitle">Install Rise Upon Deen</h2><p>Add Rise Upon Deen to your iPhone Home Screen and use it like an app.</p></header><div class="rud-ios-tutorial-status"><span id="rudIosStepLabel">Step 1 of 4</span><span>iPhone / iPad</span></div><div class="rud-ios-progress" id="rudIosProgress" aria-hidden="true"></div><div id="rudIosStepBody"></div><div class="rud-ios-tutorial-nav"><button class="rud-ios-prev" id="rudIosPrev" type="button">Previous</button><button class="rud-ios-next" id="rudIosNext" type="button">Next</button></div></div>`;
      document.body.appendChild(installOverlay);
      installOverlay.querySelector('[data-rud-install-close]')?.addEventListener('click', closeInstallPrompt);
      installOverlay.querySelector('#rudIosPrev')?.addEventListener('click', () => {
        if (iosStep > 0) {
          iosStep--;
          renderIosStep();
        }
      });
      installOverlay.querySelector('#rudIosNext')?.addEventListener('click', () => {
        if (iosStep < 3) {
          iosStep++;
          renderIosStep();
        } else showIosSuccess();
      });
      renderIosStep();
      requestAnimationFrame(() => {
        if (installOverlay && !maintenanceActive()) {
          installOverlay.style.visibility = 'visible';
          installOverlay.style.pointerEvents = 'auto';
          installOverlay.classList.add('open');
          installOverlay.querySelector('[data-rud-install-close]')?.focus();
        } else closeInstallPrompt();
      });
    }

    function buildAndroidPrompt() {
      if (installOverlay || isInstalled() || maintenanceActive() || !deferredInstallPrompt || !isAndroid()) return;
      const light = document.documentElement.classList.contains('light-mode');
      installPreviousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      installOverlay = document.createElement('div');
      installOverlay.id = 'rudAndroidInstallPrompt';
      installOverlay.setAttribute('role', 'dialog');
      installOverlay.setAttribute('aria-modal', 'true');
      installOverlay.setAttribute('aria-labelledby', 'rudAndroidInstallTitle');
      installOverlay.style.cssText = `position:fixed;inset:0;z-index:20000;display:grid;place-items:center;padding:22px;background:${light ? 'rgba(247,246,242,.90)' : 'rgba(0,0,0,.82)'};backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);opacity:0;transition:opacity .26s ease,visibility .26s ease;`;
      installOverlay.innerHTML = `<div style="width:min(430px,100%);padding:30px 25px 24px;border:1px solid ${light ? 'rgba(155,116,50,.18)' : 'rgba(216,187,121,.20)'};border-radius:28px;background:${light ? '#fff' : 'radial-gradient(circle at 50% 0%,rgba(216,187,121,.08),transparent 34%),#090a0b'};box-shadow:${light ? '0 28px 80px rgba(35,27,13,.15)' : '0 28px 90px rgba(0,0,0,.62)'};text-align:center;color:${light ? '#171717' : '#f7f5ef'};font-family:Manrope,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><img src="/icon-192.png" alt="Rise Upon Deen app icon" style="width:54px;height:54px;object-fit:contain;margin:0 auto 16px;border-radius:15px;background:#fff"><div style="margin-bottom:8px;color:${light ? '#9b7432' : '#c3a86d'};font-size:9px;font-weight:800;letter-spacing:.19em;text-transform:uppercase;">Rise Upon Deen</div><h2 id="rudAndroidInstallTitle" style="margin:0 0 10px;font-family:'Cormorant Garamond',Georgia,serif;font-size:clamp(1.9rem,7vw,2.45rem);font-weight:600;line-height:1;letter-spacing:-.04em;color:${light ? '#171717' : '#f7f5ef'};">Install Rise Upon Deen</h2><p style="margin:0 auto 22px;max-width:340px;color:${light ? '#625d54' : '#b7b5af'};line-height:1.6;font-size:13.5px;">Add Rise Upon Deen to your Home Screen for quick access to your daily guidance.</p><button id="rudAndroidInstallButton" type="button" style="width:100%;min-height:50px;border:1px solid ${light ? '#1d1b17' : 'rgba(216,187,121,.65)'};border-radius:999px;background:${light ? '#1d1b17' : 'linear-gradient(135deg,#e0c884,#ae8438)'};color:${light ? '#fff' : '#111'};font:800 13px Manrope,system-ui,sans-serif;cursor:pointer;">Install Rise Upon Deen</button><button id="rudAndroidInstallLater" type="button" style="margin-top:12px;padding:9px 14px;border:0;background:transparent;color:${light ? '#777067' : '#8f8d87'};cursor:pointer;font:650 12px Manrope,system-ui,sans-serif;">Not now</button></div>`;
      document.body.appendChild(installOverlay);
      installButton = installOverlay.querySelector('#rudAndroidInstallButton');
      installButton?.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        installButton.disabled = true;
        try {
          await promptEvent.prompt();
          await promptEvent.userChoice;
        } catch (err) {
          console.warn('PWA install prompt failed:', err);
        }
        closeInstallPrompt();
        syncInstallAction();
      });
      installOverlay.querySelector('#rudAndroidInstallLater')?.addEventListener('click', closeInstallPrompt);
      requestAnimationFrame(() => {
        if (installOverlay && !maintenanceActive()) installOverlay.style.opacity = '1';
        else closeInstallPrompt();
      });
    }

    function openInstallExperience() {
      document.querySelector('[data-rud-explore-close]')?.click();
      if (isInstalled()) return;
      if (isIOS()) {
        buildIosTutorial();
        return;
      }
      if (isAndroid() && deferredInstallPrompt) buildAndroidPrompt();
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
      if (adminShortcut || !isAndroid() || isStandalone()) return;
      event.preventDefault();
      deferredInstallPrompt = event;
      bindInstallAction();
      if (legacyDocumentLoading()) onLegacyDomContentLoaded(buildAndroidPrompt);
      else buildAndroidPrompt();
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      closeInstallPrompt();
      try {
        localStorage.setItem('rud_pwa_installed', '1');
      } catch {}
      try {
        /* The original reached this function through the implicit window global a top-level function
           declaration creates; modules have no such globals, so it is imported explicitly. */
        rudMarkPwaInstalled('appinstalled');
      } catch {}
      syncInstallAction();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && installOverlay) closeInstallPrompt();
    });
    if (legacyDocumentLoading()) onLegacyDomContentLoaded(bindInstallAction);
    else bindInstallAction();
    if (isIOS() && isStandalone()) {
      try {
        localStorage.setItem('rud_pwa_installed', '1');
      } catch {}
      closeInstallPrompt();
      syncInstallAction();
    }

    if (!adminShortcut && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => console.warn('Service worker registration failed:', err));
    }
  })();
}
