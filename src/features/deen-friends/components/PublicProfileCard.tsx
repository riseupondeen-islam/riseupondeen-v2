/* The public Deen profile card — a visiting card (V3.1): a rectangular card with a light sweep, the
 * member's avatar, name, username and handwritten-style signature. Monthly winners get the gold foil
 * edition. It is the ONE rendering used both when someone views a member and when a member previews
 * their own public profile, so the preview can never drift. It only shows what the member made
 * public: never email, private fields or hidden progress. */
import { useEffect, useState } from 'react';
import type { PublicProfile } from '../types';
import { liveStreak, loadPublicStreak, monthLabel, type StreakSummary } from '../services/progressService';
import { loadWinsFor } from '../services/winnerService';
import { SignatureText } from './Signature';
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

  const [wins, setWins] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    setWins([]);
    if (uid) void loadWinsFor(uid).then((w) => alive && setWins(w));
    return () => {
      alive = false;
    };
  }, [uid]);

  const name = profile?.displayName || 'Deen Friend';
  const details: Array<[string, string]> = profile
    ? (
        [
          ['Interests', profile.deenFocus],
          ['Focus', profile.currentFocus],
          ['Favourite surah', profile.favoriteSurah],
          ['Work / study', profile.field],
          ['Languages', profile.languages],
        ] as Array<[string, string]>
      ).filter(([, v]) => !!v)
    : [];
  const achievements = streak && profile?.privacy.showAchievements ? challengeAchievements(streak) : [];
  const winner = wins.length > 0;

  return (
    <div className={`df2-public-card df2-visiting-card df2-vcard${winner ? ' is-winner' : ''}`}>
      <div className="df2-vcard-face">
        <span className="df2-vcard-pattern" aria-hidden="true" />
        <span className="df2-vcard-shine" aria-hidden="true" />
        <div className="df2-vcard-top">
          <span className="df2-vcard-brand">RISE UPON DEEN</span>
          {winner ? (
            <span className="df2-vcard-badge" title={`Monthly winner: ${wins.map(monthLabel).join(', ')}`}>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5L3 8.5Z" />
              </svg>
              Winner · {monthLabel(wins[0])}
            </span>
          ) : null}
        </div>
        <div className="df2-vcard-main">
          <span className="df2-vcard-avatar">
            <Avatar avatar={profile?.avatar} config={profile?.avatarConfig} name={name} size={64} />
          </span>
          <div className="df2-vcard-id">
            <strong>{name}</strong>
            <span>@{profile?.username || '…'}</span>
            {extras.presence && profile ? <small>{presenceLabel(profile.lastActiveAt)}</small> : null}
          </div>
        </div>
        <div className="df2-vcard-foot">
          {profile?.bio ? <p className="df2-visiting-bio">{profile.bio}</p> : <span />}
          <SignatureText value={profile?.signature || null} fallbackName={name} size={28} />
        </div>
      </div>
      {streak || extras.friendStreak || achievements.length ? (
        <div className="df2-vcard-chips">
          {streak ? (
            <span className="df2-vchip is-flame">
              <Icon name="flame" size={14} /> {liveStreak(streak)} streak
            </span>
          ) : null}
          {streak ? <span className="df2-vchip">Best {streak.longest}</span> : null}
          {extras.friendStreak ? <span className="df2-vchip">{extras.friendStreak.current} days together</span> : null}
          {achievements.map((a) => (
            <span key={a.id} className="df2-vchip is-earned">
              <Icon name="sparkle" size={12} /> {a.title}
            </span>
          ))}
        </div>
      ) : null}
      {details.length ? (
        <dl className="df2-detail-list df2-vcard-details">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
