/* A private Deen conversation with one friend (full screen on phones, a large panel on desktops). */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Friendship, Interaction } from '../types';
import { classifyError, friendlyMessage, logError } from '../services/errors';
import { formatDayLabel, isTasbihChallenge, localDay, presenceLabel } from '../services/format';
import {
  QUICK_REACTIONS,
  clearedBefore,
  completeChallenge,
  listenToConversation,
  markSeen,
  respondToChallenge,
  sendEncouragement,
} from '../services/interactionService';
import { startTasbihChallenge } from '../services/tasbihHandoff';
import { getDeenFriendsState, refreshProfile, useDeenFriends } from '../state/deenFriendsStore';
import { ChatSettingsSheet, readChatTheme, type ChatThemeId } from './ChatSettingsSheet';
import { ChallengeSheet, DeenActionMenu, EncourageSheet, ShareSheet, type DeenAction } from './DeenActionSheets';
import { FullScreen } from './FullScreen';
import { InteractionCard, type ChallengeAction } from './InteractionCard';
import { Avatar, Icon, useToast } from './ui';

type OpenSheet =
  | null
  | 'menu'
  | 'challenge'
  | 'encourage'
  | 'settings'
  | { share: 'all' | 'quran' | 'dua' | 'hadith' | 'zikr' | 'reminder' | 'name' };

