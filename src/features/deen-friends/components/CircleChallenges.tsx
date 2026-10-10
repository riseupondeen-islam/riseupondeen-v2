/* Circle challenges (created by members for friends) and the monthly leaderboard — Section 18. */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { friendlyMessage, logError } from '../services/errors';
import { addDays, daysBetween } from '../services/format';
import {
  MAX_INVITEES,
  createUserChallenge,
  cancelUserChallenge,
  completeUserChallengeToday,
  loadMyUserChallenges,
  loadParticipants,
  respondToUserChallenge,
  runningToday,
  validateUserChallenge,
  type UserChallengeProgress,
  type UserChallengeView,
} from '../services/userChallengeService';
import {
  MAX_POINTS_PER_DAY,
  istDateString,
  istMonthId,
  loadLeaderboard,
  loadMyEntry,
  monthLabel,
  previousMonthId,
  type LeaderboardEntry,
} from '../services/progressService';
import { readAvatarConfig } from '../../../components/avatar/avatarConfig';
import { asAvatar } from '../services/format';
import { getDeenFriendsState, useDeenFriends } from '../state/deenFriendsStore';
import { Avatar, EmptyState, Icon, Sheet, SkeletonRows, useToast } from './ui';

const CATEGORIES = ["Qur'an", 'Salah', 'Zikr', 'Dua', 'Hadith', 'Charity', 'Character', 'Fasting'];

