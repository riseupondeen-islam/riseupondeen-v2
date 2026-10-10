/* Daily Deen Challenges — created by RISE admins, completed by each user on their own.
 *
 *   deens_daily_challenges/{challengeId}                  (admin writes; users read published ones
 *                                                           addressed to everyone or to them)
 *   deens_daily_challenges/{challengeId}/participants/{uid} (each user writes only their own progress)
 *
 * These are separate from friend challenges (deens_friend_messages, kind "challenge") so admin
 * challenges can never overwrite or be confused with what friends send each other. */
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
  where,
} from '../../../services/firebase/sdk';
import { prepareCompletion, type ProfileForProgress } from './progressService';
import { offlineAware } from './errors';
import type { DailyChallenge, DailyChallengeProgress } from '../types';
import { DeenFriendsError } from './errors';
import { daysBetween, localDay } from './format';
import { requireSignedIn } from './firebaseSession';

export function readDailyChallenge(id: string, data: Record<string, unknown>): DailyChallenge {
  const startDate = String(data.startDate || '');
  const endDate = String(data.endDate || startDate);
  const span = startDate && endDate ? daysBetween(startDate, endDate) + 1 : 1;
  return {
    id,
    challengeType: 'daily_deen',
    title: String(data.title || ''),
    description: String(data.description || ''),
    instructions: String(data.instructions || ''),
    category: String(data.category || 'Deen'),
    activity: data.activity === 'tasbih' ? 'tasbih' : 'manual',
    target: Math.max(1, Number(data.target) || 1),
    startDate,
    endDate,
    requiredDays: Math.max(1, Math.min(span, Number(data.requiredDays) || span)),
    status: (['draft', 'published', 'archived'].includes(String(data.status))
      ? data.status
      : 'draft') as DailyChallenge['status'],
    audience: data.audience === 'selected' ? 'selected' : 'all',
    assignedUids: Array.isArray(data.assignedUids) ? data.assignedUids.map(String) : [],
    createdBy: String(data.createdBy || ''),
    updatedAtMs: Number(data.updatedAtMs) || 0,
  };
}

export function readProgress(
  uid: string,
  challengeId: string,
  data: Record<string, unknown> | undefined,
): DailyChallengeProgress {
  const d = data || {};
  const completedDates = Array.isArray(d.completedDates) ? d.completedDates.map(String) : [];
  return {
    uid,
    challengeId,
    completedDates,
    completedCount: completedDates.length,
    lastCompletedDate: String(d.lastCompletedDate || ''),
    status: d.status === 'completed' ? 'completed' : 'active',
  };
}

/** Is the challenge running today (by local date)? */
export function isRunningOn(challenge: DailyChallenge, day = localDay()): boolean {
  return challenge.status === 'published' && challenge.startDate <= day && day <= challenge.endDate;
}

export interface DailyChallengeWithProgress {
  challenge: DailyChallenge;
  progress: DailyChallengeProgress | null;
}

/** Published challenges for me: everyone's + the ones assigned to me (two bounded queries). */
export async function loadMyDailyChallenges(): Promise<DailyChallengeWithProgress[]> {
  const { db, uid } = await requireSignedIn();
  const challenges = collection(db, 'deens_daily_challenges');
  const [forAll, forMe] = await Promise.all([
    getDocs(query(challenges, where('status', '==', 'published'), where('audience', '==', 'all'), limit(20))),
    getDocs(
      query(challenges, where('status', '==', 'published'), where('assignedUids', 'array-contains', uid), limit(20)),
    ),
  ]);
  const byId = new Map<string, DailyChallenge>();
  for (const d of [...forAll.docs, ...forMe.docs])
    byId.set(d.id, readDailyChallenge(d.id, d.data() as Record<string, unknown>));
  const today = localDay();
  const visible = [...byId.values()]
    .filter((c) => c.endDate >= today) // finished ones drop off
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
  // My own progress docs (path-based reads of my documents are always allowed).
  const progress = await Promise.all(
    visible.map(async (c) => {
      const snap = await getDoc(doc(db, 'deens_daily_challenges', c.id, 'participants', uid));
      return snap.exists() ? readProgress(uid, c.id, snap.data() as Record<string, unknown>) : null;
    }),
  );
  return visible.map((challenge, i) => ({ challenge, progress: progress[i] }));
}

