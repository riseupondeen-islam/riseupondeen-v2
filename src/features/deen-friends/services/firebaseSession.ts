/* Small helpers every Deen Friends service uses to reach Firebase safely.
 *
 * The app keeps one Firebase app (services/firebase/firebaseInit). Deen Friends only needs to wait
 * for it, and for the persisted Auth user to be restored, before reading or writing. */
import type { Firestore } from 'firebase/firestore';
import type { Auth, User } from 'firebase/auth';
import { S } from '../../../runtime/store';
import { firebaseInitPromise } from '../../../services/firebase/firebaseInit';
import { DeenFriendsError } from './errors';

export interface FirebaseHandles {
  db: Firestore;
  auth: Auth;
}

/** Resolves when Firebase has initialised (or failed to). Returns null when it is unavailable. */
export async function waitForFirebase(): Promise<FirebaseHandles | null> {
  try {
    await firebaseInitPromise;
  } catch {
    /* handled below */
  }
  if (!S.firebaseReady || !S.db || !S.auth) return null;
  try {
    await S.auth.authStateReady();
  } catch {
    /* older SDKs: currentUser is still usable */
  }
  return { db: S.db, auth: S.auth };
}

/** The signed-in (non-anonymous) Firebase user, or null. */
export function currentDeenUser(): User | null {
  const user = S.auth?.currentUser || null;
  return user && !user.isAnonymous ? user : null;
}

/** Firebase handles plus the signed-in user's uid. Throws a friendly error otherwise. */
export async function requireSignedIn(): Promise<FirebaseHandles & { uid: string }> {
  const handles = await waitForFirebase();
  if (!handles) throw new DeenFriendsError('offline', 'Deen Friends needs a connection right now. Please try again.');
  const user = currentDeenUser();
  if (!user) throw new DeenFriendsError('auth', 'Please sign in to Deen Friends again.');
  return { ...handles, uid: user.uid };
}
