/**
 * Free FCM web push (lazy-loaded after opt-in), reminder preferences, prayer-time reminders and the Reminder Center.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { rudVisitorId } from '../analytics/visitorAnalytics';
import { rudRenderMyDeen, rudSyncFridayMode, rudSyncSmartHome } from '../my-deen/myDeen';
import { onLegacyWindowLoad } from '../../runtime/lifecycle';
import { firebaseInitPromise } from '../../services/firebase/firebaseInit';
import { doc, loadMessagingSdk, serverTimestamp, setDoc, signInAnonymously } from '../../services/firebase/sdk';
import { busy, esc, toast } from '../../utils/ui';

let RUD_PUSH_PREF_KEY,
  RUD_PUSH_PREF_LEGACY_KEY,
  RUD_PUSH_TOKEN_KEY,
  RUD_PUSH_SYNC_HASH_KEY,
  RUD_PUSH_LAST_CHECK_KEY,
  RUD_PUSH_SENDER_ENDPOINT_KEY,
  RUD_PRAYER_RESOLVED_KEY,
  RUD_PRAYER_NOTIFY_STATE_KEY,
  RUD_PRAYER_KEYS,
  RUD_PUSH_COLLECTION,
  RUD_PUSH_DB,
  RUD_PUSH_STORE,
  RUD_PUSH_VAPID_KEY,
  RUD_PUSH_SEND_ENDPOINT_DEFAULT,
  RUD_PUSH_CATEGORY_DEFS,
  RUD_PUSH_DEFAULTS,
  rudMessagingLoadPromise,
  rudMessagingInstance,
  rudForegroundMessageBound,
  rudPushProfileSyncTimer,
  rudPrayerReminderClock;

function rudPushSenderEndpoint() {
  try {
    return String(localStorage.getItem(RUD_PUSH_SENDER_ENDPOINT_KEY) || RUD_PUSH_SEND_ENDPOINT_DEFAULT || '').trim();
  } catch {
    return RUD_PUSH_SEND_ENDPOINT_DEFAULT;
  }
}
function rudSetPushSenderEndpoint(value) {
  const clean = String(value || '').trim();
  try {
    if (clean) localStorage.setItem(RUD_PUSH_SENDER_ENDPOINT_KEY, clean);
    else localStorage.removeItem(RUD_PUSH_SENDER_ENDPOINT_KEY);
  } catch {}
  return clean;
}
function rudPushPrefs() {
  try {
    let raw = JSON.parse(localStorage.getItem(RUD_PUSH_PREF_KEY) || 'null');
    if (!raw) {
      raw = JSON.parse(localStorage.getItem(RUD_PUSH_PREF_LEGACY_KEY) || 'null');
      if (raw)
        try {
          localStorage.setItem(RUD_PUSH_PREF_KEY, JSON.stringify(raw));
        } catch {}
    }
    raw = raw || {};
    return { ...RUD_PUSH_DEFAULTS, ...raw, categories: { ...RUD_PUSH_DEFAULTS.categories, ...(raw.categories || {}) } };
  } catch {
    return { ...RUD_PUSH_DEFAULTS, categories: { ...RUD_PUSH_DEFAULTS.categories } };
  }
}
function rudOpenPushDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(RUD_PUSH_DB, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(RUD_PUSH_STORE)) idb.createObjectStore(RUD_PUSH_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function rudMirrorPushPrefsToIdb(prefs) {
  try {
    const idb = await rudOpenPushDb();
    if (!idb) return;
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(RUD_PUSH_STORE, 'readwrite');
      tx.objectStore(RUD_PUSH_STORE).put(
        { enabled: !!prefs.enabled, categories: { ...prefs.categories }, reminderTime: prefs.reminderTime || '08:00' },
        'preferences',
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    idb.close();
  } catch (e) {
    console.warn('Local notification preference cache unavailable', e);
  }
}
function rudSavePushPrefs(next) {
  const prefs = {
    ...RUD_PUSH_DEFAULTS,
    ...next,
    categories: { ...RUD_PUSH_DEFAULTS.categories, ...(next?.categories || {}) },
  };
  try {
    localStorage.setItem(RUD_PUSH_PREF_KEY, JSON.stringify(prefs));
  } catch {}
  rudMirrorPushPrefsToIdb(prefs);
  return prefs;
}
function rudPushIsIOS() {
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
function rudPushStandalone() {
  return (
    !!navigator.standalone ||
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches
  );
}
function rudPushCapability() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  if (rudPushIsIOS() && !rudPushStandalone()) return 'install-required';
  return 'supported';
}
function rudPushPermissionLabel() {
  if (!('Notification' in window)) return 'Unavailable';
  return Notification.permission === 'granted'
    ? 'Granted'
    : Notification.permission === 'denied'
      ? 'Denied'
      : 'Not decided';
}
function rudPushPlatform() {
  if (rudPushIsIOS()) return rudPushStandalone() ? 'ios-home-screen' : 'ios-browser';
  if (/Android/i.test(navigator.userAgent || '')) return rudPushStandalone() ? 'android-pwa' : 'android-browser';
  return rudPushStandalone() ? 'installed-pwa' : 'browser';
}
function rudPushTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
function rudPrayerDateInZone(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone || rudPushTimeZone(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date()),
      map = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function rudPrayerClockText(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const d = new Date(2000, 0, 1, Number(m[1]), Number(m[2]));
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
}
function rudResolvedPrayerSchedule() {
  try {
    const raw = JSON.parse(localStorage.getItem(RUD_PRAYER_RESOLVED_KEY) || 'null');
    if (!raw || !raw.date || !raw.timeZone || !raw.timings) return null;
    const storedDate = String(raw.date),
      parts = storedDate.match(/^(\d{2})-(\d{2})-(\d{4})$/),
      canonicalDate = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : storedDate;
    if (canonicalDate !== rudPrayerDateInZone(raw.timeZone)) return null;
    const timings = {};
    for (const key of RUD_PRAYER_KEYS) {
      const value = String(raw.timings[key] || '').match(/\d{1,2}:\d{2}/)?.[0] || '';
      if (value) timings[key] = value;
    }
    const sunrise = String(raw.timings.sunrise || '').match(/\d{1,2}:\d{2}/)?.[0] || '';
    if (sunrise) timings.sunrise = sunrise;
    const lat = Number(raw.lat),
      lng = Number(raw.lng);
    return RUD_PRAYER_KEYS.every((key) => !!timings[key])
      ? {
          date: canonicalDate,
          timeZone: String(raw.timeZone),
          timings,
          method: raw.method ?? null,
          school: raw.school ?? null,
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
        }
      : null;
  } catch {
    return null;
  }
}
function rudCacheResolvedPrayerTimes(timings, timeZone, date, meta = {}) {
  try {
    const normalized = {};
    for (const key of RUD_PRAYER_KEYS) {
      const label = key[0].toUpperCase() + key.slice(1),
        value = String(timings?.[label] || timings?.[key] || '').match(/\d{1,2}:\d{2}/)?.[0] || '';
      if (!value) return false;
      normalized[key] = value;
    }
    const sunrise = String(timings?.Sunrise || timings?.sunrise || '').match(/\d{1,2}:\d{2}/)?.[0] || '';
    if (sunrise) normalized.sunrise = sunrise;
    const zone = String(timeZone || rudPushTimeZone()),
      requestedDate = String(date || ''),
      canonicalDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : rudPrayerDateInZone(zone),
      lat = Number(meta.lat),
      lng = Number(meta.lng);
    const next = {
      date: canonicalDate,
      timeZone: zone,
      timings: normalized,
      method: meta.method ?? null,
      school: meta.school ?? null,
    };
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      next.lat = Math.round(lat * 1000) / 1000;
      next.lng = Math.round(lng * 1000) / 1000;
    }
    const old = JSON.parse(localStorage.getItem(RUD_PRAYER_RESOLVED_KEY) || 'null');
    const changed = JSON.stringify(old) !== JSON.stringify(next);
    if (changed) localStorage.setItem(RUD_PRAYER_RESOLVED_KEY, JSON.stringify(next));
    if (
      changed &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      rudPushPrefs().enabled &&
      rudPushPrefs().categories.prayer === true
    )
      rudQueuePushProfileSync();
    if (changed && typeof rudRefreshReminderCenter === 'function') rudRefreshReminderCenter();
    if (changed && (location.hash || '').startsWith('#my-deen') && typeof rudRenderMyDeen === 'function')
      requestAnimationFrame(() => rudRenderMyDeen(true));
    if (typeof rudSyncPrayerReminderClock === 'function') rudSyncPrayerReminderClock();
    return true;
  } catch {
    return false;
  }
}
function rudPushProfile() {
  const prefs = rudPushPrefs(),
    prayers = prefs.categories.prayer === true ? rudResolvedPrayerSchedule() : null;
  return {
    enabled: !!prefs.enabled,
    categories: { ...prefs.categories },
    reminderTime: prefs.reminderTime || '08:00',
    timeZone: rudPushTimeZone(),
    prayers: prayers
      ? {
          date: prayers.date,
          timeZone: prayers.timeZone,
          timings: { ...prayers.timings },
          lat: Number.isFinite(prayers.lat) ? prayers.lat : null,
          lng: Number.isFinite(prayers.lng) ? prayers.lng : null,
          method: prayers.method ?? null,
          school: prayers.school ?? null,
        }
      : null,
  };
}
function rudPushProfileHash(token, profile) {
  return JSON.stringify({
    token: String(token || ''),
    enabled: profile.enabled,
    categories: profile.categories,
    reminderTime: profile.reminderTime,
    timeZone: profile.timeZone,
    prayers: profile.prayers || null,
  });
}
async function rudLoadMessaging() {
  await firebaseInitPromise;
  if (!S.firebaseReady || !S.app) throw new Error('firebase-not-ready');
  if (!rudMessagingLoadPromise) {
    rudMessagingLoadPromise = loadMessagingSdk().then(async (mod) => {
      const supported = typeof mod.isSupported === 'function' ? await mod.isSupported() : true;
      if (!supported) throw new Error('messaging-unsupported');
      return mod;
    });
  }
  const mod = await rudMessagingLoadPromise;
  if (!rudMessagingInstance) rudMessagingInstance = mod.getMessaging(S.app);
  return { mod, messaging: rudMessagingInstance };
}
function rudPushLocalToken() {
  try {
    return localStorage.getItem(RUD_PUSH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}
function rudSetPushLocalToken(token) {
  try {
    if (token) localStorage.setItem(RUD_PUSH_TOKEN_KEY, token);
    else localStorage.removeItem(RUD_PUSH_TOKEN_KEY);
  } catch {}
}
async function rudEnsureAnonymousPushAuth() {
  /* Push registration must not depend on Anonymous Auth being enabled in Firebase.
     The Firestore rules for push_subscriptions validate the stable visitorId directly. */
  try {
    await firebaseInitPromise;
    if (S.firebaseReady && S.auth && typeof signInAnonymously === 'function' && !S.auth.currentUser) {
      await signInAnonymously(S.auth).catch(() => {});
    }
    return String(S.auth?.currentUser?.uid || '');
  } catch {
    return '';
  }
}
async function rudStoreStableFcmToken(token, { force = false } = {}) {
  if (!token) return false;
  await firebaseInitPromise;
  if (!S.firebaseReady || !S.db || !setDoc || !doc || !serverTimestamp) throw new Error('firebase-not-ready');
  const ownerUid = await rudEnsureAnonymousPushAuth();
  const visitorId = rudVisitorId();
  const prefs = rudPushPrefs();
  const profile = rudPushProfile();
  const hash = rudPushProfileHash(token, profile);
  let oldHash = '';
  try {
    oldHash = localStorage.getItem(RUD_PUSH_SYNC_HASH_KEY) || '';
  } catch {}
  if (!force && hash === oldHash) return false;
  await setDoc(
    doc(S.db, RUD_PUSH_COLLECTION, visitorId),
    {
      visitorId,
      ...(ownerUid ? { ownerUid } : {}),
      schemaVersion: 2,
      active: true,
      fcmToken: String(token),
      platform: rudPushPlatform(),
      enabledCategories: Object.keys(profile.categories || {}).filter((k) => profile.categories[k] === true),
      schedule: {
        categories: { ...profile.categories },
        reminderTime: profile.reminderTime,
        timeZone: profile.timeZone,
        lat: profile.prayers?.lat ?? null,
        lng: profile.prayers?.lng ?? null,
        method: profile.prayers?.method ?? null,
        school: profile.prayers?.school ?? null,
        prayers: profile.prayers || null,
      },
      firstEnabledAt: Number(prefs.firstEnabledAt) || Date.now(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  rudSetPushLocalToken(token);
  rudAnnouncePushToken(token);
  try {
    localStorage.setItem(RUD_PUSH_SYNC_HASH_KEY, hash);
    localStorage.setItem(RUD_PUSH_LAST_CHECK_KEY, String(Date.now()));
  } catch {}
  return true;
}
async function rudDeactivatePushRecord() {
  try {
    await firebaseInitPromise;
    if (!S.firebaseReady || !S.db || !setDoc || !doc || !serverTimestamp) return false;
    const ownerUid = await rudEnsureAnonymousPushAuth();
    const visitorId = rudVisitorId();
    await setDoc(
      doc(S.db, RUD_PUSH_COLLECTION, visitorId),
      {
        visitorId,
        ...(ownerUid ? { ownerUid } : {}),
        schemaVersion: 2,
        active: false,
        fcmToken: null,
        enabledCategories: [],
        schedule: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    rudSetPushLocalToken('');
    rudAnnouncePushToken('');
    try {
      localStorage.removeItem(RUD_PUSH_SYNC_HASH_KEY);
      localStorage.removeItem(RUD_PUSH_LAST_CHECK_KEY);
    } catch {}
    return true;
  } catch (e) {
    console.warn('Notification record deactivation skipped', e);
    return false;
  }
}
/* Lets Deen Friends link (or unlink) this device's token to the signed-in user
   (features/deen-friends/services/pushDeviceService.ts). The token itself never leaves this tab. */
function rudAnnouncePushToken(token) {
  try {
    window.dispatchEvent(new CustomEvent('rud-push-token-changed', { detail: { token: String(token || '') } }));
  } catch {}
}
function rudForegroundPushData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : {};
}
function rudForegroundPushAllowed(data) {
  const prefs = rudPushPrefs();
  if (!prefs.enabled) return false;
  const category = String(data.category || 'announcement');
  if (Object.prototype.hasOwnProperty.call(prefs.categories, category) && prefs.categories[category] === false)
    return false;
  return true;
}
async function rudBindForegroundMessaging() {
  if (rudForegroundMessageBound) return;
  const { mod, messaging } = await rudLoadMessaging();
  rudForegroundMessageBound = true;
  mod.onMessage(messaging, (payload) => {
    const data = rudForegroundPushData(payload);
    if (!rudForegroundPushAllowed(data)) return;
    // Already looking at the screen the notification points to (e.g. that chat): nothing to announce.
    if (data.route && String(data.route) === location.hash) return;
    const title = String(data.title || 'Rise Upon Deen').trim();
    const message = String(data.message || data.body || '').trim();
    toast(message ? `${title} — ${message}` : title);
  });
}
async function rudEnsureFcmToken({ force = false } = {}) {
  if (Notification.permission !== 'granted') return '';
  if (!RUD_PUSH_VAPID_KEY) throw new Error('missing-vapid-key');
  const { mod, messaging } = await rudLoadMessaging();
  const registration = await navigator.serviceWorker.ready;
  try {
    await registration.update();
  } catch {}
  const token = await mod.getToken(messaging, {
    vapidKey: RUD_PUSH_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error('no-fcm-token');
  const localToken = rudPushLocalToken();
  await rudStoreStableFcmToken(token, { force: force || token !== localToken });
  await rudBindForegroundMessaging();
  return token;
}
function rudQueuePushProfileSync() {
  clearTimeout(rudPushProfileSyncTimer);
  const prefs = rudPushPrefs();
  if (!prefs.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const token = rudPushLocalToken();
  if (!token) return;
  rudPushProfileSyncTimer = setTimeout(
    () => rudStoreStableFcmToken(token).catch((e) => console.warn('Notification preference cloud sync skipped', e)),
    700,
  );
}
async function rudEnableDeenReminders(button) {
  const capability = rudPushCapability();
  if (capability === 'unsupported') {
    toast('Notifications are not available on this device/browser.', 'error');
    return rudRefreshReminderCenter();
  }
  if (capability === 'install-required') {
    toast('Add Rise Upon Deen to your Home Screen first to enable notifications.', 'error');
    return rudRefreshReminderCenter();
  }
  if (Notification.permission === 'denied') {
    toast(
      "Notifications are blocked. Allow them from this site's browser settings if you want to enable them.",
      'error',
    );
    return rudRefreshReminderCenter();
  }
  busy(button, true, 'Enabling…');
  try {
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      const current = rudPushPrefs();
      rudSavePushPrefs({ ...current, enabled: false, dismissedPrompt: permission === 'denied' });
      toast(
        permission === 'denied' ? 'Notification permission was denied.' : 'Notification permission was not enabled.',
        'error',
      );
      return;
    }
    const current = rudPushPrefs();
    rudSavePushPrefs({
      ...current,
      enabled: true,
      firstEnabledAt: Number(current.firstEnabledAt) || Date.now(),
      dismissedPrompt: false,
    });
    await rudEnsureFcmToken({ force: true });
    rudSyncPrayerReminderClock();
    toast('Deen Reminders enabled on this device.');
  } catch (e) {
    console.error('Enable notifications failed', e);
    const current = rudPushPrefs();
    rudSavePushPrefs({ ...current, enabled: false });
    const msg =
      e?.message === 'firebase-not-ready'
        ? 'Notifications are permitted, but Firebase is temporarily unavailable.'
        : e?.message === 'messaging-unsupported'
          ? 'Notifications are not available on this device/browser.'
          : e?.message === 'missing-vapid-key'
            ? 'The Firebase Web Push public key is missing.'
            : 'Unable to enable notifications on this device.';
    toast(msg, 'error');
  } finally {
    busy(button, false);
    rudRefreshReminderCenter();
  }
}
async function rudShowLocalNotificationTest() {
  if (!('Notification' in window) || Notification.permission !== 'granted') throw new Error('notification-permission');
  const registration = await navigator.serviceWorker.ready;
  try {
    await registration.update();
  } catch {}
  await registration.showNotification('Rise Upon Deen Test', {
    body: 'Browser notifications are working on this device.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'rud-local-test-' + Date.now(),
    renotify: true,
    requireInteraction: false,
    silent: false,
    data: { route: '#home', category: 'announcement', dedupeId: 'local-test:' + Date.now() },
  });
}
async function rudDisableAllNotifications(button) {
  busy(button, true, 'Disabling…');
  try {
    const current = rudPushPrefs();
    const categories = Object.fromEntries(Object.keys(RUD_PUSH_DEFAULTS.categories).map((k) => [k, false]));
    rudSavePushPrefs({ ...current, enabled: false, categories, dismissedPrompt: true });
    if (Notification.permission === 'granted') {
      try {
        const { mod, messaging } = await rudLoadMessaging();
        await mod.deleteToken(messaging);
      } catch (e) {
        console.warn('FCM token deletion skipped', e);
      }
    }
    await rudDeactivatePushRecord();
    rudSyncPrayerReminderClock();
    toast('Deen Reminders disabled on this device.');
  } finally {
    busy(button, false);
    rudRefreshReminderCenter();
  }
}
async function rudClearNotificationData(button) {
  busy(button, true, 'Clearing…');
  try {
    if (Notification.permission === 'granted') {
      try {
        const { mod, messaging } = await rudLoadMessaging();
        await mod.deleteToken(messaging);
      } catch {}
    }
    await rudDeactivatePushRecord();
    try {
      [
        RUD_PUSH_PREF_KEY,
        RUD_PUSH_PREF_LEGACY_KEY,
        RUD_PUSH_TOKEN_KEY,
        RUD_PUSH_SYNC_HASH_KEY,
        RUD_PUSH_LAST_CHECK_KEY,
        RUD_PRAYER_NOTIFY_STATE_KEY,
      ].forEach((k) => localStorage.removeItem(k));
      indexedDB.deleteDatabase(RUD_PUSH_DB);
    } catch {}
    toast('Local Deen Reminder data cleared. Browser permission itself is controlled by your device settings.');
  } finally {
    busy(button, false);
    rudRefreshReminderCenter();
  }
}
function rudPushStatusMessage() {
  const capability = rudPushCapability(),
    prefs = rudPushPrefs();
  if (capability === 'unsupported')
    return { text: 'Notifications are not available on this device/browser.', kind: 'error' };
  if (capability === 'install-required')
    return {
      text: 'On iPhone/iPad, add Rise Upon Deen to the Home Screen first, then enable reminders from the installed app.',
      kind: 'info',
    };
  if (Notification.permission === 'denied')
    return {
      text: 'Notifications are blocked. Rise Upon Deen will not ask again automatically; you can change permission from browser/site settings.',
      kind: 'error',
    };
  if (Notification.permission === 'granted' && !RUD_PUSH_VAPID_KEY)
    return { text: 'Browser permission is granted, but Firebase Web Push is not configured.', kind: 'error' };
  if (Notification.permission === 'granted' && prefs.enabled && !rudPushLocalToken())
    return {
      text: 'Notifications are enabled, but this device is not registered for cloud delivery yet. Tap Test Notification to verify the browser, then refresh this page and enable reminders again if needed.',
      kind: 'error',
    };
  if (Notification.permission === 'granted' && prefs.enabled)
    return {
      text: 'Deen Reminders are enabled. Test Notification confirms this device can display alerts; admin messages are delivered through the free scheduler.',
      kind: 'ok',
    };
  return {
    text: 'Receive gentle reminders from Rise Upon Deen. Permission is requested only after you tap Enable.',
    kind: 'info',
  };
}
function rudReminderCenterHtml() {
  const prefs = rudPushPrefs();
  const status = rudPushStatusMessage();
  const capability = rudPushCapability(),
    prayerSchedule = rudResolvedPrayerSchedule();
  const canEnable = capability === 'supported' && Notification.permission !== 'denied';
  const prayerStatus = prefs.categories.prayer
    ? `<div class="rud-push-intro"><strong>Prayer-time reminders</strong><p>${prayerSchedule ? `Using today’s resolved Prayer & Qiblah times (${RUD_PRAYER_KEYS.map((k) => `${k[0].toUpperCase() + k.slice(1)} ${rudPrayerClockText(prayerSchedule.timings[k])}`).join(' · ')}).` : `Open Prayer & Qiblah once today to refresh the local prayer schedule.`} While the app is open, these resolved times drive one deduplicated local check per prayer/date. When the Rise Upon Deen notification backend is deployed, prayer alerts are sent by Firebase even while this website is fully closed.</p></div>`
    : '';
  return `<section class="rud-reminder-center" id="rudReminderCenter">
    <div class="rud-reminder-head"><div><span class="eyebrow">REMINDER SETTINGS</span><h2>Deen Reminders</h2><p>Gentle reminders, not constant interruptions.</p></div><span class="rud-permission-pill">Permission · ${esc(rudPushPermissionLabel())}</span></div>
    <div class="rud-push-intro"><strong>Stay Connected to Your Deen</strong><p class="${status.kind === 'error' ? 'rud-push-note-error' : status.kind === 'ok' ? 'rud-push-note-ok' : ''}">${esc(status.text)}</p>${canEnable && !prefs.enabled ? `<div class="rud-push-actions"><button type="button" class="premium-btn primary" id="rudEnablePush">Enable Deen Reminders</button></div>` : prefs.enabled ? `<div class="rud-push-actions"><button type="button" class="premium-btn" id="rudTestPush">Test Notification</button></div>` : ''}</div>
    <div class="rud-reminder-list">${RUD_PUSH_CATEGORY_DEFS.map(([key, labelText]) => `<label class="rud-reminder-row"><span>${esc(labelText)}</span><span class="rud-v2-switch"><input type="checkbox" data-rud-push-category="${key}" ${prefs.categories[key] ? 'checked' : ''}><i aria-hidden="true"></i></span></label>`).join('')}</div>${prayerStatus}
    <div class="rud-reminder-time"><label for="rudPushTime">Preferred reminder time <small>· local-first</small></label><input id="rudPushTime" type="time" value="${esc(prefs.reminderTime || '08:00')}" aria-label="Preferred reminder time"></div>
    <div class="rud-reminder-foot"><small>Preferences stay on-device first. Prayer reminders reuse only the prayer times already resolved by Prayer & Qiblah; precise coordinates are not stored in notification preferences. A minimal schedule is synced only when needed for the existing background push delivery. Opening this screen does not upload anything.</small><div class="rud-push-actions"><button type="button" class="premium-btn" id="rudClearPushData">Clear Reminder Data</button><button type="button" class="premium-btn" id="rudDisablePush">Disable All Notifications</button></div></div>
  </section>`;
}
function rudBindReminderCenter() {
  const center = document.getElementById('rudReminderCenter');
  if (!center) return;
  center.querySelector('#rudEnablePush')?.addEventListener('click', (e) => rudEnableDeenReminders(e.currentTarget));
  center.querySelector('#rudTestPush')?.addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Testing…');
    try {
      await rudShowLocalNotificationTest();
      toast('Test notification shown on this device.');
    } catch (err) {
      toast(
        err?.message === 'notification-permission'
          ? 'Allow notifications first.'
          : 'Unable to show the test notification.',
        'error',
      );
    } finally {
      busy(e.currentTarget, false);
    }
  });
  center
    .querySelector('#rudDisablePush')
    ?.addEventListener('click', (e) => rudDisableAllNotifications(e.currentTarget));
  center
    .querySelector('#rudClearPushData')
    ?.addEventListener('click', (e) => rudClearNotificationData(e.currentTarget));
  center.querySelectorAll('[data-rud-push-category]').forEach((input) =>
    input.addEventListener('change', () => {
      const current = rudPushPrefs();
      const categories = { ...current.categories, [input.dataset.rudPushCategory]: input.checked };
      rudSavePushPrefs({ ...current, categories });
      rudQueuePushProfileSync();
      rudSyncPrayerReminderClock();
    }),
  );
  center.querySelector('#rudPushTime')?.addEventListener('change', (e) => {
    const current = rudPushPrefs();
    rudSavePushPrefs({ ...current, reminderTime: e.currentTarget.value || '08:00' });
    rudQueuePushProfileSync();
  });
}
function rudRefreshReminderCenter() {
  const old = document.getElementById('rudReminderCenter');
  if (!old) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = rudReminderCenterHtml();
  old.replaceWith(wrap.firstElementChild);
  rudBindReminderCenter();
}
function rudScheduleFcmMaintenance() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !rudPushPrefs().enabled) return;
  let last = 0;
  try {
    last = Number(localStorage.getItem(RUD_PUSH_LAST_CHECK_KEY) || 0);
  } catch {}
  if (Date.now() - last < 7 * 24 * 60 * 60 * 1000) return;
  setTimeout(() => rudEnsureFcmToken().catch((e) => console.warn('Periodic FCM token refresh skipped', e)), 5000);
}
function rudPrayerNotificationState() {
  try {
    const raw = JSON.parse(localStorage.getItem(RUD_PRAYER_NOTIFY_STATE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}
function rudSavePrayerNotificationState(state) {
  try {
    const cutoff = Date.now() - 8 * 24 * 60 * 60 * 1000;
    for (const id of Object.keys(state)) {
      if (Number(state[id] || 0) < cutoff) delete state[id];
    }
    localStorage.setItem(RUD_PRAYER_NOTIFY_STATE_KEY, JSON.stringify(state));
  } catch {}
}
function rudPrayerNowInZone(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(new Date()),
      map = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return { hour: Number(map.hour) % 24, minute: Number(map.minute), second: Number(map.second) };
  } catch {
    const d = new Date();
    return { hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() };
  }
}
async function rudCheckPrayerReminderNow() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const prefs = rudPushPrefs();
  if (!prefs.enabled || prefs.categories.prayer !== true) return;
  const schedule = rudResolvedPrayerSchedule();
  if (!schedule) return;
  const now = rudPrayerNowInZone(schedule.timeZone),
    state = rudPrayerNotificationState();
  for (const key of RUD_PRAYER_KEYS) {
    const match = String(schedule.timings[key] || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match || Number(match[1]) !== now.hour || Number(match[2]) !== now.minute) continue;
    const id = `${schedule.date}:${key}`;
    if (state[id]) return;
    const name = key[0].toUpperCase() + key.slice(1);
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(`${name} Prayer`, {
        body: `It is time for ${name}.`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: `rud-prayer-${id}`,
        renotify: false,
        requireInteraction: false,
        silent: false,
        data: {
          route: '#prayer',
          category: 'prayer',
          dedupeId: `prayer:${id}`,
          prayerName: key,
          prayerDate: schedule.date,
        },
      });
      state[id] = Date.now();
      rudSavePrayerNotificationState(state);
    } catch (e) {
      console.warn('Prayer reminder could not be shown', e);
    }
    return;
  }
}
function rudSyncPrayerReminderClock() {
  const active =
    'Notification' in window &&
    Notification.permission === 'granted' &&
    rudPushPrefs().enabled &&
    rudPushPrefs().categories.prayer === true &&
    !!rudResolvedPrayerSchedule();
  if (!active) {
    if (rudPrayerReminderClock) {
      clearInterval(rudPrayerReminderClock);
      rudPrayerReminderClock = null;
    }
    return;
  }
  if (!rudPrayerReminderClock)
    rudPrayerReminderClock = setInterval(() => {
      if (!document.hidden) rudCheckPrayerReminderNow();
    }, 30000);
  rudCheckPrayerReminderNow();
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  /* ============================================================
   RISE UPON DEEN V2 — FREE FCM WEB PUSH + MY DEEN
   - Firebase Cloud Messaging is lazy-loaded only after user opt-in.
   - Reuses the ONE existing /sw.js registration.
   - Notification permission is requested only from an explicit user tap.
   - Preferences stay local first; the same stable device record is updated only
     when push delivery or scheduling preferences actually change.
   - No paid notification provider, no second Firebase app, no second service worker.
   ============================================================ */
  RUD_PUSH_PREF_KEY = 'rud_push_preferences_v2';
  RUD_PUSH_PREF_LEGACY_KEY = 'rud_push_preferences_v1';
  RUD_PUSH_TOKEN_KEY = 'rud_fcm_token_v2';
  RUD_PUSH_SYNC_HASH_KEY = 'rud_fcm_sync_hash_v2';
  RUD_PUSH_LAST_CHECK_KEY = 'rud_fcm_last_check_v2';
  RUD_PUSH_SENDER_ENDPOINT_KEY = 'rud_push_sender_endpoint_v2';
  RUD_PRAYER_RESOLVED_KEY = 'rud_prayer_resolved_v1';
  RUD_PRAYER_NOTIFY_STATE_KEY = 'rud_prayer_notification_state_v2';
  RUD_PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  RUD_PUSH_COLLECTION = 'push_subscriptions';
  RUD_PUSH_DB = 'rud-notifications-v2';
  RUD_PUSH_STORE = 'settings';
  RUD_PUSH_VAPID_KEY = String(document.querySelector('meta[name="rud-web-push-vapid-key"]')?.content || '').trim();
  RUD_PUSH_SEND_ENDPOINT_DEFAULT = String(
    document.querySelector('meta[name="rud-push-send-endpoint"]')?.content || '',
  ).trim();
  RUD_PUSH_CATEGORY_DEFS = [
    ['daily', 'Daily Reminder'],
    ['quran', "Qur'an Reminder"],
    ['prayer', 'Prayer Times'],
    ['morning', 'Morning Adhkar'],
    ['evening', 'Evening Adhkar'],
    ['friday', 'Friday Reminder'],
    ['continueQuran', "Continue Qur'an"],
    ['newDua', 'New Dua'],
    ['newHadith', 'New Hadith'],
    ['announcement', 'Important Rise Upon Deen announcements'],
  ];
  RUD_PUSH_DEFAULTS = {
    enabled: false,
    reminderTime: '08:00',
    categories: {
      daily: true,
      quran: false,
      prayer: false,
      morning: true,
      evening: false,
      friday: true,
      continueQuran: false,
      newDua: false,
      newHadith: false,
      announcement: true,
    },
    dismissedPrompt: false,
    firstEnabledAt: 0,
  };
  // Expose the existing shared prayer state to the legacy Prayer controller without duplicating its implementation.
  window.rudResolvedPrayerSchedule = rudResolvedPrayerSchedule;
  window.rudCacheResolvedPrayerTimes = rudCacheResolvedPrayerTimes;
  window.RUD_PRAYER_RESOLVED_KEY = RUD_PRAYER_RESOLVED_KEY;
  rudMessagingLoadPromise = null;
  rudMessagingInstance = null;
  rudForegroundMessageBound = false;
  rudPushProfileSyncTimer = null;
  rudPrayerReminderClock = null;
  onLegacyWindowLoad(() => {
    rudScheduleFcmMaintenance();
    window.rudRefreshPrayerCacheIfStale?.();
    rudSyncPrayerReminderClock();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      window.rudRefreshPrayerCacheIfStale?.();
      rudSyncPrayerReminderClock();
      if (typeof rudSyncSmartHome === 'function') rudSyncSmartHome();
      if (typeof rudSyncFridayMode === 'function') rudSyncFridayMode();
    }
  });
}

export {
  rudEnableDeenReminders,
  rudPushCapability,
  RUD_PRAYER_KEYS,
  RUD_PUSH_PREF_KEY,
  rudBindReminderCenter,
  rudMirrorPushPrefsToIdb,
  rudPrayerClockText,
  rudPushPrefs,
  rudPushSenderEndpoint,
  rudQueuePushProfileSync,
  rudReminderCenterHtml,
  rudResolvedPrayerSchedule,
  rudSavePushPrefs,
  rudSyncPrayerReminderClock,
};
