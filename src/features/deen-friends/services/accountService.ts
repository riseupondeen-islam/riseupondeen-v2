/* Deen Friends accounts: sign in, create account, load/save the profile, password and username
 * requests, sign out.
 *
 * Data model (unchanged from V1):
 *   deens_users/{uid}            — the profile (readable by signed-in users, written by the owner)
 *   visitor_usernames/{nameKey}  — reserves a unique username for its owner
 */
import {
  addDoc,
  collection,
  createUserWithEmailAndPassword,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  sendPasswordResetEmail,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  where,
} from '../../../services/firebase/sdk';
import { rudVisitorId } from '../../analytics/visitorAnalytics';
import type { OwnProfile, PrivacySettings } from '../types';
import { DeenFriendsError, classifyError, logError } from './errors';
import { asAvatar, cleanText, readPublicProfile, usernameKey } from './format';
import { currentDeenUser, requireSignedIn, waitForFirebase } from './firebaseSession';
import { removeDeenPushDevice } from './pushDeviceService';

/** localStorage key of the cached profile (same key as V1, so existing sessions open instantly). */
const PROFILE_CACHE_KEY = 'rud_deen_friend_profile_v2_clean';

/* ---------- profile cache (instant open; always re-validated against Firestore) ---------- */

export function readCachedProfile(uid: string): OwnProfile | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null') as Record<string, unknown> | null;
    if (!raw || String(raw.uid || '') !== uid) return null;
    const profile = toOwnProfile(uid, { ...raw, displayName: raw.displayName || raw.name }, String(raw.email || ''));
    return profile.username ? profile : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: OwnProfile | null): void {
  try {
    if (!profile) {
      localStorage.removeItem(PROFILE_CACHE_KEY);
      sessionStorage.removeItem(PROFILE_CACHE_KEY);
      return;
    }
    // `name` is kept for the V1 reader and the visitor-name feature.
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ ...profile, name: profile.displayName }));
    localStorage.setItem('rud_visitor_name', profile.displayName);
  } catch {
    /* storage blocked: the app still works, it just won't open instantly next time */
  }
}

function toOwnProfile(uid: string, data: Record<string, unknown>, email: string): OwnProfile {
  return {
    ...readPublicProfile(uid, data),
    email,
    visitorId: String(data.visitorId || ''),
  };
}

/* ---------- loading ---------- */

export type ProfileLookup = { kind: 'found'; profile: OwnProfile } | { kind: 'missing' } | { kind: 'failed' };

/** Reads deens_users/{uid}. "missing" means the account has no (or a disabled) Deen profile. */
export async function loadOwnProfile(uid: string): Promise<ProfileLookup> {
  const handles = await waitForFirebase();
  if (!handles) return { kind: 'failed' };
  try {
    const snap = await getDoc(doc(handles.db, 'deens_users', uid));
    if (!snap.exists()) return { kind: 'missing' };
    const data = (snap.data() || {}) as Record<string, unknown>;
    if (data.deenFriendsAccessDisabled === true) return { kind: 'missing' };
    const profile = toOwnProfile(uid, data, String(currentDeenUser()?.email || data.email || ''));
    if (!profile.username) return { kind: 'missing' };
    writeCachedProfile(profile);
    return { kind: 'found', profile };
  } catch (error) {
    logError('profile lookup failed', error);
    return { kind: 'failed' };
  }
}

/* ---------- sign in / create account ---------- */

function authErrorMessage(error: unknown, fallback: string): string {
  const code = String((error as { code?: string })?.code || '');
  if (/invalid-credential|wrong-password|user-not-found|invalid-login-credentials/.test(code))
    return 'The email or password is incorrect.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait a moment and try again.';
  if (code.includes('user-disabled')) return 'This account has been disabled. Contact RISE for help.';
  if (code.includes('email-already-in-use')) return 'This email is already registered. Use Sign in instead.';
  if (code.includes('weak-password')) return 'Password must be at least 8 characters.';
  if (code.includes('invalid-email')) return 'Please enter a valid email address.';
  if (code.includes('network-request-failed')) return 'You seem to be offline. Please check your connection.';
  return fallback;
}

