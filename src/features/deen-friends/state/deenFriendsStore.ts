/* The live Deen Friends state shared by the page, the navbar badge and Tasbih hand-offs.
 *
 * Listener budget (each one started at most once per signed-in user, stopped on sign-out):
 *   always while signed in (needed for the navbar badge on every page):
 *     - my pending incoming requests      deens_friend_requests  where toUid == me, status == pending
 *     - my pending outgoing requests      deens_friend_requests  where fromUid == me, status == pending
 *     - records I received (unread count) deens_friend_messages  where recipientUid == me (newest 200)
 *     - my RISE thread summary            deens_rise_threads/{me}
 *   only after Deen Friends has been opened:
 *     - my friendships                    deens_friendships      where members array-contains me
 *     - my shared streaks                 deens_friend_streaks   where members array-contains me
 *     - my challenge streak (V3)          deens_streaks/{me}
 *     - my Deen circles (V3)              deens_groups           where members array-contains me
 * Friend profiles are read once and cached; they are refreshed when a chat or profile is opened. */
import { clearChallengeCache } from './challengeCache';
import { useSyncExternalStore } from 'react';
import { collection, limit, onAuthStateChanged, onSnapshot, query, where } from '../../../services/firebase/sdk';
import type { FriendRequest, Friendship, OwnProfile, PublicProfile, RiseThread, StreakRecord } from '../types';
import { loadOwnProfile, readCachedProfile, touchPresence } from '../services/accountService';
import { logError } from '../services/errors';
import { currentDeenUser, waitForFirebase } from '../services/firebaseSession';
import {
  loadPublicProfile,
  readFriendRequest,
  readFriendship,
  type RelationshipSnapshot,
} from '../services/friendService';
import { readStreak } from '../services/streakService';
import { listenToRiseThread } from '../services/riseChatService';
import { syncDeenPushDevice } from '../services/pushDeviceService';
import { listenToMyStreak, type StreakSummary } from '../services/progressService';
import { listenToMyGroups, type DeenGroup } from '../services/groupService';
import { syncPublicCard } from '../services/suggestionService';

export type SessionStatus = 'loading' | 'signed-out' | 'signed-in' | 'unavailable';

export interface DeenFriendsState {
  session: SessionStatus;
  profile: OwnProfile | null;
  friendships: Friendship[];
  friendshipsLoaded: boolean;
  profiles: Record<string, PublicProfile>;
  streaks: Record<string, StreakRecord>;
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  /** friendshipId -> number of records I received and have not seen yet. */
  unreadByFriendship: Record<string, number>;
  riseThread: RiseThread | null;
  /** V3: my challenge streak (deens_streaks/{me}). */
  myStreak: StreakSummary | null;
  /** V3: Deen circles I belong to. */
  groups: DeenGroup[];
  groupsLoaded: boolean;
}

const initialState: DeenFriendsState = {
  session: 'loading',
  profile: null,
  friendships: [],
  friendshipsLoaded: false,
  profiles: {},
  streaks: {},
  incoming: [],
  outgoing: [],
  unreadByFriendship: {},
  riseThread: null,
  myStreak: null,
  groups: [],
  groupsLoaded: false,
};

let state: DeenFriendsState = initialState;
const subscribers = new Set<() => void>();

function setState(patch: Partial<DeenFriendsState>): void {
  state = { ...state, ...patch };
  subscribers.forEach((notify) => notify());
  updateNavBadge();
}

export function getDeenFriendsState(): DeenFriendsState {
  return state;
}

