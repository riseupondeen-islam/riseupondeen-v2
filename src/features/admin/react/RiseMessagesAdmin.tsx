/* Admin › RISE Messages: compose a message from the RISE team to every member or to one member,
 * preview it, confirm the audience, and follow delivery. See services/riseOutreach.ts for how
 * delivery stays idempotent and rule-checked. Drafts stay in this browser tab only and are never
 * sent automatically. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../../../utils/ui';
import { friendlyMessage } from '../../deen-friends/services/errors';
import {
  RISE_TEXT_MAX,
  cancelRequest,
  cleanMessage,
  countReachableMembers,
  hasRiseConversation,
  listenToRequests,
  queueMessageToAll,
  searchMembers,
  sendMessageToMember,
  validateMessage,
  type MemberHit,
  type OutreachRequest,
} from '../services/riseOutreach';
import { Card, ConfirmDialog, DataTable, PageHead, fmtDateTime, requestId, type Column } from './ui';

type Audience = 'user' | 'all';
const DRAFT_KEY = 'rud_admin_rise_draft_v1';

function readDraft(): { audience: Audience; text: string } {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (d && (d.audience === 'all' || d.audience === 'user') && typeof d.text === 'string') return d;
  } catch {
    /* no draft */
  }
  return { audience: 'user', text: '' };
}
function writeDraft(d: { audience: Audience; text: string } | null) {
  try {
    if (d && d.text) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* optional */
  }
}

const STATUS: Record<OutreachRequest['status'], { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'warn' },
  running: { label: 'Delivering', tone: 'info' },
  sent: { label: 'Delivered', tone: 'ok' },
  partial: { label: 'Partly delivered', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: '' },
};
function statusOf(r: OutreachRequest) {
  if (r.status === 'queued' && r.directDeliveredAtMs) return { label: 'Delivered', tone: 'ok' };
  return STATUS[r.status];
}

