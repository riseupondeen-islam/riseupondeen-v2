/* Shared daily streaks between two friends (deens_friend_streaks/{friendshipId}).
 *
 * A streak day counts when BOTH friends check in on the same local date. The count continues when the
 * previous "both" day was yesterday and restarts at 1 otherwise. Missing a day simply starts a new
 * streak — streaks are a gentle reminder, never a measure of anyone's faith. */
import { doc, runTransaction, serverTimestamp } from '../../../services/firebase/sdk';
import type { StreakRecord } from '../types';
import { DeenFriendsError } from './errors';
import { dayBefore, localDay } from './format';
import { requireSignedIn } from './firebaseSession';

export function readStreak(id: string, data: Record<string, unknown>): StreakRecord {
  return {
    id,
    members: Array.isArray(data.members) ? data.members.map(String) : [],
    count: Math.max(0, Number(data.count) || 0),
    lastBothDate: String(data.lastBothDate || ''),
    checkins: (data.checkins && typeof data.checkins === 'object' ? data.checkins : {}) as Record<string, string>,
    bothDates: Array.isArray(data.bothDates) ? data.bothDates.map(String) : [],
  };
}

/** The streak number to show today: it is only "alive" if the last shared day was today or yesterday. */
export function visibleStreakCount(streak: StreakRecord | undefined, today = localDay()): number {
  if (!streak) return 0;
  return streak.lastBothDate === today || streak.lastBothDate === dayBefore(today) ? streak.count : 0;
}

/** Longest run of consecutive shared days in the stored history. */
export function longestStreak(dates: string[]): number {
  const days = [...new Set(dates.filter(Boolean))].sort();
  let best = 0;
  let run = 0;
  let previous = '';
  for (const day of days) {
    run = previous && dayBefore(day) === previous ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

/** Supportive milestones (shown, never stored). */
export const STREAK_MILESTONES = [3, 7, 14, 30, 40, 100] as const;

export function nextMilestone(count: number): number | null {
  return STREAK_MILESTONES.find((m) => m > count) ?? null;
}

/** Applies one member's check-in for `day` and returns the new stored fields. */
export function applyCheckin(streak: StreakRecord, uid: string, day: string) {
  const checkins = { ...streak.checkins, [uid]: day };
  const other = streak.members.find((m) => m !== uid);
  const bothDates = [...streak.bothDates];
  let count = streak.count;
  let lastBothDate = streak.lastBothDate;
  if (other && checkins[other] === day && lastBothDate !== day) {
    count = lastBothDate === dayBefore(day) ? count + 1 : 1;
    lastBothDate = day;
    if (!bothDates.includes(day)) bothDates.push(day);
  }
  while (bothDates.length > 180) bothDates.shift();
  return { checkins, count, lastBothDate, bothDates };
}

/** Records today's check-in for me. Returns false when I had already checked in today. */
export async function checkInToday(friendshipId: string): Promise<boolean> {
  const { db, uid } = await requireSignedIn();
  const today = localDay();
  const streakRef = doc(db, 'deens_friend_streaks', friendshipId);
  const friendshipRef = doc(db, 'deens_friendships', friendshipId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(streakRef);
    if (!snap.exists()) throw new DeenFriendsError('not-found', 'This shared streak is no longer available.');
    const streak = readStreak(snap.id, snap.data() as Record<string, unknown>);
    if (!streak.members.includes(uid)) throw new DeenFriendsError('permission', 'You are not part of this streak.');
    if (streak.checkins[uid] === today) return false;
    const next = applyCheckin(streak, uid, today);
    tx.set(
      streakRef,
      { members: streak.members, ...next, updatedAt: serverTimestamp(), updatedAtMs: Date.now() },
      { merge: true },
    );
    tx.set(
      friendshipRef,
      { streakCount: next.count, updatedAt: serverTimestamp(), updatedAtMs: Date.now() },
      { merge: true },
    );
    return true;
  });
}
