/* Challenge streaks and the monthly leaderboard (Sections 7 and 18).
 *
 * WHAT COUNTS
 *   Only a genuine challenge completion: a Daily Deen Challenge day marked done, a friend challenge
 *   I completed, or a day of a circle challenge I accepted. Starting, sharing, viewing or creating a
 *   challenge never counts.
 *
 * DAY AND MONTH BOUNDARY (the app's timezone policy)
 *   Streak days and leaderboard months use India Standard Time (UTC+05:30, no daylight saving): a day
 *   runs 00:00–23:59 IST and a month resets at 00:00 IST on the 1st. One fixed zone keeps everyone's
 *   streaks comparable and lets firestore.rules verify the day from the server clock (request.time),
 *   so a device with a wrong date cannot add days.
 *
 * DOCUMENTS (all written in the SAME transaction as the completion itself; firestore.rules check the
 * arithmetic and that the completion really happened in that write)
 *   deens_activity/{uid}_{dayIndex}           one per active day: count (1–3) and the source keys
 *   deens_streaks/{uid}                       current, longest, lastDayIndex, totalDays, visible
 *   deens_leaderboard/{YYYY-MM}/entries/{uid} points, activeDays, completions, lastAtMs, public name
 *
 * SCORING (shown to users in the app)
 *   +1 point for each eligible completion, at most 3 points per day (so a flood of tiny challenges
 *   cannot buy rank). Ranking: points, then active days; equal points and active days share a rank,
 *   listed by who reached the score first.
 *
 * Duplicates: the activity document lists the source keys already counted today, so the same
 * completion can never count twice; retries and two devices produce the same outcome.
 * Offline: completing needs a connection (transactions are online-only), so a queued write can never
 * land on the wrong day. */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from '../../../services/firebase/sdk';
import type { Transaction, Firestore, DocumentSnapshot } from 'firebase/firestore';
import type { OwnProfile, PublicProfile } from '../types';
import { requireSignedIn } from './firebaseSession';

export const DAY_MS = 86400000;
export const IST_OFFSET_MS = 330 * 60000;
export const MAX_POINTS_PER_DAY = 3;

/** Days since 1970-01-01 in IST — the same number firestore.rules compute from request.time. */
export function istDayIndex(ms = Date.now()): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS);
}

/** "YYYY-MM" for the IST month containing `ms`. */
export function istMonthId(ms = Date.now()): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" for the IST calendar day containing `ms` (what firestore.rules call istDate()). */
export function istDateString(ms = Date.now()): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function previousMonthId(monthId: string): string {
  const [y, m] = monthId.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function monthLabel(monthId: string): string {
  const [y, m] = monthId.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  } catch {
    return monthId;
  }
}

export interface StreakSummary {
  uid: string;
  current: number;
  longest: number;
  lastDayIndex: number;
  totalDays: number;
  visible: boolean;
}

export function readStreakSummary(uid: string, data: Record<string, unknown> | undefined): StreakSummary {
  const d = data || {};
  return {
    uid,
    current: Math.max(0, Number(d.current) || 0),
    longest: Math.max(0, Number(d.longest) || 0),
    lastDayIndex: Number(d.lastDayIndex) || 0,
    totalDays: Math.max(0, Number(d.totalDays) || 0),
    visible: d.visible !== false,
  };
}

/** The streak to display today: alive only if the last active day was today or yesterday (IST). */
export function liveStreak(s: StreakSummary | null | undefined, today = istDayIndex()): number {
  if (!s) return 0;
  return s.lastDayIndex >= today - 1 ? s.current : 0;
}

export function completedToday(s: StreakSummary | null | undefined, today = istDayIndex()): boolean {
  return !!s && s.lastDayIndex === today;
}

/** Pure streak arithmetic (mirrored by firestore.rules validStreakAdvance). */
export function advanceStreak(prev: StreakSummary | null, today: number): Omit<StreakSummary, 'uid' | 'visible'> {
  const current = prev && prev.lastDayIndex === today - 1 ? prev.current + 1 : 1;
  return {
    current,
    longest: Math.max(prev?.longest || 0, current),
    lastDayIndex: today,
    totalDays: (prev?.totalDays || 0) + 1,
  };
}

