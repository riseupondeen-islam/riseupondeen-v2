/* Private Deen interactions between two friends — deens_friend_messages/{id}.
 *
 * Each record is one of: a challenge, a check-in card, an encouragement/quick reaction (from a fixed,
 * rules-enforced list) or a piece of shared Islamic content. Free-text messages between users are
 * intentionally not supported (a safety decision enforced by firestore.rules).
 *
 * Retention: when the recipient sees a record it gets `purgeAt = seen + 24h`. A Firestore TTL policy
 * on deens_friend_messages.purgeAt deletes it server-side (see docs/DEEN-FRIENDS.md). Active
 * challenges get purgeAt only when they finish.
 *
 * ROOT CAUSES FIXED IN CUSTOM CHALLENGE CREATION (V1)
 *  1. The document id was derived from title + due option + date. Sending the same challenge again
 *     the same day (e.g. after it was declined, or before the chat listener had loaded) turned the
 *     write into an *update* of the existing record, which the rules forbid -> permission-denied.
 *     V2 uses a unique id per challenge (still prefixed "ch_<friendshipId>_" as the rules require)
 *     and checks the live stream for an identical *active* challenge instead.
 *  2. Tasbih targets typed with Arabic-Indic digits failed validation; digits are now normalised.
 *  3. Errors were collapsed into generic text; the Firebase code is now logged with the payload keys.
 */
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from '../../../services/firebase/sdk';
import type { ChallengeDetails, Interaction, SharedContent } from '../types';
import { DeenFriendsError, logError } from './errors';
import { challengeState, isChallengeActive, localDay, randomId } from './format';
import { requireSignedIn } from './firebaseSession';
import { applyCheckin, readStreak } from './streakService';

const DAY_MS = 86400000;
/** Seen records are removed 24 hours after the recipient saw them. */
export const RETENTION_AFTER_SEEN_MS = DAY_MS;

/** Must match validEncourageMsg in firestore.rules exactly. */
export const ENCOURAGEMENTS = [
  'MashaAllah, keep going.',
  'May Allah make it easy for you.',
  "Keep your Qur'an streak alive.",
  'Alhamdulillah.',
  'May Allah accept it from you.',
] as const;

/** Quick reactions (one tap). Also part of the rules' allow-list. */
export const QUICK_REACTIONS = [
  { label: 'Ameen', text: 'Ameen 🤲' },
  { label: 'JazakAllahu khayran', text: 'JazakAllahu khayran 💚' },
  { label: 'BarakAllahu feek', text: 'BarakAllahu feek ✨' },
  { label: 'SubhanAllah', text: 'SubhanAllah 🌙' },
] as const;

export interface FriendRef {
  friendshipId: string;
  friendUid: string;
}

export function readInteraction(id: string, data: Record<string, unknown>, pending = false): Interaction {
  const challenge =
    data.challenge && typeof data.challenge === 'object' ? (data.challenge as ChallengeDetails) : undefined;
  const shared =
    data.sharedContent && typeof data.sharedContent === 'object' ? (data.sharedContent as SharedContent) : undefined;
  return {
    id,
    friendshipId: String(data.friendshipId || ''),
    senderUid: String(data.senderUid || ''),
    recipientUid: String(data.recipientUid || ''),
    kind: (String(data.kind || 'encourage') as Interaction['kind']) || 'encourage',
    text: String(data.text || ''),
    createdAtMs: Number(data.createdAtMs) || 0,
    expiresAtMs: Number(data.expiresAtMs) || 0,
    readAtMs: Number(data.readAtMs) || undefined,
    challenge,
    status: data.status ? (String(data.status) as Interaction['status']) : undefined,
    completedBy: (data.completedBy && typeof data.completedBy === 'object' ? data.completedBy : {}) as Record<
      string,
      string
    >,
    sharedContent: shared,
    pending,
  };
}

/* ---------- live stream for one open conversation ---------- */

/**
 * One realtime listener for the open conversation (newest 60 records). The Firestore SDK reconnects
 * on its own after network loss; `onError` only fires for terminal errors (permission, index, auth).
 */
export function listenToConversation(
  friendshipId: string,
  onRows: (rows: Interaction[]) => void,
  onError: (error: unknown) => void,
): () => void {
  let stop: () => void = () => undefined;
  let cancelled = false;
  void requireSignedIn()
    .then(({ db }) => {
      if (cancelled) return;
      stop = onSnapshot(
        query(
          collection(db, 'deens_friend_messages'),
          where('friendshipId', '==', friendshipId),
          orderBy('createdAtMs', 'desc'),
          limit(60),
        ),
        (snap) => {
          const rows = snap.docs.map((d) =>
            readInteraction(d.id, d.data() as Record<string, unknown>, d.metadata.hasPendingWrites),
          );
          rows.sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
          onRows(rows);
        },
        onError,
      );
    })
    .catch(onError);
  return () => {
    cancelled = true;
    stop();
  };
}

/* ---------- writes ---------- */

function baseRecord(friend: FriendRef, uid: string) {
  return {
    friendshipId: friend.friendshipId,
    senderUid: uid,
    recipientUid: friend.friendUid,
    text: '',
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };
}

