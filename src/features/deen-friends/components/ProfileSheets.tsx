/* Profile visiting cards (friends and other people) and the own-profile editor. */
import { useEffect, useState, type FormEvent } from 'react';
import { AVATAR_KEYS, type AvatarKey, type OwnProfile, type PublicProfile } from '../types';
import {
  changeOwnPassword,
  requestUsernameChange,
  saveOwnProfile,
  signOutOfDeenFriends,
} from '../services/accountService';
import { friendlyMessage, logError } from '../services/errors';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  connectionStatus,
  removeFriend,
  sendFriendRequest,
} from '../services/friendService';
import { presenceLabel } from '../services/format';
import { longestStreak, visibleStreakCount } from '../services/streakService';
import {
  refreshProfile,
  relationshipSnapshot,
  setSignedOut,
  updateOwnProfile,
  useDeenFriends,
} from '../state/deenFriendsStore';
import { goToDeenFriends } from '../deenFriendsRoute';
import { NotificationSettings } from './NotificationSettings';
import { AVATAR_LABELS, Avatar, ConfirmSheet, Icon, Sheet, useToast } from './ui';

/* ---------- achievements (computed, never stored) ---------- */

interface Achievement {
  id: string;
  title: string;
  earned: boolean;
}

function achievementsFor(friendCount: number, bestStreak: number): Achievement[] {
  return [
    { id: 'first-friend', title: 'First Deen Friend', earned: friendCount >= 1 },
    { id: 'circle-5', title: 'Circle of five', earned: friendCount >= 5 },
    { id: 'streak-7', title: '7 days together', earned: bestStreak >= 7 },
    { id: 'streak-30', title: '30 days together', earned: bestStreak >= 30 },
    { id: 'streak-100', title: '100 days together', earned: bestStreak >= 100 },
  ];
}

/* ---------- someone else's card ---------- */

export function PersonSheet({ uid, onClose }: { uid: string; onClose: () => void }) {
  const s = useDeenFriends();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const profile: PublicProfile | undefined = s.profiles[uid];
  useEffect(() => {
    void refreshProfile(uid);
  }, [uid]);

  const status = connectionStatus(uid, relationshipSnapshot(s));
  const friendship = s.friendships.find((f) => f.friendUid === uid);
  const streak = friendship ? s.streaks[friendship.id] : undefined;
  const name = profile?.displayName || 'Deen Friend';

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast(done, 'success');
    } catch (err) {
      logError('connection action', err);
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <>
      <Sheet title={name} kicker={status === 'friends' ? 'DEEN FRIEND' : 'DEEN FRIENDS PROFILE'} onClose={onClose}>
        <div className="df2-visiting-card">
          <div className="df2-visiting-top">
            <Avatar avatar={profile?.avatar} name={name} size={76} />
            <div>
              <strong>{name}</strong>
              <span>@{profile?.username || '…'}</span>
              {status === 'friends' && profile ? <small>{presenceLabel(profile.lastActiveAt)}</small> : null}
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
          {friendship ? (
            <div className="df2-stat-row">
              <span className="df2-stat">
                <b>{visibleStreakCount(streak)}</b>
                <small>current streak</small>
              </span>
              <span className="df2-stat">
                <b>{longestStreak(streak?.bothDates || [])}</b>
                <small>best together</small>
              </span>
            </div>
          ) : null}
        </div>
        <div className="df2-sheet-actions">
          {status === 'friends' && friendship ? (
            <>
              <button
                type="button"
                className="df2-btn df2-btn-primary"
                onClick={() => {
                  onClose();
                  goToDeenFriends({ chatId: friendship.id });
                }}
              >
                <Icon name="chat" size={17} /> Open chat
              </button>
              <button type="button" className="df2-btn df2-btn-ghost-danger" onClick={() => setConfirmRemove(true)}>
                Remove friend
              </button>
            </>
          ) : null}
          {status === 'none' && profile ? (
            <button
              type="button"
              className="df2-btn df2-btn-primary"
              disabled={busy}
              onClick={() => run(() => sendFriendRequest(profile, relationshipSnapshot(s)), 'Friend request sent.')}
            >
              <Icon name="plus" size={17} /> Add Deen Friend
            </button>
          ) : null}
          {status === 'incoming' ? (
            <button
              type="button"
              className="df2-btn df2-btn-primary"
              disabled={busy}
              onClick={() => {
                const request = s.incoming.find((r) => r.fromUid === uid);
                if (request)
                  void run(() => acceptFriendRequest(request, relationshipSnapshot(s)), 'You are now Deen Friends.');
              }}
            >
              Accept request
            </button>
          ) : null}
          {status === 'outgoing' ? (
            <button
              type="button"
              className="df2-btn"
              disabled={busy}
              onClick={() => {
                const request = s.outgoing.find((r) => r.toUid === uid);
                if (request) void run(() => cancelFriendRequest(request), 'Request cancelled.');
              }}
            >
              Cancel request
            </button>
          ) : null}
        </div>
      </Sheet>
      {confirmRemove && friendship ? (
        <ConfirmSheet
          title={`Remove ${name}?`}
          danger
          confirmLabel="Remove friend"
          message={<p>Your private conversation access and your shared streak with {name} will end for both of you.</p>}
          onClose={() => setConfirmRemove(false)}
          onConfirm={async () => {
            try {
              await removeFriend(friendship);
              toast('Friend removed.');
              setConfirmRemove(false);
              onClose();
            } catch (err) {
              logError('remove friend', err);
              toast(friendlyMessage(err), 'error');
            }
          }}
        />
      ) : null}
    </>
  );
}