/** Marks today as completed for me (idempotent per day). */
export async function completeDailyChallengeToday(
  challenge: DailyChallenge,
  profile: ProfileForProgress | null = null,
): Promise<DailyChallengeProgress> {
  const { db, uid } = await requireSignedIn();
  const today = localDay();
  if (!isRunningOn(challenge, today)) throw new DeenFriendsError('invalid', 'This challenge is not running today.');
  const ref = doc(db, 'deens_daily_challenges', challenge.id, 'participants', uid);
  // V3: one transaction records the day AND advances the streak / monthly points, so a completion can
  // never be counted without being saved (or saved twice).
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = readProgress(uid, challenge.id, snap.exists() ? (snap.data() as Record<string, unknown>) : undefined);
    if (current.completedDates.includes(today)) return current;
    const progress = await prepareCompletion(tx, db, uid, `daily:${challenge.id}`, profile);
    const completedDates = [...current.completedDates, today].slice(-120);
    const next: DailyChallengeProgress = {
      uid,
      challengeId: challenge.id,
      completedDates,
      completedCount: completedDates.length,
      lastCompletedDate: today,
      status: completedDates.length >= challenge.requiredDays ? 'completed' : 'active',
    };
    tx.set(ref, { ...next, updatedAt: serverTimestamp(), updatedAtMs: Date.now() });
    progress.write();
    return next;
  }).catch((error: unknown) => {
    throw offlineAware(error);
  });
}

/* ---------- admin side (authorization is enforced by firestore.rules, not by hiding buttons) ---------- */

export interface DailyChallengeDraft {
  title: string;
  description: string;
  instructions: string;
  category: string;
  activity: 'manual' | 'tasbih';
  target: number;
  startDate: string;
  endDate: string;
  requiredDays: number;
  audience: 'all' | 'selected';
  assignedUids: string[];
}

export function validateDraft(d: DailyChallengeDraft): string | null {
  if (d.title.trim().length < 3) return 'Give the challenge a title (at least 3 characters).';
  if (d.title.length > 80) return 'Keep the title under 80 characters.';
  if (d.description.length > 400 || d.instructions.length > 1000) return 'Description or instructions are too long.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(d.endDate))
    return 'Choose a start and end date.';
  if (d.endDate < d.startDate) return 'The end date must be on or after the start date.';
  const span = daysBetween(d.startDate, d.endDate) + 1;
  if (span > 90) return 'A challenge can run for at most 90 days.';
  if (d.requiredDays < 1 || d.requiredDays > span) return `Days required must be between 1 and ${span}.`;
  if (d.activity === 'tasbih' && (d.target < 2 || d.target > 10000))
    return 'A Tasbih target must be between 2 and 10,000.';
  if (d.audience === 'selected' && !d.assignedUids.length) return 'Add at least one user, or choose “All users”.';
  if (d.assignedUids.length > 200) return 'Assign at most 200 users directly; use “All users” for larger groups.';
  return null;
}

export async function saveDailyChallenge(
  existingId: string | null,
  draft: DailyChallengeDraft,
  status: DailyChallenge['status'],
): Promise<string> {
  const problem = validateDraft(draft);
  if (problem) throw new DeenFriendsError('invalid', problem);
  const { db, uid } = await requireSignedIn();
  const ref = existingId
    ? doc(db, 'deens_daily_challenges', existingId)
    : doc(collection(db, 'deens_daily_challenges'));
  await setDoc(
    ref,
    {
      challengeType: 'daily_deen',
      title: draft.title.trim(),
      description: draft.description.trim(),
      instructions: draft.instructions.trim(),
      category: draft.category.trim().slice(0, 30) || 'Deen',
      activity: draft.activity,
      target: draft.activity === 'tasbih' ? Math.round(draft.target) : 1,
      startDate: draft.startDate,
      endDate: draft.endDate,
      requiredDays: Math.round(draft.requiredDays),
      status,
      audience: draft.audience,
      assignedUids: draft.audience === 'selected' ? [...new Set(draft.assignedUids)] : [],
      updatedBy: uid,
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      ...(existingId ? {} : { createdBy: uid, createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
  return ref.id;
}

export async function setDailyChallengeStatus(id: string, status: DailyChallenge['status']): Promise<void> {
  const { db, uid } = await requireSignedIn();
  const snap = await getDoc(doc(db, 'deens_daily_challenges', id));
  if (!snap.exists()) throw new DeenFriendsError('not-found', 'Challenge not found.');
  await setDoc(
    doc(db, 'deens_daily_challenges', id),
    { status, updatedBy: uid, updatedAt: serverTimestamp(), updatedAtMs: Date.now() },
    { merge: true },
  );
}

export async function adminListDailyChallenges(): Promise<DailyChallenge[]> {
  const { db } = await requireSignedIn();
  const snap = await getDocs(query(collection(db, 'deens_daily_challenges'), limit(100)));
  return snap.docs
    .map((d) => readDailyChallenge(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export async function adminListParticipants(challengeId: string): Promise<DailyChallengeProgress[]> {
  const { db } = await requireSignedIn();
  const snap = await getDocs(query(collection(db, 'deens_daily_challenges', challengeId, 'participants'), limit(500)));
  return snap.docs.map((d) => readProgress(d.id, challengeId, d.data() as Record<string, unknown>));
}
