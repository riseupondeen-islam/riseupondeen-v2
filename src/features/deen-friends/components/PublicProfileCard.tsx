/* The public Deen profile card — the ONE rendering used both when someone views a member and when a
 * member previews their own public profile (Section 22), so the preview can never drift from reality.
 * It only shows what the member made public: never email, private fields or hidden progress. */
import { useEffect, useState } from 'react';
import type { PublicProfile } from '../types';
import { liveStreak, loadPublicStreak, type StreakSummary } from '../services/progressService';
import { presenceLabel } from '../services/format';
import { Avatar, Icon } from './ui';

export interface PublicCardExtras {
  /** Days-together stats, shown only between friends. */
  friendStreak?: { current: number; best: number } | null;
  presence?: boolean;
}

function challengeAchievements(s: StreakSummary) {
  return [
    { id: 'first', title: 'First challenge day', earned: s.totalDays >= 1 },
    { id: 'week', title: '7-day streak', earned: s.longest >= 7 },
    { id: 'days30', title: '30 active days', earned: s.totalDays >= 30 },
    { id: 'month', title: '30-day streak', earned: s.longest >= 30 },
    { id: 'days100', title: '100 active days', earned: s.totalDays >= 100 },
  ].filter((a) => a.earned);
}

export function PublicProfileCard({ profile, extras = {} }: { profile: PublicProfile | undefined; extras?: PublicCardExtras }) {
  const [streak, setStreak] = useState<StreakSummary | null>(null);
  const uid = profile?.uid || '';
  const showStreak = !!profile && profile.privacy.showStreak;
  useEffect(() => {
    let cancelled = false;
    setStreak(null);
    if (!uid || !showStreak) return;
    void loadPublicStreak(uid).then((s) => {
      if (!cancelled) setStreak(s);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, showStreak]);

  const name = profile?.displayName || 'Deen Friend';
  const details: Array<[string, string]> = profile
    ? (
        [
          ['Deen interests', profile.deenFocus],
          ['Current focus', profile.currentFocus],
          ['Favourite surah', profile.favoriteSurah],
          ['Work / study', profile.field],
          ['Languages', profile.languages],
        ] as Array<[string, string]>
      ).filter(([, v]) => !!v)
    : [];
  const achievements = streak && profile?.privacy.showAchievements ? challengeAchievements(streak) : [];

  return (
    <div className="df2-visiting-card df2-public-card">
      <div className="df2-visiting-top">
        <Avatar avatar={profile?.avatar} config={profile?.avatarConfig} name={name} size={76} />
        <div>
          <strong>{name}</strong>
          <span>@{profile?.username || '…'}</span>
          {extras.presence && profile ? <small>{presenceLabel(profile.lastActiveAt)}</small> : null}
        </div>
      </div>
      <p className="df2-visiting-bio">{profile?.bio || 'Growing in Deen, one good deed at a time.'}</p>
      {details.length ? (
        <dl className="df2-detail-list">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {streak || extras.friendStreak ? (
        <div className="df2-stat-row">
          {streak ? (
            <span className="df2-stat df2-stat-flame">
              <b>
                <Icon name="flame" size={16} /> {liveStreak(streak)}
              </b>
              <small>challenge streak</small>
            </span>
          ) : null}
          {streak ? (
            <span className="df2-stat">
              <b>{streak.longest}</b>
              <small>longest streak</small>
            </span>
          ) : null}
          {extras.friendStreak ? (
            <>
              <span className="df2-stat">
                <b>{extras.friendStreak.current}</b>
                <small>days together</small>
              </span>
              <span className="df2-stat">
                <b>{extras.friendStreak.best}</b>
                <small>best together</small>
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      {achievements.length ? (
        <ul className="df2-achievements df2-achievements-public" aria-label="Milestones">
          {achievements.map((a) => (
            <li key={a.id} className="earned">
              <Icon name="sparkle" size={14} /> {a.title}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
