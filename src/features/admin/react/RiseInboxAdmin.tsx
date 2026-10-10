/* Admin › RISE Inbox: support conversations users started with the official RISE account.
 * Readable only by support-level admins (firestore.rules); each opened thread is audit-logged. */
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from '../../../utils/ui';
import type { RiseMessage, RiseThread } from '../../deen-friends/types';
import { friendlyMessage } from '../../deen-friends/services/errors';
import { formatClock, formatDayLabel } from '../../deen-friends/services/format';
import {
  adminClearThread,
  adminLogThreadAccess,
  adminMarkThreadSeen,
  adminReply,
  adminSetThreadStatus,
  listenToRiseInbox,
  listenToRiseMessages,
} from '../../deen-friends/services/riseChatService';

export function RiseInboxAdmin() {
  const [threads, setThreads] = useState<RiseThread[] | null>(null);
  const [error, setError] = useState('');
  const [openUid, setOpenUid] = useState('');
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');

  useEffect(
    () =>
      listenToRiseInbox(
        (rows) => setThreads(rows),
        (err) => {
          setError(friendlyMessage(err, 'The inbox could not be loaded. Your role may not include support access.'));
          setThreads([]);
        },
      ),
    [],
  );

  const open = threads?.find((t) => t.uid === openUid) || null;
  if (open) return <ThreadView thread={open} onBack={() => setOpenUid('')} />;
  // A user can write again after an issue was solved: unread messages always show under "Open".
  const visible = (threads || []).filter(
    (t) => filter === 'all' || (filter === 'open' ? t.status === 'open' || t.unreadByRise > 0 : t.status === 'resolved'),
  );

  return (
    <section className="df2-admin-view">
      <header className="df2-admin-head">
        <div>
          <span className="df2-kicker">OFFICIAL · PRIVATE</span>
          <h1>RISE Inbox</h1>
          <p>Messages users send to the RISE team. Opening a conversation is recorded in the admin audit log.</p>
        </div>
        <div className="df2-segmented">
          {(['open', 'resolved', 'all'] as const).map((f) => (
            <button key={f} type="button" className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </header>
      {error ? <p className="df2-form-error">{error}</p> : null}
      {threads === null ? <p className="df2-inline-note">Loading…</p> : null}
      {threads && !visible.length && !error ? <p className="df2-inline-note">No conversations here.</p> : null}
      <div className="df2-admin-list">
        {visible.map((t) => (
          <button
            key={t.uid}
            type="button"
            className="df2-card df2-admin-row df2-admin-thread"
            onClick={() => setOpenUid(t.uid)}
          >
            <div className="df2-admin-row-main">
              <strong>
                {t.displayName || 'User'} <small>@{t.username}</small>
              </strong>
              <small>
                {t.lastFrom === 'rise' ? 'RISE: ' : ''}
                {t.lastMessagePreview}
              </small>
            </div>
            <div className="df2-admin-actions">
              {t.unreadByRise ? <span className="df2-badge">{t.unreadByRise}</span> : null}
              <small>{formatDayLabel(t.lastMessageAtMs)}</small>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ThreadView({ thread, onBack }: { thread: RiseThread; onBack: () => void }) {
  const [rows, setRows] = useState<RiseMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [clearBusy, setClearBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // The RISE side has seen the conversation (needed before the 24-hour retention can start).
  useEffect(() => {
    if (document.hidden) return;
    void adminMarkThreadSeen(thread.uid, thread).catch(() => undefined);
  }, [thread.uid, thread.lastMessageAtMs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void adminLogThreadAccess(thread.uid).catch((err) => setError(friendlyMessage(err, 'Access could not be logged.')));
    return listenToRiseMessages(
      thread.uid,
      (next) => setRows(next),
      (err) => setError(friendlyMessage(err, 'Messages could not be loaded.')),
    );
  }, [thread.uid]);
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [rows?.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await adminReply(thread.uid, draft, thread);
      setDraft('');
    } catch (err) {
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="df2-admin-view df2-admin-thread-view">
      <header className="df2-admin-head">
        <div>
          <span className="df2-kicker">CONVERSATION</span>
          <h1>
            {thread.displayName} <small>@{thread.username}</small>
          </h1>
        </div>
        <div className="df2-admin-actions">
          <button
            type="button"
            className="df2-btn df2-btn-sm"
            onClick={async () => {
              try {
                await adminSetThreadStatus(thread.uid, thread.status === 'open' ? 'resolved' : 'open');
              } catch (err) {
                toast(friendlyMessage(err), 'error');
              }
            }}
          >
            Mark {thread.status === 'open' ? 'resolved' : 'open'}
          </button>
          {thread.status === 'resolved' ? (
            <button type="button" className="df2-btn df2-btn-sm df2-btn-danger" onClick={() => setClearing(true)}>
              Clear chat
            </button>
          ) : null}
          <button type="button" className="df2-btn df2-btn-sm" onClick={onBack}>
            Back
          </button>
        </div>
      </header>
      <p className="df2-inline-note rud-retention-note">
        {thread.status === 'resolved'
          ? 'Solved. Messages both sides have seen are removed automatically 24 hours later (the automated welcome is kept).'
          : 'Open. Messages are kept until the issue is marked solved.'}
        {thread.clearedAtMs ? ` Last cleared ${formatDayLabel(thread.clearedAtMs)} ${formatClock(thread.clearedAtMs)}.` : ''}
      </p>
      {clearing ? (
        <div className="df2-card rud-clear-confirm" role="alertdialog" aria-labelledby="rudClearTitle" aria-describedby="rudClearBody">
          <h2 id="rudClearTitle">Clear this conversation?</h2>
          <p id="rudClearBody">
            This permanently deletes every message in the conversation with <strong>{thread.displayName}</strong> (@{thread.username}) except the
            automated welcome. It cannot be undone. Type <strong>@{thread.username}</strong> to confirm.
          </p>
          <input
            className="df2-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={`@${thread.username}`}
            aria-label="Type the username to confirm"
            autoFocus
          />
          <div className="df2-admin-actions">
            <button type="button" className="df2-btn df2-btn-sm" disabled={clearBusy} onClick={() => setClearing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="df2-btn df2-btn-sm df2-btn-danger"
              disabled={clearBusy || confirmText.trim().replace(/^@+/, '').toLowerCase() !== thread.username.toLowerCase()}
              onClick={async () => {
                setClearBusy(true);
                try {
                  const n = await adminClearThread(thread.uid, thread, confirmText);
                  toast(n ? `Cleared ${n} message${n === 1 ? '' : 's'}.` : 'Nothing to clear — only the welcome message remains.');
                  setClearing(false);
                  setConfirmText('');
                } catch (err) {
                  toast(friendlyMessage(err, 'The conversation could not be cleared.'), 'error');
                } finally {
                  setClearBusy(false);
                }
              }}
            >
              {clearBusy ? 'Clearing…' : 'Clear chat'}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="df2-form-error">{error}</p> : null}
      <div className="df2-admin-messages" ref={listRef}>
        {rows?.map((m) => (
          <article
            key={m.id}
            className={`df2-msg df2-msg-bubble df2-msg-text ${m.from === 'rise' ? 'mine' : 'theirs'}${m.automated ? ' automated' : ''}`}
          >
            {m.automated ? <span className="df2-automated-label">Automated welcome</span> : null}
            <p>{m.text}</p>
            <span className="df2-msg-meta">
              {formatDayLabel(m.createdAtMs)} {formatClock(m.createdAtMs)}
            </span>
          </article>
        ))}
      </div>
      <form className="df2-composer-text df2-admin-reply" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Reply as the RISE team"
          aria-label="Reply"
        />
        <button type="submit" className="df2-btn df2-btn-primary" disabled={busy || !draft.trim()}>
          {busy ? 'Sending…' : 'Send reply'}
        </button>
      </form>
    </section>
  );
}
