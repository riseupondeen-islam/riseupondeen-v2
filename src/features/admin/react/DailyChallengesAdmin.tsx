/* Admin › Daily Deen Challenges.
 *
 * Three tabs:
 *  - Schedule:   the automation. Turn daily publishing on/off, see the scheduler's last run, plan the
 *                30-day library from a start date, add one-off or repeating challenges (every day or
 *                chosen weekdays), pause / edit / reschedule / disable entries, preview the next 30
 *                days and publish today's challenges now if needed.
 *  - Challenges: every published, draft and archived challenge (manual and scheduled), with the
 *                original create / edit / publish / unpublish / archive / progress tools.
 *  - Library:    the 30 ready-made challenges with their references, to preview or plan.
 * Every write is authorised by firestore.rules (community-level admins); buttons are a convenience. */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { addDays as dfAddDays, daysBetween, localDay, usernameKey } from '../../deen-friends/services/format';
import { requireSignedIn } from '../../deen-friends/services/firebaseSession';
import { CHALLENGE_LIBRARY, LIBRARY_CATEGORIES, SINCERITY_NOTE, libraryInstructions, type LibraryChallenge } from '../challenges/challengeLibrary';
import {
  DEFAULT_TIME_ZONE,
  INSTANCE_PREFIX,
  WEEKDAYS,
  addDays,
  describeRepeat,
  upcoming,
  zoneDate,
  type ScheduleEntry,
} from '../challenges/scheduleRules';
import {
  deleteEntry,
  libraryDraft,
  listEntries,
  publishDueToday,
  readAutomation,
  saveEntry,
  scheduleLibrary,
  setAutomationEnabled,
  setEntryStatus,
  validateEntry,
  type Automation,
  type EntryDraft,
} from '../services/challengeSchedule';
import { Card, ConfirmDialog, DataTable, Empty, PageHead, fmtDateTime, type Column } from './ui';

const EMPTY: DailyChallengeDraft = {
  title: '',
  description: '',
  instructions: '',
  category: "Qur'an",
  activity: 'manual',
  target: 1,
  startDate: localDay(),
  endDate: dfAddDays(localDay(), 6),
  requiredDays: 7,
  audience: 'all',
  assignedUids: [],
};

type Tab = 'schedule' | 'challenges' | 'library';

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
  const [tab, setTab] = useState<Tab>('schedule');
  const [editing, setEditing] = useState<{ id: string | null; draft: DailyChallengeDraft; usernames: string } | null>(null);
  const [tracking, setTracking] = useState<DailyChallenge | null>(null);
  const [entryEditing, setEntryEditing] = useState<{ id: string | null; draft: EntryDraft } | null>(null);

  if (editing) return <ChallengeForm state={editing} onDone={() => setEditing(null)} />;
  if (tracking) return <ParticipantsView challenge={tracking} onBack={() => setTracking(null)} />;
  if (entryEditing) return <EntryForm state={entryEditing} onDone={() => setEntryEditing(null)} />;

  return (
    <section className="df2-admin-view">
      <PageHead
        kicker="Deen Friends · Official"
        title="Daily Deen Challenges"
        description="Plan challenges once and they publish automatically each day. Published challenges appear in members’ Challenges tab, separate from challenges friends send each other."
        actions={
          <button className="rad-btn rad-btn-primary" onClick={() => setEditing({ id: null, draft: { ...EMPTY }, usernames: '' })} type="button">
            + New challenge
          </button>
        }
      />
      <div aria-label="Daily Deen Challenges sections" className="rad-tabs" role="tablist">
        {(
          [
            ['schedule', 'Schedule & automation'],
            ['challenges', 'Published & drafts'],
            ['library', '30-day library'],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button aria-selected={tab === id} key={id} onClick={() => setTab(id)} role="tab" type="button">
            {label}
          </button>
        ))}
      </div>
      {tab === 'schedule' ? <ScheduleTab onEdit={setEntryEditing} /> : null}
      {tab === 'challenges' ? <ChallengesTab onEdit={setEditing} onTrack={setTracking} /> : null}
      {tab === 'library' ? <LibraryTab onPlanned={() => setTab('schedule')} /> : null}
    </section>
  );
}

/* ================================================================ Schedule tab */

