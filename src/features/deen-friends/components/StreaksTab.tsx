/* Streaks: one clean row per friend, a gentle daily check-in and supportive milestones. */
import { useState } from 'react';
import type { Friendship } from '../types';
import { friendlyMessage, logError } from '../services/errors';
import { localDay } from '../services/format';
import { postCheckinCard } from '../services/interactionService';
import { checkInToday, longestStreak, nextMilestone, visibleStreakCount } from '../services/streakService';
import { useDeenFriends } from '../state/deenFriendsStore';
import { goToDeenFriends } from '../deenFriendsRoute';
import { Avatar, EmptyState, Icon, SkeletonRows, useToast } from './ui';
import { completedToday, liveStreak } from '../services/progressService';

export function StreaksTab() {
  return (
    <div className="df2-stack">
      <ChallengeStreakCard />
      <FriendStreaks />
    </div>
  );
}

/** V3: my personal challenge streak (Section 7) — compact: count, today's state, two numbers. */
function ChallengeStreakCard() {
  const s = useDeenFriends();
  const streak = s.myStreak;
  const current = liveStreak(streak);
  const today = completedToday(streak);
  const atRisk = !today && current > 0;
  return (
    <section className={`df2-card df2-my-streak${today ? ' is-today' : ''}`} aria-labelledby="df2-my-streak-title" data-tour="df-my-streak">
      <div className="df2-my-streak-main">
        <span className="df2-my-streak-flame" aria-hidden="true">
          <Icon name="flame" size={22} />
        </span>
        <div className="df2-my-streak-copy">
          <span className="df2-kicker">YOUR STREAK</span>
          <h2 id="df2-my-streak-title">
            {current} day{current === 1 ? '' : 's'}
          </h2>
        </div>
        {today ? (
          <span className="df2-my-streak-state is-done">
            <Icon name="check" size={13} /> Today
          </span>
        ) : atRisk ? (
          <span className="df2-my-streak-state">Keep it going</span>
        ) : null}
      </div>
      <div className="df2-my-streak-foot">
        <span className="df2-my-streak-stats">
          <span>
            <b>{streak?.longest || 0}</b> best
          </span>
          <span>
            <b>{streak?.totalDays || 0}</b> active days
          </span>
        </span>
        {!today ? (
          <button type="button" className="df2-btn df2-btn-sm df2-btn-primary" onClick={() => goToDeenFriends({ tab: 'challenges' }, true)}>
            Challenges
          </button>
        ) : null}
      </div>
    </section>
  );
}

function FriendStreaks() {
  const s = useDeenFriends();
  if (!s.friendshipsLoaded) return <SkeletonRows count={3} />;
  if (!s.friendships.length)
    return (
      <EmptyState icon="flame" title="Build your first shared streak">
        <p>Add a Deen Friend and check in together each day.</p>
        <button type="button" className="df2-btn df2-btn-primary" onClick={() => goToDeenFriends({ tab: 'friends' })}>
          Find a friend
        </button>
      </EmptyState>
    );

  const records = s.friendships.map((f) => ({ friendship: f, streak: s.streaks[f.id] }));
  const best = Math.max(0, ...records.map((r) => longestStreak(r.streak?.bothDates || [])));
  const alive = records.filter((r) => visibleStreakCount(r.streak) > 0).length;

  return (
    <>
      <section className="df2-card df2-streak-summary">
        <span className="df2-kicker">SHARED STREAKS</span>
        <span className="df2-my-streak-stats">
          <span>
            <b>{alive}</b> active
          </span>
          <span>
            <b>{best}</b> best run
          </span>
        </span>
      </section>
      <ul className="df2-streak-list">
        {records.map(({ friendship }) => (
          <StreakRow key={friendship.id} friendship={friendship} />
        ))}
      </ul>
    </>
  );
}

function StreakRow({ friendship }: { friendship: Friendship }) {
  const s = useDeenFriends();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const profile = s.profiles[friendship.friendUid];
  const name = profile?.displayName || 'Deen Friend';
  const streak = s.streaks[friendship.id];
  const today = localDay();
  const count = visibleStreakCount(streak, today);
  const meToday = !!s.profile && streak?.checkins[s.profile.uid] === today;
  const friendToday = streak?.checkins[friendship.friendUid] === today;
  const milestone = nextMilestone(count);

  async function checkIn() {
    if (busy || meToday) return;
    setBusy(true);
    try {
      const isNew = await checkInToday(friendship.id);
      if (isNew && s.profile?.privacy.shareCheckinCards)
        await postCheckinCard({ friendshipId: friendship.id, friendUid: friendship.friendUid }).catch((e) =>
          logError('check-in card', e),
        );
      toast(
        isNew
          ? friendToday
            ? 'MashaAllah — you both checked in today.'
            : 'Checked in. Your friend will see it.'
          : 'You already checked in today.',
        'success',
      );
    } catch (err) {
      logError('check-in', err);
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const status =
    meToday && friendToday
      ? 'Both checked in today'
      : friendToday
        ? `${name.split(' ')[0]} checked in`
        : meToday
          ? 'Waiting for your friend'
          : 'Check in today';

  return (
    <li className={`df2-streak-row${count ? ' is-alive' : ''}`}>
      <Avatar avatar={profile?.avatar} config={profile?.avatarConfig} name={name} size={46} />
      <span className="df2-streak-copy">
        <strong>{name}</strong>
        <small>
          {status}
          {milestone && count ? ` · ${milestone - count} to ${milestone}` : ''}
        </small>
        <span
          className="df2-checkmarks"
          aria-label={`You ${meToday ? 'checked in' : 'not yet'}, friend ${friendToday ? 'checked in' : 'not yet'}`}
        >
          <i className={meToday ? 'on' : ''}>You</i>
          <i className={friendToday ? 'on' : ''}>Friend</i>
        </span>
      </span>
      <span className="df2-streak-count" aria-label={`${count} day streak`}>
        <Icon name="flame" size={18} />
        <b>{count}</b>
      </span>
      <button
        type="button"
        className={`df2-btn df2-btn-sm ${meToday ? 'df2-btn-soft' : 'df2-btn-primary'}`}
        disabled={busy || meToday}
        onClick={checkIn}
      >
        {meToday ? (
          <>
            <Icon name="check" size={15} /> Done
          </>
        ) : busy ? (
          'Saving…'
        ) : (
          'Check in'
        )}
      </button>
    </li>
  );
}
