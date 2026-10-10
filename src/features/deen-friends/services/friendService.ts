/* Finding people, friend requests and friendships.
 *
 *   deens_friend_requests/{requestId}   { fromUid, toUid, status, createdAt, createdAtMs, updatedAt }
 *   deens_friendships/{uidA_uidB}       { members:[uidA,uidB] (sorted), createdAt, updatedAt, streakCount }
 *   deens_friend_streaks/{uidA_uidB}    { members, count, lastBothDate, checkins, bothDates, updatedAt }
 *
 * ROOT CAUSE OF THE V1 "ADD FRIEND" FAILURE
 * V1 checked a relationship by reading deens_friendships/{pair} and deens_friend_requests/{pair}
 * directly. When such a document does not exist yet (always true for two people who have never
 * connected), the read rules dereference `resource.data`, which is null, so Firestore denies the
 * read. For every normal user the search card therefore showed "Unavailable" and the request was
 * never sent; only the super-admin account (which has a blanket override) could add friends.
 *
 * V2 never reads a document that might not exist. Relationship state comes from the live,
 * rule-provable queries in the Deen Friends store (my friendships, my incoming and my outgoing
 * requests), plus one fresh query in each direction just before sending, so duplicates are blocked
 * even if a listener is a moment behind.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '../../../services/firebase/sdk';
import type { FriendRequest, Friendship, PublicProfile } from '../types';
import { DeenFriendsError } from './errors';
import { friendshipIdFor, randomId, readPublicProfile, toMillis, usernameKey } from './format';
import { requireSignedIn } from './firebaseSession';

export function readFriendRequest(id: string, data: Record<string, unknown>): FriendRequest {
  return {
    id,
    fromUid: String(data.fromUid || ''),
    toUid: String(data.toUid || ''),
    status: (String(data.status || 'pending') as FriendRequest['status']) || 'pending',
    createdAtMs: Number(data.createdAtMs) || toMillis(data.createdAt),
  };
}

export function readFriendship(id: string, data: Record<string, unknown>, myUid: string): Friendship | null {
  const members = Array.isArray(data.members) ? data.members.map(String) : [];
  const friendUid = members.find((uid) => uid !== myUid);
  if (!friendUid || !members.includes(myUid)) return null;
  return {
    id,
    members,
    friendUid,
    streakCount: Number(data.streakCount) || 0,
    createdAtMs: toMillis(data.createdAt),
  };
}

/** Looks up one profile by exact username (the existing discovery method — no public directory). */
export async function findProfileByUsername(username: string): Promise<PublicProfile | null> {
  const key = usernameKey(username);
  if (key.length < 3) throw new DeenFriendsError('invalid', 'Enter a username with at least 3 characters.');
  const { db } = await requireSignedIn();
  const snap = await getDocs(query(collection(db, 'deens_users'), where('usernameKey', '==', key), limit(1)));
  if (snap.empty) return null;
  const found = snap.docs[0];
  const data = (found.data() || {}) as Record<string, unknown>;
  if (data.deenFriendsAccessDisabled === true) return null;
  return readPublicProfile(found.id, data);
}

/** Reads one public profile (friends list, requests, visiting cards). */
export async function loadPublicProfile(uid: string): Promise<PublicProfile | null> {
  const { db } = await requireSignedIn();
  const snap = await getDoc(doc(db, 'deens_users', uid));
  return snap.exists() ? readPublicProfile(uid, (snap.data() || {}) as Record<string, unknown>) : null;
}

export type ConnectionStatus = 'self' | 'friends' | 'outgoing' | 'incoming' | 'none';

