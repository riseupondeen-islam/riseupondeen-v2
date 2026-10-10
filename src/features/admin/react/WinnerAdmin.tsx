/* Admin › Monthly Winner: pick a month, choose the winner(s) from that month's leaderboard, write an
 * announcement and publish it. Members see it at the top of Deen Friends → Challenges, and winners
 * get the premium gold visiting card. Writes are authorised by firestore.rules (Community admins). */
import { useEffect, useState } from 'react';
import { toast } from '../../../utils/ui';
import { friendlyMessage } from '../../deen-friends/services/errors';
import { istMonthId, loadLeaderboard, monthLabel, previousMonthId, type LeaderboardEntry } from '../../deen-friends/services/progressService';
import { adminLoadWinner, announceWinner, withdrawWinner, type MonthlyWinner } from '../../deen-friends/services/winnerService';
import { Avatar } from '../../deen-friends/components/ui';
import { asAvatar } from '../../deen-friends/services/format';
import { readAvatarConfig } from '../../../components/avatar/avatarConfig';

function recentMonths(): string[] {
  const out = [istMonthId()];
  for (let i = 0; i < 5; i++) out.push(previousMonthId(out[out.length - 1]));
  return out;
}

export function WinnerAdmin() {
  const months = recentMonths();
  const [monthId, setMonthId] = useState(months[1]);
  const [rows, setRows] = useState<Array<LeaderboardEntry & { rank: number }> | null>(null);
  const [current, setCurrent] = useState<MonthlyWinner | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('Winner of the month');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError('');
    Promise.all([loadLeaderboard(monthId, 10), adminLoadWinner(monthId)])
      .then(([list, existing]) => {
        if (!alive) return;
        setRows(list);
        setCurrent(existing);
        setPicked(existing ? existing.winners.map((w) => w.uid) : list.filter((r) => r.rank === 1 && r.points > 0).map((r) => r.uid));
        setTitle(existing?.title || 'Winner of the month');
        setMessage(existing?.message || '');
      })
      .catch((err) => {
        if (!alive) return;
        setError(friendlyMessage(err, 'The leaderboard could not be loaded.'));
        setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [monthId]);

  async function publish() {
    setBusy(true);
    try {
      const people = (rows || []).filter((r) => picked.includes(r.uid));
      await announceWinner(monthId, people, title, message);
      setCurrent(await adminLoadWinner(monthId));
      toast(`Winner for ${monthLabel(monthId)} announced.`);
    } catch (err) {
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    try {
      await withdrawWinner(monthId);
      setCurrent(null);
      toast('Announcement removed.');
    } catch (err) {
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rud-winner-admin">
      <div className="df2-card rud-winner-admin-card">
        <label className="df2-field">
          <span>Month</span>
          <select value={monthId} onChange={(e) => setMonthId(e.target.value)} aria-label="Month">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        {current ? <p className="df2-inline-note">Announced: {current.winners.map((w) => w.displayName).join(', ')}</p> : null}
        {error ? <p className="df2-form-error">{error}</p> : null}
        <h3>Choose up to three winners</h3>
        {rows === null ? (
          <p className="df2-inline-note">Loading…</p>
        ) : !rows.some((r) => r.points > 0) ? (
          <p className="df2-inline-note">No one scored points in {monthLabel(monthId)}.</p>
        ) : (
          <ul className="df2-pick-list rud-winner-pick">
            {rows
              .filter((r) => r.points > 0)
              .map((r) => {
                const on = picked.includes(r.uid);
                return (
                  <li key={r.uid}>
                    <label className={`df2-pick${on ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setPicked((x) => (on ? x.filter((u) => u !== r.uid) : [...x, r.uid].slice(0, 3)))}
                      />
                      <b className="rud-winner-rank">#{r.rank}</b>
                      <Avatar avatar={asAvatar(r.avatar)} config={readAvatarConfig(r.avatarConfig)} name={r.displayName} size={34} />
                      <span>
                        <strong>{r.displayName}</strong>
                        <small>
                          @{r.username} · {r.points} pts · {r.activeDays} days
                        </small>
                      </span>
                    </label>
                  </li>
                );
              })}
          </ul>
        )}
        <label className="df2-field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-label="Announcement title" />
        </label>
        <label className="df2-field">
          <span>Announcement</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={400} rows={3} aria-label="Announcement message" placeholder="MashaAllah! May Allah accept from all of us." />
        </label>
        <div className="df2-card-actions">
          <button type="button" className="df2-btn df2-btn-primary" disabled={busy || !picked.length} onClick={() => void publish()}>
            {current ? 'Update announcement' : 'Announce winner'}
          </button>
          {current ? (
            <button type="button" className="df2-btn" disabled={busy} onClick={() => void withdraw()}>
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