export function RiseMessagesAdmin() {
  const initial = useMemo(readDraft, []);
  const [audience, setAudience] = useState<Audience>(initial.audience);
  const [text, setText] = useState(initial.text);
  const [member, setMember] = useState<MemberHit | null>(null);
  const [memberHasThread, setMemberHasThread] = useState<boolean | null>(null);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<MemberHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [reach, setReach] = useState<{ count: number; capped: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'info' | 'error'; text: string } | null>(null);
  const [rows, setRows] = useState<OutreachRequest[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const idRef = useRef(requestId('rise'));
  const sendingRef = useRef(false);

  useEffect(() => writeDraft({ audience, text }), [audience, text]);
  useEffect(() => listenToRequests(setRows, (err) => setHistoryError(friendlyMessage(err, 'History could not be loaded.'))), []);
  useEffect(() => {
    if (audience !== 'all' || reach) return;
    countReachableMembers()
      .then(setReach)
      .catch(() => setReach(null));
  }, [audience, reach]);

  // Member search (debounced; stale responses are ignored).
  useEffect(() => {
    const q = search.trim();
    if (q.replace(/^@/, '').length < 2) {
      setHits(null);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchMembers(q)
        .then((list) => alive && setHits(list))
        .catch((err) => alive && (setHits([]), toast(friendlyMessage(err, 'Search failed.'), 'error')))
        .finally(() => alive && setSearching(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [search]);

  useEffect(() => {
    if (!member) {
      setMemberHasThread(null);
      return;
    }
    let alive = true;
    hasRiseConversation(member.uid)
      .then((v) => alive && setMemberHasThread(v))
      .catch(() => alive && setMemberHasThread(null));
    return () => {
      alive = false;
    };
  }, [member]);

  const problem = validateMessage(text);
  const canSend = !problem && (audience === 'all' || (!!member && !member.disabled)) && !sending;
  const body = cleanMessage(text);

  async function send() {
    if (sendingRef.current || !canSend) return;
    sendingRef.current = true;
    setSending(true);
    setResult(null);
    try {
      if (audience === 'all') {
        const r = await queueMessageToAll(idRef.current, text);
        setResult(
          r === 'duplicate'
            ? { tone: 'info', text: 'This message was already queued — it was not sent again.' }
            : { tone: 'ok', text: 'Queued. The scheduler delivers it to every member within a few minutes; progress appears in History below.' },
        );
      } else if (member) {
        const r = await sendMessageToMember(idRef.current, member, text);
        setResult(
          r === 'delivered'
            ? { tone: 'ok', text: `Delivered to ${member.displayName || '@' + member.username}. It is in their RISE conversation now.` }
            : r === 'queued'
              ? { tone: 'info', text: `${member.displayName || '@' + member.username} has no RISE conversation yet. The message is queued and will be delivered within a few minutes.` }
              : { tone: 'info', text: 'This message was already sent — it was not sent again.' },
        );
      }
      // A fresh request id for the next message; the composer is cleared only after success.
      idRef.current = requestId('rise');
      setText('');
      writeDraft(null);
      setConfirming(false);
      toast(audience === 'all' ? 'Message queued for all members.' : 'Message sent.');
    } catch (err) {
      const msg = friendlyMessage(err, 'The message could not be sent. Nothing was delivered.');
      setResult({ tone: 'error', text: msg });
      toast(msg, 'error');
      setConfirming(false);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const columns: Column<OutreachRequest>[] = [
    { key: 'when', label: 'Created', mandatory: true, render: (r) => fmtDateTime(r.createdAtMs), value: (r) => r.createdAtMs, filter: 'date' },
    {
      key: 'audience',
      label: 'Audience',
      render: (r) => (r.audience === 'all' ? <b>All members</b> : r.targetLabel || r.targetUid),
      value: (r) => (r.audience === 'all' ? 'All members' : 'One member'),
      filter: 'select',
    },
    {
      key: 'message',
      label: 'Message',
      render: (r) => <span title={r.text}>{r.text.length > 90 ? `${r.text.slice(0, 90)}…` : r.text}</span>,
      value: (r) => r.text,
      sortable: false,
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => {
        const s = statusOf(r);
        return <span className={`rad-pill ${s.tone ? `rad-pill-${s.tone}` : ''}`}>{s.label}</span>;
      },
      value: (r) => statusOf(r).label,
      filter: 'select',
    },
    {
      key: 'progress',
      label: 'Progress',
      render: (r) =>
        r.audience === 'user' ? (
          r.directDeliveredAtMs || r.status === 'sent' ? '1 delivered' : '—'
        ) : (
          <span>
            {r.delivered.toLocaleString()} delivered
            {r.duplicates ? ` · ${r.duplicates} already had it` : ''}
            {r.skipped ? ` · ${r.skipped} skipped` : ''}
            {r.failed ? <span className="rad-muted"> · {r.failed} failed</span> : ''}
          </span>
        ),
      value: (r) => r.delivered,
      align: 'right',
    },
    { key: 'by', label: 'By', defaultHidden: true, render: (r) => r.createdByEmail || '—', value: (r) => r.createdByEmail },
    {
      key: 'actions',
      label: 'Actions',
      mandatory: true,
      sortable: false,
      render: (r) =>
        r.status === 'queued' && !r.directDeliveredAtMs ? (
          <button
            className="mini-action danger"
            onClick={async () => {
              try {
                await cancelRequest(r.id);
                toast('Cancelled before delivery.');
              } catch (err) {
                toast(friendlyMessage(err, 'It could not be cancelled — delivery may already have started.'), 'error');
              }
            }}
            type="button"
          >
            Cancel
          </button>
        ) : (
          <span className="rad-muted">—</span>
        ),
    },
  ];

  return (
    <div className="rad-rise-messages">
      <PageHead
        kicker="Deen Friends · Official"
        title="RISE Messages"
        description="Send a message from the RISE team. It arrives in each member’s private RISE conversation, exactly like a reply from the team."
      />
      <div className="rad-grid-wide">
        <Card title="Compose" subtitle="Choose who receives it, write, preview, then confirm.">
          <div className="rad-seg" role="radiogroup" aria-label="Audience" style={{ marginBottom: 16 }}>
            <button aria-checked={audience === 'user'} className={audience === 'user' ? 'active' : ''} onClick={() => setAudience('user')} role="radio" type="button">
              One member
            </button>
            <button aria-checked={audience === 'all'} className={audience === 'all' ? 'active' : ''} onClick={() => setAudience('all')} role="radio" type="button">
              All members
            </button>
          </div>

          {audience === 'user' ? (
            member ? (
              <div className="rad-recipient" style={{ marginBottom: 16 }}>
                <span className="rad-avatar" aria-hidden="true">
                  {(member.displayName || member.username || '?').slice(0, 1).toUpperCase()}
                </span>
                <div className="rad-list-main">
                  <strong>{member.displayName || 'Member'}</strong>
                  <small>
                    @{member.username || '—'} ·{' '}
                    {member.disabled
                      ? 'account disabled — cannot receive messages'
                      : memberHasThread === null
                        ? 'checking conversation…'
                        : memberHasThread
                          ? 'has a RISE conversation — delivered instantly'
                          : 'no RISE conversation yet — delivered by the scheduler within minutes'}
                  </small>
                </div>
                <button className="rad-btn rad-btn-sm" onClick={() => (setMember(null), setSearch(''))} type="button">
                  Change
                </button>
              </div>
            ) : (
              <div className="rad-field" style={{ marginBottom: 16 }}>
                <label htmlFor="radRiseRecipient">Recipient</label>
                <input
                  aria-autocomplete="list"
                  autoComplete="off"
                  className="rad-input"
                  id="radRiseRecipient"
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by username, e.g. @aisha"
                  spellCheck={false}
                  type="search"
                  value={search}
                />
                {searching ? <small>Searching…</small> : null}
                {hits ? (
                  hits.length ? (
                    <div className="rad-results" role="listbox" aria-label="Matching members">
                      {hits.map((h) => (
                        <button aria-selected="false" key={h.uid} onClick={() => (setMember(h), setHits(null))} role="option" type="button">
                          <span className="rad-avatar" aria-hidden="true">
                            {(h.displayName || h.username || '?').slice(0, 1).toUpperCase()}
                          </span>
                          <span>
                            <b>{h.displayName || 'Member'}</b> <small>@{h.username}</small>
                            {h.disabled ? <small> · disabled</small> : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <small>No member with that username.</small>
                  )
                ) : null}
              </div>
            )
          ) : (
            <div className="rad-alert rad-alert-warn" style={{ marginBottom: 16 }}>
              This message will reach <b>every Deen Friends member</b>
              {reach ? ` (about ${reach.count.toLocaleString()}${reach.capped ? '+' : ''} today)` : ''}. Members whose accounts are disabled or being
              deleted are skipped. You will be asked to confirm before anything is sent.
            </div>
          )}

          <div className="rad-field">
            <label htmlFor="radRiseText">Message</label>
            <textarea
              className="rad-input"
              id="radRiseText"
              maxLength={RISE_TEXT_MAX}
              onChange={(e) => setText(e.target.value)}
              placeholder="Assalamu alaikum! …"
              rows={7}
              value={text}
            />
            <span className="rad-counter">
              {body.length.toLocaleString()} / {RISE_TEXT_MAX.toLocaleString()}
            </span>
          </div>
          {result ? (
            <div className={`rad-alert ${result.tone === 'error' ? 'rad-alert-error' : result.tone === 'info' ? 'rad-alert-warn' : 'rad-alert-info'}`} role="status" style={{ marginTop: 14 }}>
              {result.text}
            </div>
          ) : null}
          <div className="rad-actions" style={{ marginTop: 16 }}>
            <button className="rad-btn rad-btn-primary" disabled={!canSend} onClick={() => setConfirming(true)} type="button">
              {audience === 'all' ? 'Review & send to all' : 'Review & send'}
            </button>
            {text ? (
              <button className="rad-btn" disabled={sending} onClick={() => (setText(''), setResult(null))} type="button">
                Clear
              </button>
            ) : null}
            <span className="rad-muted" style={{ fontSize: 12 }}>
              Drafts stay in this tab only and are never sent automatically.
            </span>
          </div>
        </Card>

        <Card title="Preview" subtitle="How it appears in the member’s RISE conversation">
          {body ? (
            <div className="df2-admin-messages" style={{ minHeight: 160 }}>
              <article className="df2-msg df2-msg-bubble df2-msg-text mine">
                <p>{body}</p>
                <span className="df2-msg-meta">RISE team · now</span>
              </article>
            </div>
          ) : (
            <div className="rad-empty">Start writing to see a preview.</div>
          )}
        </Card>
      </div>

      <Card title="History" subtitle="The latest 30 messages sent from the console, with live delivery progress.">
        {historyError ? <div className="rad-alert rad-alert-error">{historyError}</div> : null}
        {rows === null && !historyError ? <p className="rad-loading">Loading history…</p> : null}
        {rows ? <DataTable columns={columns} empty="No messages have been sent from the console yet." id="rise-outreach-history" rowKey={(r) => r.id} rows={rows} searchPlaceholder="Search messages…" /> : null}
      </Card>

      {confirming ? (
        <ConfirmDialog
          busy={sending}
          busyLabel="Sending…"
          confirmLabel={audience === 'all' ? 'Send to all members' : 'Send message'}
          danger={audience === 'all'}
          onCancel={() => !sending && setConfirming(false)}
          onConfirm={() => void send()}
          title={audience === 'all' ? 'Send to every member?' : 'Send this message?'}
          typed={audience === 'all' ? 'SEND TO ALL' : undefined}
        >
          <p>
            {audience === 'all' ? (
              <>
                This message goes to <b>every Deen Friends member</b>
                {reach ? ` (about ${reach.count.toLocaleString()}${reach.capped ? '+' : ''})` : ''} as a message from the RISE team. It cannot be unsent
                once delivery starts.
              </>
            ) : (
              <>
                To <b>{member?.displayName || 'this member'}</b> (@{member?.username}) as a message from the RISE team.
              </>
            )}
          </p>
          <div className="rad-preview-card" style={{ marginTop: 12 }}>
            <p className="rad-prewrap">{body.length > 600 ? `${body.slice(0, 600)}…` : body}</p>
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
