/* One Deen interaction in a friend conversation: challenge, check-in, encouragement or shared content. */
import { memo } from 'react';
import type { Interaction } from '../types';
import { challengeState, formatClock, isTasbihChallenge } from '../services/format';
import { Icon } from './ui';

const STATE_LABEL: Record<string, string> = {
  pending: 'Waiting for reply',
  accepted: 'Accepted',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
  expired: 'Expired',
  missed: 'Ended',
};

const CONTENT_LABEL: Record<string, string> = {
  quran: 'Qur’an',
  dua: 'Dua',
  hadith: 'Hadith',
  zikr: 'Dhikr',
  reminder: 'Reminder',
};

export type ChallengeAction = 'accept' | 'decline' | 'done';

export const InteractionCard = memo(function InteractionCard({
  item,
  myUid,
  friendName,
  busy,
  onChallengeAction,
}: {
  item: Interaction;
  myUid: string;
  friendName: string;
  busy: boolean;
  onChallengeAction: (item: Interaction, action: ChallengeAction) => void;
}) {
  const mine = item.senderUid === myUid;
  const firstName = friendName.split(' ')[0] || 'Your friend';
  const meta = (
    <span className="df2-msg-meta">
      {item.pending ? 'Sending…' : formatClock(item.createdAtMs)}
      {mine && !item.pending ? (
        <span className="df2-ticks" aria-label={item.readAtMs ? 'Seen' : 'Delivered'}>
          {item.readAtMs ? '✓✓' : '✓'}
        </span>
      ) : null}
    </span>
  );

  if (item.kind === 'challenge' && item.challenge) {
    const state = challengeState(item);
    const completedBy = item.completedBy || {};
    const meDone = !!completedBy[myUid];
    const friendDone = Object.keys(completedBy).some((uid) => uid !== myUid);
    const target = Number(item.challenge.target) || 1;
    const due = new Date(item.expiresAtMs).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return (
      <article className={`df2-msg df2-msg-card df2-challenge s-${state} ${mine ? 'mine' : 'theirs'}`}>
        <header className="df2-card-kicker">
          <span>
            <Icon name="target" size={15} /> {item.challenge.official ? 'Official · ' : ''}
            {item.challenge.category || 'Deen'} challenge
          </span>
          <b>{STATE_LABEL[state]}</b>
        </header>
        <h3>{item.challenge.title}</h3>
        {item.challenge.description ? <p>{item.challenge.description}</p> : null}
        <p className="df2-card-sub">
          {mine ? `You challenged ${firstName}` : `${firstName} challenged you`}
          {target > 1 ? ` · Target ${target}` : ''} · Due {due}
        </p>
        <div className="df2-progress-pair" aria-label="Completion">
          <span className={meDone ? 'on' : ''}>
            {meDone ? <Icon name="check" size={13} /> : null} You{meDone ? '' : ' · to do'}
          </span>
          <span className={friendDone ? 'on' : ''}>
            {friendDone ? <Icon name="check" size={13} /> : null} {firstName}
            {friendDone ? '' : ' · to do'}
          </span>
        </div>
        <div className="df2-card-actions">
          {state === 'pending' && !mine ? (
            <>
              <button
                type="button"
                className="df2-btn df2-btn-primary df2-btn-sm"
                disabled={busy}
                onClick={() => onChallengeAction(item, 'accept')}
              >
                Accept
              </button>
              <button
                type="button"
                className="df2-btn df2-btn-sm"
                disabled={busy}
                onClick={() => onChallengeAction(item, 'decline')}
              >
                Decline
              </button>
            </>
          ) : null}
          {(state === 'accepted' || state === 'in_progress') && !meDone ? (
            <button
              type="button"
              className="df2-btn df2-btn-primary df2-btn-sm"
              disabled={busy}
              onClick={() => onChallengeAction(item, 'done')}
            >
              {isTasbihChallenge(item) ? 'Count in Tasbih' : 'Mark as done'}
            </button>
          ) : null}
          {state === 'completed' ? <span className="df2-celebrate">Alhamdulillah — completed together.</span> : null}
        </div>
        {meta}
      </article>
    );
  }

  if (item.kind === 'checkin') {
    return (
      <article className={`df2-msg df2-msg-pill ${mine ? 'mine' : 'theirs'}`}>
        <Icon name="check" size={15} />
        <span>{mine ? 'You checked in today' : `${firstName} checked in today`}</span>
        {meta}
      </article>
    );
  }

  if (item.kind === 'content' && item.sharedContent) {
    const shared = item.sharedContent;
    return (
      <article className={`df2-msg df2-msg-card df2-shared ${mine ? 'mine' : 'theirs'}`}>
        <header className="df2-card-kicker">
          <span>
            <Icon
              name={
                shared.type === 'quran'
                  ? 'book'
                  : shared.type === 'zikr'
                    ? 'beads'
                    : shared.type === 'dua'
                      ? 'hands'
                      : 'scroll'
              }
              size={15}
            />{' '}
            {CONTENT_LABEL[shared.type] || 'Shared'}
          </span>
          <b>{mine ? 'You shared' : `From ${firstName}`}</b>
        </header>
        <h3>{shared.title}</h3>
        {shared.arabic ? (
          <p className="df2-arabic" lang="ar" dir="rtl">
            {shared.arabic}
          </p>
        ) : null}
        {shared.preview ? <p>{shared.preview}</p> : null}
        {shared.reference ? <small className="df2-reference">{shared.reference}</small> : null}
        {meta}
      </article>
    );
  }

  return (
    <article className={`df2-msg df2-msg-bubble ${mine ? 'mine' : 'theirs'}`}>
      <p>{item.text}</p>
      {meta}
    </article>
  );
});
