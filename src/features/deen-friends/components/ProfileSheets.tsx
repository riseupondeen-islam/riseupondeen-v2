/* Profile visiting cards (friends and other people) and the own-profile editor. */
import { useEffect, useState, type FormEvent } from 'react';
import { AVATAR_KEYS, type AvatarKey, type OwnProfile, type PublicProfile, type SignatureStyle } from '../types';
import { SIGNATURE_STYLES } from '../services/format';
import { SIGNATURE_FONTS, SignatureText } from './Signature';
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
import { PublicProfileCard } from './PublicProfileCard';
import { AvatarCreator } from './AvatarCreator';

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

  return (
    <>
      <Sheet title={name} kicker={status === 'friends' ? 'DEEN FRIEND' : 'DEEN FRIENDS PROFILE'} onClose={onClose}>
        <PublicProfileCard
          profile={profile}
          extras={{
            presence: status === 'friends',
            friendStreak: friendship ? { current: visibleStreakCount(streak), best: longestStreak(streak?.bothDates || []) } : null,
          }}
        />
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
  const [previewing, setPreviewing] = useState(false);
  const [buildingAvatar, setBuildingAvatar] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const best = Math.max(0, ...Object.values(s.streaks).map((st) => longestStreak(st.bothDates)));
  const achievements = achievementsFor(s.friendships.length, best);

  if (editing) return <ProfileEditor profile={me} onDone={() => setEditing(false)} onClose={onClose} />;
  if (buildingAvatar) return <AvatarCreator profile={me} onClose={() => setBuildingAvatar(false)} />;
  if (previewing)
    return (
      <Sheet title="Public profile" kicker="PREVIEW" onClose={() => setPreviewing(false)}>
        <PublicProfileCard profile={me} />
        <p className="df2-preview-note">
          <Icon name="shield" size={14} /> Exactly what others see. Email and private settings are never shown.
        </p>
        <div className="df2-sheet-actions">
          <button type="button" className="df2-btn" onClick={() => setPreviewing(false)}>
            Back
          </button>
          <button
            type="button"
            className="df2-btn df2-btn-primary"
            onClick={() => {
              setPreviewing(false);
              setEditing(true);
            }}
          >
            <Icon name="edit" size={17} /> Edit
          </button>
        </div>
      </Sheet>
    );

  const earned = achievements.filter((a) => a.earned);
  return (
    <Sheet title="Your profile" onClose={onClose}>
      <PublicProfileCard profile={me} />
      <div className="df2-profile-actions">
        <button type="button" className="df2-pa" aria-label="Edit profile" onClick={() => setEditing(true)}>
          <Icon name="edit" size={18} />
          <span>Edit</span>
        </button>
        <button type="button" className="df2-pa" onClick={() => setBuildingAvatar(true)}>
          <Icon name="sparkle" size={18} />
          <span>Avatar</span>
        </button>
        <button type="button" className="df2-pa" onClick={() => setPreviewing(true)} data-tour="df-preview-profile">
          <Icon name="people" size={18} />
          <span>Preview</span>
        </button>
        <InviteButton username={me.username} toast={toast} />
      </div>
      {earned.length ? (
        <div className="df2-vcard-chips" aria-label="Achievements">
          {earned.map((a) => (
            <span key={a.id} className="df2-vchip is-earned">
              <Icon name="sparkle" size={12} /> {a.title}
            </span>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className={`df2-requests-toggle df2-collapse-toggle${notifyOpen ? ' is-open' : ''}`}
        aria-expanded={notifyOpen}
        onClick={() => setNotifyOpen((x) => !x)}
      >
        <Icon name="bell" size={16} />
        <span>Notifications</span>
        <Icon name={notifyOpen ? 'chevronUp' : 'chevronDown'} size={16} />
      </button>
      {notifyOpen ? (
        <div className="df2-collapse-panel">
          <NotificationSettings />
        </div>
      ) : null}
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
      className="df2-pa"
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
      <Icon name="share" size={18} />
      <span>Invite</span>
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
    showAchievements: profile.privacy.showAchievements,
    showStreak: profile.privacy.showStreak,
    showOnLeaderboard: profile.privacy.showOnLeaderboard,
    discoverable: profile.privacy.discoverable,
    signatureText: profile.signature?.text || '',
    signatureStyle: (profile.signature?.style || 'royal') as SignatureStyle,
  });
  const [buildingAvatar, setBuildingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [usernameBox, setUsernameBox] = useState(false);
  const [usernameReq, setUsernameReq] = useState({ requested: '', reason: '', status: '' });
  const [password, setPassword] = useState({ value: '', status: '' });

  const field = (key: 'displayName' | 'bio' | 'deenFocus' | 'currentFocus' | 'favoriteSurah' | 'languages' | 'field' | 'signatureText') =>
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
        privacy: {
          shareCheckinCards: profile.privacy.shareCheckinCards,
          showAchievements: form.showAchievements,
          showStreak: form.showStreak,
          showOnLeaderboard: form.showOnLeaderboard,
          discoverable: form.discoverable,
        },
        signature: form.signatureText.trim() ? { text: form.signatureText, style: form.signatureStyle } : { text: form.displayName, style: form.signatureStyle },
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

  if (buildingAvatar) return <AvatarCreator profile={profile} onClose={() => setBuildingAvatar(false)} />;

  const toggle = (key: 'showStreak' | 'showOnLeaderboard' | 'discoverable' | 'showAchievements', title: string) => (
    <label className="df2-toggle df2-toggle-compact">
      <input type="checkbox" checked={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} />
      <span>
        <strong>{title}</strong>
      </span>
    </label>
  );
  const signatureName = form.signatureText.trim() || form.displayName || profile.displayName;

  return (
    <Sheet title="Edit profile" onClose={onClose} wide>
      <form className="df2-form df2-edit-form" onSubmit={save}>
        <div className="df2-edit-avatar">
          <Avatar avatar={form.avatar} config={profile.avatarConfig} name={form.displayName} size={60} />
          <button type="button" className="df2-btn df2-btn-sm df2-build-avatar" onClick={() => setBuildingAvatar(true)}>
            <Icon name="sparkle" size={16} /> {profile.avatarConfig ? 'Customise avatar' : 'Create avatar'}
          </button>
          <details className="df2-details df2-classic-icons">
            <summary>Classic icons</summary>
            <div className="df2-avatar-picker">
              {AVATAR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={form.avatar === key ? 'active' : ''}
                  aria-pressed={form.avatar === key}
                  onClick={() => setForm((f) => ({ ...f, avatar: key }))}
                >
                  <Avatar avatar={key} name={key} size={44} />
                  <small>{AVATAR_LABELS[key]}</small>
                </button>
              ))}
            </div>
          </details>
        </div>
        <div className="df2-form-grid">
          <label className="df2-field">
            <span>Display name</span>
            <input {...field('displayName')} maxLength={40} required />
          </label>
          <label className="df2-field">
            <span>Username</span>
            <input value={`@${profile.username}`} readOnly aria-readonly="true" />
            <button type="button" className="df2-link-btn" onClick={() => setUsernameBox((v) => !v)}>
              {usernameBox ? 'Cancel' : 'Request a change'}
            </button>
          </label>
        </div>
        {usernameBox ? (
          <div className="df2-subcard">
            <input
              className="df2-input"
              placeholder="newusername"
              value={usernameReq.requested}
              onChange={(e) => setUsernameReq((u) => ({ ...u, requested: e.target.value }))}
              maxLength={24}
              aria-label="New username"
            />
            <textarea
              className="df2-input"
              placeholder="Reason (optional)"
              value={usernameReq.reason}
              onChange={(e) => setUsernameReq((u) => ({ ...u, reason: e.target.value }))}
              maxLength={240}
              rows={2}
              aria-label="Reason"
            />
            <button
              type="button"
              className="df2-btn df2-btn-sm"
              onClick={async () => {
                try {
                  await requestUsernameChange(profile, usernameReq.requested, usernameReq.reason);
                  setUsernameReq({ requested: '', reason: '', status: 'Request sent.' });
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

        <fieldset className="df2-fieldset df2-signature-edit">
          <legend>Signature</legend>
          <div className="df2-signature-preview" aria-hidden="true">
            <SignatureText value={{ text: signatureName, style: form.signatureStyle }} fallbackName={signatureName} size={36} />
          </div>
          <input className="df2-input" {...field('signatureText')} maxLength={40} placeholder={form.displayName} aria-label="Signature text" />
          <div className="df2-signature-styles" role="radiogroup" aria-label="Signature style">
            {SIGNATURE_STYLES.map((st) => (
              <button
                key={st}
                type="button"
                role="radio"
                aria-checked={form.signatureStyle === st}
                className={form.signatureStyle === st ? 'active' : ''}
                onClick={() => setForm((f) => ({ ...f, signatureStyle: st }))}
              >
                <span style={{ fontFamily: SIGNATURE_FONTS[st].family }}>{signatureName.split(' ')[0] || 'Name'}</span>
                <small>{SIGNATURE_FONTS[st].label}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="df2-field">
          <span>About you</span>
          <textarea {...field('bio')} maxLength={180} rows={2} />
        </label>
        <details className="df2-details df2-more-details">
          <summary>More about you</summary>
          <div className="df2-form-grid">
            <label className="df2-field">
              <span>Interests</span>
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
        </details>

        <fieldset className="df2-fieldset">
          <legend>Privacy</legend>
          {toggle('showStreak', 'Show my streak')}
          {toggle('showAchievements', 'Show my milestones')}
          {toggle('showOnLeaderboard', 'Show me on the leaderboard')}
          {toggle('discoverable', 'Show me in People')}
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

      <details className="df2-details df2-account-details">
        <summary>Account</summary>
        <div className="df2-subcard">
          <p className="df2-muted">{profile.email || 'Your account'}</p>
          <input
            className="df2-input"
            type="password"
            placeholder="New password (8+ characters)"
            autoComplete="new-password"
            value={password.value}
            onChange={(e) => setPassword({ value: e.target.value, status: '' })}
            minLength={8}
            maxLength={128}
            aria-label="New password"
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
        </div>
      </details>
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
    </Sheet>
  );
}
