/* Chats: the official RISE conversation (pinned) and one private Deen conversation per friend. */
import { useMemo, useState } from 'react';
import { presenceLabel } from '../services/format';
import { useDeenFriends } from '../state/deenFriendsStore';
import { goToDeenFriends } from '../deenFriendsRoute';
import { Avatar, Badge, EmptyState, Icon, SkeletonRows } from './ui';
import { CreateGroupSheet } from './GroupScreens';
import { formatDayLabel } from '../services/format';
import type { AvatarKey } from '../types';

export function ChatsTab() {
  const s = useDeenFriends();
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return s.friendships
      .map((f) => ({ friendship: f, profile: s.profiles[f.friendUid], unread: s.unreadByFriendship[f.id] || 0 }))
      .filter(
        ({ profile }) =>
          !term || `${profile?.displayName || ''} ${profile?.username || ''}`.toLowerCase().includes(term),
      )
      .sort((a, b) => b.unread - a.unread || (b.profile?.lastActiveAt || 0) - (a.profile?.lastActiveAt || 0));
  }, [s.friendships, s.profiles, s.unreadByFriendship, filter]);

  const rise = s.riseThread;
  return (
    <div className="df2-stack">
      <button type="button" className="df2-chat-row df2-chat-row-rise" onClick={() => goToDeenFriends({ tab: 'rise' })}>
        <span className="df2-rise-mark" aria-hidden="true">
          <Icon name="moon" size={22} />
        </span>
        <span className="df2-chat-row-copy">
          <strong>
            RISE{' '}
            <span className="df2-verified" title="Official RiseUponDeen team">
              <Icon name="verified" size={15} label="Official" />
            </span>
          </strong>
          <small>
            {rise?.lastMessagePreview ||
              'Talk to the RiseUponDeen team'}
          </small>
        </span>
        <Badge count={rise?.unreadByUser || 0} />
      </button>

      <section className="df2-section df2-circles" aria-labelledby="df2-circles-title" data-tour="df-circles">
        <div className="df2-section-head">
          <h2 id="df2-circles-title">Circles</h2>
          <button type="button" className="df2-btn df2-btn-sm" onClick={() => setCreating(true)} data-tour="df-new-circle">
            <Icon name="plus" size={16} /> New circle
          </button>
        </div>
        {!s.groupsLoaded ? null : s.groups.length ? (
          <ul className="df2-chat-list">
            {s.groups.map((g) => (
              <li key={g.id}>
                <button type="button" className="df2-chat-row" onClick={() => goToDeenFriends({ groupId: g.id })}>
                  <Avatar avatar={g.avatar as AvatarKey} name={g.name} size={48} />
                  <span className="df2-chat-row-copy">
                    <strong>{g.name}</strong>
                    <small>
                      {g.members.length} participants · {g.lastPreview || 'Circle'} · {formatDayLabel(g.lastMessageAtMs)}
                    </small>
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="df2-inline-note">No circles yet.</p>
        )}
      </section>
      {creating ? <CreateGroupSheet onClose={() => setCreating(false)} /> : null}

      {!s.friendshipsLoaded ? (
        <SkeletonRows count={3} />
      ) : !s.friendships.length ? (
        <EmptyState icon="chat" title="No chats yet">
          <button type="button" className="df2-btn df2-btn-primary" onClick={() => goToDeenFriends({ tab: 'friends' })}>
            Add a friend
          </button>
        </EmptyState>
      ) : (
        <>
          {s.friendships.length > 6 ? (
            <input
              className="df2-filter"
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
            />
          ) : null}
          <ul className="df2-chat-list">
            {rows.map(({ friendship, profile, unread }) => {
              const name = profile?.displayName || 'Deen Friend';
              const online = !!profile && Date.now() - profile.lastActiveAt < 120000;
              return (
                <li key={friendship.id}>
                  <button
                    type="button"
                    className="df2-chat-row"
                    onClick={() => goToDeenFriends({ chatId: friendship.id })}
                  >
                    <Avatar avatar={profile?.avatar} config={profile?.avatarConfig} name={name} size={48} online={online} />
                    <span className="df2-chat-row-copy">
                      <strong>{name}</strong>
                      <small>
                        {unread
                          ? `${unread} new Deen ${unread === 1 ? 'interaction' : 'interactions'}`
                          : profile
                            ? presenceLabel(profile.lastActiveAt)
                            : '…'}
                      </small>
                    </span>
                    <Badge count={unread} />
                    <Icon name="chevron" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