export interface RelationshipSnapshot {
  myUid: string;
  friendships: Friendship[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

/** Relationship with `otherUid`, computed from live data (no extra reads). */
export function connectionStatus(otherUid: string, rel: RelationshipSnapshot): ConnectionStatus {
  if (!otherUid || otherUid === rel.myUid) return 'self';
  if (rel.friendships.some((f) => f.friendUid === otherUid)) return 'friends';
  if (rel.incoming.some((r) => r.fromUid === otherUid && r.status === 'pending')) return 'incoming';
  if (rel.outgoing.some((r) => r.toUid === otherUid && r.status === 'pending')) return 'outgoing';
  return 'none';
}

/** Pending requests between me and them, in both directions (fresh from the server). */
async function pendingBetween(
  myUid: string,
  otherUid: string,
): Promise<{ mine: FriendRequest[]; theirs: FriendRequest[] }> {
  const { db } = await requireSignedIn();
  const requests = collection(db, 'deens_friend_requests');
  const [mine, theirs] = await Promise.all([
    getDocs(
      query(
        requests,
        where('fromUid', '==', myUid),
        where('toUid', '==', otherUid),
        where('status', '==', 'pending'),
        limit(5),
      ),
    ),
    getDocs(
      query(
        requests,
        where('fromUid', '==', otherUid),
        where('toUid', '==', myUid),
        where('status', '==', 'pending'),
        limit(5),
      ),
    ),
  ]);
  return {
    mine: mine.docs.map((d) => readFriendRequest(d.id, d.data() as Record<string, unknown>)),
    theirs: theirs.docs.map((d) => readFriendRequest(d.id, d.data() as Record<string, unknown>)),
  };
}

export type SendRequestResult = 'sent' | 'already-sent' | 'accepted-theirs' | 'already-friends';

/**
 * Sends a friend request to `target` (identified by UID — never by display name).
 * If they already asked me, their request is accepted instead of creating a second one.
 */
export async function sendFriendRequest(target: PublicProfile, rel: RelationshipSnapshot): Promise<SendRequestResult> {
  const { db, uid } = await requireSignedIn();
  if (target.uid === uid) throw new DeenFriendsError('invalid', 'That is your own profile.');
  if (connectionStatus(target.uid, rel) === 'friends') return 'already-friends';

  const pending = await pendingBetween(uid, target.uid);
  if (pending.theirs.length) {
    await acceptFriendRequest(pending.theirs[0], rel);
    return 'accepted-theirs';
  }
  if (pending.mine.length) return 'already-sent';

  // A fresh id per request: V1 reused the pair id, which collided with old accepted/declined requests.
  const requestId = `${friendshipIdFor(uid, target.uid)}_${Date.now().toString(36)}${randomId(4)}`;
  await setDoc(doc(db, 'deens_friend_requests', requestId), {
    fromUid: uid,
    toUid: target.uid,
    status: 'pending',
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
  return 'sent';
}

/**
 * Accepts an incoming request: marks it accepted, creates the friendship, then the shared streak.
 * (The streak rule checks the friendship exists, which a single batch cannot see, so it is a second write.)
 */
export async function acceptFriendRequest(request: FriendRequest, rel: RelationshipSnapshot): Promise<void> {
  const { db, uid } = await requireSignedIn();
  if (request.toUid !== uid)
    throw new DeenFriendsError('permission', 'Only the person who received this request can accept it.');
  const requestRef = doc(db, 'deens_friend_requests', request.id);

  const fresh = await getDoc(requestRef);
  if (!fresh.exists()) throw new DeenFriendsError('not-found', 'This friend request is no longer available.');
  const current = readFriendRequest(fresh.id, fresh.data() as Record<string, unknown>);
  if (current.status !== 'pending') throw new DeenFriendsError('invalid', 'This friend request was already answered.');

  const friendshipId = friendshipIdFor(uid, request.fromUid);
  const members = [uid, request.fromUid].sort();
  const alreadyFriends = rel.friendships.some((f) => f.id === friendshipId);

  const batch = writeBatch(db);
  batch.update(requestRef, { status: 'accepted', updatedAt: serverTimestamp(), updatedAtMs: Date.now() });
  if (!alreadyFriends) {
    batch.set(doc(db, 'deens_friendships', friendshipId), {
      members,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      streakCount: 0,
    });
  }
  await batch.commit();

  await setDoc(
    doc(db, 'deens_friend_streaks', friendshipId),
    { members, count: 0, lastBothDate: '', checkins: {}, bothDates: [], updatedAt: serverTimestamp() },
    { merge: true },
  );

  // If I had also sent them a request, close it so it does not linger as "pending".
  const mineToThem = rel.outgoing.filter((r) => r.toUid === request.fromUid && r.status === 'pending');
  await Promise.all(mineToThem.map((r) => cancelFriendRequest(r).catch(() => undefined)));
}

export async function declineFriendRequest(request: FriendRequest): Promise<void> {
  const { db, uid } = await requireSignedIn();
  if (request.toUid !== uid)
    throw new DeenFriendsError('permission', 'Only the person who received this request can decline it.');
  // V1 wrote status "rejected", which the rules do not allow, so declining always failed.
  await updateDoc(doc(db, 'deens_friend_requests', request.id), {
    status: 'declined',
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  });
}

export async function cancelFriendRequest(request: FriendRequest): Promise<void> {
  const { db, uid } = await requireSignedIn();
  if (request.fromUid !== uid) throw new DeenFriendsError('permission', 'Only the sender can cancel this request.');
  await updateDoc(doc(db, 'deens_friend_requests', request.id), {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  });
}

/** Ends a friendship for both people (removes the friendship and the shared streak). */
export async function removeFriend(friendship: Friendship): Promise<void> {
  const { db, uid } = await requireSignedIn();
  const friendshipRef = doc(db, 'deens_friendships', friendship.id);
  const streakRef = doc(db, 'deens_friend_streaks', friendship.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(friendshipRef);
    if (!snap.exists()) throw new DeenFriendsError('not-found', 'This friendship no longer exists.');
    const members = Array.isArray(snap.data()?.members) ? (snap.data()?.members as unknown[]).map(String) : [];
    if (!members.includes(uid)) throw new DeenFriendsError('permission', 'You are not part of this friendship.');
    tx.delete(streakRef);
    tx.delete(friendshipRef);
  });
}
