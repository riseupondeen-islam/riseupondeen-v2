/* The official conversation with the RiseUponDeen team. Users write normal text here. */
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { RiseMessage } from '../types';
import { classifyError, friendlyMessage, logError } from '../services/errors';
import { formatClock, formatDayLabel, localDay } from '../services/format';
import {
  RISE_MESSAGE_MAX,
  ensureRiseThread,
  listenToRiseMessages,
  markRiseThreadRead,
  newRiseMessageId,
  sendRiseMessage,
} from '../services/riseChatService';
import { useDeenFriends } from '../state/deenFriendsStore';
import { ChatSettingsSheet, readChatTheme, type ChatThemeId } from './ChatSettingsSheet';
import { FullScreen } from './FullScreen';
import { Icon, useToast } from './ui';

interface Outgoing {
  id: string;
  text: string;
  state: 'sending' | 'failed';
  error?: string;
}

const RISE_THREAD_THEME_ID = 'rise-official';

export function RiseChatScreen({ onBack }: { onBack: () => void }) {
  const s = useDeenFriends();
  const toast = useToast();
  const [rows, setRows] = useState<RiseMessage[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState('');
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ChatThemeId>(() => readChatTheme(RISE_THREAD_THEME_ID));
  const listRef = useRef<HTMLDivElement>(null);
  const profile = s.profile;
  const thread = s.riseThread;

  // Create the thread + one-time welcome (idempotent), then listen for messages.
  useEffect(() => {
    if (!profile) return;
    let stop = () => undefined as void;
    let cancelled = false;
    setLoadError('');
    setRows(null);
    void ensureRiseThread(profile)
      .catch((error) => logError('RISE thread setup', error))
      .finally(() => {
        if (cancelled) return;
        stop = listenToRiseMessages(
          null,
          (next) => setRows(next),
          (error) => {
            logError('RISE messages listener', error);
            setLoadError(
              classifyError(error) === 'permission'
                ? 'The RISE conversation is not available on this server yet. Please try again in a little while.'
                : friendlyMessage(error, 'The conversation could not be loaded.'),
            );
          },
        );
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [profile?.uid, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening the conversation clears my unread counter.
  useEffect(() => {
    if (thread?.unreadByUser) void markRiseThreadRead(thread).catch((e) => logError('RISE read receipt', e));
  }, [thread?.unreadByUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server copies replace local "sending" bubbles as soon as they arrive.
  useEffect(() => {
    if (!rows) return;
    const ids = new Set(rows.map((r) => r.id));
    setOutgoing((list) => list.filter((o) => !ids.has(o.id)));
  }, [rows]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows?.length, outgoing.length]);

  async function deliver(item: Outgoing) {
    if (!profile) return;
    setOutgoing((list) => list.map((o) => (o.id === item.id ? { ...o, state: 'sending', error: undefined } : o)));
    try {
      await sendRiseMessage(profile, item.text, item.id, thread);
    } catch (err) {
      logError('RISE send', err);
      // The same id is reused on retry, so a message that did reach the server is never duplicated.
      setOutgoing((list) =>
        list.map((o) => (o.id === item.id ? { ...o, state: 'failed', error: friendlyMessage(err) } : o)),
      );
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (text.length > RISE_MESSAGE_MAX) {
      toast(`Please keep messages under ${RISE_MESSAGE_MAX} characters.`, 'error');
      return;
    }
    const item: Outgoing = { id: newRiseMessageId(), text, state: 'sending' };
    setOutgoing((list) => [...list, item]);
    setDraft('');
    void deliver(item);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on desktop; Shift+Enter (and the mobile keyboard's return) adds a new line.
    if (event.key === 'Enter' && !event.shiftKey && window.matchMedia('(pointer: fine)').matches) {
      event.preventDefault();
      submit();
    }
  }

  let lastDay = '';
  const all = rows || [];
  return (
    <FullScreen label="Conversation with RISE" theme={theme} onClose={onBack}>
      <header className="df2-chat-head">
        <button type="button" className="df2-icon-btn" onClick={onBack} aria-label="Back to chats">
          <Icon name="back" />
        </button>
        <div className="df2-chat-person">
          <span className="df2-rise-mark" aria-hidden="true">
            <Icon name="moon" size={22} />
          </span>
          <span>
            <strong>
              RISE <Icon name="verified" size={15} label="Official account" />
            </strong>
            <small>The RiseUponDeen team · usually replies within a few days</small>
          </span>
        </div>
        <button
          type="button"
          className="df2-icon-btn"
          onClick={() => document.getElementById('rudThemeToggle')?.click()}
          aria-label="Switch light or dark mode"
        >
          <Icon name="moon" />
        </button>
        <button type="button" className="df2-icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Chat settings">
          <Icon name="settings" />
        </button>
      </header>

      <div className="df2-chat-body" ref={listRef} aria-live="polite">
        {rows === null && !loadError ? (
          <div className="df2-chat-loading">
            <span className="df2-spinner" aria-hidden="true" /> Opening your conversation with RISE…
          </div>
        ) : null}
        {loadError && !all.length ? (
          <div className="df2-chat-empty" role="alert">
            <strong>{loadError}</strong>
            <button type="button" className="df2-btn df2-btn-soft df2-btn-sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {all.map((m) => {
          const day = localDay(new Date(m.createdAtMs || Date.now()));
          const sep =
            day !== lastDay ? (
              <div className="df2-day-sep" key={`sep-${day}`}>
                <span>{formatDayLabel(m.createdAtMs || Date.now())}</span>
              </div>
            ) : null;
          lastDay = day;
          const mine = m.from === 'user';
          return [
            sep,
            <article
              key={m.id}
              className={`df2-msg df2-msg-bubble df2-msg-text ${mine ? 'mine' : 'theirs'}${m.automated ? ' automated' : ''}`}
            >
              {m.automated ? (
                <span className="df2-automated-label">Automated message</span>
              ) : !mine ? (
                <span className="df2-automated-label">RISE team</span>
              ) : null}
              <p>{m.text}</p>
              <span className="df2-msg-meta">{m.pending ? 'Sending…' : formatClock(m.createdAtMs)}</span>
            </article>,
          ];
        })}
        {outgoing.map((o) => (
          <article
            key={o.id}
            className={`df2-msg df2-msg-bubble df2-msg-text mine${o.state === 'failed' ? ' failed' : ''}`}
          >
            <p>{o.text}</p>
            <span className="df2-msg-meta">
              {o.state === 'sending' ? (
                'Sending…'
              ) : (
                <>
                  {o.error || 'Not sent.'}{' '}
                  <button type="button" className="df2-link-btn" onClick={() => void deliver(o)}>
                    Retry
                  </button>
                </>
              )}
            </span>
          </article>
        ))}
      </div>

      <form className="df2-composer df2-composer-text" onSubmit={submit}>
        <label className="df2-visually-hidden" htmlFor="df2RiseDraft">
          Message to RISE
        </label>
        <textarea
          id="df2RiseDraft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write to RISE — a question, a feeling, a problem or a suggestion"
          rows={1}
          maxLength={RISE_MESSAGE_MAX}
        />
        <button type="submit" className="df2-send-btn" disabled={!draft.trim()} aria-label="Send message">
          <Icon name="send" />
        </button>
        <p className="df2-composer-note">
          <Icon name="lock" size={12} /> Only you and the RiseUponDeen support team can read this conversation. In an
          emergency, contact local emergency services.
        </p>
      </form>

      {settingsOpen ? (
        <ChatSettingsSheet
          conversationId={RISE_THREAD_THEME_ID}
          theme={theme}
          onTheme={setTheme}
          canClear={false}
          onCleared={() => undefined}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </FullScreen>
  );
}