function ScheduleTab({ onEdit }: { onEdit: (s: { id: string | null; draft: EntryDraft }) => void }) {
  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null);
  const [auto, setAuto] = useState<Automation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [planning, setPlanning] = useState(false);
  const [removing, setRemoving] = useState<ScheduleEntry | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [e, a] = await Promise.all([listEntries(), readAutomation()]);
      setEntries(e);
      setAuto(a);
    } catch (err) {
      setError(friendlyMessage(err, 'The schedule could not be loaded.'));
      setEntries([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const tz = auto?.timeZone || DEFAULT_TIME_ZONE;
  const today = zoneDate(Date.now(), tz);
  const next = useMemo(() => (entries ? upcoming(entries, today, 30) : []), [entries, today]);
  const conflicts = next.filter((d) => d.entries.length > 1).length;
  const gaps = next.filter((d) => !d.entries.length).length;

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusy('');
    }
  }

  const columns: Column<ScheduleEntry>[] = [
    {
      key: 'title',
      label: 'Challenge',
      mandatory: true,
      render: (e) => (
        <span>
          <b>{e.title}</b>
          {e.dayNumber ? <small className="rad-muted"> · library day {e.dayNumber}</small> : null}
        </span>
      ),
      value: (e) => e.title,
    },
    { key: 'category', label: 'Category', render: (e) => e.category, value: (e) => e.category, filter: 'select' },
    { key: 'when', label: 'Runs', render: (e) => describeRepeat(e), value: (e) => e.date },
    { key: 'repeat', label: 'Repeat', defaultHidden: true, render: (e) => e.repeat, value: (e) => e.repeat, filter: 'select' },
    {
      key: 'status',
      label: 'Status',
      render: (e) => <span className={`rad-pill ${e.status === 'active' ? 'rad-pill-ok' : e.status === 'paused' ? 'rad-pill-warn' : ''}`}>{e.status}</span>,
      value: (e) => e.status,
      filter: 'select',
    },
    { key: 'activity', label: 'Completion', defaultHidden: true, render: (e) => (e.activity === 'tasbih' ? `Tasbih ${e.target}` : 'Mark as done'), value: (e) => e.activity, filter: 'select' },
    {
      key: 'actions',
      label: 'Actions',
      mandatory: true,
      sortable: false,
      render: (e) => (
        <div className="table-actions">
          <button className="mini-action" onClick={() => onEdit({ id: e.id, draft: { ...e } })} type="button">
            Edit
          </button>
          {e.status === 'active' ? (
            <button className="mini-action" disabled={!!busy} onClick={() => void run('status', async () => (await setEntryStatus(e, 'paused'), toast('Paused.'), await load()))} type="button">
              Pause
            </button>
          ) : (
            <button className="mini-action primary" disabled={!!busy} onClick={() => void run('status', async () => (await setEntryStatus(e, 'active'), toast('Resumed.'), await load()))} type="button">
              Resume
            </button>
          )}
          <button className="mini-action danger" onClick={() => setRemoving(e)} type="button">
            Remove
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      {error ? <div className="rad-alert rad-alert-error">{error}</div> : null}
      <div className="rad-grid-2">
        <Card
          title="Daily automation"
          subtitle={`Days follow ${tz}. The free scheduler checks every few minutes and publishes each planned challenge once on its day.`}
          actions={
            auto ? (
              <label className="rad-switch">
                <input
                  checked={auto.enabled}
                  disabled={!!busy}
                  onChange={(ev) =>
                    void run('auto', async () => {
                      await setAutomationEnabled(ev.target.checked, tz);
                      setAuto({ ...auto, enabled: ev.target.checked });
                      toast(ev.target.checked ? 'Daily publishing is on.' : 'Daily publishing is paused.');
                    })
                  }
                  type="checkbox"
                />
                <i aria-hidden="true" />
                {auto.enabled ? 'On' : 'Paused'}
              </label>
            ) : null
          }
        >
          {auto ? (
            <div className="rad-list">
              <div className="rad-list-item">
                <div className="rad-list-main">
                  <strong>Last scheduler run</strong>
                  <small>
                    {auto.lastRunAtMs
                      ? `${fmtDateTime(auto.lastRunAtMs)} · published ${auto.lastRunPublished}, archived ${auto.lastRunArchived}${auto.lastRunFailed ? `, ${auto.lastRunFailed} failed` : ''}${auto.lastRunNote ? ` · ${auto.lastRunNote}` : ''}`
                      : 'No run recorded yet. Runs appear here once the scheduler (GitHub Actions) has processed the schedule.'}
                  </small>
                </div>
              </div>
              <div className="rad-list-item">
                <div className="rad-list-main">
                  <strong>Today ({today})</strong>
                  <small>
                    {next[0]?.entries.length
                      ? next[0].entries.map((e) => e.title).join(' · ')
                      : 'Nothing is planned for today.'}
                  </small>
                </div>
                <button
                  className={`rad-btn rad-btn-sm${busy === 'publish' ? ' is-busy' : ''}`}
                  disabled={!!busy || !next[0]?.entries.length || !auto.enabled}
                  onClick={() =>
                    void run('publish', async () => {
                      const r = await publishDueToday(entries || [], tz);
                      toast(r.published ? `Published ${r.published} challenge${r.published === 1 ? '' : 's'} for ${r.date}.` : 'Today’s challenges were already published.');
                    })
                  }
                  title="Publishes today’s planned challenges now instead of waiting for the scheduler. Never creates a second copy."
                  type="button"
                >
                  Publish today’s now
                </button>
              </div>
            </div>
          ) : (
            <p className="rad-loading">Loading…</p>
          )}
        </Card>
        <Card
          title="Plan ahead"
          subtitle={entries ? `${entries.filter((e) => e.status === 'active').length} active entries · next 30 days: ${30 - gaps} planned, ${gaps} empty${conflicts ? `, ${conflicts} with more than one challenge` : ''}` : ''}
        >
          <div className="rad-actions">
            <button className="rad-btn rad-btn-primary" onClick={() => setPlanning(true)} type="button">
              Plan the 30-day library
            </button>
            <button
              className="rad-btn"
              onClick={() =>
                onEdit({
                  id: null,
                  draft: { title: '', description: '', instructions: '', category: 'Zikr', activity: 'manual', target: 1, repeat: 'once', date: addDays(today, 1), endDate: '', weekdays: [], status: 'active' },
                })
              }
              type="button"
            >
              + Add a scheduled challenge
            </button>
          </div>
          {conflicts ? (
            <p className="rad-alert rad-alert-warn" style={{ marginTop: 14 }}>
              {conflicts} upcoming day{conflicts === 1 ? ' has' : 's have'} more than one challenge. That is allowed (for example a daily repeat plus a one-off) — check
              it is intended.
            </p>
          ) : null}
        </Card>
      </div>

      <Card title="Next 30 days" subtitle="What will be published each day (preview — nothing here is published yet).">
        {entries === null ? (
          <p className="rad-loading">Loading…</p>
        ) : next.some((d) => d.entries.length) ? (
          <ol className="rad-list">
            {next.map((d) => (
              <li className={`rad-list-item${d.entries.length ? '' : ' is-muted'}`} key={d.date}>
                <span className={`rad-date-badge${d.date === today ? ' is-today' : ''}`}>
                  <small>{WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}</small>
                  <b>{Number(d.date.slice(8))}</b>
                </span>
                <div className="rad-list-main">
                  {d.entries.length ? (
                    d.entries.map((e) => (
                      <strong key={e.id}>
                        {e.title} <small className="rad-muted">· {e.category}{e.repeat !== 'once' ? ` · repeats ${e.repeat === 'daily' ? 'daily' : 'weekly'}` : ''}</small>
                      </strong>
                    ))
                  ) : (
                    <small>No challenge planned.</small>
                  )}
                  <small>{d.date}</small>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>Nothing is planned yet. Plan the 30-day library or add a scheduled challenge.</Empty>
        )}
      </Card>

      <Card title="All schedule entries" subtitle="Edit, reschedule, pause or remove planned challenges. Removing an entry never deletes challenges already published.">
        {entries ? <DataTable columns={columns} empty="No schedule entries yet." id="challenge-schedule" rowKey={(e) => e.id} rows={entries} searchPlaceholder="Search the schedule…" /> : null}
      </Card>

      {planning ? (
        <PlanLibraryDialog
          entries={entries || []}
          onCancel={() => setPlanning(false)}
          onDone={async () => {
            setPlanning(false);
            await load();
          }}
          today={today}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          busy={busy === 'remove'}
          confirmLabel="Remove from schedule"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void run('remove', async () => {
              await deleteEntry(removing.id);
              toast('Removed from the schedule.');
              setRemoving(null);
              await load();
            })
          }
          title="Remove this planned challenge?"
        >
          <p>
            <b>{removing.title}</b> ({describeRepeat(removing)}) will no longer be published. Challenges it already published, and members’ progress, are kept.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function PlanLibraryDialog({ today, entries, onCancel, onDone }: { today: string; entries: ScheduleEntry[]; onCancel: () => void; onDone: () => void }) {
  const [start, setStart] = useState(addDays(today, 1));
  const [busy, setBusy] = useState(false);
  const overlapping = entries.filter((e) => e.status === 'active' && e.repeat === 'once' && e.date >= start && e.date <= addDays(start, 29) && !e.libraryKey).length;
  return (
    <ConfirmDialog
      busy={busy}
      busyLabel="Planning…"
      confirmLabel="Plan 30 days"
      onCancel={onCancel}
      onConfirm={async () => {
        setBusy(true);
        try {
          const r = await scheduleLibrary(start);
          toast(r.created ? `Planned ${r.created} challenges from ${start}.${r.skipped ? ` ${r.skipped} were already planned.` : ''}` : 'These 30 days were already planned — nothing was duplicated.');
          onDone();
        } catch (err) {
          toast(friendlyMessage(err), 'error');
        } finally {
          setBusy(false);
        }
      }}
      title="Plan the 30-day library"
    >
      <p>Day 1 runs on the start date, day 2 the next day, and so on to day 30. You can edit, move or pause any day afterwards.</p>
      <label className="rad-field" style={{ marginTop: 12 }}>
        <span>Start date</span>
        <input className="rad-input" min={today} onChange={(e) => setStart(e.target.value)} type="date" value={start} />
        <small>
          Runs {start} → {addDays(start, 29)}.
          {overlapping ? ` ${overlapping} other one-off challenge(s) are already planned in this period.` : ''}
        </small>
      </label>
    </ConfirmDialog>
  );
}

/* ================================================================ Schedule entry form */

function EntryForm({ state, onDone }: { state: { id: string | null; draft: EntryDraft }; onDone: () => void }) {
  const [d, setD] = useState<EntryDraft>(state.draft);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EntryDraft>(k: K, v: EntryDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setError('');
  };
  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const problem = validateEntry(d);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await saveEntry(state.id, d);
      toast(state.id ? 'Schedule entry updated.' : 'Added to the schedule.');
      onDone();
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="df2-admin-view df2-form" onSubmit={(e) => void save(e)}>
      <PageHead
        kicker="Challenge schedule"
        title={state.id ? 'Edit scheduled challenge' : 'New scheduled challenge'}
        actions={
          <button className="rad-btn" onClick={onDone} type="button">
            Cancel
          </button>
        }
      />
      <div className="rad-grid-wide">
        <Card title="Challenge">
          <div className="rad-form-grid">
            <label className="rad-field rad-span-2">
              <span>Title</span>
              <input className="rad-input" maxLength={80} onChange={(e) => set('title', e.target.value)} required value={d.title} />
            </label>
            <label className="rad-field">
              <span>Category</span>
              <input className="rad-input" list="radChallengeCategories" maxLength={30} onChange={(e) => set('category', e.target.value)} value={d.category} />
              <datalist id="radChallengeCategories">
                {LIBRARY_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="rad-field">
              <span>Completion</span>
              <select className="rad-input" onChange={(e) => set('activity', e.target.value === 'tasbih' ? 'tasbih' : 'manual')} value={d.activity}>
                <option value="manual">Mark as done</option>
                <option value="tasbih">Tasbih count</option>
              </select>
            </label>
            {d.activity === 'tasbih' ? (
              <label className="rad-field">
                <span>Tasbih target</span>
                <input className="rad-input" max={10000} min={2} onChange={(e) => set('target', Number(e.target.value))} type="number" value={d.target} />
              </label>
            ) : null}
            <label className="rad-field rad-span-2">
              <span>Description</span>
              <textarea className="rad-input" maxLength={400} onChange={(e) => set('description', e.target.value)} rows={2} value={d.description} />
            </label>
            <label className="rad-field rad-span-2">
              <span>Instructions</span>
              <textarea className="rad-input" maxLength={1000} onChange={(e) => set('instructions', e.target.value)} rows={7} value={d.instructions} />
              <small>
                Include the action, how to know it is done, and the source of any Qur’an verse or hadith. {d.instructions.length}/1000
              </small>
            </label>
            <label className="rad-field rad-span-2">
              <span>Reference (optional)</span>
              <input className="rad-input" maxLength={300} onChange={(e) => set('reference', e.target.value)} placeholder="e.g. Qur'an 13:28 · Sahih Muslim 2733" value={d.reference || ''} />
            </label>
          </div>
        </Card>
        <Card title="When">
          <div className="rad-form-grid">
            <label className="rad-field rad-span-2">
              <span>Repeat</span>
              <select className="rad-input" onChange={(e) => set('repeat', e.target.value as EntryDraft['repeat'])} value={d.repeat}>
                <option value="once">Once</option>
                <option value="daily">Every day</option>
                <option value="weekly">On chosen weekdays</option>
              </select>
            </label>
            <label className="rad-field">
              <span>{d.repeat === 'once' ? 'Day' : 'Starts'}</span>
              <input className="rad-input" onChange={(e) => set('date', e.target.value)} type="date" value={d.date} />
            </label>
            {d.repeat !== 'once' ? (
              <label className="rad-field">
                <span>Ends (optional)</span>
                <input className="rad-input" min={d.date} onChange={(e) => set('endDate', e.target.value)} type="date" value={d.endDate} />
              </label>
            ) : null}
            {d.repeat === 'weekly' ? (
              <fieldset className="rad-field rad-span-2" style={{ border: 0, padding: 0 }}>
                <legend style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Weekdays</legend>
                <div className="rad-days">
                  {WEEKDAYS.map((w, i) => (
                    <label key={w}>
                      <input
                        checked={d.weekdays.includes(i)}
                        onChange={(e) => set('weekdays', e.target.checked ? [...d.weekdays, i] : d.weekdays.filter((x) => x !== i))}
                        type="checkbox"
                      />
                      <span>{w}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <label className="rad-field rad-span-2">
              <span>Status</span>
              <select className="rad-input" onChange={(e) => set('status', e.target.value as EntryDraft['status'])} value={d.status}>
                <option value="active">Active — publish automatically</option>
                <option value="paused">Paused — keep, but do not publish</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
          </div>
          <p className="rad-muted" style={{ marginTop: 12, fontSize: 12.5 }}>
            {describeRepeat(d)}. Each day it runs, one challenge is published for that day only.
          </p>
        </Card>
      </div>
      <Card title="Preview" subtitle="How members will see it in their Challenges tab">
        <ChallengePreview category={d.category} description={d.description} instructions={d.instructions} title={d.title} />
      </Card>
      {error ? <p className="df2-form-error">{error}</p> : null}
      <div className="rad-actions">
        <button className="rad-btn" disabled={busy} onClick={onDone} type="button">
          Cancel
        </button>
        <button className={`rad-btn rad-btn-primary${busy ? ' is-busy' : ''}`} disabled={busy} type="submit">
          {busy ? 'Saving…' : state.id ? 'Save changes' : 'Add to schedule'}
        </button>
      </div>
    </form>
  );
}

function ChallengePreview({ title, category, description, instructions }: { title: string; category: string; description: string; instructions: string }) {
  if (!title && !description && !instructions) return <Empty>Start writing to see a preview.</Empty>;
  return (
    <div className="rad-preview-card">
      <span className="rad-kicker">{category || 'Deen'}</span>
      <h4>{title || 'Untitled challenge'}</h4>
      {description ? <p>{description}</p> : null}
      {instructions ? <p className="rad-prewrap">{instructions}</p> : null}
    </div>
  );
}

/* ================================================================ Library tab */

function LibraryTab({ onPlanned }: { onPlanned: () => void }) {
  const [open, setOpen] = useState<LibraryChallenge | null>(null);
  const [planDay, setPlanDay] = useState<LibraryChallenge | null>(null);
  const columns: Column<LibraryChallenge>[] = [
    { key: 'day', label: 'Day', mandatory: true, render: (c) => <b>{c.day}</b>, value: (c) => c.day },
    { key: 'title', label: 'Challenge', mandatory: true, render: (c) => c.title, value: (c) => c.title },
    { key: 'category', label: 'Category', render: (c) => c.category, value: (c) => c.category, filter: 'select' },
    { key: 'activity', label: 'Completion', render: (c) => (c.activity === 'tasbih' ? `Tasbih ${c.target}` : 'Mark as done'), value: (c) => (c.activity === 'tasbih' ? 'Tasbih' : 'Mark as done'), filter: 'select' },
    { key: 'reference', label: 'Reference', render: (c) => <small>{c.reference || '—'}</small>, value: (c) => c.reference || '' },
    {
      key: 'actions',
      label: 'Actions',
      mandatory: true,
      sortable: false,
      render: (c) => (
        <div className="table-actions">
          <button className="mini-action" onClick={() => setOpen(c)} type="button">
            Preview
          </button>
          <button className="mini-action primary" onClick={() => setPlanDay(c)} type="button">
            Schedule…
          </button>
        </div>
      ),
    },
  ];
  return (
    <>
      <Card
        title="30 distinct daily challenges"
        subtitle="Zikr, du’a, hadith, Qur’an, salah, character, family, community, gratitude, knowledge, reflection and encouragement — one small action each day."
      >
        <div className="rad-alert rad-alert-info" style={{ marginBottom: 14 }}>
          Qur’an and hadith lines are translations of the meaning, each with its reference; “Motivation” lines are original encouragement, not quotations. Every challenge
          ends with this reminder: <i>“{SINCERITY_NOTE}”</i>
        </div>
        <DataTable columns={columns} id="challenge-library" pageSize={10} rowKey={(c) => c.key} rows={CHALLENGE_LIBRARY} searchPlaceholder="Search the library…" />
      </Card>
      {open ? (
        <ConfirmDialog confirmLabel="Close" onCancel={() => setOpen(null)} onConfirm={() => setOpen(null)} title={`Day ${open.day}: ${open.title}`}>
          <ChallengePreview category={open.category} description={open.summary} instructions={libraryInstructions(open)} title={open.title} />
        </ConfirmDialog>
      ) : null}
      {planDay ? <ScheduleOneDialog challenge={planDay} onCancel={() => setPlanDay(null)} onDone={() => (setPlanDay(null), onPlanned())} /> : null}
    </>
  );
}

function ScheduleOneDialog({ challenge, onCancel, onDone }: { challenge: LibraryChallenge; onCancel: () => void; onDone: () => void }) {
  const tomorrow = addDays(zoneDate(Date.now(), DEFAULT_TIME_ZONE), 1);
  const [date, setDate] = useState(tomorrow);
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      busy={busy}
      busyLabel="Scheduling…"
      confirmLabel="Add to schedule"
      onCancel={onCancel}
      onConfirm={async () => {
        setBusy(true);
        try {
          await saveEntry(null, libraryDraft(challenge, date));
          toast(`“${challenge.title}” is planned for ${date}.`);
          onDone();
        } catch (err) {
          toast(friendlyMessage(err), 'error');
        } finally {
          setBusy(false);
        }
      }}
      title={`Schedule “${challenge.title}”`}
    >
      <label className="rad-field">
        <span>Day</span>
        <input className="rad-input" min={tomorrow} onChange={(e) => setDate(e.target.value)} type="date" value={date} />
      </label>
    </ConfirmDialog>
  );
}

/* ================================================================ Challenges tab (original tools) */

function ChallengesTab({
  onEdit,
  onTrack,
}: {
  onEdit: (s: { id: string | null; draft: DailyChallengeDraft; usernames: string }) => void;
  onTrack: (c: DailyChallenge) => void;
}) {
  const [rows, setRows] = useState<DailyChallenge[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

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
    const names = c.assignedUids.length ? await usernamesFor(c.assignedUids).catch(() => ({}) as Record<string, string>) : {};
    onEdit({
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
    if (busyId) return;
    setBusyId(c.id);
    try {
      await setDailyChallengeStatus(c.id, status);
      toast(status === 'published' ? 'Challenge published.' : status === 'archived' ? 'Challenge archived.' : 'Challenge unpublished.');
      await load();
    } catch (err) {
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusyId('');
    }
  }

  const columns: Column<DailyChallenge>[] = [
    {
      key: 'title',
      label: 'Challenge',
      mandatory: true,
      render: (c) => (
        <span data-challenge-title>
          <b>{c.title}</b>
          {c.activity === 'tasbih' ? <small className="rad-muted"> · Tasbih {c.target}/day</small> : null}
        </span>
      ),
      value: (c) => c.title,
    },
    { key: 'category', label: 'Category', render: (c) => c.category, value: (c) => c.category, filter: 'select' },
    {
      key: 'dates',
      label: 'Runs',
      render: (c) => (c.startDate === c.endDate ? c.startDate : `${c.startDate} → ${c.endDate}`),
      value: (c) => Date.parse(`${c.startDate}T00:00:00`) || 0,
      filter: 'date',
    },
    { key: 'required', label: 'Days required', defaultHidden: true, render: (c) => c.requiredDays, value: (c) => c.requiredDays, align: 'right' },
    {
      key: 'audience',
      label: 'Audience',
      render: (c) => (c.audience === 'all' ? 'All users' : `${c.assignedUids.length} selected`),
      value: (c) => (c.audience === 'all' ? 'All users' : 'Selected users'),
      filter: 'select',
    },
    {
      key: 'source',
      label: 'Source',
      render: (c) => (c.id.startsWith(INSTANCE_PREFIX) ? 'Schedule' : 'Manual'),
      value: (c) => (c.id.startsWith(INSTANCE_PREFIX) ? 'Schedule' : 'Manual'),
      filter: 'select',
    },
    {
      key: 'status',
      label: 'Status',
      render: (c) => <span className={`df2-status df2-status-${c.status}`}>{c.status}</span>,
      value: (c) => c.status,
      filter: 'select',
    },
    {
      key: 'actions',
      label: 'Actions',
      mandatory: true,
      sortable: false,
      render: (c) => (
        <div className="table-actions">
          <button className="mini-action" onClick={() => void startEdit(c)} type="button">
            Edit
          </button>
          <button className="mini-action" onClick={() => onTrack(c)} type="button">
            Progress
          </button>
          {c.status === 'published' ? (
            <button className="mini-action" disabled={busyId === c.id} onClick={() => void changeStatus(c, 'draft')} type="button">
              Unpublish
            </button>
          ) : (
            <button className="mini-action primary" disabled={busyId === c.id} onClick={() => void changeStatus(c, 'published')} type="button">
              Publish
            </button>
          )}
          {c.status !== 'archived' ? (
            <button className="mini-action danger" disabled={busyId === c.id} onClick={() => void changeStatus(c, 'archived')} type="button">
              Archive
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <Card
      title="Published, draft and archived challenges"
      subtitle="Scheduled challenges appear here on their day. Unpublish or archive one to correct a mistake; members’ progress is kept."
      actions={
        <button className="rad-btn rad-btn-sm" disabled={rows === null} onClick={() => (setRows(null), void load())} type="button">
          Refresh
        </button>
      }
    >
      {error ? <p className="df2-form-error">{error}</p> : null}
      {rows === null ? <p className="rad-loading">Loading…</p> : null}
      {rows ? <DataTable columns={columns} empty="No Daily Deen Challenges yet." id="daily-challenges" rowKey={(c) => c.id} rows={rows} searchPlaceholder="Search challenges…" /> : null}
    </Card>
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
    /^\d{4}-\d{2}-\d{2}$/.test(draft.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(draft.endDate) ? daysBetween(draft.startDate, draft.endDate) + 1 : 0;
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
      <PageHead
        kicker="Daily Deen Challenge"
        title={state.id ? 'Edit challenge' : 'New challenge'}
        actions={
          <button className="rad-btn" onClick={onDone} type="button">
            Cancel
          </button>
        }
      />
      <div className="rad-grid-wide">
        <Card title="Challenge">
          <div className="df2-form" style={{ gap: 14 }}>
            <label className="df2-field">
              <span>Title</span>
              <input maxLength={80} onChange={(e) => set('title', e.target.value)} required value={draft.title} />
            </label>
            <label className="df2-field">
              <span>Description</span>
              <textarea maxLength={400} onChange={(e) => set('description', e.target.value)} rows={2} value={draft.description} />
            </label>
            <label className="df2-field">
              <span>Instructions</span>
              <textarea maxLength={1000} onChange={(e) => set('instructions', e.target.value)} rows={5} value={draft.instructions} />
              <small>Cite sources for any Qur’an, hadith or dua you mention.</small>
            </label>
            <div className="df2-form-grid">
              <label className="df2-field">
                <span>Category</span>
                <input maxLength={30} onChange={(e) => set('category', e.target.value)} value={draft.category} />
              </label>
              <label className="df2-field">
                <span>Completion</span>
                <select className="df2-input" onChange={(e) => set('activity', e.target.value === 'tasbih' ? 'tasbih' : 'manual')} value={draft.activity}>
                  <option value="manual">Mark as done each day</option>
                  <option value="tasbih">Tasbih count each day</option>
                </select>
              </label>
              {draft.activity === 'tasbih' ? (
                <label className="df2-field">
                  <span>Tasbih target per day</span>
                  <input max={10000} min={2} onChange={(e) => set('target', Number(e.target.value))} type="number" value={draft.target} />
                </label>
              ) : null}
            </div>
          </div>
        </Card>
        <Card title="Dates & audience">
          <div className="df2-form" style={{ gap: 14 }}>
            <div className="df2-form-grid">
              <label className="df2-field">
                <span>Start date</span>
                <input onChange={(e) => set('startDate', e.target.value)} type="date" value={draft.startDate} />
              </label>
              <label className="df2-field">
                <span>End date</span>
                <input onChange={(e) => set('endDate', e.target.value)} type="date" value={draft.endDate} />
              </label>
            </div>
            <label className="df2-field">
              <span>Days required to complete</span>
              <input max={span || 90} min={1} onChange={(e) => set('requiredDays', Number(e.target.value))} type="number" value={draft.requiredDays} />
              <small>{span ? `The challenge runs for ${span} day${span === 1 ? '' : 's'}.` : ''}</small>
            </label>
            <fieldset className="df2-fieldset">
              <legend>Assign to</legend>
              <div className="df2-segmented">
                <button className={draft.audience === 'all' ? 'active' : ''} onClick={() => set('audience', 'all')} type="button">
                  All users
                </button>
                <button className={draft.audience === 'selected' ? 'active' : ''} onClick={() => set('audience', 'selected')} type="button">
                  Selected users
                </button>
              </div>
            </fieldset>
            {draft.audience === 'selected' ? (
              <label className="df2-field">
                <span>Usernames</span>
                <textarea onChange={(e) => setUsernames(e.target.value)} placeholder="@aisha, @bilal" rows={2} value={usernames} />
                <small>Separate with commas or spaces. Up to 200 users.</small>
              </label>
            ) : null}
          </div>
        </Card>
      </div>
      <Card title="Preview" subtitle="How members will see it">
        <ChallengePreview category={draft.category} description={draft.description} instructions={draft.instructions} title={draft.title} />
      </Card>
      {error ? <p className="df2-form-error">{error}</p> : null}
      <div className="df2-sheet-actions">
        <button className="rad-btn" disabled={busy} onClick={() => void save('draft')} type="button">
          Save as draft
        </button>
        <button className={`rad-btn rad-btn-primary${busy ? ' is-busy' : ''}`} disabled={busy} type="submit">
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
        setRows(list.map((p) => ({ ...p, username: names[p.uid] || p.uid })).sort((a, b) => b.completedCount - a.completedCount));
      } catch (err) {
        setError(friendlyMessage(err, 'Progress could not be loaded.'));
        setRows([]);
      }
    })();
  }, [challenge.id]);
  const completed = rows?.filter((r) => r.status === 'completed').length || 0;
  const columns: Column<DailyChallengeProgress & { username: string }>[] = [
    { key: 'user', label: 'Member', mandatory: true, render: (r) => `@${r.username}`, value: (r) => r.username },
    { key: 'done', label: 'Days done', render: (r) => `${r.completedCount} / ${challenge.requiredDays}`, value: (r) => r.completedCount, align: 'right' },
    { key: 'last', label: 'Last day', render: (r) => r.lastCompletedDate || '—', value: (r) => r.lastCompletedDate },
    { key: 'status', label: 'Status', render: (r) => r.status, value: (r) => r.status, filter: 'select' },
  ];
  return (
    <section className="df2-admin-view">
      <PageHead
        kicker="Progress"
        title={challenge.title}
        description={`${rows ? `${rows.length} participant${rows.length === 1 ? '' : 's'} · ${completed} completed` : 'Loading…'}${
          challenge.audience === 'selected' ? ` · ${challenge.assignedUids.length} assigned` : ' · assigned to all users'
        }. Progress is private to each member and is shown here only for administration.`}
        actions={
          <button className="rad-btn" onClick={onBack} type="button">
            Back
          </button>
        }
      />
      {error ? <p className="df2-form-error">{error}</p> : null}
      <Card>{rows ? <DataTable columns={columns} empty="Nobody has started this challenge yet." id="challenge-participants" rowKey={(r) => r.uid} rows={rows} /> : <p className="rad-loading">Loading…</p>}</Card>
    </section>
  );
}
