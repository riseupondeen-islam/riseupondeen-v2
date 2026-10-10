/**
 * Firebase initialisation (one app, durable Auth persistence, Firestore with long-polling auto-detect, Storage) and post-init start-up.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { rudIsAdminRoute } from '../../app/routing/routeState';
import { rudAttachAuthListener } from './authListener';
import { rudEnsureInstalledState, rudInitVisitorAnalytics } from '../../features/analytics/visitorAnalytics';
import { rudStartBroadcastListener } from '../../features/broadcast/broadcast';
import { startMaintenanceLive } from '../../features/maintenance/maintenance';
import { startPublic } from '../content/publicContentSync';
import { ADMIN_EMAIL, firebaseConfig } from './config';
import {
  browserLocalPersistence,
  firebaseSdkPromise,
  getAuth,
  getFirestore,
  getStorage,
  indexedDBLocalPersistence,
  initializeApp,
  initializeAuth,
  initializeFirestore,
} from './sdk';

/** Resolves once Firebase has initialised (true) or failed to (false/undefined). @type {Promise<boolean | undefined>} */
let firebaseInitPromise;

function configured() {
  return (
    Object.values(firebaseConfig).every(
      (v) => typeof v === 'string' && v.trim() && !v.includes('YOUR_') && !v.includes('YOUR_PROJECT'),
    ) &&
    ADMIN_EMAIL &&
    !ADMIN_EMAIL.includes('YOUR_ADMIN_EMAIL')
  );
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  firebaseInitPromise = Promise.resolve(false);
  if (configured()) {
    firebaseInitPromise = firebaseSdkPromise.then((ok) => {
      if (!ok || S.firebaseReady) return;

      try {
        S.app = initializeApp(firebaseConfig);
        /* Keep the same Firebase Auth identity across browser reloads and iOS Home Screen launches. */
        try {
          S.auth = initializeAuth(S.app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
        } catch (authInitError) {
          console.warn('[Rise Upon Deen] Durable Auth initialization fallback:', authInitError);
          S.auth = getAuth(S.app);
        }
        /* Auto-detect long polling so Firestore listeners/writes also work on mobile networks
         and WebKit where the default WebChannel stream is blocked; still one db instance. */
        try {
          S.db = initializeFirestore(S.app, { experimentalAutoDetectLongPolling: true });
        } catch (dbInitError) {
          console.warn('[Rise Upon Deen] Firestore long-polling detection unavailable:', dbInitError);
          S.db = getFirestore(S.app);
        }
        S.storage = getStorage(S.app);
        S.firebaseReady = true;

        try {
          rudAttachAuthListener();
        } catch (e) {
          console.warn('Auth listener start deferred.', e);
        }

        try {
          const note = document.getElementById('firebaseConfigNote');
          if (note) note.hidden = true;
        } catch {}

        /* Public realtime/content services stay out of the Admin route. */
        if (!rudIsAdminRoute()) {
          try {
            startPublic();
          } catch (e) {
            console.warn('Public live sync start deferred.', e);
          }
          try {
            startMaintenanceLive();
          } catch (e) {
            console.warn('Maintenance live sync start deferred.', e);
          }
          setTimeout(() => {
            try {
              rudStartBroadcastListener();
            } catch {}
          }, 500);
          try {
            rudEnsureInstalledState();
            rudInitVisitorAnalytics();
          } catch (e) {
            console.warn('Visitor analytics initial start deferred.', e);
          }
        }
      } catch (e) {
        console.error('Firebase initialization failed', e);
        return false;
      }
      return true;
    });
  }
}

export { configured, firebaseInitPromise };
