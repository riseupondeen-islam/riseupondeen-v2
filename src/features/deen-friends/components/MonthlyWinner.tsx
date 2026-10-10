/* The announced winner(s) of last month — a premium card at the top of the Challenges tab. */
import { useEffect, useState } from 'react';
import { loadLatestWinner, type MonthlyWinner } from '../services/winnerService';
import { monthLabel } from '../services/progressService';
import { Avatar } from './ui';

/** Opens a member's profile on the Deen Friends page (listened to by DeenFriendsPage). */
export function openDeenProfile(uid: string): void {
  window.dispatchEvent(new CustomEvent('df2:open-profile', { detail: { uid } }));
}

export function MonthlyWinnerBanner() {
  const [winner, setWinner] = useState<MonthlyWinner | null>(null);
  useEffect(() => {
    let alive = true;
    void loadLatestWinner().then((w) => {
      if (alive) setWinner(w);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!winner || !winner.winners.length) return null;
  return (
    <section className="df2-winner" aria-label={`Winner of ${monthLabel(winner.monthId)}`}>
      <span className="df2-winner-shine" aria-hidden="true" />
      <div className="df2-winner-head">
        <span className="df2-winner-crown" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5L3 8.5Z" />
          </svg>
        </span>
        <span>
          <small>{monthLabel(winner.monthId)}</small>
          <strong>{winner.title || 'Winner of the month'}</strong>
        </span>
      </div>
      <div className="df2-winner-people">
        {winner.winners.map((w) => (
          <button key={w.uid} type="button" className="df2-winner-person" onClick={() => openDeenProfile(w.uid)}>
            <span className="df2-winner-avatar">
              <Avatar avatar={w.avatar} config={w.avatarConfig} name={w.displayName} size={58} />
            </span>
            <span className="df2-winner-name">
              <strong>{w.displayName}</strong>
              <small>
                @{w.username} · {w.points} pts
              </small>
            </span>
          </button>
        ))}
      </div>
      {winner.message ? <p className="df2-winner-message">{winner.message}</p> : null}
    </section>
  );
}
