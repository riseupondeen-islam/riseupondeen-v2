/* Streaks: one clean row per friend, a gentle daily check-in and supportive milestones. */
import type { Friendship } from '../types';
import { localDay } from '../services/format';
import { longestStreak, nextMilestone, visibleStreakCount } from '../services/streakService';
import { useDeenFriends } from '../state/deenFriendsStore';
import { goToDeenFriends } from '../deenFriendsRoute';
import { Avatar, EmptyState, Icon, SkeletonRows } from './ui';
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
        <p>Add a friend — each day you both share a Deen action, it grows.</p>
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

/** One friend's shared streak. It grows on each day you both sent a Deen action or completed a
 *  challenge together — there is nothing to tap; tapping the row opens the chat. */
function StreakRow({ friendship }: { friendship: Friendship }) {
  const s = useDeenFriends();
  const profile = s.profiles[friendship.friendUid];
  const name = profile?.displayName || 'Deen Friend';
  const first = name.split(' ')[0];
  const streak = s.streaks[friendship.id];
  const today = localDay();
  const count = visibleStreakCount(streak, today);
  const meToday = !!s.profile && streak?.checkins[s.profile.uid] === today;
  const friendToday = streak?.checkins[friendship.friendUid] === today;
  const milestone = nextMilestone(count);
  const status =
    meToday && friendToday ? 'Both active today' : friendToday ? `${first} was active — reply to keep it` : meToday ? `Waiting for ${first}` : 'Send a Deen action today';

  return (
    <li className={`df2-streak-row${count ? ' is-alive' : ''}${meToday && friendToday ? ' is-today' : ''}`}>
      <button type="button" className="df2-streak-open" onClick={() => goToDeenFriends({ chatId: friendship.id })} aria-label={`Open chat with ${name}`}>
        <Avatar avatar={profile?.avatar} config={profile?.avatarConfig} name={name} size={42} />
        <span className="df2-streak-copy">
          <strong>{name}</strong>
          <small>
            {status}
            {milestone && count ? ` · ${milestone - count} to ${milestone}` : ''}
          </small>
        </span>
        <span className="df2-streak-count" aria-label={`${count} day streak`}>
          <Icon name="flame" size={17} />
          <b>{count}</b>
        </span>
      </button>
    </li>
  );
}