export function CircleChallengesSection() {
  const s = useDeenFriends();
  const toast = useToast();
  const [rows, setRows] = useState<UserChallengeView[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState('');
  const [people, setPeople] = useState<Record<string, UserChallengeProgress[]>>({});

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await loadMyUserChallenges());
    } catch (err) {
      logError('circle challenges load', err);
      setError(friendlyMessage(err, 'Circle challenges could not be loaded.'));
      setRows((r) => r || []);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(view: UserChallengeView, action: 'accept' | 'decline' | 'done' | 'end') {
    setBusy(view.challenge.id + action);
    try {
      if (action === 'accept' || action === 'decline') {
        await respondToUserChallenge(view.challenge, action === 'accept');
        toast(action === 'accept' ? 'Challenge accepted. Bismillah!' : 'Challenge declined.', 'success');
      } else if (action === 'done') {
        const mine = await completeUserChallengeToday(view.challenge, getDeenFriendsState().profile);
        toast(mine.completedCount >= view.challenge.requiredDays ? 'MashaAllah — challenge completed!' : 'Today is done. May Allah accept it.', 'success');
      } else {
        await cancelUserChallenge(view.challenge);
        toast('Challenge ended.', 'info');
      }
      await load();
    } catch (err) {
      logError(`circle challenge ${action}`, err);
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusy('');
    }
  }

  async function toggleOpen(id: string) {
    setOpen((o) => (o === id ? '' : id));
    if (!people[id]) {
      try {
        const list = await loadParticipants(id);
        setPeople((p) => ({ ...p, [id]: list }));
      } catch (err) {
        logError('participants', err);
      }
    }
  }

  const today = istDateString();
  const myUid = s.profile?.uid || '';
  return (
    <section className="df2-section" aria-labelledby="df2-circle-ch-title" data-tour="df-circle-challenges">
      <div className="df2-section-head">
        <h2 id="df2-circle-ch-title">Circle challenges</h2>
        <button type="button" className="df2-btn df2-btn-sm" onClick={() => setCreating(true)} disabled={!s.friendships.length}>
          <Icon name="plus" size={16} /> New challenge
        </button>
      </div>
      {error ? <p className="df2-inline-note">{error}</p> : null}
      {rows === null ? (
        <SkeletonRows count={2} />
      ) : rows.length ? (
        <div className="df2-daily-grid">
          {rows.map((view) => {
            const { challenge, mine } = view;
            const creator = challenge.creatorUid === myUid;
            const creatorName = creator ? 'You' : s.profiles[challenge.creatorUid]?.displayName || 'A friend';
            const running = runningToday(challenge, today);
            const doneToday = !!mine?.completedDates.includes(today);
            const count = mine?.completedCount || 0;
            const complete = count >= challenge.requiredDays;
            const pct = Math.min(100, Math.round((count / challenge.requiredDays) * 100));
            const daysLeft = Math.max(0, daysBetween(today, challenge.endDate));
            return (
              <article key={challenge.id} className={`df2-card df2-daily${complete ? ' is-complete' : ''}`}>
                <header className="df2-card-kicker">
                  <span>
                    <Icon name="people" size={15} /> {challenge.category} · by {creatorName}
                  </span>
                  <b>{complete ? 'Completed' : running ? `${daysLeft + 1} day${daysLeft ? 's' : ''} left` : today < challenge.startDate ? `Starts ${challenge.startDate}` : 'Ended'}</b>
                </header>
                <h3>{challenge.title}</h3>
                {challenge.description ? <p>{challenge.description}</p> : null}
                <p className="df2-criteria">
                  <strong>Done for a day when:</strong> {challenge.criteria}
                </p>
                {mine?.status === 'accepted' ? (
                  <>
                    <div className="df2-progress" role="progressbar" aria-valuemin={0} aria-valuemax={challenge.requiredDays} aria-valuenow={count} aria-label="Your progress">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <small className="df2-card-sub">
                      {count} of {challenge.requiredDays} day{challenge.requiredDays === 1 ? '' : 's'}
                    </small>
                  </>
                ) : null}
                <div className="df2-card-actions">
                  {!mine || mine.status === 'invited' ? (
                    <>
                      <button type="button" className="df2-btn df2-btn-primary df2-btn-sm" disabled={!!busy} onClick={() => void act(view, 'accept')}>
                        Accept
                      </button>
                      <button type="button" className="df2-btn df2-btn-sm" disabled={!!busy} onClick={() => void act(view, 'decline')}>
                        Decline
                      </button>
                    </>
                  ) : mine.status === 'declined' ? (
                    <span className="df2-inline-note">You declined this challenge.</span>
                  ) : complete ? (
                    <span className="df2-celebrate">Alhamdulillah — completed.</span>
                  ) : running ? (
                    <button type="button" className="df2-btn df2-btn-primary df2-btn-sm" disabled={doneToday || !!busy} onClick={() => void act(view, 'done')}>
                      {doneToday ? 'Done for today' : busy === challenge.id + 'done' ? 'Saving…' : 'Mark today done'}
                    </button>
                  ) : null}
                  <button type="button" className="df2-link-btn" onClick={() => void toggleOpen(challenge.id)} aria-expanded={open === challenge.id}>
                    {open === challenge.id ? 'Hide progress' : 'Everyone’s progress'}
                  </button>
                  {creator ? (
                    <button type="button" className="df2-link-btn" disabled={!!busy} onClick={() => void act(view, 'end')}>
                      End
                    </button>
                  ) : null}
                </div>
                {open === challenge.id ? (
                  <ul className="df2-participants">
                    {[challenge.creatorUid, ...challenge.invitedUids].map((uid) => {
                      const p = people[challenge.id]?.find((x) => x.uid === uid);
                      return (
                        <li key={uid}>
                          <span>{uid === myUid ? 'You' : s.profiles[uid]?.displayName || 'Deen Friend'}</span>
                          <small>
                            {!p || p.status === 'invited' ? 'invited' : p.status === 'declined' ? 'declined' : `${p.completedCount}/${challenge.requiredDays} days`}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="target" title="No circle challenges yet">
          <p>Set a goal for yourself and invite up to {MAX_INVITEES} Deen Friends — for example “Read Surah Al-Mulk every night this week”.</p>
        </EmptyState>
      )}
      {creating ? (
        <CreateChallengeSheet
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}
    </section>
  );
}

function CreateChallengeSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const s = useDeenFriends();
  const toast = useToast();
  const today = istDateString();
  const [form, setForm] = useState({
    title: '',
    description: '',
    criteria: '',
    category: CATEGORIES[0],
    startDate: today,
    endDate: addDays(today, 6),
    requiredDays: '7',
    invitedUids: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const friendUids = s.friendships.map((f) => f.friendUid);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validateUserChallenge(form, friendUids);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createUserChallenge(form, friendUids);
      toast('Challenge created. Your friends can accept it now.', 'success');
      onCreated();
    } catch (err) {
      logError('create circle challenge', err);
      setError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="New circle challenge" kicker="INVITE FRIENDS" onClose={onClose} wide>
      <form className="df2-form" onSubmit={submit}>
        <label className="df2-field">
          <span>Title</span>
          <input value={form.title} onChange={set('title')} maxLength={80} placeholder="e.g. Surah Al-Mulk every night" required />
        </label>
        <label className="df2-field">
          <span>What counts as done for one day</span>
          <input value={form.criteria} onChange={set('criteria')} maxLength={200} placeholder="e.g. Recite Surah Al-Mulk before sleeping" required />
        </label>
        <label className="df2-field">
          <span>Description (optional)</span>
          <textarea value={form.description} onChange={set('description')} maxLength={300} rows={2} />
        </label>
        <div className="df2-form-grid">
          <label className="df2-field">
            <span>Category</span>
            <select value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="df2-field">
            <span>Start</span>
            <input type="date" value={form.startDate} min={today} onChange={set('startDate')} />
          </label>
          <label className="df2-field">
            <span>End</span>
            <input type="date" value={form.endDate} min={form.startDate} onChange={set('endDate')} />
          </label>
          <label className="df2-field">
            <span>Days required</span>
            <input inputMode="numeric" value={form.requiredDays} onChange={set('requiredDays')} />
          </label>
        </div>
        <fieldset className="df2-fieldset">
          <legend>
            Invite friends <small>(up to {MAX_INVITEES})</small>
          </legend>
          <ul className="df2-pick-list">
            {s.friendships.map((f) => {
              const on = form.invitedUids.includes(f.friendUid);
              const p = s.profiles[f.friendUid];
              return (
                <li key={f.id}>
                  <label className={`df2-pick${on ? ' on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setForm((x) => ({
                          ...x,
                          invitedUids: on ? x.invitedUids.filter((u) => u !== f.friendUid) : [...x.invitedUids, f.friendUid],
                        }))
                      }
                    />
                    <Avatar avatar={p?.avatar} config={p?.avatarConfig} name={p?.displayName || ''} size={32} />
                    <span>
                      <strong>{p?.displayName || 'Deen Friend'}</strong>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <p className="df2-footnote">Each day you complete counts toward your streak and this month’s points. Creating a challenge earns no points.</p>
        {error ? (
          <p className="df2-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="df2-sheet-actions">
          <button type="button" className="df2-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="df2-btn df2-btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create challenge'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ---------- monthly leaderboard ---------- */

export function LeaderboardSection() {
  const s = useDeenFriends();
  const current = istMonthId();
  const [monthId, setMonthId] = useState(current);
  const [rows, setRows] = useState<Array<LeaderboardEntry & { rank: number }> | null>(null);
  const [mine, setMine] = useState<LeaderboardEntry | null>(null);
  const [error, setError] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);

  // Refresh when the month changes and when my own completed days change (a completion I just made
  // shows up without leaving the tab); only a month change shows the loading skeleton.
  const activeDays = s.myStreak?.totalDays ?? 0;
  const shownMonth = useRef('');
  useEffect(() => {
    let cancelled = false;
    if (shownMonth.current !== monthId) setRows(null);
    shownMonth.current = monthId;
    setError('');
    Promise.all([loadLeaderboard(monthId, 20), loadMyEntry(monthId).catch(() => null)])
      .then(([list, me]) => {
        if (cancelled) return;
        setRows(list);
        setMine(me);
      })
      .catch((err) => {
        if (cancelled) return;
        logError('leaderboard', err);
        setError(friendlyMessage(err, 'The leaderboard could not be loaded.'));
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [monthId, activeDays]);

  const leaders = (rows || []).filter((r) => r.rank === 1 && r.points > 0);
  const others = (rows || []).filter((r) => !(r.rank === 1 && r.points > 0));
  const myUid = s.profile?.uid;
  const myRank = rows?.find((r) => r.uid === myUid)?.rank;

  return (
    <section className="df2-section df2-leaderboard" aria-labelledby="df2-lb-title" data-tour="df-leaderboard">
      <div className="df2-section-head">
        <h2 id="df2-lb-title">Monthly leaderboard</h2>
        <div className="df2-segmented" role="tablist" aria-label="Month">
          <button type="button" role="tab" aria-selected={monthId === current} className={monthId === current ? 'active' : ''} onClick={() => setMonthId(current)}>
            This month
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={monthId === previousMonthId(current)}
            className={monthId === previousMonthId(current) ? 'active' : ''}
            onClick={() => setMonthId(previousMonthId(current))}
          >
            Last month
          </button>
        </div>
      </div>
      <p className="df2-section-meta">{monthLabel(monthId)} · resets at midnight India Standard Time on the 1st</p>
      {error ? <p className="df2-inline-note">{error}</p> : null}
      {rows === null ? (
        <SkeletonRows count={3} />
      ) : !rows.length || !rows.some((r) => r.points > 0) ? (
        <EmptyState icon="sparkle" title={monthId === current ? 'No completions yet this month' : 'No results for that month'}>
          <p>Complete a challenge to be the first on the board — every completed day counts.</p>
        </EmptyState>
      ) : (
        <>
          {leaders.length ? (
            <div className={`df2-lb-first${leaders.length > 1 ? ' is-joint' : ''}`}>
              <span className="df2-lb-crown" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5L3 8.5Z" />
                </svg>
              </span>
              <span className="df2-kicker">{leaders.length > 1 ? 'JOINT FIRST PLACE' : 'FIRST PLACE'}</span>
              <div className="df2-lb-first-people">
                {leaders.map((r) => (
                  <div key={r.uid} className="df2-lb-first-person">
                    <Avatar avatar={asAvatar(r.avatar)} config={readAvatarConfig(r.avatarConfig)} name={r.displayName} size={64} />
                    <strong>{r.displayName}</strong>
                    <small>@{r.username}</small>
                    <b>
                      {r.points} pts · {r.activeDays} day{r.activeDays === 1 ? '' : 's'}
                    </b>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <ol className="df2-lb-list">
            {others
              .filter((r) => r.points > 0)
              .map((r) => (
                <li key={r.uid} className={r.uid === myUid ? 'is-me' : ''}>
                  <span className="df2-lb-rank">{r.rank}</span>
                  <Avatar avatar={asAvatar(r.avatar)} config={readAvatarConfig(r.avatarConfig)} name={r.displayName} size={34} />
                  <span className="df2-lb-name">
                    <strong>{r.uid === myUid ? 'You' : r.displayName}</strong>
                    <small>@{r.username}</small>
                  </span>
                  <span className="df2-lb-points">
                    <b>{r.points}</b> pts
                  </span>
                </li>
              ))}
          </ol>
        </>
      )}
      {mine && !myRank ? (
        <p className="df2-inline-note">
          You: {mine.points} pts · {mine.activeDays} active day{mine.activeDays === 1 ? '' : 's'}
          {mine.visible ? '' : ' (hidden from the board by your privacy setting)'}
        </p>
      ) : null}
      <button type="button" className="df2-link-btn" onClick={() => setRulesOpen(true)}>
        How points work
      </button>
      {rulesOpen ? (
        <Sheet title="How points work" kicker="FAIR & TRANSPARENT" onClose={() => setRulesOpen(false)}>
          <ul className="df2-rules-list">
            <li>+1 point for each challenge you complete: a Daily Deen Challenge day, a friend’s challenge, or a day of a circle challenge.</li>
            <li>At most {MAX_POINTS_PER_DAY} points a day, so many small challenges can’t outweigh steady effort.</li>
            <li>Creating, sharing, viewing or accepting a challenge earns nothing — only completing it does.</li>
            <li>Ranking: points, then active days. Equal points and days share the same place; people who reached the score first are listed first.</li>
            <li>Months run from the 1st at 00:00 to the last day at 23:59 India Standard Time. Last month’s results stay visible; lifetime streaks are separate.</li>
            <li>Only your display name, username and avatar appear. Turn off “Show me on the monthly leaderboard” in Edit profile → Privacy to hide yourself.</li>
          </ul>
          <p className="df2-footnote">Points are encouragement, not a measure of anyone’s faith. May Allah accept from all of us.</p>
        </Sheet>
      ) : null}
    </section>
  );
}