export interface NewChallenge {
  details: ChallengeDetails;
  expiresAtMs: number;
}

/**
 * Sends a challenge (recommended, official template or custom). `activeRows` is the loaded conversation,
 * used to refuse an identical challenge that is still active.
 */
export async function sendChallenge(
  friend: FriendRef,
  challenge: NewChallenge,
  activeRows: Interaction[],
): Promise<string> {
  const { db, uid } = await requireSignedIn();
  const title = challenge.details.title.trim();
  const duplicate = activeRows.some(
    (row) =>
      row.kind === 'challenge' &&
      row.senderUid === uid &&
      isChallengeActive(row) &&
      String(row.challenge?.title || '').toLowerCase() === title.toLowerCase(),
  );
  if (duplicate) throw new DeenFriendsError('invalid', 'You already have this challenge active with your friend.');
  if (!(challenge.expiresAtMs > Date.now()))
    throw new DeenFriendsError('invalid', 'Please choose a due time in the future.');

  const details: ChallengeDetails = {
    type: challenge.details.type,
    category: challenge.details.category,
    title,
    target: Math.max(1, Math.min(1000, Math.round(challenge.details.target))),
    activity: challenge.details.activity === 'tasbih' ? 'tasbih' : 'manual',
  };
  if (challenge.details.description) details.description = challenge.details.description;
  if (challenge.details.official) {
    details.official = true;
    details.officialId = challenge.details.officialId;
  }
  const id = `ch_${friend.friendshipId}_${randomId(14)}`;
  const payload = {
    ...baseRecord(friend, uid),
    kind: 'challenge',
    challenge: details,
    status: 'pending',
    completedBy: {},
    expiresAtMs: challenge.expiresAtMs,
  };
  try {
    await setDoc(doc(db, 'deens_friend_messages', id), payload);
  } catch (error) {
    logError(`challenge create rejected (keys: ${Object.keys(details).join(',')})`, error);
    throw error;
  }
  return id;
}

export async function respondToChallenge(id: string, accept: boolean): Promise<void> {
  const { db, uid } = await requireSignedIn();
  const ref = doc(db, 'deens_friend_messages', id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new DeenFriendsError('not-found', 'This challenge is no longer available.');
    const row = readInteraction(snap.id, snap.data() as Record<string, unknown>);
    if (row.recipientUid !== uid) throw new DeenFriendsError('permission', 'Only the challenged friend can respond.');
    if (challengeState(row) !== 'pending')
      throw new DeenFriendsError('invalid', 'This challenge was already answered or has expired.');
    tx.update(ref, {
      status: accept ? 'accepted' : 'declined',
      respondedAtMs: Date.now(),
      ...(accept ? {} : { purgeAt: new Date(Date.now() + RETENTION_AFTER_SEEN_MS) }),
    });
  });
}

/**
 * Records MY completion of an accepted challenge. When both friends have completed it, the shared
 * streak advances for today (in the same transaction).
 */
export async function completeChallenge(id: string): Promise<'done' | 'already'> {
  const { db, uid } = await requireSignedIn();
  const ref = doc(db, 'deens_friend_messages', id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new DeenFriendsError('not-found', 'This challenge is no longer available.');
    const row = readInteraction(snap.id, snap.data() as Record<string, unknown>);
    const members = [row.senderUid, row.recipientUid];
    if (!members.includes(uid)) throw new DeenFriendsError('permission', 'You are not part of this challenge.');
    const completedBy = { ...(row.completedBy || {}) };
    if (completedBy[uid]) return 'already';
    const state = challengeState(row);
    if (state !== 'accepted' && state !== 'in_progress')
      throw new DeenFriendsError('invalid', 'This challenge is not active.');
    const today = localDay();
    completedBy[uid] = today;
    const bothDone = members.every((m) => completedBy[m]);

    const streakRef = doc(db, 'deens_friend_streaks', row.friendshipId);
    const streakSnap = bothDone ? await tx.get(streakRef) : null;
    tx.update(
      ref,
      bothDone ? { completedBy, purgeAt: new Date(Date.now() + RETENTION_AFTER_SEEN_MS) } : { completedBy },
    );

    if (bothDone && streakSnap?.exists()) {
      let streak = readStreak(streakSnap.id, streakSnap.data() as Record<string, unknown>);
      for (const member of members) {
        const next = applyCheckin(streak, member, today);
        streak = { ...streak, ...next };
      }
      tx.set(
        streakRef,
        {
          members: streak.members,
          checkins: streak.checkins,
          count: streak.count,
          lastBothDate: streak.lastBothDate,
          bothDates: streak.bothDates,
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
        },
        { merge: true },
      );
      tx.set(
        doc(db, 'deens_friendships', row.friendshipId),
        { streakCount: streak.count, updatedAt: serverTimestamp(), updatedAtMs: Date.now() },
        { merge: true },
      );
    }
    return 'done';
  });
}

