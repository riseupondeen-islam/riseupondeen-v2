/* Chats: the official RISE conversation (pinned) and one private Deen conversation per friend. */
import { useMemo, useState } from 'react';
import { presenceLabel } from '../services/format';
import { useDeenFriends } from '../state/deenFriendsStore';
import { goToDeenFriends } from '../deenFriendsRoute';
import { Avatar, Badge, EmptyState, Icon, SkeletonRows } from './ui';

export function ChatsTab() {
  const s = useDeenFriends();
  const [filter, setFilter] = useState('');
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
              'Questions, feelings, problems or suggestions — talk to the RiseUponDeen team.'}
          </small>
        </span>
        <Badge count={rise?.unreadByUser || 0} />
      </button>

      {!s.friendshipsLoaded ? (
        <SkeletonRows count={3} />
      ) : !s.friendships.length ? (
        <EmptyState icon="chat" title="No friend conversations yet">
          <p>Once a friend accepts your request, your private Deen conversation appears here.</p>
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
                    <Avatar avatar={profile?.avatar} name={name} size={48} online={online} />
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
