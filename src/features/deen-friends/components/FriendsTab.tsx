/* Friends: find someone by username, answer requests, and see your Deen circle. */
import { useEffect, useState, type FormEvent } from 'react';
import type { FriendRequest, Friendship, PublicProfile } from '../types';
import { friendlyMessage, logError } from '../services/errors';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  connectionStatus,
  declineFriendRequest,
  findProfileByUsername,
  sendFriendRequest,
  type ConnectionStatus,
} from '../services/friendService';
import { presenceLabel } from '../services/format';
import { visibleStreakCount } from '../services/streakService';
import { relationshipSnapshot, useDeenFriends } from '../state/deenFriendsStore';
import { goToDeenFriends } from '../deenFriendsRoute';
import { Avatar, Badge, EmptyState, Icon, SkeletonRows, useToast } from './ui';
import { SuggestionsSection } from './SuggestionsSection';

export function FriendsTab({ onOpenProfile }: { onOpenProfile: (uid: string) => void }) {
  const s = useDeenFriends();
  return (
    <div className="df2-stack">
      <AddFriendCard onOpenProfile={onOpenProfile} />
      <RequestsSection onOpenProfile={onOpenProfile} />
      <section className="df2-section" aria-labelledby="df2-circle-title">
        <div className="df2-section-head">
          <h2 id="df2-circle-title">My circle</h2>
          {s.friendships.length ? <span className="df2-section-meta">{s.friendships.length}</span> : null}
        </div>
        {!s.friendshipsLoaded ? (
          <SkeletonRows count={3} />
        ) : s.friendships.length ? (
          <div className="df2-friend-grid">
            {s.friendships.map((f) => (
              <FriendCard key={f.id} friendship={f} onOpenProfile={onOpenProfile} />
            ))}
          </div>
        ) : (
          <EmptyState icon="people" title="No friends yet">
            <p>Search a username above or add someone from People.</p>
          </EmptyState>
        )}
      </section>
      <SuggestionsSection onOpenProfile={onOpenProfile} />
    </div>
  );
}

function FriendCard({ friendship, onOpenProfile }: { friendship: Friendship; onOpenProfile: (uid: string) => void }) {
  const s = useDeenFriends();
  const profile = s.profiles[friendship.friendUid];
  const name = profile?.displayName || 'Deen Friend';
  const streak = s.streaks[friendship.id];
  const count = visibleStreakCount(streak);
  const unread = s.unreadByFriendship[friendship.id] || 0;
  const online = !!profile && Date.now() - profile.lastActiveAt < 120000;
  return (
    <article className="df2-friend-card">
      <button
        type="button"
        className="df2-friend-main"
        onClick={() => onOpenProfile(friendship.friendUid)}
        aria-label={`View ${name}'s profile`}
      >
        <Avatar avatar={profile?.avatar} config={profile?.avatarConfig} name={name} size={48} online={online} />
        <span className="df2-friend-copy">
          <strong>{name}</strong>
          <small>{profile ? `@${profile.username} · ${presenceLabel(profile.lastActiveAt)}` : 'Loading…'}</small>
        </span>
      </button>
      <div className="df2-friend-meta">
        <span className={`df2-streak-pill${count ? ' is-alive' : ''}`} title="Shared streak">
          <Icon name="flame" size={15} />
          {count}
        </span>
      </div>
      <div className="df2-friend-actions">
        <button
          type="button"
          className="df2-btn df2-btn-soft"
          onClick={() => goToDeenFriends({ chatId: friendship.id })}
        >
          <Icon name="chat" size={17} />
          Chat
          <Badge count={unread} />
        </button>
      </div>
    </article>
  );
}

const STATUS_ACTION: Record<ConnectionStatus, string> = {
  none: 'Add friend',
  outgoing: 'Request sent',
  incoming: 'Accept request',
  friends: 'Friends',
  self: 'This is you',
};

