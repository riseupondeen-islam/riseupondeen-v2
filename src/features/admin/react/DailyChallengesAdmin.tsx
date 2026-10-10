/* Admin › Daily Deen Challenges: create, edit, publish/unpublish, archive, assign and track.
 * Every write is authorised by firestore.rules (Community / Trust & Safety admins and the Super
 * Admin); the buttons are only a convenience. */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { collection, getDocs, limit, query, where } from '../../../services/firebase/sdk';
import { toast } from '../../../utils/ui';
import type { DailyChallenge, DailyChallengeProgress } from '../../deen-friends/types';
import {
  adminListDailyChallenges,
  adminListParticipants,
  saveDailyChallenge,
  setDailyChallengeStatus,
  validateDraft,
  type DailyChallengeDraft,
} from '../../deen-friends/services/dailyChallengeService';
import { friendlyMessage } from '../../deen-friends/services/errors';
import { addDays, daysBetween, localDay, usernameKey } from '../../deen-friends/services/format';
import { requireSignedIn } from '../../deen-friends/services/firebaseSession';

const EMPTY: DailyChallengeDraft = {
  title: '',
  description: '',
  instructions: '',
  category: "Qur'an",
  activity: 'manual',
  target: 1,
  startDate: localDay(),
  endDate: addDays(localDay(), 6),
  requiredDays: 7,
  audience: 'all',
  assignedUids: [],
};

/** Resolves "@name, name2" to UIDs using the existing usernameKey lookup. */
async function resolveUsernames(text: string): Promise<{ uids: string[]; missing: string[] }> {
  const names = [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((n) => usernameKey(n))
        .filter((n) => n.length >= 3),
    ),
  ];
  const { db } = await requireSignedIn();
  const uids: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const snap = await getDocs(query(collection(db, 'deens_users'), where('usernameKey', '==', name), limit(1)));
    if (snap.empty) missing.push(name);
    else uids.push(snap.docs[0].id);
  }
  return { uids, missing };
}

async function usernamesFor(uids: string[]): Promise<Record<string, string>> {
  const { db } = await requireSignedIn();
  const out: Record<string, string> = {};
  // Firestore "in" queries take up to 30 values.
  for (let i = 0; i < uids.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'deens_users'), where('uid', 'in', uids.slice(i, i + 30))));
    snap.docs.forEach((d) => (out[d.id] = String(d.data().username || d.id)));
  }
  return out;
}

