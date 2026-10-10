/* Deen circles (group chats): creation, the full-screen circle conversation and circle details.
 * Same Deen-action messaging as one-to-one chats (no free text), same themes and full-screen shell. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AvatarKey } from '../types';
import { AVATAR_KEYS } from '../types';
import { friendlyMessage, logError } from '../services/errors';
import { formatClock, formatDayLabel, localDay } from '../services/format';
import {
  MIN_GROUP_SIZE,
  addGroupMember,
  createGroup,
  groupSizeMessage,
  listenToGroupMessages,
  removeGroupMember,
  renameGroup,
  sendGroupEncouragement,
  shareToGroup,
  validateGroup,
  type DeenGroup,
  type GroupMessage,
} from '../services/groupService';
import { QUICK_REACTIONS } from '../services/interactionService';
import { ensureProfiles, useDeenFriends } from '../state/deenFriendsStore';
import { goToDeenFriends } from '../deenFriendsRoute';
import { ChatSettingsSheet, readChatTheme, type ChatThemeId } from './ChatSettingsSheet';
import { EncourageSheet, ShareSheet } from './DeenActionSheets';
import { FullScreen } from './FullScreen';
import { SharedContentCard } from './SharedContentCard';
import { AVATAR_LABELS, Avatar, ConfirmSheet, EmptyState, Icon, Sheet, useToast } from './ui';

/* ---------- create ---------- */