export function subscribeDeenFriends(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

/** React hook: the whole (immutable) Deen Friends state. */
export function useDeenFriends(): DeenFriendsState {
  return useSyncExternalStore(subscribeDeenFriends, getDeenFriendsState, getDeenFriendsState);
}

export function relationshipSnapshot(s = state): RelationshipSnapshot {
  return { myUid: s.profile?.uid || '', friendships: s.friendships, incoming: s.incoming, outgoing: s.outgoing };
}

/* ---------- navbar badge (#rudDfNavBadge lives in the static header) ---------- */

export function totalUnread(s = state): number {
  const interactions = Object.values(s.unreadByFriendship).reduce((sum, n) => sum + n, 0);
  return s.incoming.length + interactions + (s.riseThread?.unreadByUser || 0);
}

function updateNavBadge(): void {
  const nav = document.getElementById('rudDeenFriendsNav');
  const badge = document.getElementById('rudDfNavBadge');
  if (!nav || !badge) return;
  const total = state.session === 'signed-in' ? totalUnread() : 0;
  const text = total > 99 ? '99+' : String(total);
  if (total) {
    if (badge.textContent !== text) badge.textContent = text;
    badge.hidden = false;
    nav.setAttribute('aria-label', `Deen Friends, ${text} new`);
  } else {
    badge.hidden = true;
    nav.setAttribute('aria-label', 'Deen Friends');
  }
}

/* ---------- listeners ---------- */

const badgeListeners: Array<() => void> = [];
const pageListeners: Array<() => void> = [];
let listenersUid = '';
let pageListenersStarted = false;

function stopListeners(): void {
  [...badgeListeners, ...pageListeners].forEach((stop) => {
    try {
      stop();
    } catch {
      /* already stopped */
    }
  });
  badgeListeners.length = 0;
  pageListeners.length = 0;
  pageListenersStarted = false;
  listenersUid = '';
}

async function startBadgeListeners(uid: string): Promise<void> {
  if (listenersUid === uid) return;
  stopListeners();
  listenersUid = uid;
  const handles = await waitForFirebase();
  if (!handles || listenersUid !== uid) return;
  const { db } = handles;
  const requests = collection(db, 'deens_friend_requests');

  badgeListeners.push(
    onSnapshot(
      query(requests, where('toUid', '==', uid), where('status', '==', 'pending'), limit(50)),
      (snap) => {
        const incoming = snap.docs.map((d) => readFriendRequest(d.id, d.data() as Record<string, unknown>));
        incoming.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setState({ incoming });
        void ensureProfiles(incoming.map((r) => r.fromUid));
      },
      (error) => logError('incoming requests listener', error),
    ),
    onSnapshot(
      query(requests, where('fromUid', '==', uid), where('status', '==', 'pending'), limit(50)),
      (snap) => {
        const outgoing = snap.docs.map((d) => readFriendRequest(d.id, d.data() as Record<string, unknown>));
        outgoing.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setState({ outgoing });
        void ensureProfiles(outgoing.map((r) => r.toUid));
      },
      (error) => logError('outgoing requests listener', error),
    ),
    onSnapshot(
      query(collection(db, 'deens_friend_messages'), where('recipientUid', '==', uid), limit(200)),
      (snap) => {
        const unread: Record<string, number> = {};
        for (const d of snap.docs) {
          const data = d.data() as Record<string, unknown>;
          if (data.readAtMs) continue;
          const fid = String(data.friendshipId || '');
          if (fid) unread[fid] = (unread[fid] || 0) + 1;
        }
        setState({ unreadByFriendship: unread });
      },
      (error) => logError('unread listener', error),
    ),
    listenToRiseThread(
      (riseThread) => setState({ riseThread }),
      (error) => logError('RISE thread listener', error),
    ),
  );
}

/** Friendships and streaks: started the first time the Deen Friends page needs them. */
export async function startPageListeners(): Promise<void> {
  const uid = state.profile?.uid;
  if (!uid || pageListenersStarted) return;
  pageListenersStarted = true;
  const handles = await waitForFirebase();
  if (!handles || state.profile?.uid !== uid) {
    pageListenersStarted = false;
    return;
  }
  const { db } = handles;
  pageListeners.push(
    onSnapshot(
      query(collection(db, 'deens_friendships'), where('members', 'array-contains', uid), limit(100)),
      (snap) => {
        const friendships = snap.docs
          .map((d) => readFriendship(d.id, d.data() as Record<string, unknown>, uid))
          .filter((f): f is Friendship => !!f);
        setState({ friendships, friendshipsLoaded: true });
        void ensureProfiles(friendships.map((f) => f.friendUid));
      },
      (error) => {
        logError('friendships listener', error);
        setState({ friendshipsLoaded: true });
      },
    ),
    onSnapshot(
      query(collection(db, 'deens_friend_streaks'), where('members', 'array-contains', uid), limit(100)),
      (snap) => {
        const streaks: Record<string, StreakRecord> = {};
        snap.docs.forEach((d) => (streaks[d.id] = readStreak(d.id, d.data() as Record<string, unknown>)));
        setState({ streaks });
      },
      (error) => logError('streaks listener', error),
    ),
    listenToMyStreak(
      (myStreak) => setState({ myStreak }),
      (error) => logError('my streak listener', error),
    ),
    listenToMyGroups(
      (groups) => setState({ groups, groupsLoaded: true }),
      (error) => {
        logError('groups listener', error);
        setState({ groupsLoaded: true });
      },
    ),
  );
  if (state.profile) {
    void touchPresence(state.profile);
    void syncPublicCard(state.profile).catch((error) => logError('public card sync', error));
  }
}

/* ---------- profiles of other people ---------- */

const profileRequests = new Map<string, Promise<void>>();

/** Loads any profiles not cached yet (one read each, de-duplicated). */
export async function ensureProfiles(uids: string[]): Promise<void> {
  const missing = [...new Set(uids)].filter((uid) => uid && !state.profiles[uid] && !profileRequests.has(uid));
  await Promise.all(missing.map((uid) => refreshProfile(uid)));
}

/** Re-reads one profile (e.g. to update "last seen" when a chat opens). */
export function refreshProfile(uid: string): Promise<void> {
  const inFlight = profileRequests.get(uid);
  if (inFlight) return inFlight;
  const request = loadPublicProfile(uid)
    .then((profile) => {
      if (profile) setState({ profiles: { ...state.profiles, [uid]: profile } });
    })
    .catch((error) => logError('profile read', error))
    .finally(() => profileRequests.delete(uid));
  profileRequests.set(uid, request);
  return request;
}

/* ---------- session ---------- */

export function setSignedIn(profile: OwnProfile): void {
  setState({ session: 'signed-in', profile });
  void startBadgeListeners(profile.uid);
  // Link this device's existing push token to the user (no write when nothing changed).
  void syncDeenPushDevice().catch((error) => logError('push device sync', error));
}

export function updateOwnProfile(profile: OwnProfile): void {
  setState({ profile });
}

export function setSignedOut(): void {
  stopListeners();
  clearChallengeCache();
  profileRequests.clear();
  state = { ...initialState, session: 'signed-out' };
  subscribers.forEach((notify) => notify());
  updateNavBadge();
}

let sessionStarted = false;

/**
 * Restores the Deen Friends session once per page load: opens instantly from the cached profile, then
 * re-validates it against Firestore. A network failure never signs anyone out; only a definite
 * "profile missing or disabled" answer does.
 */
export async function startSession(): Promise<void> {
  if (sessionStarted) return;
  sessionStarted = true;
  const handles = await waitForFirebase();
  if (!handles) {
    setState({ session: 'unavailable' });
    return;
  }
  onAuthStateChanged(handles.auth, (user) => {
    if (!user || user.isAnonymous) {
      if (state.session === 'signed-in') setSignedOut();
      else if (state.session === 'loading') setState({ session: 'signed-out' });
    } else if (state.profile && state.profile.uid !== user.uid) {
      setSignedOut();
      void restoreFor(user.uid);
    }
  });
  const user = currentDeenUser();
  if (!user) {
    setState({ session: 'signed-out' });
    return;
  }
  await restoreFor(user.uid);
}

async function restoreFor(uid: string): Promise<void> {
  const cached = readCachedProfile(uid);
  if (cached) setSignedIn(cached);
  const lookup = await loadOwnProfile(uid);
  if (lookup.kind === 'found') setSignedIn(lookup.profile);
  else if (lookup.kind === 'missing') setSignedOut();
  else if (!cached) setState({ session: 'unavailable' });
}