export function ChatScreen({
  friendship,
  onBack,
  onOpenProfile,
}: {
  friendship: Friendship;
  onBack: () => void;
  onOpenProfile: (uid: string) => void;
}) {
  const s = useDeenFriends();
  const toast = useToast();
  const me = s.profile;
  const friend = s.profiles[friendship.friendUid];
  const friendName = friend?.displayName || 'Deen Friend';
  const friendRef = useMemo(
    () => ({ friendshipId: friendship.id, friendUid: friendship.friendUid }),
    [friendship.id, friendship.friendUid],
  );

  const [rows, setRows] = useState<Interaction[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [theme, setTheme] = useState<ChatThemeId>(() => readChatTheme(friendship.id));
  const [hiddenBefore, setHiddenBefore] = useState(() => clearedBefore(friendship.id));
  const [reacting, setReacting] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // One realtime listener for this conversation; stopped when the screen closes.
  useEffect(() => {
    setLoadError('');
    void refreshProfile(friendship.friendUid);
    return listenToConversation(
      friendship.id,
      (next) => setRows(next),
      (error) => {
        logError('conversation listener', error);
        setLoadError(friendlyMessage(error, 'This conversation could not be loaded.'));
        if (classifyError(error) === 'offline') setRows((current) => current || []);
      },
    );
  }, [friendship.id, friendship.friendUid, retryKey]);

  const visibleRows = useMemo(
    () => (rows || []).filter((r) => !(hiddenBefore && r.createdAtMs < hiddenBefore && r.senderUid !== me?.uid)),
    [rows, hiddenBefore, me?.uid],
  );

  // Mark what I received as seen while the screen is visible.
  useEffect(() => {
    if (visibleRows.length) void markSeen(visibleRows);
    const onVisible = () => {
      if (!document.hidden && visibleRows.length) void markSeen(visibleRows);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [visibleRows]);

  // Keep the newest item in view unless the reader has scrolled up to older items.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [visibleRows.length]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const onChallengeAction = useCallback(
    async (item: Interaction, action: ChallengeAction) => {
      if (action === 'done' && isTasbihChallenge(item)) {
        const ok = startTasbihChallenge({
          kind: 'friend',
          challengeId: item.id,
          friendshipId: item.friendshipId,
          target: Number(item.challenge?.target) || 2,
          title: item.challenge?.title || 'Deen challenge',
        });
        if (!ok) toast('Tasbih could not be opened on this device.', 'error');
        return;
      }
      setBusy(item.id, true);
      try {
        if (action === 'accept') await respondToChallenge(item.id, true);
        else if (action === 'decline') await respondToChallenge(item.id, false);
        else {
          const outcome = await completeChallenge(item.id, getDeenFriendsState().profile);
          toast(outcome === 'already' ? 'You already completed this.' : 'Alhamdulillah — marked as done.', 'success');
        }
      } catch (err) {
        logError(`challenge ${action}`, err);
        toast(friendlyMessage(err), 'error');
      } finally {
        setBusy(item.id, false);
      }
    },
    [toast],
  );

  async function react(text: string) {
    if (reacting) return;
    setReacting(text);
    try {
      await sendEncouragement(friendRef, text);
    } catch (err) {
      logError('quick reaction', err);
      toast(friendlyMessage(err), 'error');
    } finally {
      setReacting('');
    }
  }

  function pickAction(action: DeenAction) {
    if (action === 'challenge') setSheet('challenge');
    else if (action === 'encourage') setSheet('encourage');
    else setSheet({ share: action });
  }

  const online = !!friend && Date.now() - friend.lastActiveAt < 120000;
  let lastDay = '';

  return (
    <FullScreen label={`Conversation with ${friendName}`} theme={theme} onClose={onBack}>
      <header className="df2-chat-head">
        <button type="button" className="df2-icon-btn" onClick={onBack} aria-label="Back to chats">
          <Icon name="back" />
        </button>
        <button type="button" className="df2-chat-person" onClick={() => onOpenProfile(friendship.friendUid)}>
          <Avatar avatar={friend?.avatar} config={friend?.avatarConfig} name={friendName} size={40} online={online} />
          <span>
            <strong>{friendName}</strong>
            <small>{friend ? presenceLabel(friend.lastActiveAt) : '…'}</small>
          </span>
        </button>
        <button
          type="button"
          className="df2-icon-btn"
          onClick={() => document.getElementById('rudThemeToggle')?.click()}
          aria-label="Switch light or dark mode"
        >
          <Icon name="moon" />
        </button>
        <button type="button" className="df2-icon-btn" onClick={() => setSheet('settings')} aria-label="Chat settings">
          <Icon name="settings" />
        </button>
      </header>

      <div className="df2-chat-body" ref={listRef} onScroll={onScroll} aria-live="polite">
        {rows === null && !loadError ? (
          <div className="df2-chat-loading">
            <span className="df2-spinner" aria-hidden="true" /> Loading your conversation…
          </div>
        ) : null}
        {loadError && !visibleRows.length ? (
          <div className="df2-chat-empty">
            <strong>{loadError}</strong>
            <button type="button" className="df2-btn df2-btn-primary" onClick={() => setRetryKey((k) => k + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {rows !== null && !visibleRows.length && !loadError ? (
          <div className="df2-chat-empty">
            <span className="df2-kicker">START YOUR DEEN JOURNEY TOGETHER</span>
            <blockquote>
              “Whoever guides someone to goodness will have a reward like the one who did it.”
              <cite>Sahih Muslim 1893</cite>
            </blockquote>
            <div className="df2-chip-row df2-center">
              <button type="button" className="df2-btn df2-btn-primary" onClick={() => setSheet('challenge')}>
                Challenge {friendName.split(' ')[0]}
              </button>
              <button type="button" className="df2-btn" onClick={() => setSheet({ share: 'all' })}>
                Share a reminder
              </button>
            </div>
          </div>
        ) : null}
        {visibleRows.map((item) => {
          const day = localDay(new Date(item.createdAtMs || Date.now()));
          const separator =
            day !== lastDay ? (
              <div className="df2-day-sep" key={`sep-${day}`}>
                <span>{formatDayLabel(item.createdAtMs || Date.now())}</span>
              </div>
            ) : null;
          lastDay = day;
          return [
            separator,
            <InteractionCard
              key={item.id}
              item={item}
              myUid={me?.uid || ''}
              friendName={friendName}
              busy={busyIds.has(item.id)}
              onChallengeAction={onChallengeAction}
            />,
          ];
        })}
      </div>

      <footer className="df2-composer">
        <div className="df2-reactions" role="group" aria-label="Quick reactions">
          {QUICK_REACTIONS.map((r) => (
            <button
              key={r.text}
              type="button"
              className="df2-reaction"
              disabled={!!reacting}
              onClick={() => react(r.text)}
            >
              {reacting === r.text ? '…' : r.text}
            </button>
          ))}
        </div>
        <div className="df2-composer-row">
          <button type="button" className="df2-btn df2-btn-primary df2-composer-main" onClick={() => setSheet('menu')}>
            <Icon name="plus" size={18} /> Deen action
          </button>
          <button
            type="button"
            className="df2-icon-btn df2-composer-icon"
            onClick={() => setSheet({ share: 'quran' })}
            aria-label="Share a Qur’an ayah"
          >
            <Icon name="book" />
          </button>
          <button
            type="button"
            className="df2-icon-btn df2-composer-icon"
            onClick={() => setSheet('challenge')}
            aria-label="Send a challenge"
          >
            <Icon name="target" />
          </button>
        </div>
        <p className="df2-composer-note">
          <Icon name="lock" size={12} /> Private between you two · only Deen actions, no free text
        </p>
      </footer>

      {sheet === 'menu' ? <DeenActionMenu onPick={pickAction} onClose={() => setSheet(null)} /> : null}
      {sheet === 'challenge' ? (
        <ChallengeSheet friend={friendRef} rows={rows || []} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'encourage' ? <EncourageSheet friend={friendRef} onClose={() => setSheet(null)} /> : null}
      {sheet && typeof sheet === 'object' ? (
        <ShareSheet friend={friendRef} initialType={sheet.share} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'settings' ? (
        <ChatSettingsSheet
          conversationId={friendship.id}
          theme={theme}
          onTheme={setTheme}
          canClear
          onCleared={() => setHiddenBefore(clearedBefore(friendship.id))}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </FullScreen>
  );
}