function AddFriendCard({ onOpenProfile }: { onOpenProfile: (uid: string) => void }) {
  const s = useDeenFriends();
  const toast = useToast();
  const [term, setTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState<PublicProfile | null>(null);
  const [message, setMessage] = useState('');

  // Invite links: ?deen_friend=<username> pre-fills and runs the search once.
  useEffect(() => {
    const invited = new URLSearchParams(location.search).get('deen_friend');
    if (!invited) return;
    setTerm(invited);
    void search(invited);
    try {
      const url = new URL(location.href);
      url.searchParams.delete('deen_friend');
      history.replaceState(history.state || {}, '', url.pathname + url.search + url.hash);
    } catch {
      /* keep the URL */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(value = term) {
    const wanted = value.trim().replace(/^@+/, '');
    if (!wanted) {
      setMessage('Enter a username to search.');
      return;
    }
    setSearching(true);
    setMessage('');
    setResult(null);
    try {
      const found = await findProfileByUsername(wanted);
      if (!found) setMessage(`No one found for @${wanted}.`);
      setResult(found);
    } catch (err) {
      logError('profile search', err);
      setMessage(friendlyMessage(err));
    } finally {
      setSearching(false);
    }
  }

  const status: ConnectionStatus | null = result ? connectionStatus(result.uid, relationshipSnapshot(s)) : null;

  async function act() {
    if (!result || !status || acting) return;
    setActing(true);
    try {
      if (status === 'incoming') {
        const request = s.incoming.find((r) => r.fromUid === result.uid);
        if (request) await acceptFriendRequest(request, relationshipSnapshot(s));
        toast(`You and ${result.displayName} are now Deen Friends.`, 'success');
      } else if (status === 'outgoing') {
        const request = s.outgoing.find((r) => r.toUid === result.uid);
        if (request) await cancelFriendRequest(request);
        toast('Friend request cancelled.');
      } else if (status === 'none') {
        const outcome = await sendFriendRequest(result, relationshipSnapshot(s));
        toast(
          outcome === 'sent'
            ? `Request sent to @${result.username}. They’ll see it right away.`
            : outcome === 'accepted-theirs'
              ? `@${result.username} had already asked you — you are now Deen Friends.`
              : outcome === 'already-friends'
                ? 'You are already Deen Friends.'
                : 'Your request is already waiting for them.',
          'success',
        );
      }
    } catch (err) {
      logError('friend request action', err);
      toast(friendlyMessage(err), 'error');
    } finally {
      setActing(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void search();
  }

  const actionLabel = status === 'outgoing' ? 'Cancel request' : status ? STATUS_ACTION[status] : '';

  return (
    <section className="df2-card df2-add-card" aria-labelledby="df2-add-title">
      <div className="df2-add-head">
        <span className="df2-add-icon">
          <Icon name="plus" />
        </span>
        <h2 id="df2-add-title">Add a friend</h2>
      </div>
      <form className="df2-search-row" onSubmit={submit} role="search">
        <label className="df2-input-with-prefix">
          <span aria-hidden="true">@</span>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="username"
            aria-label="Friend's username"
            maxLength={40}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
        </label>
        <button className="df2-btn df2-btn-primary" type="submit" disabled={searching}>
          {searching ? 'Searching…' : 'Find'}
        </button>
      </form>
      {message ? <p className="df2-inline-note">{message}</p> : null}
      {result && status ? (
        <div className="df2-search-result">
          <button type="button" className="df2-search-person" onClick={() => onOpenProfile(result.uid)}>
            <Avatar avatar={result.avatar} config={result.avatarConfig} name={result.displayName} size={46} />
            <span>
              <strong>{result.displayName}</strong>
              <small>@{result.username}</small>
            </span>
          </button>
          <button
            type="button"
            className={`df2-btn ${status === 'none' || status === 'incoming' ? 'df2-btn-primary' : 'df2-btn-soft'}`}
            disabled={acting || status === 'friends' || status === 'self'}
            onClick={act}
          >
            {acting ? 'Please wait…' : actionLabel}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function RequestsSection({ onOpenProfile }: { onOpenProfile: (uid: string) => void }) {
  const s = useDeenFriends();
  const toast = useToast();
  const [busyId, setBusyId] = useState('');
  const [open, setOpen] = useState(false);
  const total = s.incoming.length + s.outgoing.length;

  async function run(request: FriendRequest, action: 'accept' | 'decline' | 'cancel') {
    setBusyId(request.id);
    try {
      if (action === 'accept') {
        await acceptFriendRequest(request, relationshipSnapshot(s));
        toast('Request accepted. You are now Deen Friends.', 'success');
      } else if (action === 'decline') {
        await declineFriendRequest(request);
        toast('Request declined.');
      } else {
        await cancelFriendRequest(request);
        toast('Request cancelled.');
      }
    } catch (err) {
      logError(`request ${action}`, err);
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusyId('');
    }
  }

  const row = (request: FriendRequest, uid: string, incoming: boolean) => {
    const profile = s.profiles[uid];
    const name = profile?.displayName || 'Deen Friend';
    return (
      <li className="df2-request" key={request.id}>
        <button type="button" className="df2-request-person" onClick={() => onOpenProfile(uid)}>
          <Avatar avatar={profile?.avatar} config={profile?.avatarConfig} name={name} size={42} />
          <span>
            <strong>{name}</strong>
            <small>
              {profile ? `@${profile.username}` : '…'} · {incoming ? 'wants to connect' : 'waiting for reply'}
            </small>
          </span>
        </button>
        <span className="df2-request-actions">
          {incoming ? (
            <>
              <button
                type="button"
                className="df2-btn df2-btn-primary df2-btn-sm"
                disabled={busyId === request.id}
                onClick={() => run(request, 'accept')}
              >
                Accept
              </button>
              <button
                type="button"
                className="df2-btn df2-btn-sm"
                disabled={busyId === request.id}
                onClick={() => run(request, 'decline')}
              >
                Decline
              </button>
            </>
          ) : (
            <button
              type="button"
              className="df2-btn df2-btn-sm"
              disabled={busyId === request.id}
              onClick={() => run(request, 'cancel')}
            >
              Cancel
            </button>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="df2-requests-wrap">
      <button
        type="button"
        className={`df2-requests-toggle${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls="df2-requests"
        onClick={() => setOpen((x) => !x)}
      >
        <Icon name="people" size={17} />
        <span>Requests</span>
        {s.incoming.length ? <Badge count={s.incoming.length} /> : <small>{total}</small>}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
      </button>
      {open ? (
        <section className="df2-requests-panel" id="df2-requests" aria-label="Friend requests">
          {total ? (
            <ul className="df2-request-list">
              {s.incoming.map((r) => row(r, r.fromUid, true))}
              {s.outgoing.map((r) => row(r, r.toUid, false))}
            </ul>
          ) : (
            <p className="df2-inline-note">No requests.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