export async function signInToDeenFriends(email: string, password: string): Promise<OwnProfile> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) throw new DeenFriendsError('invalid', 'Enter your email and password.');
  const handles = await waitForFirebase();
  if (!handles) throw new DeenFriendsError('offline', 'Secure sign-in is unavailable right now. Please try again.');
  let uid = '';
  try {
    const credential = await signInWithEmailAndPassword(handles.auth, cleanEmail, password);
    uid = credential.user.uid;
  } catch (error) {
    throw new DeenFriendsError('auth', authErrorMessage(error, 'Sign in failed. Please check your details.'));
  }
  const lookup = await loadOwnProfile(uid);
  if (lookup.kind === 'found') return lookup.profile;
  if (lookup.kind === 'missing') {
    await signOut(handles.auth).catch(() => undefined);
    throw new DeenFriendsError(
      'not-found',
      'This account has no Deen Friends profile yet. Choose “Create account” to set one up.',
    );
  }
  throw new DeenFriendsError('offline', 'Signed in, but your profile could not be loaded. Please try again.');
}

export interface NewAccountInput {
  displayName: string;
  username: string;
  email: string;
  password: string;
}

export function validateNewAccount(input: NewAccountInput): string | null {
  if (cleanText(input.displayName, 40).length < 2) return 'Please enter your name (at least 2 characters).';
  const key = usernameKey(input.username);
  if (key.length < 3) return 'Choose a username with at least 3 letters or numbers.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return 'Please enter a valid email address.';
  if (input.password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

/**
 * Creates the Firebase Auth user, then — in one transaction — reserves the username and writes the
 * profile. If the profile cannot be written, the new Auth user is deleted so no half-created account
 * is left behind.
 */
export async function createDeenAccount(input: NewAccountInput): Promise<OwnProfile> {
  const problem = validateNewAccount(input);
  if (problem) throw new DeenFriendsError('invalid', problem);
  const displayName = cleanText(input.displayName, 40);
  const username = cleanText(input.username, 30).replace(/^@+/, '');
  const email = input.email.trim().toLowerCase();
  const visitorId = String(rudVisitorId() || '').slice(0, 120);
  if (!visitorId) throw new DeenFriendsError('invalid', 'Could not create a visitor identity. Please reload.');

  const handles = await waitForFirebase();
  if (!handles) throw new DeenFriendsError('offline', 'Secure account creation is unavailable right now.');
  const { auth } = handles;
  if (auth.currentUser?.isAnonymous) await signOut(auth).catch(() => undefined);
  if (auth.currentUser && !auth.currentUser.isAnonymous)
    throw new DeenFriendsError('invalid', 'You are already signed in. Sign out before creating another account.');

  let credentialUid = '';
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, input.password);
    credentialUid = credential.user.uid;
  } catch (error) {
    throw new DeenFriendsError('auth', authErrorMessage(error, 'Could not create your secure account.'));
  }

  try {
    return await writeNewProfile(credentialUid, { displayName, username, email, visitorId });
  } catch (error) {
    // Roll back the Auth user so the email can be used again.
    try {
      if (auth.currentUser?.uid === credentialUid) await auth.currentUser.delete();
    } catch {
      /* best effort */
    }
    throw error;
  }
}

/**
 * Reserves the username and writes deens_users/{uid} in one transaction. The username is re-checked
 * inside the transaction, so two people can never claim the same name at the same moment.
 */
