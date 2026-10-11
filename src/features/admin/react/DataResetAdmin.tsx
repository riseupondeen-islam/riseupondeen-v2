/* Admin › Data & Accounts › Full Admin Data Reset (V3.5).
 *
 * Scope (chosen by the owner): administrative LOGS & ANALYTICS only — the collections below. Members,
 * profiles, friendships, chats, challenges, published content, settings, notification setup, login
 * accounts and the admin audit log are never touched. The reset itself is written to the audit log.
 *
 * Authorisation is enforced by Firestore security rules (server-side): only the Super Admin account
 * may delete documents in these collections. The page also only offers the button to that account.
 * Each collection is cleared in pages of 400 until empty, so a run that is interrupted or partly
 * fails can simply be repeated ("Retry"); nothing is reported as done unless it really is empty. */
import { useEffect, useRef, useState } from 'react';
import { addDoc, collection, getDocs, limit, query, serverTimestamp, writeBatch } from '../../../services/firebase/sdk';
import { requireSignedIn, currentDeenUser } from '../../deen-friends/services/firebaseSession';
import { friendlyMessage } from '../../deen-friends/services/errors';
import { toast } from '../../../utils/ui';

const SUPER_ADMIN_EMAIL = 'riseupondeen@gmail.com';
const PAGE = 400;
const PREVIEW_CAP = 1000;
const CONFIRM_PHRASE = 'RESET LOGS';

export const RESET_SCOPE: Array<{ id: string; label: string }> = [
  { id: 'deens_activity_logs', label: 'Deen Friends activity logs' },
  { id: 'deens_analytics', label: 'Deen Friends analytics' },
  { id: 'deens_risk_signals', label: 'Risk signals' },
  { id: 'deens_private_chat_access_logs', label: 'Private-chat access logs' },
  { id: 'visitor_sessions', label: 'Visitor session analytics' },
];
const KEPT = [
  'Members, profiles, usernames and login accounts',
  'Friendships, chats, circles, RISE conversations',
  'Challenges, streaks and leaderboards',
  'Published content, settings, notifications and the admin audit log',
  'Reports, moderation cases and evidence',
];

type Row = { count: number | null; capped?: boolean; deleted: number; state: 'idle' | 'running' | 'done' | 'error'; error?: string };

async function countUpTo(id: string): Promise<{ count: number; capped: boolean }> {
  const { db } = await requireSignedIn();
  const snap = await getDocs(query(collection(db, id), limit(PREVIEW_CAP)));
  return { count: snap.size, capped: snap.size >= PREVIEW_CAP };
}

/** Deletes every document in one collection, page by page. Reports progress; throws on failure. */
async function clearCollection(id: string, onProgress: (deleted: number) => void): Promise<number> {
  const { db } = await requireSignedIn();
  let deleted = 0;
  for (;;) {
    const snap = await getDocs(query(collection(db, id), limit(PAGE)));
    if (snap.empty) return deleted;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    onProgress(deleted);
    if (snap.size < PAGE) return deleted;
  }
}

async function audit(action: string, reason: string, extra: Record<string, unknown>) {
  const { db, uid } = await requireSignedIn();
  await addDoc(collection(db, 'deens_admin_audit_logs'), {
    adminUid: uid,
    adminEmail: currentDeenUser()?.email || '',
    adminRole: 'SUPER_ADMIN',
    action,
    target: 'LOGS_AND_ANALYTICS',
    reason,
    timestamp: serverTimestamp(),
    timestampMs: Date.now(),
    ...extra,
  });
}

