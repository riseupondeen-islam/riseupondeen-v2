/* Circle challenges: challenges people create for themselves and invited friends (Section 18).
 *
 *   deens_user_challenges/{id}                     the challenge (written by its creator only)
 *   deens_user_challenges/{id}/participants/{uid}  each person's acceptance and progress (own doc only)
 *
 * Safety and fairness (enforced by firestore.rules, mirrored here for friendly messages):
 *  - Only friends can be invited (each invitee must share a friendship with the creator), 1–8 people.
 *  - At most 3 new challenges per creator per day (document id `${uid}_${dayIndex}_${0|1|2}`).
 *  - A participant can complete at most once per day, only between the start and end date, only
 *    after accepting, and never more days than required. Each day completed counts toward the
 *    streak and monthly points once (progressService). Creating or sharing a challenge earns nothing.
 *  - Visibility: "invited" (creator + invitees only). Nothing is public.
 *  - Dates are calendar days in India Standard Time, the app's streak timezone (progressService). */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from '../../../services/firebase/sdk';
import { DeenFriendsError, offlineAware } from './errors';
import { cleanText, daysBetween, toAsciiDigits } from './format';
import { requireSignedIn } from './firebaseSession';
import { istDateString, istDayIndex, prepareCompletion, type ProfileForProgress } from './progressService';

export const MAX_INVITEES = 8;
export const MAX_CHALLENGES_PER_DAY = 3;
export const MAX_DAYS = 60;

export interface UserChallenge {
  id: string;
  creatorUid: string;
  title: string;
  description: string;
  criteria: string;
  category: string;
  startDate: string;
  endDate: string;
  requiredDays: number;
  invitedUids: string[];
  visibility: 'invited';
  createdAtMs: number;
  status: 'active' | 'cancelled';
}

export type ParticipantStatus = 'invited' | 'accepted' | 'declined';

export interface UserChallengeProgress {
  uid: string;
  status: ParticipantStatus;
  completedDates: string[];
  completedCount: number;
}

export interface UserChallengeView {
  challenge: UserChallenge;
  mine: UserChallengeProgress | null;
}

export function readUserChallenge(id: string, data: Record<string, unknown>): UserChallenge {
  return {
    id,
    creatorUid: String(data.creatorUid || ''),
    title: String(data.title || ''),
    description: String(data.description || ''),
    criteria: String(data.criteria || ''),
    category: String(data.category || 'Deen'),
    startDate: String(data.startDate || ''),
    endDate: String(data.endDate || ''),
    requiredDays: Math.max(1, Number(data.requiredDays) || 1),
    invitedUids: Array.isArray(data.invitedUids) ? data.invitedUids.map(String) : [],
    visibility: 'invited',
    createdAtMs: Number(data.createdAtMs) || 0,
    status: data.status === 'cancelled' ? 'cancelled' : 'active',
  };
}

export function readParticipant(uid: string, data: Record<string, unknown> | undefined): UserChallengeProgress {
  const d = data || {};
  const dates = Array.isArray(d.completedDates) ? d.completedDates.map(String) : [];
  return {
    uid,
    status: d.status === 'accepted' ? 'accepted' : d.status === 'declined' ? 'declined' : 'invited',
    completedDates: dates,
    completedCount: dates.length,
  };
}

export interface NewUserChallenge {
  title: string;
  description: string;
  criteria: string;
  category: string;
  startDate: string;
  endDate: string;
  requiredDays: string | number;
  invitedUids: string[];
}

export function validateUserChallenge(input: NewUserChallenge, friendUids: string[]): string | null {
  const title = cleanText(input.title, 80);
  if (title.length < 3) return 'Give the challenge a title (at least 3 characters).';
  if (cleanText(input.criteria, 200).length < 3) return 'Say clearly what counts as done for one day.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) return 'Choose a start and end date.';
  if (input.startDate < istDateString()) return 'The start date can’t be in the past.';
  if (input.endDate < input.startDate) return 'The end date must be on or after the start date.';
  const span = daysBetween(input.startDate, input.endDate) + 1;
  if (span > MAX_DAYS) return `A challenge can run for at most ${MAX_DAYS} days.`;
  const required = Number(toAsciiDigits(String(input.requiredDays)));
  if (!Number.isInteger(required) || required < 1 || required > span) return `Days required must be between 1 and ${span}.`;
  const invited = [...new Set(input.invitedUids)];
  if (!invited.length) return 'Invite at least one friend.';
  if (invited.length > MAX_INVITEES) return `Invite at most ${MAX_INVITEES} friends.`;
  if (invited.some((u) => !friendUids.includes(u))) return 'You can only invite people who are your Deen Friends.';
  return null;
}