/* ---------- my own profile ---------- */

export function MyProfileSheet({ onClose }: { onClose: () => void }) {
  const s = useDeenFriends();
  const toast = useToast();
  const me = s.profile as OwnProfile;
  const [editing, setEditing] = useState(false);
  const best = Math.max(0, ...Object.values(s.streaks).map((st) => longestStreak(st.bothDates)));
  const achievements = achievementsFor(s.friendships.length, best);

  if (editing) return <ProfileEditor profile={me} onDone={() => setEditing(false)} onClose={onClose} />;

  return (
    <Sheet title="Your Deen profile" kicker="HOW FRIENDS SEE YOU" onClose={onClose}>
      <div className="df2-visiting-card is-own">
        <div className="df2-visiting-top">
          <Avatar avatar={me.avatar} name={me.displayName} size={76} />
          <div>
            <strong>{me.displayName}</strong>
            <span>@{me.username}</span>
          </div>
        </div>
        <p className="df2-visiting-bio">{me.bio || 'Add a short line about yourself so friends recognise you.'}</p>
      </div>
      <h3 className="df2-subhead">Achievements</h3>
      <ul className="df2-achievements">
        {achievements.map((a) => (
          <li key={a.id} className={a.earned ? 'earned' : ''}>
            <Icon name={a.earned ? 'sparkle' : 'lock'} size={16} />
            {a.title}
          </li>
        ))}
      </ul>
      <p className="df2-footnote">
        Only you can see your achievements. Worship activity is never shared automatically.
      </p>
      <h3 className="df2-subhead">Notifications</h3>
      <NotificationSettings />
      <div className="df2-sheet-actions">
        <button type="button" className="df2-btn df2-btn-primary" onClick={() => setEditing(true)}>
          <Icon name="edit" size={17} /> Edit profile
        </button>
        <InviteButton username={me.username} toast={toast} />
      </div>
    </Sheet>
  );
}

function InviteButton({
  username,
  toast,
}: {
  username: string;
  toast: (t: string, tone?: 'info' | 'success' | 'error') => void;
}) {
  return (
    <button
      type="button"
      className="df2-btn"
      onClick={async () => {
        const link = inviteLink(username);
        try {
          if (navigator.share) {
            await navigator.share({
              title: 'Join my Deen circle · Rise Upon Deen',
              text: 'Connect with me on Rise Upon Deen.',
              url: link,
            });
            return;
          }
        } catch {
          /* share sheet dismissed: fall back to copying */
        }
        try {
          await navigator.clipboard.writeText(link);
          toast('Invite link copied.', 'success');
        } catch {
          toast(link);
        }
      }}
    >
      <Icon name="share" size={17} /> Invite a friend
    </button>
  );
}

export function inviteLink(username: string): string {
  const origin = /^https?:$/i.test(location.protocol) ? location.origin : 'https://riseupondeen.web.app';
  return `${origin}/?deen_friend=${encodeURIComponent(username)}#deen-friends`;
}