export function DataResetAdmin() {
  const isSuper = String(currentDeenUser()?.email || '').toLowerCase() === SUPER_ADMIN_EMAIL;
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(RESET_SCOPE.map((c) => [c.id, { count: null, deleted: 0, state: 'idle' } as Row])),
  );
  const [phrase, setPhrase] = useState('');
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState('');
  const runningRef = useRef(false); // guards against double submission even before React re-renders

  const patch = (id: string, next: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...next } }));

  const refreshCounts = () =>
    RESET_SCOPE.forEach((c) =>
      countUpTo(c.id)
        .then(({ count, capped }) => patch(c.id, { count, capped }))
        .catch((err) => patch(c.id, { count: null, state: 'error', error: friendlyMessage(err, 'Could not be read.') })),
    );

  useEffect(() => {
    if (isSuper) refreshCounts();
  }, [isSuper]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(only?: string[]) {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setSummary('');
    const targets = RESET_SCOPE.filter((c) => !only || only.includes(c.id));
    const results: Record<string, number> = {};
    const failures: Record<string, string> = {};
    try {
      await audit('ADMIN_DATA_RESET_STARTED', 'Full Admin Data Reset (logs & analytics) started.', { collections: targets.map((c) => c.id) });
      for (const c of targets) {
        patch(c.id, { state: 'running', deleted: 0, error: undefined });
        try {
          results[c.id] = await clearCollection(c.id, (n) => patch(c.id, { deleted: n }));
          patch(c.id, { state: 'done', count: 0, capped: false });
        } catch (err) {
          failures[c.id] = friendlyMessage(err, 'Could not be cleared.');
          patch(c.id, { state: 'error', error: failures[c.id] });
        }
      }
      const failed = Object.keys(failures);
      await audit(
        failed.length ? 'ADMIN_DATA_RESET_PARTIAL' : 'ADMIN_DATA_RESET_COMPLETED',
        failed.length ? `Reset finished with ${failed.length} collection(s) not cleared.` : 'Full Admin Data Reset (logs & analytics) completed.',
        { deleted: results, failed },
      ).catch(() => undefined);
      const total = Object.values(results).reduce((a, b) => a + b, 0);
      if (failed.length) {
        setSummary(`${total} records removed. ${failed.length} collection(s) could not be cleared — use Retry.`);
        toast('Reset finished with errors. Nothing else was changed.', 'error');
      } else {
        setSummary(`Done — ${total} records removed. Everything else is unchanged.`);
        toast('Logs and analytics were reset.');
      }
    } catch (err) {
      setSummary(friendlyMessage(err, 'The reset could not start.'));
      toast(friendlyMessage(err, 'The reset could not start.'), 'error');
    } finally {
      setPhrase('');
      runningRef.current = false;
      setRunning(false);
    }
  }

  const failedIds = RESET_SCOPE.filter((c) => rows[c.id].state === 'error').map((c) => c.id);

  return (
    <div className="rud-reset-admin">
      <section className="df2-card rud-reset-card" aria-labelledby="rudResetTitle">
        <span className="df2-kicker">Super Admin · destructive</span>
        <h2 id="rudResetTitle">Full Admin Data Reset</h2>
        <p className="df2-inline-note">
          Clears administrative <b>logs &amp; analytics</b> only. It is separate from maintenance and content tools, and it is recorded in the
          admin audit log.
        </p>
        {!isSuper ? (
          <p className="df2-form-error" role="alert">
            Only the Super Admin account can run this reset.
          </p>
        ) : null}
        <div className="rud-reset-grid">
          <div>
            <h3>Will be cleared</h3>
            <ul className="rud-reset-list">
              {RESET_SCOPE.map((c) => {
                const r = rows[c.id];
                const count = r.count === null ? '…' : `${r.count}${r.capped ? '+' : ''}`;
                return (
                  <li key={c.id} data-collection={c.id} data-state={r.state}>
                    <span>{c.label}</span>
                    <b>
                      {r.state === 'running' ? `${r.deleted} removed…` : r.state === 'done' ? 'cleared' : r.state === 'error' ? 'not cleared' : count}
                    </b>
                    {r.error ? <small>{r.error}</small> : null}
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h3>Always kept</h3>
            <ul className="rud-reset-list is-kept">
              {KEPT.map((k) => (
                <li key={k}>
                  <span>{k}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <label className="df2-field">
          <span>
            Type <b>{CONFIRM_PHRASE}</b> to confirm
          </span>
          <input
            className="df2-input"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            disabled={!isSuper || running}
            autoComplete="off"
            spellCheck={false}
            aria-label="Confirmation phrase"
          />
        </label>
        <div className="rud-reset-actions">
          <button
            type="button"
            className="df2-btn df2-btn-danger"
            disabled={!isSuper || running || phrase.trim() !== CONFIRM_PHRASE}
            onClick={() => void run()}
          >
            {running ? 'Resetting…' : 'Reset logs & analytics'}
          </button>
          {failedIds.length && !running ? (
            <button type="button" className="df2-btn df2-btn-soft" disabled={phrase.trim() !== CONFIRM_PHRASE} onClick={() => void run(failedIds)}>
              Retry failed
            </button>
          ) : null}
          {isSuper && !running ? (
            <button type="button" className="df2-btn df2-btn-soft" onClick={refreshCounts}>
              Recount
            </button>
          ) : null}
        </div>
        {summary ? (
          <p className="df2-inline-note" role="status">
            {summary}
          </p>
        ) : null}
      </section>
    </div>
  );
}