export async function sendEncouragement(friend: FriendRef, text: string): Promise<void> {
  const allowed = [...ENCOURAGEMENTS, ...QUICK_REACTIONS.map((r) => r.text)] as string[];
  if (!allowed.includes(text)) throw new DeenFriendsError('invalid', 'Please choose one of the suggested messages.');
  const { db, uid } = await requireSignedIn();
  await setDoc(doc(collection(db, 'deens_friend_messages')), {
    ...baseRecord(friend, uid),
    kind: 'encourage',
    text,
    expiresAtMs: Date.now() + DAY_MS,
  });
}

export async function shareContent(friend: FriendRef, content: SharedContent): Promise<void> {
  const { db, uid } = await requireSignedIn();
  const sharedContent: SharedContent = {
    id: String(content.id).slice(0, 200),
    type: content.type,
    title: String(content.title || 'Shared reminder').slice(0, 200),
    preview: String(content.preview || '').slice(0, 300),
    reference: String(content.reference || '').slice(0, 200),
    arabic: String(content.arabic || '').slice(0, 1200),
  };
  await setDoc(doc(collection(db, 'deens_friend_messages')), {
    ...baseRecord(friend, uid),
    kind: 'content',
    sharedContent,
    expiresAtMs: Date.now() + DAY_MS,
  });
}

/**
 * Posts the "checked in today" card. Call it only right after a NEW check-in: the id is fixed per
 * friend per day (the rules require it), so a second card for the same day would be refused.
 */
export async function postCheckinCard(friend: FriendRef): Promise<void> {
  const { db, uid } = await requireSignedIn();
  await setDoc(doc(db, 'deens_friend_messages', `ck_${friend.friendshipId}_${uid}_${localDay()}`), {
    ...baseRecord(friend, uid),
    kind: 'checkin',
    expiresAtMs: Date.now() + DAY_MS,
  });
}

/** Marks records I received as seen (once) and schedules their removal 24h later. */
const seenRequested = new Set<string>();
export async function markSeen(rows: Interaction[]): Promise<void> {
  if (typeof document !== 'undefined' && document.hidden) return;
  const { db, uid } = await requireSignedIn();
  const unseen = rows.filter((r) => r.recipientUid === uid && !r.readAtMs && !r.pending && !seenRequested.has(r.id));
  if (!unseen.length) return;
  unseen.forEach((r) => seenRequested.add(r.id));
  const now = Date.now();
  const purgeAt = new Date(now + RETENTION_AFTER_SEEN_MS);
  try {
    for (let i = 0; i < unseen.length; i += 400) {
      const batch = writeBatch(db);
      for (const row of unseen.slice(i, i + 400)) {
        const fields: Record<string, unknown> = { readAt: serverTimestamp(), readAtMs: now };
        if (row.kind !== 'challenge') fields.purgeAt = purgeAt;
        batch.update(doc(db, 'deens_friend_messages', row.id), fields);
      }
      await batch.commit();
    }
  } catch (error) {
    unseen.forEach((r) => seenRequested.delete(r.id));
    logError('seen update failed', error);
  }
}

/* ---------- clear chat ---------- */

const clearedKey = (friendshipId: string) => `rud_df_cleared_${friendshipId}`;

/** Records earlier than this are hidden on this device after "Clear chat". */
export function clearedBefore(friendshipId: string): number {
  try {
    return Number(localStorage.getItem(clearedKey(friendshipId))) || 0;
  } catch {
    return 0;
  }
}

/**
 * Clear chat: deletes the records I sent (both of us stop seeing them) except challenges that are
 * still active, and hides my friend's earlier records on this device. The rules only let each person
 * delete their own records, so a friend's records are never deleted from my side.
 */
export async function clearConversation(friendshipId: string): Promise<number> {
  const { db, uid } = await requireSignedIn();
  const snap = await getDocs(
    query(
      collection(db, 'deens_friend_messages'),
      where('friendshipId', '==', friendshipId),
      where('senderUid', '==', uid),
      limit(400),
    ),
  );
  const deletable = snap.docs.filter((d) => {
    const row = readInteraction(d.id, d.data() as Record<string, unknown>);
    return !(row.kind === 'challenge' && isChallengeActive(row));
  });
  for (let i = 0; i < deletable.length; i += 400) {
    const batch = writeBatch(db);
    deletable.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  try {
    localStorage.setItem(clearedKey(friendshipId), String(Date.now()));
  } catch {
    /* hiding on this device is best effort */
  }
  return deletable.length;
}

/* ---------- challenges across all friends (Challenges tab) ---------- */

/** Recent friend challenges I sent or received (bounded, fetched on demand). */
export async function loadMyFriendChallenges(): Promise<Interaction[]> {
  const { db, uid } = await requireSignedIn();
  const messages = collection(db, 'deens_friend_messages');
  const [sent, received] = await Promise.all([
    getDocs(query(messages, where('senderUid', '==', uid), where('kind', '==', 'challenge'), limit(30))),
    getDocs(query(messages, where('recipientUid', '==', uid), where('kind', '==', 'challenge'), limit(30))),
  ]);
  const rows = [...sent.docs, ...received.docs].map((d) => readInteraction(d.id, d.data() as Record<string, unknown>));
  const unique = new Map(rows.map((r) => [r.id, r]));
  return [...unique.values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
}