export interface LeaderboardEntry {
  uid: string;
  monthId: string;
  points: number;
  activeDays: number;
  completions: number;
  lastAtMs: number;
  displayName: string;
  username: string;
  avatar: string;
  avatarConfig: unknown;
  visible: boolean;
}

export function readEntry(uid: string, monthId: string, data: Record<string, unknown> | undefined): LeaderboardEntry {
  const d = data || {};
  return {
    uid,
    monthId,
    points: Math.max(0, Number(d.points) || 0),
    activeDays: Math.max(0, Number(d.activeDays) || 0),
    completions: Math.max(0, Number(d.completions) || 0),
    lastAtMs: Number(d.lastAtMs) || 0,
    displayName: String(d.displayName || ''),
    username: String(d.username || ''),
    avatar: String(d.avatar || ''),
    avatarConfig: d.avatarConfig || null,
    visible: d.visible !== false,
  };
}

/** Ranks entries: points ↓, active days ↓; equal (points, active days) share a rank; earlier first. */
export function rankEntries(entries: LeaderboardEntry[]): Array<LeaderboardEntry & { rank: number }> {
  const sorted = [...entries].sort(
    (a, b) => b.points - a.points || b.activeDays - a.activeDays || a.lastAtMs - b.lastAtMs || a.uid.localeCompare(b.uid),
  );
  let rank = 0;
  return sorted.map((e, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.points !== e.points || prev.activeDays !== e.activeDays) rank = i + 1;
    return { ...e, rank };
  });
}

/* ---------- the shared completion step ---------- */

export type CompletionSource = `daily:${string}` | `friend:${string}` | `user:${string}`;

export interface PreparedCompletion {
  /** False when this source already counted today (nothing is written). */
  counts: boolean;
  /** True when this is the first completion of the day (the streak advances). */
  newDay: boolean;
  /** Writes the activity, streak and leaderboard documents into the transaction. */
  write: () => void;
}

export interface ProfileForProgress {
  displayName: string;
  username: string;
  avatar: string;
  avatarConfig?: unknown;
  privacy?: { showStreak?: boolean; showOnLeaderboard?: boolean };
}

/**
 * Reads what the completion needs (must run before any write in the transaction, as Firestore
 * requires) and returns a function that adds the writes. Call it from inside the transaction that
 * records the completion itself.
 */
export async function prepareCompletion(
  tx: Transaction,
  db: Firestore,
  uid: string,
  source: CompletionSource,
  profile: ProfileForProgress | null,
  now = Date.now(),
): Promise<PreparedCompletion> {
  const day = istDayIndex(now);
  const monthId = istMonthId(now);
  const activityRef = doc(db, 'deens_activity', `${uid}_${day}`);
  const streakRef = doc(db, 'deens_streaks', uid);
  const entryRef = doc(db, 'deens_leaderboard', monthId, 'entries', uid);
  const [activitySnap, streakSnap, entrySnap] = (await Promise.all([tx.get(activityRef), tx.get(streakRef), tx.get(entryRef)])) as DocumentSnapshot[];

  const activity = activitySnap.exists() ? (activitySnap.data() as Record<string, unknown>) : null;
  const sources = Array.isArray(activity?.sources) ? (activity?.sources as unknown[]).map(String) : [];
  const count = Number(activity?.count) || 0;
  if (sources.includes(source) || count >= MAX_POINTS_PER_DAY) {
    // Already counted (duplicate event) or today's cap reached: the completion itself still saves.
    return { counts: false, newDay: false, write: () => undefined };
  }
  const newDay = !activity;
  const streakPrev = streakSnap.exists() ? readStreakSummary(uid, streakSnap.data() as Record<string, unknown>) : null;
  const entryPrev = entrySnap.exists() ? readEntry(uid, monthId, entrySnap.data() as Record<string, unknown>) : null;
  const showStreak = profile?.privacy?.showStreak !== false;
  const showOnBoard = profile?.privacy?.showOnLeaderboard !== false;

  return {
    counts: true,
    newDay,
    write: () => {
      tx.set(activityRef, {
        uid,
        dayIndex: day,
        monthId,
        count: count + 1,
        sources: [...sources, source],
        updatedAt: serverTimestamp(),
        ...(newDay ? { createdAt: serverTimestamp() } : {}),
      }, { merge: true });
      if (newDay) {
        tx.set(streakRef, {
          uid,
          ...advanceStreak(streakPrev, day),
          visible: streakPrev ? streakPrev.visible : showStreak,
          updatedAt: serverTimestamp(),
        });
      }
      tx.set(entryRef, {
        uid,
        monthId,
        points: (entryPrev?.points || 0) + 1,
        completions: (entryPrev?.completions || 0) + 1,
        activeDays: (entryPrev?.activeDays || 0) + (newDay ? 1 : 0),
        lastAtMs: now,
        displayName: String(profile?.displayName || 'Deen Friend').slice(0, 50),
        username: String(profile?.username || '').slice(0, 50),
        avatar: String(profile?.avatar || 'crescent').slice(0, 20),
        avatarConfig: profile?.avatarConfig || null,
        visible: entryPrev ? entryPrev.visible : showOnBoard,
        updatedAt: serverTimestamp(),
      });
    },
  };
}

