/* Deen Friends page: session gate, header, sections and the open conversation. */
import { useEffect, useState } from 'react';
import { AuthPanel } from './components/AuthPanel';
import { ChallengesTab } from './components/ChallengesTab';
import { ChatScreen } from './components/ChatScreen';
import { ChatsTab } from './components/ChatsTab';
import { FriendsTab } from './components/FriendsTab';
import { MyProfileSheet, PersonSheet } from './components/ProfileSheets';
import { RiseChatScreen } from './components/RiseChatScreen';
import { StreaksTab } from './components/StreaksTab';
import { GroupChatScreen } from './components/GroupScreens';
import { completedToday, liveStreak } from './services/progressService';
import { Avatar, Badge, Icon, SkeletonRows, ToastProvider, type IconName } from './components/ui';
import { goToDeenFriends, leaveConversation, useDeenFriendsRoute, type DeenFriendsTab } from './deenFriendsRoute';
import { startPageListeners, startSession, useDeenFriends } from './state/deenFriendsStore';

const TABS: Array<{ id: Exclude<DeenFriendsTab, 'rise'>; label: string; icon: IconName }> = [
  { id: 'friends', label: 'Friends', icon: 'people' },
  { id: 'streaks', label: 'Streaks', icon: 'flame' },
  { id: 'chats', label: 'Chats', icon: 'chat' },
  { id: 'challenges', label: 'Challenges', icon: 'target' },
];

export default function DeenFriendsPage() {
  return (
    <ToastProvider>
      <DeenFriendsContent />
    </ToastProvider>
  );
}

function DeenFriendsContent() {
  const s = useDeenFriends();
  const route = useDeenFriendsRoute();
  const [profileUid, setProfileUid] = useState('');
  const [myProfileOpen, setMyProfileOpen] = useState(false);

  useEffect(() => {
    void startSession();
  }, []);
  useEffect(() => {
    if (s.session === 'signed-in') void startPageListeners();
  }, [s.session, s.profile?.uid]);

  if (s.session === 'loading') {
    return (
      <section className="df2-root df2-page">
        <div className="df2-container">
          <div className="df2-hero df2-hero-loading">
            <span className="df2-kicker">RISE UPON DEEN · DEEN FRIENDS</span>
            <h1 className="df2-title">Deen Friends</h1>
          </div>
          <SkeletonRows count={4} />
        </div>
      </section>
    );
  }

  if (s.session === 'unavailable') {
    return (
      <section className="df2-root df2-page">
        <div className="df2-container">
          <div className="df2-card df2-offline">
            <Icon name="shield" size={28} />
            <h1>Deen Friends needs a connection</h1>
            <p>We couldn’t reach the secure service. Check your connection, then try again.</p>
            <button type="button" className="df2-btn df2-btn-primary" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (s.session === 'signed-out' || !s.profile) {
    return (
      <section className="df2-root df2-page">
        <div className="df2-container">
          <AuthPanel />
        </div>
      </section>
    );
  }

  const me = s.profile;
  const chatUnread = Object.values(s.unreadByFriendship).reduce((a, b) => a + b, 0) + (s.riseThread?.unreadByUser || 0);
  const activeTab = route.tab === 'rise' ? 'chats' : route.tab;
  const openFriendship = route.chatId ? s.friendships.find((f) => f.id === route.chatId) : undefined;
  const openGroup = route.groupId ? s.groups.find((g) => g.id === route.groupId) : undefined;
  const streakNow = liveStreak(s.myStreak);

  return (
    <section className="df2-root df2-page">
      <div className="df2-container">
        <header className="df2-hero">
          <div className="df2-hero-copy">
            <span className="df2-kicker">RISE UPON DEEN · RISE TOGETHER</span>
            <h1 className="df2-title">Deen Friends</h1>
            <p className="df2-lead">
              Grow together — encourage one another, keep gentle streaks and share what benefits.
            </p>
          </div>
          <div className="df2-hero-actions">
            <button
              type="button"
              className={`df2-streak-chip${completedToday(s.myStreak) ? ' is-today' : ''}`}
              data-tour="df-streak"
              onClick={() => goToDeenFriends({ tab: 'streaks' }, true)}
              aria-label={`Challenge streak: ${streakNow} day${streakNow === 1 ? '' : 's'}${completedToday(s.myStreak) ? ', completed today' : ''}`}
              title="Your challenge streak"
            >
              <Icon name="flame" size={17} />
              <b>{streakNow}</b>
            </button>
            <button
              type="button"
              className="df2-me-chip"
              onClick={() => setMyProfileOpen(true)}
              aria-label="Your Deen profile"
            >
              <Avatar avatar={me.avatar} config={me.avatarConfig} name={me.displayName} size={40} />
              <span>
                <strong>{me.displayName}</strong>
                <small>@{me.username}</small>
              </span>
            </button>
            <button
              type="button"
              className="df2-icon-btn df2-icon-btn-bordered"
              aria-label={`Friend requests${s.incoming.length ? `, ${s.incoming.length} new` : ''}`}
              onClick={() => {
                goToDeenFriends({ tab: 'friends' }, true);
                requestAnimationFrame(() =>
                  document.getElementById('df2-requests')?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                );
              }}
            >
              <Icon name="inbox" />
              <Badge count={s.incoming.length} />
            </button>
          </div>
        </header>

        <nav className="df2-tabs" role="tablist" aria-label="Deen Friends sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`df2-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls="df2-panel"
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => goToDeenFriends({ tab: tab.id }, true)}
            >
              <Icon name={tab.icon} size={18} />
              <span>{tab.label}</span>
              {tab.id === 'chats' ? (
                <Badge count={chatUnread} />
              ) : tab.id === 'friends' ? (
                <Badge count={s.incoming.length} />
              ) : null}
            </button>
          ))}
        </nav>

        <div className="df2-panel" id="df2-panel" role="tabpanel" aria-labelledby={`df2-tab-${activeTab}`}>
          {activeTab === 'friends' ? <FriendsTab onOpenProfile={setProfileUid} /> : null}
          {activeTab === 'streaks' ? <StreaksTab /> : null}
          {activeTab === 'chats' ? <ChatsTab /> : null}
          {activeTab === 'challenges' ? <ChallengesTab /> : null}
        </div>
      </div>

      {route.chatId && openFriendship ? (
        <ChatScreen friendship={openFriendship} onBack={leaveConversation} onOpenProfile={setProfileUid} />
      ) : null}
      {route.chatId && !openFriendship && s.friendshipsLoaded ? <MissingConversation /> : null}
      {route.tab === 'rise' ? <RiseChatScreen onBack={leaveConversation} /> : null}
      {route.groupId && openGroup ? <GroupChatScreen group={openGroup} onBack={leaveConversation} onOpenProfile={setProfileUid} /> : null}
      {route.groupId && !openGroup && s.groupsLoaded ? <MissingConversation /> : null}

      {profileUid ? <PersonSheet uid={profileUid} onClose={() => setProfileUid('')} /> : null}
      {myProfileOpen ? <MyProfileSheet onClose={() => setMyProfileOpen(false)} /> : null}
    </section>
  );
}

function MissingConversation() {
  useEffect(() => {
    goToDeenFriends({ tab: 'chats' }, true);
  }, []);
  return null;
}