async function writeNewProfile(
  uid: string,
  input: { displayName: string; username: string; email: string; visitorId: string },
): Promise<OwnProfile> {
  const { db } = await requireSignedIn();
  const key = usernameKey(input.username);
  const profileRef = doc(db, 'deens_users', uid);
  const usernameRef = doc(db, 'visitor_usernames', key);
  try {
    await runTransaction(db, async (tx) => {
      const reserved = await tx.get(usernameRef);
      if (reserved.exists() && String(reserved.data()?.ownerUid || '') !== uid)
        throw new DeenFriendsError('invalid', 'That username is already taken. Please choose another.');
      tx.set(usernameRef, {
        visitorId: input.visitorId,
        ownerUid: uid,
        name: input.username,
        nameKey: key,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      tx.set(profileRef, {
        uid,
        visitorId: input.visitorId,
        username: input.username,
        usernameKey: key,
        displayName: input.displayName,
        email: input.email,
        authProvider: 'password',
        passwordEnabled: true,
        avatar: 'crescent',
        bio: '',
        deenFocus: '',
        currentFocus: '',
        favoriteSurah: '',
        languages: '',
        field: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastActiveAt: Date.now(),
      });
    });
  } catch (error) {
    if (error instanceof DeenFriendsError) throw error;
    logError('profile creation failed', error);
    throw new DeenFriendsError(classifyError(error), 'Your Deen profile could not be created. Please try again.');
  }
  const profile: OwnProfile = {
    ...readPublicProfile(uid, {
      username: input.username,
      usernameKey: key,
      displayName: input.displayName,
      lastActiveAt: Date.now(),
    }),
    email: input.email,
    visitorId: input.visitorId,
  };
  writeCachedProfile(profile);
  return profile;
}

/** For an account that is signed in but has no Deen profile yet (e.g. created elsewhere). */
export async function createProfileForCurrentUser(input: {
  displayName: string;
  username: string;
}): Promise<OwnProfile> {
  const displayName = cleanText(input.displayName, 40);
  const username = cleanText(input.username, 30).replace(/^@+/, '');
  if (displayName.length < 2) throw new DeenFriendsError('invalid', 'Please enter your name (at least 2 characters).');
  if (usernameKey(username).length < 3)
    throw new DeenFriendsError('invalid', 'Choose a username with at least 3 letters or numbers.');
  const user = currentDeenUser();
  if (!user) throw new DeenFriendsError('auth', 'Please sign in again.');
  const visitorId = String(rudVisitorId() || '').slice(0, 120);
  return writeNewProfile(user.uid, { displayName, username, email: String(user.email || ''), visitorId });
}

export async function sendDeenPasswordReset(email: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!clean) throw new DeenFriendsError('invalid', 'Enter your email address first.');
  const handles = await waitForFirebase();
  if (!handles) throw new DeenFriendsError('offline', 'Password reset is unavailable right now.');
  try {
    await sendPasswordResetEmail(handles.auth, clean);
  } catch (error) {
    throw new DeenFriendsError('auth', authErrorMessage(error, 'Could not send the reset email.'));
  }
}

export async function changeOwnPassword(newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new DeenFriendsError('invalid', 'Password must be at least 8 characters.');
  const { db, uid } = await requireSignedIn();
  const user = currentDeenUser();
  if (!user) throw new DeenFriendsError('auth', 'Please sign in again.');
  try {
    await updatePassword(user, newPassword);
  } catch (error) {
    const code = String((error as { code?: string })?.code || '');
    if (code.includes('requires-recent-login'))
      throw new DeenFriendsError(
        'auth',
        'For your security, sign out and sign in again before changing your password.',
      );
    throw new DeenFriendsError('auth', authErrorMessage(error, 'Could not update your password.'));
  }
  await setDoc(
    doc(db, 'deens_users', uid),
    {
      passwordUpdatedAt: serverTimestamp(),
      passwordEnabled: true,
      updatedAt: serverTimestamp(),
      lastActiveAt: Date.now(),
    },
    { merge: true },
  );
}

export async function signOutOfDeenFriends(): Promise<void> {
  // Unlink this device from the user's notifications while still signed in (the rules require it).
  await removeDeenPushDevice();
  writeCachedProfile(null);
  const handles = await waitForFirebase();
  if (handles) await signOut(handles.auth);
}

/* ---------- editing ---------- */

export interface ProfileEdits {
  displayName: string;
  avatar: string;
  bio: string;
  deenFocus: string;
  currentFocus: string;
  favoriteSurah: string;
  languages: string;
  field: string;
  privacy: PrivacySettings;
}

/** Saves the editable profile fields. Username and usernameKey are never changed here. */
export async function saveOwnProfile(current: OwnProfile, edits: ProfileEdits): Promise<OwnProfile> {
  const displayName = cleanText(edits.displayName, 40);
  if (displayName.length < 2) throw new DeenFriendsError('invalid', 'Please enter a display name.');
  const { db, uid } = await requireSignedIn();
  if (uid !== current.uid) throw new DeenFriendsError('auth', 'Your session changed. Please sign in again.');
  const next: OwnProfile = {
    ...current,
    displayName,
    avatar: asAvatar(edits.avatar),
    bio: cleanText(edits.bio, 180),
    deenFocus: cleanText(edits.deenFocus, 120),
    currentFocus: cleanText(edits.currentFocus, 120),
    favoriteSurah: cleanText(edits.favoriteSurah, 60),
    languages: cleanText(edits.languages, 80),
    field: cleanText(edits.field, 80),
    privacy: { ...edits.privacy },
    visitorId: current.visitorId || String(rudVisitorId() || '').slice(0, 120),
  };
  // The update rule requires uid, username, displayName, visitorId (unchanged), updatedAt and lastActiveAt.
  await setDoc(
    doc(db, 'deens_users', uid),
    {
      uid,
      visitorId: next.visitorId,
      username: next.username,
      usernameKey: next.usernameKey,
      displayName: next.displayName,
      avatar: next.avatar,
      bio: next.bio,
      deenFocus: next.deenFocus,
      currentFocus: next.currentFocus,
      favoriteSurah: next.favoriteSurah,
      languages: next.languages,
      field: next.field,
      privacy: next.privacy,
      updatedAt: serverTimestamp(),
      lastActiveAt: Date.now(),
    },
    { merge: true },
  );
  writeCachedProfile(next);
  return next;
}

let lastPresenceWrite = 0;
/** Activity heartbeat ("online" / "last seen"). At most one write every 2 minutes. */
export async function touchPresence(profile: OwnProfile): Promise<void> {
  if (Date.now() - lastPresenceWrite < 120000) return;
  lastPresenceWrite = Date.now();
  try {
    const { db, uid } = await requireSignedIn();
    if (uid !== profile.uid) return;
    await setDoc(
      doc(db, 'deens_users', uid),
      {
        uid,
        visitorId: profile.visitorId || String(rudVisitorId() || '').slice(0, 120),
        username: profile.username,
        usernameKey: profile.usernameKey,
        displayName: profile.displayName,
        lastActiveAt: Date.now(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    logError('presence update skipped', error);
  }
}

export async function requestUsernameChange(profile: OwnProfile, requested: string, reason: string): Promise<void> {
  const wanted = requested.trim().replace(/^@+/, '').toLowerCase();
  const why = cleanText(reason, 240);
  if (!/^[a-z0-9_]{3,24}$/.test(wanted))
    throw new DeenFriendsError('invalid', 'Use 3–24 letters, numbers or underscores.');
  if (wanted === profile.username.toLowerCase()) throw new DeenFriendsError('invalid', 'Enter a different username.');
  if (!why) throw new DeenFriendsError('invalid', 'Please add a short reason.');
  const { db, uid } = await requireSignedIn();
  const pendingRequests = await getDocs(
    query(
      collection(db, 'deens_username_change_requests'),
      where('uid', '==', uid),
      where('status', '==', 'pending'),
      limit(1),
    ),
  );
  if (!pendingRequests.empty) throw new DeenFriendsError('invalid', 'You already have a pending username request.');
  await addDoc(collection(db, 'deens_username_change_requests'), {
    uid,
    displayName: profile.displayName.slice(0, 40),
    currentUsername: profile.username,
    requestedUsername: wanted,
    reason: why,
    status: 'pending',
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
}

/** Same public helper V1 exported (the admin console's "Send password reset" uses it). */
export async function rudDfPasswordReset(email: string): Promise<void> {
  await sendDeenPasswordReset(email);
}
