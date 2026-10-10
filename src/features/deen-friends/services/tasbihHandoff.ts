/* Opens the existing Tasbih for a challenge with a count target.
 *
 * The count is kept locally by Tasbih (sessionStorage) and Firestore is written once, on completion,
 * through window.RUD_DEEN_FRIENDS.completeFromTasbih (see deenFriendsRoute.tsx). The context shape is
 * the one features/tasbih/tasbih.js already reads; `kind` distinguishes friend and daily challenges. */

const TASBIH_CONTEXT_KEY = 'rud_df_tasbih_challenge_v1';

export interface TasbihChallengeStart {
  kind: 'friend' | 'daily';
  challengeId: string;
  friendshipId: string;
  target: number;
  title: string;
}

export function startTasbihChallenge(start: TasbihChallengeStart): boolean {
  let existing: { challengeId?: string } | null = null;
  try {
    existing = JSON.parse(sessionStorage.getItem(TASBIH_CONTEXT_KEY) || 'null');
  } catch {
    existing = null;
  }
  // Resume an unfinished count for the same challenge instead of resetting it.
  if (!existing || existing.challengeId !== start.challengeId) {
    try {
      sessionStorage.setItem(
        TASBIH_CONTEXT_KEY,
        JSON.stringify({
          kind: start.kind,
          challengeId: start.challengeId,
          friendshipId: start.friendshipId,
          targetCount: Math.floor(start.target),
          challengeType: start.kind === 'daily' ? 'daily_deen' : 'friend',
          returnDestination: 'deen-friends',
          title: start.title.slice(0, 100),
          count: 0,
          startedAt: Date.now(),
        }),
      );
    } catch {
      return false;
    }
  }
  location.hash = '#tasbih/df-challenge';
  return true;
}