export function DailyChallengesAdmin() {
  const [rows, setRows] = useState<DailyChallenge[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: DailyChallengeDraft; usernames: string } | null>(
    null,
  );
  const [tracking, setTracking] = useState<DailyChallenge | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await adminListDailyChallenges());
    } catch (err) {
      setError(friendlyMessage(err, 'Challenges could not be loaded.'));
      setRows([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function startEdit(c: DailyChallenge) {
    const names = c.assignedUids.length
      ? await usernamesFor(c.assignedUids).catch(() => ({}) as Record<string, string>)
      : {};
    setEditing({
      id: c.id,
      usernames: c.assignedUids.map((u) => names[u] || u).join(', '),
      draft: {
        title: c.title,
        description: c.description,
        instructions: c.instructions,
        category: c.category,
        activity: c.activity,
        target: c.target,
        startDate: c.startDate,
        endDate: c.endDate,
        requiredDays: c.requiredDays,
        audience: c.audience,
        assignedUids: c.assignedUids,
      },
    });
  }

  async function changeStatus(c: DailyChallenge, status: DailyChallenge['status']) {
    try {
      await setDailyChallengeStatus(c.id, status);
      toast(
        status === 'published'
          ? 'Challenge published.'
          : status === 'archived'
            ? 'Challenge archived.'
            : 'Challenge unpublished.',
      );
      await load();
    } catch (err) {
      toast(friendlyMessage(err), 'error');
    }
  }

  if (editing) return <ChallengeForm state={editing} onDone={() => (setEditing(null), void load())} />;
  if (tracking) return <ParticipantsView challenge={tracking} onBack={() => setTracking(null)} />;

  return (
    <section className="df2-admin-view">
      <header className="df2-admin-head">
        <div>
          <span className="df2-kicker">DEEN FRIENDS · OFFICIAL</span>
          <h1>Daily Deen Challenges</h1>
          <p>
            Published challenges appear in each assigned user’s Challenges tab. They are separate from challenges
            friends send each other.
          </p>
        </div>
        <button
          type="button"
          className="df2-btn df2-btn-primary"
          onClick={() => setEditing({ id: null, draft: { ...EMPTY }, usernames: '' })}
        >
          + New challenge
        </button>
      </header>
      {error ? <p className="df2-form-error">{error}</p> : null}
      {rows === null ? <p className="df2-inline-note">Loading…</p> : null}
      {rows?.length === 0 && !error ? <p className="df2-inline-note">No Daily Deen Challenges yet.</p> : null}
      <div className="df2-admin-list">
        {rows?.map((c) => (
          <article key={c.id} className="df2-card df2-admin-row">
            <div className="df2-admin-row-main">
              <span className={`df2-status df2-status-${c.status}`}>{c.status}</span>
              <strong>{c.title}</strong>
              <small>
                {c.startDate} → {c.endDate} · {c.requiredDays} day{c.requiredDays === 1 ? '' : 's'} required ·{' '}
                {c.audience === 'all'
                  ? 'All users'
                  : `${c.assignedUids.length} selected user${c.assignedUids.length === 1 ? '' : 's'}`}
                {c.activity === 'tasbih' ? ` · Tasbih ${c.target}/day` : ''}
              </small>
            </div>
            <div className="df2-admin-actions">
              <button type="button" className="df2-btn df2-btn-sm" onClick={() => void startEdit(c)}>
                Edit
              </button>
              <button type="button" className="df2-btn df2-btn-sm" onClick={() => setTracking(c)}>
                Progress
              </button>
              {c.status === 'published' ? (
                <button type="button" className="df2-btn df2-btn-sm" onClick={() => void changeStatus(c, 'draft')}>
                  Unpublish
                </button>
              ) : (
                <button
                  type="button"
                  className="df2-btn df2-btn-sm df2-btn-primary"
                  onClick={() => void changeStatus(c, 'published')}
                >
                  Publish
                </button>
              )}
              {c.status !== 'archived' ? (
                <button
                  type="button"
                  className="df2-btn df2-btn-sm df2-btn-ghost-danger"
                  onClick={() => void changeStatus(c, 'archived')}
                >
                  Archive
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ChallengeForm({
  state,
  onDone,
}: {
  state: { id: string | null; draft: DailyChallengeDraft; usernames: string };
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<DailyChallengeDraft>(state.draft);
  const [usernames, setUsernames] = useState(state.usernames);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const span =
    /^\d{4}-\d{2}-\d{2}$/.test(draft.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(draft.endDate)
      ? daysBetween(draft.startDate, draft.endDate) + 1
      : 0;
  const set = <K extends keyof DailyChallengeDraft>(key: K, value: DailyChallengeDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError('');
  };

  async function save(status: DailyChallenge['status'], event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      let next = { ...draft };
      if (draft.audience === 'selected') {
        const { uids, missing } = await resolveUsernames(usernames);
        if (missing.length) throw new Error(`No Deen Friends profile for: ${missing.map((m) => '@' + m).join(', ')}`);
        next = { ...next, assignedUids: uids };
      }
      const problem = validateDraft(next);
      if (problem) throw new Error(problem);
      await saveDailyChallenge(state.id, next, status);
      toast(status === 'published' ? 'Challenge published.' : 'Draft saved.');
      onDone();
    } catch (err) {
      setError(err instanceof Error && !(err as { code?: string }).code ? err.message : friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="df2-admin-view df2-form" onSubmit={(e) => void save('published', e)}>
      <header className="df2-admin-head">
        <div>
          <span className="df2-kicker">DAILY DEEN CHALLENGE</span>
          <h1>{state.id ? 'Edit challenge' : 'New challenge'}</h1>
        </div>
        <button type="button" className="df2-btn" onClick={onDone}>
          Cancel
        </button>
      </header>
      <label className="df2-field">
        <span>Title</span>
        <input value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={80} required />
      </label>
      <label className="df2-field">
        <span>Description</span>
        <textarea
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={400}
          rows={2}
        />
      </label>
      <label className="df2-field">
        <span>Instructions</span>
        <textarea
          value={draft.instructions}
          onChange={(e) => set('instructions', e.target.value)}
          maxLength={1000}
          rows={4}
        />
        <small>Cite sources for any Qur’an, hadith or dua you mention.</small>
      </label>
      <div className="df2-form-grid">
        <label className="df2-field">
          <span>Category</span>
          <input value={draft.category} onChange={(e) => set('category', e.target.value)} maxLength={30} />
        </label>
        <label className="df2-field">
          <span>Completion</span>
          <select
            className="df2-input"
            value={draft.activity}
            onChange={(e) => set('activity', e.target.value === 'tasbih' ? 'tasbih' : 'manual')}
          >
            <option value="manual">Mark as done each day</option>
            <option value="tasbih">Tasbih count each day</option>
          </select>
        </label>
        {draft.activity === 'tasbih' ? (
          <label className="df2-field">
            <span>Tasbih target per day</span>
            <input
              type="number"
              min={2}
              max={10000}
              value={draft.target}
              onChange={(e) => set('target', Number(e.target.value))}
            />
          </label>
        ) : null}
        <label className="df2-field">
          <span>Start date</span>
          <input type="date" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </label>
        <label className="df2-field">
          <span>End date</span>
          <input type="date" value={draft.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </label>
        <label className="df2-field">
          <span>Days required to complete</span>
          <input
            type="number"
            min={1}
            max={span || 90}
            value={draft.requiredDays}
            onChange={(e) => set('requiredDays', Number(e.target.value))}
          />
          <small>{span ? `The challenge runs for ${span} day${span === 1 ? '' : 's'}.` : ''}</small>
        </label>
      </div>
      <fieldset className="df2-fieldset">
        <legend>Assign to</legend>
        <div className="df2-segmented">
          <button
            type="button"
            className={draft.audience === 'all' ? 'active' : ''}
            onClick={() => set('audience', 'all')}
          >
            All users
          </button>
          <button
            type="button"
            className={draft.audience === 'selected' ? 'active' : ''}
            onClick={() => set('audience', 'selected')}
          >
            Selected users
          </button>
        </div>
      </fieldset>
      {draft.audience === 'selected' ? (
        <label className="df2-field">
          <span>Usernames</span>
          <textarea
            value={usernames}
            onChange={(e) => setUsernames(e.target.value)}
            rows={2}
            placeholder="@aisha, @bilal"
          />
          <small>Separate with commas or spaces. Up to 200 users.</small>
        </label>
      ) : null}
      {error ? <p className="df2-form-error">{error}</p> : null}
      <div className="df2-sheet-actions">
        <button type="button" className="df2-btn" disabled={busy} onClick={() => void save('draft')}>
          Save as draft
        </button>
        <button type="submit" className="df2-btn df2-btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save & publish'}
        </button>
      </div>
    </form>
  );
}

function ParticipantsView({ challenge, onBack }: { challenge: DailyChallenge; onBack: () => void }) {
  const [rows, setRows] = useState<Array<DailyChallengeProgress & { username: string }> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void (async () => {
      try {
        const list = await adminListParticipants(challenge.id);
        const names = list.length ? await usernamesFor(list.map((p) => p.uid)) : {};
        setRows(
          list
            .map((p) => ({ ...p, username: names[p.uid] || p.uid }))
            .sort((a, b) => b.completedCount - a.completedCount),
        );
      } catch (err) {
        setError(friendlyMessage(err, 'Progress could not be loaded.'));
        setRows([]);
      }
    })();
  }, [challenge.id]);
  const completed = rows?.filter((r) => r.status === 'completed').length || 0;
  return (
    <section className="df2-admin-view">
      <header className="df2-admin-head">
        <div>
          <span className="df2-kicker">PROGRESS</span>
          <h1>{challenge.title}</h1>
          <p>
            {rows ? `${rows.length} participant${rows.length === 1 ? '' : 's'} · ${completed} completed` : 'Loading…'}
            {challenge.audience === 'selected'
              ? ` · ${challenge.assignedUids.length} assigned`
              : ' · assigned to all users'}
          </p>
        </div>
        <button type="button" className="df2-btn" onClick={onBack}>
          Back
        </button>
      </header>
      {error ? <p className="df2-form-error">{error}</p> : null}
      <table className="df2-admin-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Days done</th>
            <th>Last day</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.uid}>
              <td>@{r.username}</td>
              <td>
                {r.completedCount} / {challenge.requiredDays}
              </td>
              <td>{r.lastCompletedDate || '—'}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
