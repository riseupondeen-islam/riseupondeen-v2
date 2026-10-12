/* Admin › RISE Inbox: support conversations users started with the official RISE account.
 * Readable only by support-level admins (firestore.rules); each opened thread is audit-logged.
 * The list is a live Firestore listener, so replies, status changes and deletions appear (and stay
 * gone) without a refresh. Deletion tools: services/riseInboxAdmin.ts. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { deleteRiseConversation, deleteRiseMessage, isSuperAdminSession } from '../services/riseInboxAdmin';
import { ConfirmDialog, PageHead } from './ui';

type Filter = 'open' | 'resolved' | 'all';

export function RiseInboxAdmin() {
  const [threads, setThreads] = useState<RiseThread[] | null>(null);
  const [error, setError] = useState('');
  const [openUid, setOpenUid] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<RiseThread | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const superAdmin = isSuperAdminSession();

  useEffect(
    () =>
      listenToRiseInbox(
        (rows) => {
          setThreads(rows);
          setError('');
        },
        (err) => {
          setError(friendlyMessage(err, 'The inbox could not be loaded. Your role may not include support access.'));
          setThreads((t) => t || []);
        },
      ),
    [],
  );

  const counts = useMemo(() => {
    const list = threads || [];
    return {
      open: list.filter((t) => t.status === 'open' || t.unreadByRise > 0).length,
      resolved: list.filter((t) => t.status === 'resolved').length,
      all: list.length,
      unread: list.filter((t) => t.unreadByRise > 0).length,
    };
  }, [threads]);

  const open = threads?.find((t) => t.uid === openUid) || null;
  // The conversation was deleted (or no longer exists): return to the list.
  useEffect(() => {
    if (openUid && threads && !open) setOpenUid('');
  }, [openUid, threads, open]);
  const deleteDialog = deleting ? (
    <DeleteConversationDialog
      busy={deleteBusy}
      onCancel={() => setDeleting(null)}
      onConfirm={async (typed) => {
        setDeleteBusy(true);
        try {
          const n = await deleteRiseConversation(deleting, typed);
          toast(`Conversation deleted (${n} message${n === 1 ? '' : 's'}).`);
          setDeleting(null);
          setOpenUid('');
        } catch (err) {
          toast(friendlyMessage(err, 'The conversation could not be deleted. Nothing was removed.'), 'error');
        } finally {
          setDeleteBusy(false);
        }
      }}
      thread={deleting}
    />
  ) : null;
  if (open)
    return (
      <>
        <ThreadView thread={open} onBack={() => setOpenUid('')} onDelete={superAdmin ? () => setDeleting(open) : undefined} deleting={deleting} />
        {deleteDialog}
      </>
    );

  const q = search.trim().toLowerCase().replace(/^@/, '');
  // A user can write again after an issue was solved: unread messages always show under "Open".
  const visible = (threads || []).filter(
    (t) =>
      (filter === 'all' || (filter === 'open' ? t.status === 'open' || t.unreadByRise > 0 : t.status === 'resolved')) &&
      (!q || `${t.displayName} ${t.username} ${t.lastMessagePreview}`.toLowerCase().includes(q)),
  );

  return (
    <section className="df2-admin-view">
      <PageHead
        kicker="Official · Private"
        title="RISE Inbox"
        description="Messages members send to the RISE team. Opening a conversation is recorded in the admin audit log."
        actions={
          <div className="df2-segmented" role="group" aria-label="Show conversations">
            {(['open', 'resolved', 'all'] as const).map((f) => (
              <button aria-pressed={filter === f} className={filter === f ? 'active' : ''} key={f} onClick={() => setFilter(f)} type="button">
                {f[0].toUpperCase() + f.slice(1)} <small className="rad-muted">{threads ? counts[f] : ''}</small>
              </button>
            ))}
          </div>
        }
      />
      <div className="rad-tablebar">
        <div className="rad-tablebar-main">
          <label className="rad-tablebar-search">
            <span className="rad-sr">Search conversations</span>
            <input onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, @username or message…" type="search" value={search} />
          </label>
          <span className="rad-tablebar-count" aria-live="polite">
            {threads ? `${visible.length} conversation${visible.length === 1 ? '' : 's'} · ${counts.unread} awaiting a reply` : ''}
          </span>
        </div>
      </div>
      {error ? <p className="df2-form-error">{error}</p> : null}
      {threads === null && !error ? <p className="rad-loading">Loading conversations…</p> : null}
      {threads && !visible.length && !error ? <p className="rad-empty">{q ? 'No conversation matches your search.' : 'No conversations here.'}</p> : null}
      <div className="df2-admin-list">
        {visible.map((t) => (
          <button className="df2-card df2-admin-row df2-admin-thread" key={t.uid} onClick={() => setOpenUid(t.uid)} type="button">
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
              <span className={`rad-pill ${t.status === 'resolved' ? 'rad-pill-ok' : 'rad-pill-warn'}`}>{t.status === 'resolved' ? 'Solved' : 'Open'}</span>
              {t.unreadByRise ? <span className="df2-badge">{t.unreadByRise}</span> : null}
              <small>{formatDayLabel(t.lastMessageAtMs)}</small>
            </div>
          </button>
        ))}
      </div>
      {deleteDialog}
    </section>
  );
}

function DeleteConversationDialog({
  thread,
  busy,
  onCancel,
  onConfirm,
}: {
  thread: RiseThread;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (typed: string) => void;
}) {
  const handle = `@${thread.username || thread.uid}`;
  return (
    <ConfirmDialog
      busy={busy}
      busyLabel="Deleting…"
      confirmLabel="Delete conversation"
      danger
      onCancel={onCancel}
      onConfirm={() => onConfirm(handle)}
      title="Delete this conversation?"
      typed={handle}
    >
      <p>
        This permanently deletes every message in the RISE conversation with <b>{thread.displayName || 'this member'}</b> ({handle}) and removes it from the inbox. The
        member’s account and everything else are not touched. If they write to RISE again later, a new conversation starts.
      </p>
    </ConfirmDialog>
  );
}

function ThreadView({
  thread,
  onBack,
  onDelete,
  deleting,
}: {
  thread: RiseThread;
  onBack: () => void;
  onDelete?: () => void;
  deleting: RiseThread | null;
}) {
  const [rows, setRows] = useState<RiseMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [clearBusy, setClearBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [removing, setRemoving] = useState<RiseMessage | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const superAdmin = isSuperAdminSession();

  // The RISE side has seen the conversation (needed before the 24-hour retention can start).
  useEffect(() => {
    if (document.hidden || deleting) return;
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
            className="df2-btn df2-btn-sm"
            disabled={statusBusy}
            onClick={async () => {
              setStatusBusy(true);
              try {
                await adminSetThreadStatus(thread.uid, thread.status === 'open' ? 'resolved' : 'open');
              } catch (err) {
                toast(friendlyMessage(err), 'error');
              } finally {
                setStatusBusy(false);
              }
            }}
            type="button"
          >
            Mark {thread.status === 'open' ? 'resolved' : 'open'}
          </button>
          {thread.status === 'resolved' ? (
            <button className="df2-btn df2-btn-sm df2-btn-danger" onClick={() => setClearing(true)} type="button">
              Clear chat
            </button>
          ) : null}
          {onDelete ? (
            <button className="df2-btn df2-btn-sm df2-btn-ghost-danger" onClick={onDelete} type="button">
              Delete conversation
            </button>
          ) : null}
          <button className="df2-btn df2-btn-sm" onClick={onBack} type="button">
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
        <div aria-describedby="rudClearBody" aria-labelledby="rudClearTitle" className="df2-card rud-clear-confirm" role="alertdialog">
          <h2 id="rudClearTitle">Clear this conversation?</h2>
          <p id="rudClearBody">
            This permanently deletes every message in the conversation with <strong>{thread.displayName}</strong> (@{thread.username}) except the automated welcome. It
            cannot be undone. Type <strong>@{thread.username}</strong> to confirm.
          </p>
          <input
            aria-label="Type the username to confirm"
            autoFocus
            className="df2-input"
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={`@${thread.username}`}
            value={confirmText}
          />
          <div className="df2-admin-actions">
            <button className="df2-btn df2-btn-sm" disabled={clearBusy} onClick={() => setClearing(false)} type="button">
              Cancel
            </button>
            <button
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
              type="button"
            >
              {clearBusy ? 'Clearing…' : 'Clear chat'}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="df2-form-error">{error}</p> : null}
      <div className="df2-admin-messages" ref={listRef}>
        {rows === null && !error ? <p className="rad-loading">Loading messages…</p> : null}
        {rows?.map((m) => (
          <article className={`df2-msg df2-msg-bubble df2-msg-text ${m.from === 'rise' ? 'mine' : 'theirs'}${m.automated ? ' automated' : ''}`} key={m.id}>
            {m.automated ? <span className="df2-automated-label">Automated welcome</span> : null}
            <p>{m.text}</p>
            <span className="df2-msg-meta">
              {formatDayLabel(m.createdAtMs)} {formatClock(m.createdAtMs)}
              {superAdmin && !m.automated && !m.pending ? (
                <button aria-label="Delete this message" className="rad-link-btn" onClick={() => setRemoving(m)} style={{ padding: '0 2px', fontSize: 11 }} type="button">
                  Delete
                </button>
              ) : null}
            </span>
          </article>
        ))}
      </div>
      <form className="df2-composer-text df2-admin-reply" onSubmit={send}>
        <textarea aria-label="Reply" maxLength={2000} onChange={(e) => setDraft(e.target.value)} placeholder="Reply as the RISE team" rows={2} value={draft} />
        <button className="df2-btn df2-btn-primary" disabled={busy || !draft.trim()} type="submit">
          {busy ? 'Sending…' : 'Send reply'}
        </button>
      </form>
      {removing ? (
        <ConfirmDialog
          busy={removeBusy}
          busyLabel="Deleting…"
          confirmLabel="Delete message"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            setRemoveBusy(true);
            try {
              await deleteRiseMessage(thread, removing.id);
              toast('Message deleted.');
              setRemoving(null);
            } catch (err) {
              toast(friendlyMessage(err, 'The message could not be deleted.'), 'error');
            } finally {
              setRemoveBusy(false);
            }
          }}
          title="Delete this message?"
        >
          <p>It is removed permanently for both the member and the RISE team.</p>
          <div className="rad-preview-card" style={{ marginTop: 10 }}>
            <p className="rad-prewrap">{removing.text.length > 400 ? `${removing.text.slice(0, 400)}…` : removing.text}</p>
          </div>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
