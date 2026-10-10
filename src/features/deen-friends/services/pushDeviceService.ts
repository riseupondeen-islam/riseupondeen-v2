/* Links this device's push registration to the signed-in Deen Friends user.
 *
 * The app already has one FCM token per device (features/notifications/pushNotifications.js, stored
 * per visitor in push_subscriptions for reminders). Deen Friends notifications are personal, so the
 * same token is also recorded under the user's UID:
 *
 *   deens_push_devices/{uid}/devices/{deviceId = visitorId}
 *     { uid, deviceId, fcmToken, platform, categories, active, updatedAt, updatedAtMs }
 *
 * Only the owner can write it (firestore.rules). The trusted scheduler (push-scheduler/, Admin SDK)
 * reads it to send friend-request, message, RISE and challenge notifications. Nothing here sends a
 * notification. The record is removed on sign-out and when notifications are turned off. */
import { deleteDoc, doc, serverTimestamp, setDoc } from '../../../services/firebase/sdk';
import { rudVisitorId } from '../../analytics/visitorAnalytics';
import { logError } from './errors';
import { requireSignedIn } from './firebaseSession';

export interface DeenPushCategories {
  friendRequests: boolean;
  friendActivity: boolean;
  rise: boolean;
  challenges: boolean;
}

export const DEEN_PUSH_CATEGORY_LABELS: Array<[keyof DeenPushCategories, string, string]> = [
  ['friendRequests', 'Friend requests', 'When someone asks to connect, or accepts your request'],
  ['friendActivity', 'Friend activity', 'Challenges, check-ins, encouragement and shared reminders'],
  ['rise', 'Replies from RISE', 'When the RiseUponDeen team answers you'],
  ['challenges', 'Daily Deen Challenges', 'When RISE assigns you a new challenge'],
];

const CATEGORY_KEY = 'rud_df_push_categories_v1';
const TOKEN_KEY = 'rud_fcm_token_v2'; // written by pushNotifications.js
const SYNC_KEY = 'rud_df_push_sync_v1';

export function readDeenPushCategories(): DeenPushCategories {
  try {
    const saved = JSON.parse(localStorage.getItem(CATEGORY_KEY) || 'null') as Partial<DeenPushCategories> | null;
    return { friendRequests: true, friendActivity: true, rise: true, challenges: true, ...(saved || {}) };
  } catch {
    return { friendRequests: true, friendActivity: true, rise: true, challenges: true };
  }
}

export function saveDeenPushCategories(categories: DeenPushCategories): void {
  try {
    localStorage.setItem(CATEGORY_KEY, JSON.stringify(categories));
  } catch {
    /* preferences then apply for this visit only */
  }
}

function localToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function platform(): string {
  const standalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const ios =
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  if (standalone) return ios ? 'ios-home-screen' : android ? 'android-pwa' : 'installed-pwa';
  return ios ? 'ios-browser' : android ? 'android-browser' : 'desktop-browser';
}

/**
 * Records (or refreshes) this device for the signed-in user when the browser already has a push
 * token. Skips the write when nothing changed since the last sync on this device.
 */
export async function syncDeenPushDevice(): Promise<'synced' | 'unchanged' | 'no-token'> {
  const token = localToken();
  if (!token || typeof Notification === 'undefined' || Notification.permission !== 'granted') return 'no-token';
  const { db, uid } = await requireSignedIn();
  const deviceId = String(rudVisitorId() || '').slice(0, 120);
  if (!deviceId) return 'no-token';
  const categories = readDeenPushCategories();
  const signature = JSON.stringify({ uid, deviceId, token, categories });
  try {
    if (localStorage.getItem(SYNC_KEY) === signature) return 'unchanged';
  } catch {
    /* continue */
  }
  await setDoc(doc(db, 'deens_push_devices', uid, 'devices', deviceId), {
    uid,
    deviceId,
    fcmToken: token,
    platform: platform(),
    categories,
    active: true,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  });
  try {
    localStorage.setItem(SYNC_KEY, signature);
  } catch {
    /* next sync simply writes again */
  }
  return 'synced';
}

/** Removes this device from the signed-in user's notification devices (sign-out, notifications off). */
export async function removeDeenPushDevice(): Promise<void> {
  try {
    localStorage.removeItem(SYNC_KEY);
  } catch {
    /* ignore */
  }
  try {
    const { db, uid } = await requireSignedIn();
    const deviceId = String(rudVisitorId() || '').slice(0, 120);
    if (deviceId) await deleteDoc(doc(db, 'deens_push_devices', uid, 'devices', deviceId));
  } catch (error) {
    logError('push device removal skipped', error);
  }
}

/** Keeps the device record in step with the app-wide push token (enabled, refreshed or removed). */
export function watchPushTokenChanges(isSignedIn: () => boolean): void {
  window.addEventListener('rud-push-token-changed', (event) => {
    if (!isSignedIn()) return;
    const token = (event as CustomEvent<{ token: string }>).detail?.token || '';
    void (token ? syncDeenPushDevice() : removeDeenPushDevice()).catch((error) => logError('push device sync', error));
  });
}
