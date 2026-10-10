/**
 * Privacy-conscious first-party visitor analytics (anonymous visitor/session ids, no IP stored) and installed-app detection.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { rudIsAdminRoute } from '../../app/routing/routeState';
import { doc, serverTimestamp, setDoc } from '../../services/firebase/sdk';

let RUD_ANALYTICS_COLLECTION,
  RUD_ANALYTICS_LOCATION_KEY,
  RUD_ANALYTICS_LOCATION_TTL,
  rudAnalyticsSessionId,
  rudAnalyticsStartedAt,
  rudAnalyticsLastWrite,
  rudAnalyticsHeartbeat,
  rudAnalyticsWriteInFlight,
  rudAnalyticsWriteQueued,
  rudAnalyticsLocationPromise,
  rudVisitorMemoryId,
  rudSessionMemoryId;

function rudAnalyticsLocationCached() {
  try {
    const value = JSON.parse(localStorage.getItem(RUD_ANALYTICS_LOCATION_KEY) || 'null');
    const updatedAt = Number(value?.updatedAt) || 0;
    if (!updatedAt || Date.now() - updatedAt > RUD_ANALYTICS_LOCATION_TTL) return null;
    const city = String(value?.city || '')
      .trim()
      .slice(0, 100);
    const region = String(value?.region || '')
      .trim()
      .slice(0, 100);
    const country = String(value?.country || '')
      .trim()
      .slice(0, 100);
    return city || region || country ? { city, region, country, updatedAt } : null;
  } catch {
    return null;
  }
}
async function rudResolveAnalyticsLocation() {
  const cached = rudAnalyticsLocationCached();
  if (cached) return cached;
  if (rudAnalyticsLocationPromise) return rudAnalyticsLocationPromise;
  rudAnalyticsLocationPromise = (async () => {
    try {
      const res = await fetch('https://ipwho.is/?fields=success,city,region,country', {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.success !== true) return null;
      const value = {
        city: String(data.city || '')
          .trim()
          .slice(0, 100),
        region: String(data.region || '')
          .trim()
          .slice(0, 100),
        country: String(data.country || '')
          .trim()
          .slice(0, 100),
        updatedAt: Date.now(),
      };
      if (!value.city && !value.region && !value.country) return null;
      try {
        localStorage.setItem(RUD_ANALYTICS_LOCATION_KEY, JSON.stringify(value));
      } catch {}
      return value;
    } catch {
      return null;
    } finally {
      rudAnalyticsLocationPromise = null;
    }
  })();
  return rudAnalyticsLocationPromise;
}
function rudRandomId(prefix = '') {
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return prefix + [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
  } catch {
    return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}
function rudVisitorId() {
  try {
    let id = localStorage.getItem('rud_visitor_id');
    if (!id) {
      id = rudRandomId('v_');
      localStorage.setItem('rud_visitor_id', id);
    }
    rudVisitorMemoryId = id;
    return id;
  } catch {
    if (!rudVisitorMemoryId) rudVisitorMemoryId = rudRandomId('v_');
    return rudVisitorMemoryId;
  }
}
function rudSessionId() {
  try {
    let id = sessionStorage.getItem('rud_session_id');
    if (!id) {
      id = rudRandomId('s_');
      sessionStorage.setItem('rud_session_id', id);
    }
    rudSessionMemoryId = id;
    return id;
  } catch {
    if (!rudSessionMemoryId) rudSessionMemoryId = rudRandomId('s_');
    return rudSessionMemoryId;
  }
}
function rudDeviceType() {
  const w = Math.max(screen?.width || 0, innerWidth || 0);
  if (w < 768) return 'mobile';
  if (w < 1100) return 'tablet';
  return 'desktop';
}
function rudReferrer() {
  try {
    if (!document.referrer) return 'direct';
    const u = new URL(document.referrer);
    return u.hostname === location.hostname ? 'internal' : u.hostname.slice(0, 100);
  } catch {
    return 'unknown';
  }
}
function rudCurrentRoute() {
  return (location.hash || '#home').slice(1, 180);
}
function rudIsAndroid() {
  try {
    return /Android/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
}
function rudAndroidAppReferrer() {
  try {
    return /^android-app:\/\//i.test(document.referrer || '');
  } catch {
    return false;
  }
}
function rudDisplayMode() {
  try {
    if (rudIsPwaLaunchUrl()) return 'standalone';
    if (navigator.standalone === true) return 'standalone';
    if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
    if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui';
    if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return 'window-controls-overlay';
    if (rudIsAndroidDevice() && /^android-app:\/\//i.test(document.referrer || '')) return 'standalone';
    return 'browser';
  } catch {
    return 'browser';
  }
}
function rudIsIosDevice() {
  try {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}
function rudIsAndroidDevice() {
  try {
    return /Android/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
}
function rudIsPwaLaunchUrl() {
  try {
    const p = new URLSearchParams(location.search);
    return p.get('source') === 'pwa' || p.get('utm_source') === 'pwa';
  } catch {
    return false;
  }
}
function rudIsStandaloneSession() {
  try {
    if (rudIsPwaLaunchUrl()) return true;
    if (navigator.standalone === true) return true;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;

    /* Android installed/Home Screen launches may expose android-app://
       even when display-mode propagation is delayed. */
    if (rudIsAndroidDevice() && /^android-app:\/\//i.test(document.referrer || '')) return true;

    /* Chrome/Android may expose TWA display mode on some installed launches. */
    if (window.matchMedia('(display-mode: standalone)').matches && rudIsAndroidDevice()) return true;
  } catch {}
  return false;
}
function rudInstalledPlatform() {
  if (rudIsIosDevice()) return 'iOS';
  if (rudIsAndroidDevice()) return 'Android';
  return 'Other';
}
function rudIsInstalledApp() {
  if (rudIsStandaloneSession()) return true;
  try {
    return localStorage.getItem('rud_pwa_installed') === '1';
  } catch {
    return false;
  }
}
function rudEnsureInstalledState() {
  const standalone = rudIsStandaloneSession();
  if (!standalone) return false;

  try {
    localStorage.setItem('rud_pwa_installed', '1');
    localStorage.setItem('rud_pwa_install_captured', '1');

    if (!localStorage.getItem('rud_pwa_installed_at')) {
      localStorage.setItem('rud_pwa_installed_at', String(Date.now()));
    }

    if (!localStorage.getItem('rud_pwa_install_source')) {
      const source = rudIsIosDevice()
        ? 'ios_home_screen_launch'
        : rudIsAndroidDevice()
          ? 'android_installed_app_launch'
          : 'standalone_launch';
      localStorage.setItem('rud_pwa_install_source', source);
    }
  } catch {}

  return true;
}
function rudInstallCaptured() {
  try {
    return localStorage.getItem('rud_pwa_install_captured') === '1';
  } catch {
    return false;
  }
}
function rudInstalledAt() {
  try {
    const raw = Number(localStorage.getItem('rud_pwa_installed_at') || 0);
    return raw > 0 ? new Date(raw) : null;
  } catch {
    return null;
  }
}
function rudMarkPwaInstalled(source = 'appinstalled') {
  try {
    localStorage.setItem('rud_pwa_installed', '1');
    localStorage.setItem('rud_pwa_install_captured', '1');
    if (!localStorage.getItem('rud_pwa_installed_at')) {
      localStorage.setItem('rud_pwa_installed_at', String(Date.now()));
    }
    localStorage.setItem('rud_pwa_install_source', source);
  } catch {}
  try {
    rudAnalyticsWrite(true);
  } catch {}
}
async function rudAnalyticsWrite(force = false) {
  if (!S.firebaseReady || !S.db || !rudAnalyticsSessionId || rudIsAdminRoute()) return;

  rudEnsureInstalledState();

  if (document.visibilityState !== 'visible' && !force) return;

  if (rudAnalyticsWriteInFlight) {
    if (force) rudAnalyticsWriteQueued = true;
    return;
  }

  const now = Date.now();
  if (!force && now - rudAnalyticsLastWrite < 1200) return;
  rudAnalyticsLastWrite = now;

  const duration = Math.max(0, Math.floor((now - rudAnalyticsStartedAt) / 1000));
  const standalone =
    rudIsStandaloneSession() || (rudIsAndroidDevice() && /^android-app:\/\//i.test(document.referrer || ''));
  const installed = standalone || rudIsInstalledApp();
  const coarseLocation = rudAnalyticsLocationCached();

  rudAnalyticsWriteInFlight = true;

  try {
    await setDoc(
      doc(S.db, RUD_ANALYTICS_COLLECTION, rudAnalyticsSessionId),
      {
        visitorId: rudVisitorId(),
        visitorName: (() => {
          try {
            return (localStorage.getItem('rud_visitor_name') || '').slice(0, 50);
          } catch {
            return '';
          }
        })(),
        sessionId: rudAnalyticsSessionId,
        startedAt: new Date(rudAnalyticsStartedAt),
        lastSeenAt: serverTimestamp(),
        clientLastSeenMs: now,
        durationSeconds: duration,
        route: rudCurrentRoute(),
        device: rudDeviceType(),
        referrer: rudReferrer(),
        language: (navigator.language || '').slice(0, 20),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        ...(coarseLocation?.city ? { city: coarseLocation.city } : {}),
        ...(coarseLocation?.region ? { region: coarseLocation.region } : {}),
        ...(coarseLocation?.country ? { country: coarseLocation.country } : {}),
        ...(coarseLocation?.updatedAt
          ? { locationCapturedAt: new Date(coarseLocation.updatedAt), locationSource: 'coarse_network' }
          : {}),
        appMode: rudDisplayMode(),
        appSession: standalone,
        installedApp: installed,
        installedPlatform: rudInstalledPlatform(),
        installCaptured: rudInstallCaptured(),
        installedAt: rudInstalledAt(),
        installSource: (() => {
          try {
            return localStorage.getItem('rud_pwa_install_source') || '';
          } catch {
            return '';
          }
        })(),
        visibility: document.visibilityState || 'visible',
        active: document.visibilityState === 'visible',
      },
      { merge: true },
    );
  } catch (e) {
    if (String(e?.code || '').includes('permission')) {
      console.warn('Visitor analytics writes are blocked by Firestore rules.');
    } else {
      console.warn('Visitor analytics write failed.', e);
    }
  } finally {
    rudAnalyticsWriteInFlight = false;

    if (rudAnalyticsWriteQueued) {
      rudAnalyticsWriteQueued = false;
      queueMicrotask(() => rudAnalyticsWrite(true));
    }
  }

  if (!coarseLocation && !rudAnalyticsLocationPromise) {
    rudResolveAnalyticsLocation()
      .then((location) => {
        if (location && S.firebaseReady && S.db && rudAnalyticsSessionId && !rudIsAdminRoute()) rudAnalyticsWrite(true);
      })
      .catch(() => {});
  }
}
function rudInitVisitorAnalytics() {
  if (!S.firebaseReady || !S.db || rudAnalyticsSessionId) return;

  /* Start analytics immediately, including fresh Android/iOS Home Screen apps.
     The visitor name can be blank initially and is merged into this same
     session after the welcome form is submitted. */
  rudEnsureInstalledState();

  rudAnalyticsSessionId = rudSessionId();
  rudAnalyticsStartedAt = Date.now();
  rudAnalyticsLastWrite = 0;

  /* First write is immediate. This is especially important for an Android
     installed/WebAPK launch where the app may be opened and closed quickly. */
  rudAnalyticsWrite(true);

  if (rudAnalyticsHeartbeat) clearInterval(rudAnalyticsHeartbeat);
  rudAnalyticsHeartbeat = setInterval(() => {
    if (document.visibilityState === 'visible') {
      rudEnsureInstalledState();
      rudAnalyticsWrite(true);
    }
  }, 15000);

  const liveWrite = () => {
    rudEnsureInstalledState();
    rudAnalyticsWrite(true);
  };

  document.addEventListener('visibilitychange', liveWrite, { passive: true });
  addEventListener('hashchange', liveWrite, { passive: true });
  addEventListener('focus', liveWrite, { passive: true });
  addEventListener('pageshow', liveWrite, { passive: true });
  addEventListener('online', liveWrite, { passive: true });
  addEventListener('pagehide', liveWrite, { passive: true });
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  /* ============================================================
   RISE UPON DEEN — PRIVACY-CONSCIOUS VISITOR ANALYTICS
   Anonymous first-party metrics only. No IP address is stored.
   One session document + low-frequency visible-page heartbeat.
   ============================================================ */
  RUD_ANALYTICS_COLLECTION = 'visitor_sessions';
  RUD_ANALYTICS_LOCATION_KEY = 'rud_analytics_location_v1';
  RUD_ANALYTICS_LOCATION_TTL = 6 * 60 * 60 * 1000;
  rudAnalyticsSessionId = '';
  rudAnalyticsStartedAt = Date.now();
  rudAnalyticsLastWrite = 0;
  rudAnalyticsHeartbeat = null;
  rudAnalyticsWriteInFlight = false;
  rudAnalyticsWriteQueued = false;
  rudAnalyticsLocationPromise = null;
  rudVisitorMemoryId = '';
  rudSessionMemoryId = '';
}

export {
  RUD_ANALYTICS_COLLECTION,
  rudAnalyticsSessionId,
  rudAnalyticsWrite,
  rudCurrentRoute,
  rudDeviceType,
  rudDisplayMode,
  rudEnsureInstalledState,
  rudInitVisitorAnalytics,
  rudIsInstalledApp,
  rudMarkPwaInstalled,
  rudSessionId,
  rudVisitorId,
};