export function CreateGroupSheet({ onClose }: { onClose: () => void }) {
  const s = useDeenFriends();
  const toast = useToast();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<AvatarKey>('mosque');
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const friendUids = s.friendships.map((f) => f.friendUid);
  const size = groupSizeMessage(picked.length);
  const myUid = s.profile?.uid || '';

  const friends = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return s.friendships
      .map((f) => ({ uid: f.friendUid, profile: s.profiles[f.friendUid] }))
      .filter(({ profile }) => !term || `${profile?.displayName || ''} ${profile?.username || ''}`.toLowerCase().includes(term));
  }, [s.friendships, s.profiles, filter]);

  const toggle = (uid: string) => setPicked((list) => (list.includes(uid) ? list.filter((u) => u !== uid) : [...list, uid]));

  async function create() {
    setBusy(true);
    setError('');
    try {
      const id = await createGroup(name, avatar, picked, friendUids);
      toast('Your Deen circle is ready.', 'success');
      onClose();
      goToDeenFriends({ groupId: id });
    } catch (err) {
      logError('create group', err);
      setError(friendlyMessage(err));
      setStep('form');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'confirm') {
    return (
      <Sheet
        title="Create this circle?"
        kicker="CONFIRM"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="df2-btn" onClick={() => setStep('form')} disabled={busy}>
              Back
            </button>
            <button type="button" className="df2-btn df2-btn-primary" onClick={() => void create()} disabled={busy}>
              {busy ? 'Creating…' : 'Create circle'}
            </button>
          </>
        }
      >
        <div className="df2-group-confirm">
          <Avatar avatar={avatar} name={name} size={56} />
          <div>
            <strong>{name.trim()}</strong>
            <small>{picked.length + 1} participants including you</small>
          </div>
        </div>
        <ul className="df2-group-members-preview">
          {picked.map((uid) => (
            <li key={uid}>{s.profiles[uid]?.displayName || 'Deen Friend'}</li>
          ))}
        </ul>
        <p className="df2-footnote">Everyone you add can see the circle and its shared reminders. Circles use Deen actions only — no free text.</p>
      </Sheet>
    );
  }

  const problem = validateGroup(name, picked, friendUids, myUid);
  return (
    <Sheet
      title="New Deen circle"
      kicker="GROUP"
      onClose={onClose}
      wide
      footer={
        <>
          <span className={`df2-group-count${size.ok ? ' ok' : ''}`} role="status" aria-live="polite" data-testid="group-count">
            {size.text}
          </span>
          <button type="button" className="df2-btn df2-btn-primary" disabled={!!problem} onClick={() => setStep('confirm')}>
            Continue
          </button>
        </>
      }
    >
      <label className="df2-field">
        <span>Circle name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Fajr Friends" />
      </label>
      <fieldset className="df2-fieldset">
        <legend>Circle image</legend>
        <div className="df2-avatar-picker df2-avatar-picker-sm">
          {AVATAR_KEYS.map((key) => (
            <button key={key} type="button" className={avatar === key ? 'active' : ''} aria-pressed={avatar === key} onClick={() => setAvatar(key)}>
              <Avatar avatar={key} name={key} size={40} />
              <small>{AVATAR_LABELS[key]}</small>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="df2-fieldset">
        <legend>
          Participants <small>(at least {MIN_GROUP_SIZE} including you)</small>
        </legend>
        {s.friendships.length < MIN_GROUP_SIZE - 1 ? (
          <EmptyState icon="people" title={`You need ${MIN_GROUP_SIZE - 1} Deen Friends to start a circle`}>
            <p>
              You have {s.friendships.length}. Add {MIN_GROUP_SIZE - 1 - s.friendships.length} more from the Friends tab — only people who
              accepted your request can be added.
            </p>
          </EmptyState>
        ) : (
          <>
            {s.friendships.length > 8 ? (
              <input className="df2-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search friends" aria-label="Search friends" />
            ) : null}
            <ul className="df2-pick-list">
              {friends.map(({ uid, profile }) => {
                const on = picked.includes(uid);
                return (
                  <li key={uid}>
                    <label className={`df2-pick${on ? ' on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(uid)} />
                      <Avatar avatar={profile?.avatar} config={profile?.avatarConfig} name={profile?.displayName || ''} size={36} />
                      <span>
                        <strong>{profile?.displayName || 'Deen Friend'}</strong>
                        <small>@{profile?.username || '…'}</small>
                      </span>
                      <i className="df2-pick-check" aria-hidden="true">
                        {on ? <Icon name="check" size={14} /> : null}
                      </i>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </fieldset>
      {error ? <p className="df2-form-error" role="alert">{error}</p> : null}
    </Sheet>
  );
}

/* ---------- conversation ---------- */

export function GroupChatScreen({ group, onBack, onOpenProfile }: { group: DeenGroup; onBack: () => void; onOpenProfile: (uid: string) => void }) {
  const s = useDeenFriends();
  const toast = useToast();
  const me = s.profile;
  const [rows, setRows] = useState<GroupMessage[] | null>(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<null | 'encourage' | 'share' | 'details' | 'settings'>(null);
  const [theme, setTheme] = useState<ChatThemeId>(() => readChatTheme(`group_${group.id}`));
  const [reacting, setReacting] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    void ensureProfiles(group.members);
  }, [group.members]);
  useEffect(
    () =>
      listenToGroupMessages(
        group.id,
        (next) => setRows(next),
        (err) => {
          logError('group messages', err);
          setError(friendlyMessage(err, 'This circle could not be loaded.'));
          setRows((r) => r || []);
        },
      ),
    [group.id],
  );
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows?.length]);
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  async function react(text: string) {
    if (reacting) return;
    setReacting(text);
    try {
      await sendGroupEncouragement(group, text);
    } catch (err) {
      toast(friendlyMessage(err), 'error');
    } finally {
      setReacting('');
    }
  }

  let lastDay = '';
  return (
    <FullScreen label={`Deen circle ${group.name}`} theme={theme} onClose={onBack}>
      <header className="df2-chat-head">
        <button type="button" className="df2-icon-btn" onClick={onBack} aria-label="Back to chats">
          <Icon name="back" />
        </button>
        <button type="button" className="df2-chat-person" onClick={() => setSheet('details')}>
          <Avatar avatar={group.avatar as AvatarKey} name={group.name} size={40} />
          <span>
            <strong>{group.name}</strong>
            <small>{group.members.length} participants · tap for details</small>
          </span>
        </button>
        <button type="button" className="df2-icon-btn" onClick={() => setSheet('settings')} aria-label="Circle settings">
          <Icon name="settings" />
        </button>
      </header>
      <div className="df2-chat-body" ref={listRef} onScroll={onScroll} aria-live="polite">
        {rows === null && !error ? (
          <div className="df2-chat-loading">
            <span className="df2-spinner" aria-hidden="true" /> Loading your circle…
          </div>
        ) : null}
        {error && !rows?.length ? <div className="df2-chat-empty"><strong>{error}</strong></div> : null}
        {rows && !rows.length && !error ? (
          <div className="df2-chat-empty">
            <span className="df2-kicker">YOUR CIRCLE IS READY</span>
            <blockquote>
              “The believers are like one body in their mutual love and mercy.”
              <cite>Sahih Muslim 2586</cite>
            </blockquote>
            <div className="df2-chip-row df2-center">
              <button type="button" className="df2-btn df2-btn-primary" onClick={() => setSheet('share')}>
                Share a reminder
              </button>
              <button type="button" className="df2-btn" onClick={() => setSheet('encourage')}>
                Encourage everyone
              </button>
            </div>
          </div>
        ) : null}
        {(rows || []).map((m) => {
          const day = localDay(new Date(m.createdAtMs || Date.now()));
          const sep = day !== lastDay ? (
            <div className="df2-day-sep" key={`sep-${day}`}>
              <span>{formatDayLabel(m.createdAtMs || Date.now())}</span>
            </div>
          ) : null;
          lastDay = day;
          const mine = m.senderUid === me?.uid;
          const sender = s.profiles[m.senderUid];
          const from = mine ? 'You' : sender?.displayName?.split(' ')[0] || 'A friend';
          const meta = (
            <span className="df2-msg-meta">
              {!mine ? (
                <button type="button" className="df2-link-btn df2-msg-sender" onClick={() => onOpenProfile(m.senderUid)}>
                  {from}
                </button>
              ) : null}{' '}
              {m.pending ? 'Sending…' : formatClock(m.createdAtMs)}
            </span>
          );
          return [
            sep,
            m.kind === 'content' && m.sharedContent ? (
              <SharedContentCard key={m.id} stored={m.sharedContent} mine={mine} fromLabel={mine ? 'You shared' : `From ${from}`} meta={meta} />
            ) : (
              <article key={m.id} className={`df2-msg df2-msg-bubble ${mine ? 'mine' : 'theirs'}`}>
                <p>{m.text}</p>
                {meta}
              </article>
            ),
          ];
        })}
      </div>
      <footer className="df2-composer">
        <div className="df2-reactions" role="group" aria-label="Quick reactions">
          {QUICK_REACTIONS.map((r) => (
            <button key={r.text} type="button" className="df2-reaction" disabled={!!reacting} onClick={() => void react(r.text)}>
              {reacting === r.text ? '…' : r.text}
            </button>
          ))}
        </div>
        <div className="df2-composer-row">
          <button type="button" className="df2-btn df2-btn-primary df2-composer-main" onClick={() => setSheet('share')}>
            <Icon name="share" size={18} /> Share with the circle
          </button>
          <button type="button" className="df2-icon-btn df2-composer-icon" onClick={() => setSheet('encourage')} aria-label="Send encouragement">
            <Icon name="heart" />
          </button>
        </div>
        <p className="df2-composer-note">
          <Icon name="lock" size={12} /> Visible to circle members only · Deen actions, no free text
        </p>
      </footer>
      {sheet === 'encourage' ? <EncourageSheet onClose={() => setSheet(null)} send={(text) => sendGroupEncouragement(group, text)} /> : null}
      {sheet === 'share' ? (
        <ShareSheet initialType="all" onClose={() => setSheet(null)} send={(item) => shareToGroup(group, item)} sentText="Shared with your circle." />
      ) : null}
      {sheet === 'details' ? <GroupDetailsSheet group={group} onClose={() => setSheet(null)} onOpenProfile={onOpenProfile} /> : null}
      {sheet === 'settings' ? (
        <ChatSettingsSheet conversationId={`group_${group.id}`} theme={theme} onTheme={setTheme} canClear={false} onCleared={() => undefined} onClose={() => setSheet(null)} />
      ) : null}
    </FullScreen>
  );
}

/* ---------- details & participant management ---------- */

function GroupDetailsSheet({ group, onClose, onOpenProfile }: { group: DeenGroup; onClose: () => void; onOpenProfile: (uid: string) => void }) {
  const s = useDeenFriends();
  const toast = useToast();
  const myUid = s.profile?.uid || '';
  const admin = group.admins.includes(myUid);
  const [name, setName] = useState(group.name);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<null | { uid: string; leave: boolean }>(null);
  const friendUids = s.friendships.map((f) => f.friendUid);
  const addable = friendUids.filter((u) => !group.members.includes(u));

  return (
    <>
      <Sheet title={group.name} kicker="CIRCLE DETAILS" onClose={onClose} wide>
        {admin ? (
          <form
            className="df2-search-row"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await renameGroup(group, name);
                toast('Circle renamed.', 'success');
              } catch (err) {
                toast(friendlyMessage(err), 'error');
              }
            }}
          >
            <input className="df2-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Circle name" />
            <button type="submit" className="df2-btn" disabled={name.trim() === group.name}>
              Rename
            </button>
          </form>
        ) : null}
        <h3 className="df2-subhead">{group.members.length} participants</h3>
        <ul className="df2-member-list">
          {group.members.map((uid) => {
            const p = s.profiles[uid];
            return (
              <li key={uid}>
                <button type="button" className="df2-member" onClick={() => uid !== myUid && onOpenProfile(uid)}>
                  <Avatar avatar={p?.avatar} config={p?.avatarConfig} name={p?.displayName || ''} size={36} />
                  <span>
                    <strong>{uid === myUid ? 'You' : p?.displayName || 'Deen Friend'}</strong>
                    <small>
                      @{p?.username || '…'}
                      {group.admins.includes(uid) ? ' · admin' : ''}
                      {group.ownerUid === uid ? ' · created the circle' : ''}
                    </small>
                  </span>
                </button>
                {admin && uid !== myUid && uid !== group.ownerUid ? (
                  <button type="button" className="df2-btn df2-btn-sm df2-btn-ghost-danger" onClick={() => setConfirm({ uid, leave: false })}>
                    Remove
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {admin ? (
          adding ? (
            <ul className="df2-pick-list">
              {addable.length ? (
                addable.map((uid) => (
                  <li key={uid}>
                    <button
                      type="button"
                      className="df2-pick"
                      onClick={async () => {
                        try {
                          await addGroupMember(group, uid, friendUids);
                          toast('Added to the circle.', 'success');
                          setAdding(false);
                        } catch (err) {
                          toast(friendlyMessage(err), 'error');
                        }
                      }}
                    >
                      <Avatar avatar={s.profiles[uid]?.avatar} config={s.profiles[uid]?.avatarConfig} name={s.profiles[uid]?.displayName || ''} size={32} />
                      <span>
                        <strong>{s.profiles[uid]?.displayName || 'Deen Friend'}</strong>
                      </span>
                      <Icon name="plus" size={16} />
                    </button>
                  </li>
                ))
              ) : (
                <li className="df2-inline-note">All your Deen Friends are already in this circle.</li>
              )}
            </ul>
          ) : (
            <button type="button" className="df2-btn df2-btn-sm" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} /> Add a friend
            </button>
          )
        ) : null}
        <div className="df2-sheet-actions">
          <button type="button" className="df2-btn df2-btn-ghost-danger" onClick={() => setConfirm({ uid: myUid, leave: true })}>
            Leave circle
          </button>
        </div>
      </Sheet>
      {confirm ? (
        <ConfirmSheet
          title={confirm.leave ? 'Leave this circle?' : `Remove ${s.profiles[confirm.uid]?.displayName || 'this person'}?`}
          danger
          confirmLabel={confirm.leave ? 'Leave' : 'Remove'}
          message={<p>{confirm.leave ? 'You will stop seeing this circle and its shared reminders.' : 'They will stop seeing this circle.'}</p>}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await removeGroupMember(group, confirm.uid);
              setConfirm(null);
              if (confirm.leave) {
                onClose();
                goToDeenFriends({ tab: 'chats' }, true);
              }
            } catch (err) {
              toast(friendlyMessage(err), 'error');
            }
          }}
        />
      ) : null}
    </>
  );
}