/* ---------- reading ---------- */

export function listenToMyStreak(onValue: (s: StreakSummary | null) => void, onError: (e: unknown) => void): () => void {
  let stop: () => void = () => undefined;
  let cancelled = false;
  void requireSignedIn()
    .then(({ db, uid }) => {
      if (cancelled) return;
      stop = onSnapshot(
        doc(db, 'deens_streaks', uid),
        (snap) => onValue(snap.exists() ? readStreakSummary(uid, snap.data() as Record<string, unknown>) : null),
        onError,
      );
    })
    .catch(onError);
  return () => {
    cancelled = true;
    stop();
  };
}

/** Another member's public streak (readable only when they made it visible). */
export async function loadPublicStreak(uid: string): Promise<StreakSummary | null> {
  try {
    const { db } = await requireSignedIn();
    const snap = await getDoc(doc(db, 'deens_streaks', uid));
    if (!snap.exists()) return null;
    const s = readStreakSummary(uid, snap.data() as Record<string, unknown>);
    return s.visible ? s : null;
  } catch {
    return null; // hidden (permission denied) or offline: show nothing rather than a guess
  }
}

/** The month's top entries (visible members only). One bounded query. */
export async function loadLeaderboard(monthId: string, max = 20): Promise<Array<LeaderboardEntry & { rank: number }>> {
  const { db } = await requireSignedIn();
  const snap = await getDocs(
    query(
      collection(db, 'deens_leaderboard', monthId, 'entries'),
      where('visible', '==', true),
      orderBy('points', 'desc'),
      orderBy('activeDays', 'desc'),
      limit(max),
    ),
  );
  return rankEntries(snap.docs.map((d) => readEntry(d.id, monthId, d.data() as Record<string, unknown>)));
}

export async function loadMyEntry(monthId: string): Promise<LeaderboardEntry | null> {
  const { db, uid } = await requireSignedIn();
  const snap = await getDoc(doc(db, 'deens_leaderboard', monthId, 'entries', uid));
  return snap.exists() ? readEntry(uid, monthId, snap.data() as Record<string, unknown>) : null;
}

/** Keeps the visibility flags on my streak / current entry in step with my privacy settings. */
export async function syncProgressVisibility(profile: OwnProfile | PublicProfile): Promise<void> {
  const { db, uid } = await requireSignedIn();
  const streakRef = doc(db, 'deens_streaks', uid);
  const entryRef = doc(db, 'deens_leaderboard', istMonthId(), 'entries', uid);
  const [streak, entry] = await Promise.all([getDoc(streakRef), getDoc(entryRef)]);
  const writes: Array<Promise<void>> = [];
  if (streak.exists() && (streak.data()?.visible !== false) !== profile.privacy.showStreak)
    writes.push(setDoc(streakRef, { visible: profile.privacy.showStreak, updatedAt: serverTimestamp() }, { merge: true }));
  if (entry.exists() && (entry.data()?.visible !== false) !== profile.privacy.showOnLeaderboard)
    writes.push(
      setDoc(
        entryRef,
        {
          visible: profile.privacy.showOnLeaderboard,
          displayName: profile.displayName.slice(0, 50),
          avatar: profile.avatar,
          avatarConfig: profile.avatarConfig || null,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  await Promise.all(writes);
}
