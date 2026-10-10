/* Challenges: Daily Deen Challenges from RISE (done individually) and active challenges with friends. */
import { useCallback, useEffect, useState } from 'react';
import type { Interaction } from '../types';
import {
  completeDailyChallengeToday,
  isRunningOn,
  type DailyChallengeWithProgress,
} from '../services/dailyChallengeService';
import { friendlyMessage, logError } from '../services/errors';
import { challengeState, daysBetween, localDay } from '../services/format';
import { startTasbihChallenge } from '../services/tasbihHandoff';
import { getDeenFriendsState, useDeenFriends } from '../state/deenFriendsStore';
import { goToDeenFriends } from '../deenFriendsRoute';
import { EmptyState, Icon, SkeletonRows, useToast } from './ui';
import { CircleChallengesSection, LeaderboardSection } from './CircleChallenges';
import { cachedChallenges, refreshChallenges, setCachedDaily } from '../state/challengeCache';
import { MonthlyWinnerBanner } from './MonthlyWinner';

export function ChallengesTab() {
  const s = useDeenFriends();
  const toast = useToast();
  const cached = cachedChallenges();
  const [daily, setDaily] = useState<DailyChallengeWithProgress[] | null>(cached?.daily ?? null);
  const [friendChallenges, setFriendChallenges] = useState<Interaction[] | null>(cached?.friends ?? null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const fresh = await refreshChallenges();
      setDaily(fresh.daily);
      setFriendChallenges(fresh.friends);
    } catch (err) {
      logError('challenges load', err);
      setError(friendlyMessage(err, 'Challenges could not be loaded.'));
      setDaily((d) => d || []);
      setFriendChallenges((f) => f || []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function completeToday(entry: DailyChallengeWithProgress) {
    const { challenge } = entry;
    if (challenge.activity === 'tasbih' && challenge.target > 1) {
      startTasbihChallenge({
        kind: 'daily',
        challengeId: challenge.id,
        friendshipId: '',
        target: challenge.target,
        title: challenge.title,
      });
      return;
    }
    setBusyId(challenge.id);
    try {
      const progress = await completeDailyChallengeToday(challenge, getDeenFriendsState().profile);
      setDaily((list) => {
        const next = (list || []).map((x) => (x.challenge.id === challenge.id ? { ...x, progress } : x));
        setCachedDaily(next);
        return next;
      });
      toast(
        progress.status === 'completed' ? 'MashaAllah — challenge completed!' : 'Today is done. May Allah accept it.',
        'success',
      );
    } catch (err) {
      logError('daily challenge complete', err);
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusyId('');
    }
  }

  const today = localDay();
  const activeWithFriends = (friendChallenges || []).filter((c) =>
    ['pending', 'accepted', 'in_progress'].includes(challengeState(c)),
  );
  const finishedWithFriends = (friendChallenges || []).filter((c) => challengeState(c) === 'completed').length;

  return (
    <div className="df2-stack">
      <MonthlyWinnerBanner />
      <LeaderboardSection />
      <section className="df2-section" aria-labelledby="df2-daily-title">
        <div className="df2-section-head">
          <h2 id="df2-daily-title">
            Daily challenges <span className="df2-official-tag">RISE</span>
          </h2>
        </div>
        {error ? <p className="df2-inline-note">{error}</p> : null}
        {daily === null ? (
          <SkeletonRows count={2} />
        ) : daily.length ? (
          <div className="df2-daily-grid">
            {daily.map((entry) => {
              const { challenge, progress } = entry;
              const doneToday = !!progress?.completedDates.includes(today);
              const running = isRunningOn(challenge, today);
              const count = progress?.completedCount || 0;
              const pct = Math.min(100, Math.round((count / challenge.requiredDays) * 100));
              const daysLeft = Math.max(0, daysBetween(today, challenge.endDate));
              return (
                <article
                  key={challenge.id}
                  className={`df2-card df2-daily${progress?.status === 'completed' ? ' is-complete' : ''}`}
                >
                  <header className="df2-card-kicker">
                    <span>
                      <Icon name="target" size={15} /> {challenge.category}
                    </span>
                    <b>
                      {progress?.status === 'completed'
                        ? 'Completed'
                        : running
                          ? `${daysLeft + 1} day${daysLeft ? 's' : ''} left`
                          : `Starts ${challenge.startDate}`}
                    </b>
                  </header>
                  <h3>{challenge.title}</h3>
                  {challenge.description ? <p>{challenge.description}</p> : null}
                  {challenge.instructions ? (
                    <details className="df2-details">
                      <summary>How to do it</summary>
                      <p>{challenge.instructions}</p>
                    </details>
                  ) : null}
                  <div
                    className="df2-progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={challenge.requiredDays}
                    aria-valuenow={count}
                    aria-label="Your progress"
                  >
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <small className="df2-card-sub">
                    {count} of {challenge.requiredDays} day{challenge.requiredDays === 1 ? '' : 's'}
                    {challenge.activity === 'tasbih' ? ` · ${challenge.target} in Tasbih each day` : ''}
                  </small>
                  <div className="df2-card-actions">
                    {progress?.status === 'completed' ? (
                      <span className="df2-celebrate">Alhamdulillah — completed.</span>
                    ) : running ? (
                      <button
                        type="button"
                        className="df2-btn df2-btn-primary df2-btn-sm"
                        disabled={doneToday || busyId === challenge.id}
                        onClick={() => void completeToday(entry)}
                      >
                        {doneToday
                          ? 'Done for today'
                          : busyId === challenge.id
                            ? 'Saving…'
                            : challenge.activity === 'tasbih'
                              ? 'Count in Tasbih'
                              : 'Mark today done'}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState icon="target" title="No daily challenge right now" />
        )}
      </section>

      <section className="df2-section" aria-labelledby="df2-shared-title">
        <div className="df2-section-head">
          <h2 id="df2-shared-title">With friends</h2>
          {finishedWithFriends ? <span className="df2-section-meta">{finishedWithFriends} done</span> : null}
        </div>
        {friendChallenges === null ? (
          <SkeletonRows count={2} />
        ) : activeWithFriends.length ? (
          <ul className="df2-goal-list">
            {activeWithFriends.map((c) => {
              const friendUid = c.senderUid === s.profile?.uid ? c.recipientUid : c.senderUid;
              const friendName = s.profiles[friendUid]?.displayName || 'Your friend';
              const state = challengeState(c);
              const meDone = !!c.completedBy?.[s.profile?.uid || ''];
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="df2-goal"
                    onClick={() => goToDeenFriends({ chatId: c.friendshipId })}
                  >
                    <span className="df2-goal-copy">
                      <strong>{c.challenge?.title || 'Deen challenge'}</strong>
                      <small>
                        With {friendName} ·{' '}
                        {state === 'pending'
                          ? 'waiting for a reply'
                          : meDone
                            ? 'you’re done — waiting for your friend'
                            : 'your turn'}
                      </small>
                    </span>
                    <Icon name="chevron" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon="people" title="No shared goals yet">
            <p>Start one from a friend’s chat.</p>
          </EmptyState>
        )}
      </section>

      <CircleChallengesSection />
    </div>
  );
}