/** Creates a circle challenge and the creator's own (accepted) participant record. */
export async function createUserChallenge(input: NewUserChallenge, friendUids: string[]): Promise<string> {
  const problem = validateUserChallenge(input, friendUids);
  if (problem) throw new DeenFriendsError('invalid', problem);
  const { db, uid } = await requireSignedIn();
  const day = istDayIndex();
  // Find a free daily slot (0–2). Reading my own documents is allowed even when they don't exist.
  let challengeId = '';
  for (let n = 0; n < MAX_CHALLENGES_PER_DAY; n++) {
    const id = `${uid}_${day}_${n}`;
    const snap = await getDoc(doc(db, 'deens_user_challenges', id)).catch(() => null);
    if (snap && !snap.exists()) {
      challengeId = id;
      break;
    }
  }
  if (!challengeId) throw new DeenFriendsError('invalid', `You can start up to ${MAX_CHALLENGES_PER_DAY} challenges a day. Please try again tomorrow.`);
  const startDate = input.startDate;
  const endDate = input.endDate;
  const batch = writeBatch(db);
  batch.set(doc(db, 'deens_user_challenges', challengeId), {
    creatorUid: uid,
    title: cleanText(input.title, 80),
    description: cleanText(input.description, 300),
    criteria: cleanText(input.criteria, 200),
    category: cleanText(input.category || 'Deen', 30),
    startDate,
    endDate,
    requiredDays: Number(toAsciiDigits(String(input.requiredDays))),
    invitedUids: [...new Set(input.invitedUids)],
    visibility: 'invited',
    status: 'active',
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
  batch.set(doc(db, 'deens_user_challenges', challengeId, 'participants', uid), {
    uid,
    challengeId,
    status: 'accepted',
    completedDates: [],
    completedCount: 0,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return challengeId;
}

/** Challenges I created or was invited to (two bounded queries) with my own progress. */
export async function loadMyUserChallenges(): Promise<UserChallengeView[]> {
  const { db, uid } = await requireSignedIn();
  const col = collection(db, 'deens_user_challenges');
  const [created, invited] = await Promise.all([
    getDocs(query(col, where('creatorUid', '==', uid), limit(30))),
    getDocs(query(col, where('invitedUids', 'array-contains', uid), limit(30))),
  ]);
  const map = new Map<string, UserChallenge>();
  [...created.docs, ...invited.docs].forEach((d) => map.set(d.id, readUserChallenge(d.id, d.data() as Record<string, unknown>)));
  const challenges = [...map.values()].filter((c) => c.status === 'active').sort((a, b) => b.createdAtMs - a.createdAtMs);
  const mine = await Promise.all(
    challenges.map((c) =>
      getDoc(doc(db, 'deens_user_challenges', c.id, 'participants', uid))
        .then((s) => (s.exists() ? readParticipant(uid, s.data() as Record<string, unknown>) : null))
        .catch(() => null),
    ),
  );
  return challenges.map((challenge, i) => ({ challenge, mine: mine[i] }));
}

/** Everyone's progress on one challenge (participants can see each other's progress). */
export async function loadParticipants(challengeId: string): Promise<UserChallengeProgress[]> {
  const { db } = await requireSignedIn();
  const snap = await getDocs(query(collection(db, 'deens_user_challenges', challengeId, 'participants'), limit(12)));
  return snap.docs.map((d) => readParticipant(d.id, d.data() as Record<string, unknown>));
}

export async function respondToUserChallenge(challenge: UserChallenge, accept: boolean): Promise<void> {
  const { db, uid } = await requireSignedIn();
  if (!challenge.invitedUids.includes(uid)) throw new DeenFriendsError('permission', 'You were not invited to this challenge.');
  const batch = writeBatch(db);
  batch.set(doc(db, 'deens_user_challenges', challenge.id, 'participants', uid), {
    uid,
    challengeId: challenge.id,
    status: accept ? 'accepted' : 'declined',
    completedDates: [],
    completedCount: 0,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export function runningToday(challenge: UserChallenge, today = istDateString()): boolean {
  return challenge.startDate <= today && today <= challenge.endDate;
}

/** Marks today done (once per day) and counts it toward my streak and monthly points. */
export async function completeUserChallengeToday(
  challenge: UserChallenge,
  profile: ProfileForProgress | null,
): Promise<UserChallengeProgress> {
  const { db, uid } = await requireSignedIn();
  const today = istDateString();
  if (!runningToday(challenge, today)) throw new DeenFriendsError('invalid', 'This challenge is not running today.');
  const ref = doc(db, 'deens_user_challenges', challenge.id, 'participants', uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new DeenFriendsError('invalid', 'Accept the challenge first.');
    const current = readParticipant(uid, snap.data() as Record<string, unknown>);
    if (current.status !== 'accepted') throw new DeenFriendsError('invalid', 'Accept the challenge first.');
    if (current.completedDates.includes(today)) return current;
    if (current.completedCount >= challenge.requiredDays) return current;
    const progress = await prepareCompletion(tx, db, uid, `user:${challenge.id}`, profile);
    const completedDates = [...current.completedDates, today];
    tx.update(ref, { completedDates, completedCount: completedDates.length, updatedAt: serverTimestamp() });
    progress.write();
    return { ...current, completedDates, completedCount: completedDates.length };
  }).catch((error: unknown) => {
    throw offlineAware(error);
  });
}

export async function cancelUserChallenge(challenge: UserChallenge): Promise<void> {
  const { db, uid } = await requireSignedIn();
  if (challenge.creatorUid !== uid) throw new DeenFriendsError('permission', 'Only the creator can end this challenge.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'deens_user_challenges', challenge.id), { status: 'cancelled', updatedAt: serverTimestamp() });
  await batch.commit();
}
