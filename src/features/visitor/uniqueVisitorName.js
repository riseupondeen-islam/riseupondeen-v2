/**
 * Globally unique visitor-name reservation (Firestore transaction on visitor_usernames).
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { rudVisitorId } from '../analytics/visitorAnalytics';
import { firebaseInitPromise } from '../../services/firebase/firebaseInit';
import { doc, runTransaction, serverTimestamp, signInAnonymously } from '../../services/firebase/sdk';

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  (function () {
    const NAME_KEY = 'rud_visitor_name';
    const NAME_ID_KEY = 'rud_visitor_name_key';
    function normalizeName(value) {
      return String(value ?? '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50);
    }
    function nameKey(value) {
      return normalizeName(value)
        .toLocaleLowerCase()
        .replace(/[^a-z0-9\u0600-\u06FF _.-]/gi, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 80);
    }
    async function reserve(name) {
      const clean = normalizeName(name),
        key = nameKey(clean);
      if (clean.length < 2 || key.length < 2) throw new Error('invalid-name');
      await firebaseInitPromise;
      if (
        !S.firebaseReady ||
        !S.db ||
        !S.auth ||
        typeof runTransaction !== 'function' ||
        typeof signInAnonymously !== 'function'
      )
        throw new Error('username-verification-unavailable');
      if (!S.auth.currentUser) await signInAnonymously(S.auth);
      const uid = S.auth.currentUser?.uid;
      if (!uid) throw new Error('username-verification-unavailable');
      const visitorId =
        typeof rudVisitorId === 'function' ? rudVisitorId() : String(localStorage.getItem('rud_visitor_id') || '');
      if (!visitorId) throw new Error('visitor-id-unavailable');
      const ref = doc(S.db, 'visitor_usernames', key);
      await runTransaction(S.db, async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists()) {
          const data = snap.data() || {};
          if (String(data.visitorId || '') !== visitorId && String(data.ownerUid || '') !== uid) {
            const e = new Error('name-taken');
            e.code = 'name-taken';
            throw e;
          }
          tx.set(
            ref,
            { visitorId, ownerUid: uid, name: clean, nameKey: key, updatedAt: serverTimestamp() },
            { merge: true },
          );
          return;
        }
        tx.set(ref, {
          visitorId,
          ownerUid: uid,
          name: clean,
          nameKey: key,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      try {
        localStorage.setItem(NAME_ID_KEY, key);
      } catch {}
      return true;
    }
    window.RUD_reserveVisitorName = reserve;
    window.RUD_normalizeVisitorName = normalizeName;
  })();
}
