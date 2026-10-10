/* Challenge data cache (V3.1): the Challenges tab opens instantly with the last results while fresh
 * data loads in the background. Requests are de-duplicated (one in flight per key) and prefetched
 * when Deen Friends starts, so the first visit to the tab is fast too. Cleared on sign-out. */
import type { Interaction } from '../types';
import { loadMyDailyChallenges, type DailyChallengeWithProgress } from '../services/dailyChallengeService';
import { loadMyFriendChallenges } from '../services/interactionService';
import { loadMyUserChallenges, type UserChallengeView } from '../services/userChallengeService';
import { loadLeaderboard, loadMyEntry, rankEntries, type LeaderboardEntry } from '../services/progressService';

export interface ChallengeData {
  daily: DailyChallengeWithProgress[];
  friends: Interaction[];
}
export interface BoardData {
  rows: ReturnType<typeof rankEntries>;
  mine: LeaderboardEntry | null;
}

let challenges: ChallengeData | null = null;
let circles: UserChallengeView[] | null = null;
const boards = new Map<string, BoardData>();
const inflight = new Map<string, Promise<unknown>>();

function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const cachedChallenges = () => challenges;
export const cachedCircles = () => circles;
export const cachedBoard = (monthId: string) => boards.get(monthId) || null;

export function refreshChallenges(): Promise<ChallengeData> {
  return once('challenges', async () => {
    const [daily, friends] = await Promise.all([loadMyDailyChallenges(), loadMyFriendChallenges()]);
    challenges = { daily, friends };
    return challenges;
  });
}

export function setCachedDaily(daily: DailyChallengeWithProgress[]): void {
  if (challenges) challenges = { ...challenges, daily };
}

export function refreshCircles(): Promise<UserChallengeView[]> {
  return once('circles', async () => {
    circles = await loadMyUserChallenges();
    return circles;
  });
}

export function refreshBoard(monthId: string): Promise<BoardData> {
  return once(`board:${monthId}`, async () => {
    const [rows, mine] = await Promise.all([loadLeaderboard(monthId, 20), loadMyEntry(monthId).catch(() => null)]);
    const data = { rows, mine };
    boards.set(monthId, data);
    return data;
  });
}

/** Warm everything the Challenges tab shows (errors are ignored here; the tab reports them). */
export function prefetchChallengeData(monthId: string): void {
  void refreshChallenges().catch(() => undefined);
  void refreshCircles().catch(() => undefined);
  void refreshBoard(monthId).catch(() => undefined);
}

export function clearChallengeCache(): void {
  challenges = null;
  circles = null;
  boards.clear();
}