function ProfileEditor({ profile, onDone, onClose }: { profile: OwnProfile; onDone: () => void; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    displayName: profile.displayName,
    avatar: profile.avatar as AvatarKey,
    bio: profile.bio,
    deenFocus: profile.deenFocus,
    currentFocus: profile.currentFocus,
    favoriteSurah: profile.favoriteSurah,
    languages: profile.languages,
    field: profile.field,
    shareCheckinCards: profile.privacy.shareCheckinCards,
    showAchievements: profile.privacy.showAchievements,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [usernameBox, setUsernameBox] = useState(false);
  const [usernameReq, setUsernameReq] = useState({ requested: '', reason: '', status: '' });
  const [password, setPassword] = useState({ value: '', status: '' });

  const field = (key: 'displayName' | 'bio' | 'deenFocus' | 'currentFocus' | 'favoriteSurah' | 'languages' | 'field') =>
    ({
      value: form[key],
      onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })),
    }) as const;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const next = await saveOwnProfile(profile, {
        ...form,
        privacy: { shareCheckinCards: form.shareCheckinCards, showAchievements: form.showAchievements },
      });
      updateOwnProfile(next);
      toast('Profile saved.', 'success');
      onDone();
    } catch (err) {
      logError('profile save', err);
      setError(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Edit your profile" kicker="PRIVATE TO YOUR DEEN CIRCLE" onClose={onClose} wide>
      <form className="df2-form" onSubmit={save}>
        <fieldset className="df2-fieldset">
          <legend>Avatar</legend>
          <div className="df2-avatar-picker">
            {AVATAR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={form.avatar === key ? 'active' : ''}
                aria-pressed={form.avatar === key}
                onClick={() => setForm((f) => ({ ...f, avatar: key }))}
              >
                <Avatar avatar={key} name={key} size={48} />
                <small>{AVATAR_LABELS[key]}</small>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="df2-form-grid">
          <label className="df2-field">
            <span>Display name</span>
            <input {...field('displayName')} maxLength={40} required />
          </label>
          <label className="df2-field">
            <span>Username</span>
            <input value={`@${profile.username}`} readOnly aria-readonly="true" />
            <button type="button" className="df2-link-btn" onClick={() => setUsernameBox((v) => !v)}>
              {usernameBox ? 'Hide username request' : 'Request a username change'}
            </button>
          </label>
        </div>
        {usernameBox ? (
          <div className="df2-subcard">
            <p className="df2-muted">Usernames stay fixed for safety. RISE reviews change requests.</p>
            <input
              className="df2-input"
              placeholder="new_username"
              value={usernameReq.requested}
              onChange={(e) => setUsernameReq((u) => ({ ...u, requested: e.target.value }))}
              maxLength={24}
            />
            <textarea
              className="df2-input"
              placeholder="Why would you like to change it?"
              value={usernameReq.reason}
              onChange={(e) => setUsernameReq((u) => ({ ...u, reason: e.target.value }))}
              maxLength={240}
              rows={2}
            />
            <button
              type="button"
              className="df2-btn df2-btn-sm"
              onClick={async () => {
                try {
                  await requestUsernameChange(profile, usernameReq.requested, usernameReq.reason);
                  setUsernameReq({ requested: '', reason: '', status: 'Request sent. RISE will review it.' });
                } catch (err) {
                  setUsernameReq((u) => ({ ...u, status: friendlyMessage(err) }));
                }
              }}
            >
              Send request
            </button>
            {usernameReq.status ? <p className="df2-inline-note">{usernameReq.status}</p> : null}
          </div>
        ) : null}
        <label className="df2-field">
          <span>About you</span>
          <textarea {...field('bio')} maxLength={180} rows={2} />
        </label>
        <div className="df2-form-grid">
          <label className="df2-field">
            <span>Deen interests</span>
            <input {...field('deenFocus')} maxLength={120} />
          </label>
          <label className="df2-field">
            <span>Current focus</span>
            <input {...field('currentFocus')} maxLength={120} />
          </label>
          <label className="df2-field">
            <span>Favourite surah</span>
            <input {...field('favoriteSurah')} maxLength={60} />
          </label>
          <label className="df2-field">
            <span>Languages</span>
            <input {...field('languages')} maxLength={80} />
          </label>
          <label className="df2-field">
            <span>Work / study</span>
            <input {...field('field')} maxLength={80} />
          </label>
        </div>

        <fieldset className="df2-fieldset">
          <legend>Privacy</legend>
          <label className="df2-toggle">
            <input
              type="checkbox"
              checked={form.shareCheckinCards}
              onChange={(e) => setForm((f) => ({ ...f, shareCheckinCards: e.target.checked }))}
            />
            <span>
              <strong>Post a card when I check in</strong>
              <small>Your friend sees “checked in today” in your chat. Your streak works either way.</small>
            </span>
          </label>
        </fieldset>

        {error ? (
          <p className="df2-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="df2-sheet-actions">
          <button type="button" className="df2-btn" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="df2-btn df2-btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      <h3 className="df2-subhead">Account security</h3>
      <div className="df2-subcard">
        <p className="df2-muted">Signed in as {profile.email || 'your account'}.</p>
        <input
          className="df2-input"
          type="password"
          placeholder="New password (8+ characters)"
          autoComplete="new-password"
          value={password.value}
          onChange={(e) => setPassword({ value: e.target.value, status: '' })}
          minLength={8}
          maxLength={128}
        />
        <button
          type="button"
          className="df2-btn df2-btn-sm"
          onClick={async () => {
            try {
              await changeOwnPassword(password.value);
              setPassword({ value: '', status: 'Password updated.' });
            } catch (err) {
              setPassword((p) => ({ ...p, status: friendlyMessage(err) }));
            }
          }}
        >
          Change password
        </button>
        {password.status ? <p className="df2-inline-note">{password.status}</p> : null}
        <button
          type="button"
          className="df2-btn df2-btn-ghost-danger df2-btn-block"
          onClick={async () => {
            try {
              await signOutOfDeenFriends();
            } finally {
              setSignedOut();
              onClose();
            }
          }}
        >
          Sign out
        </button>
      </div>
    </Sheet>
  );
}
