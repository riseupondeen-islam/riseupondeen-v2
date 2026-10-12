/* Admin › Daily Deen Challenges › Schedule — client side of the challenge automation.
 *
 *   deens_challenge_schedule/{entryId}          the plan (firestore.rules: community admins)
 *   deens_admin_settings/challenge_automation   { enabled, timeZone } + the scheduler's last run
 *   deens_daily_challenges/sched_<entry>_<day>  the published challenge for one day
 *
 * The trusted scheduler (push-scheduler/challengeScheduler.js) publishes due entries every few
 * minutes. "Publish today's now" here does the same work from the browser — same fixed document
 * ids, inside create-if-absent transactions — so it can never create a second copy either. */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from '../../../services/firebase/sdk';
import { requireSignedIn, currentDeenUser } from '../../deen-friends/services/firebaseSession';
import { DeenFriendsError } from '../../deen-friends/services/errors';
import { CHALLENGE_LIBRARY, libraryInstructions, type LibraryChallenge } from '../challenges/challengeLibrary';
import {
  DEFAULT_TIME_ZONE,
  addDays,
  entryRunsOn,
  instanceId,
  zoneDate,
  type EntryStatus,
  type Repeat,
  type ScheduleEntry,
} from '../challenges/scheduleRules';

const SCHEDULE = 'deens_challenge_schedule';

export interface Automation {
  enabled: boolean;
  timeZone: string;
  lastRunAtMs: number;
  lastRunDate: string;
  lastRunPublished: number;
  lastRunArchived: number;
  lastRunFailed: number;
  lastRunNote: string;
}

export type EntryDraft = Omit<ScheduleEntry, 'id' | 'updatedAtMs'>;

function readEntry(id: string, d: Record<string, unknown>): ScheduleEntry {
  return {
    id,
    title: String(d.title || ''),
    description: String(d.description || ''),
    instructions: String(d.instructions || ''),
    category: String(d.category || 'Deen'),
    activity: d.activity === 'tasbih' ? 'tasbih' : 'manual',
    target: Math.max(1, Number(d.target) || 1),
    repeat: (['once', 'daily', 'weekly'].includes(String(d.repeat)) ? d.repeat : 'once') as Repeat,
    date: String(d.date || ''),
    endDate: String(d.endDate || ''),
    weekdays: Array.isArray(d.weekdays) ? d.weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : [],
    status: (['active', 'paused', 'disabled'].includes(String(d.status)) ? d.status : 'paused') as EntryStatus,
    libraryKey: d.libraryKey ? String(d.libraryKey) : undefined,
    dayNumber: Number.isFinite(Number(d.dayNumber)) && d.dayNumber !== undefined ? Number(d.dayNumber) : undefined,
    reference: d.reference ? String(d.reference) : undefined,
    updatedAtMs: Number(d.updatedAtMs) || 0,
  };
}

export function validateEntry(d: EntryDraft): string | null {
  if (d.title.trim().length < 3) return 'Give the challenge a title (at least 3 characters).';
  if (d.title.length > 80) return 'Keep the title under 80 characters.';
  if (d.description.length > 400) return 'Keep the description under 400 characters.';
  if (d.instructions.length > 1000) return 'Keep the instructions under 1,000 characters.';
  if (!d.category.trim() || d.category.length > 30) return 'Choose a category (up to 30 characters).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return 'Choose the day it starts.';
  if (d.repeat !== 'once' && d.endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(d.endDate) || d.endDate < d.date)) return 'The end date must be on or after the start date.';
  if (d.repeat === 'weekly' && !d.weekdays.length) return 'Choose at least one weekday.';
  if (d.activity === 'tasbih' && (d.target < 2 || d.target > 10000)) return 'A Tasbih target must be between 2 and 10,000.';
  if ((d.reference || '').length > 300) return 'Keep the reference under 300 characters.';
  return null;
}

function entryFields(d: EntryDraft, uid: string) {
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    instructions: d.instructions.trim(),
    category: d.category.trim().slice(0, 30),
    activity: d.activity,
    target: d.activity === 'tasbih' ? Math.round(d.target) : 1,
    repeat: d.repeat,
    date: d.date,
    endDate: d.repeat === 'once' ? '' : d.endDate || '',
    weekdays: d.repeat === 'weekly' ? [...new Set(d.weekdays)].sort() : [],
    status: d.status,
    ...(d.libraryKey ? { libraryKey: d.libraryKey } : {}),
    ...(d.dayNumber !== undefined ? { dayNumber: Math.round(d.dayNumber) } : {}),
    ...(d.reference ? { reference: d.reference.slice(0, 300) } : {}),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  };
}

export async function listEntries(): Promise<ScheduleEntry[]> {
  const { db } = await requireSignedIn();
  const snap = await getDocs(query(collection(db, SCHEDULE), limit(500)));
  return snap.docs
    .map((d) => readEntry(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function newEntryId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `e_${Date.now().toString(36)}_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Creates or replaces one schedule entry. */
export async function saveEntry(id: string | null, draft: EntryDraft): Promise<string> {
  const problem = validateEntry(draft);
  if (problem) throw new DeenFriendsError('invalid', problem);
  const { db, uid } = await requireSignedIn();
  if (id) {
    const ref = doc(db, SCHEDULE, id);
    const current = await getDoc(ref);
    if (!current.exists()) throw new DeenFriendsError('not-found', 'This schedule entry no longer exists.');
    const createdBy = String((current.data() as Record<string, unknown>).createdBy || '');
    await setDoc(ref, { ...entryFields(draft, uid), createdBy, createdAt: (current.data() as Record<string, unknown>).createdAt ?? serverTimestamp() });
    return id;
  }
  const newId = newEntryId();
  await setDoc(doc(db, SCHEDULE, newId), { ...entryFields(draft, uid), createdBy: uid, createdAt: serverTimestamp() });
  return newId;
}

export async function setEntryStatus(entry: ScheduleEntry, status: EntryStatus): Promise<void> {
  await saveEntry(entry.id, { ...entry, status });
}

/** Removes the plan entry only; challenges it already published (and their progress) are kept. */
export async function deleteEntry(id: string): Promise<void> {
  const { db } = await requireSignedIn();
  await deleteDoc(doc(db, SCHEDULE, id));
}

export function libraryDraft(c: LibraryChallenge, date: string): EntryDraft {
  return {
    title: c.title,
    description: c.summary,
    instructions: libraryInstructions(c),
    category: c.category,
    activity: c.activity,
    target: c.activity === 'tasbih' ? c.target : 1,
    repeat: 'once',
    date,
    endDate: '',
    weekdays: [],
    status: 'active',
    libraryKey: c.key,
    dayNumber: c.day,
    reference: c.reference,
  };
}

/** Plans the 30-day library starting at `startDate`: day N runs on startDate + N − 1.
 *  Entries already planned for the same library day and date are not created again. */
export async function scheduleLibrary(startDate: string, onlyKeys?: string[]): Promise<{ created: number; skipped: number }> {
  const { db, uid } = await requireSignedIn();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new DeenFriendsError('invalid', 'Choose a start date.');
  let created = 0,
    skipped = 0;
  for (const c of CHALLENGE_LIBRARY) {
    if (onlyKeys && !onlyKeys.includes(c.key)) continue;
    const date = addDays(startDate, c.day - 1);
    const id = `lib_${c.key.replace(/^lib30-/, '').slice(0, 40)}_${date.replace(/-/g, '')}`;
    const ref = doc(db, SCHEDULE, id);
    const made = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) return false;
      tx.set(ref, { ...entryFields(libraryDraft(c, date), uid), createdBy: uid, createdAt: serverTimestamp() });
      return true;
    });
    if (made) created++;
    else skipped++;
  }
  return { created, skipped };
}

const SETTINGS_REF = ['deens_admin_settings', 'challenge_automation'] as const;

export async function readAutomation(): Promise<Automation> {
  const { db } = await requireSignedIn();
  const snap = await getDoc(doc(db, SETTINGS_REF[0], SETTINGS_REF[1]));
  const d = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
  return {
    enabled: d.enabled !== false,
    timeZone: typeof d.timeZone === 'string' && d.timeZone ? d.timeZone : DEFAULT_TIME_ZONE,
    lastRunAtMs: Number(d.lastRunAtMs) || 0,
    lastRunDate: String(d.lastRunDate || ''),
    lastRunPublished: Number(d.lastRunPublished) || 0,
    lastRunArchived: Number(d.lastRunArchived) || 0,
    lastRunFailed: Number(d.lastRunFailed) || 0,
    lastRunNote: String(d.lastRunNote || ''),
  };
}

export async function setAutomationEnabled(enabled: boolean, timeZone: string): Promise<void> {
  const { db, uid } = await requireSignedIn();
  await setDoc(
    doc(db, SETTINGS_REF[0], SETTINGS_REF[1]),
    { enabled, timeZone, updatedBy: uid, updatedByEmail: currentDeenUser()?.email || '', updatedAtMs: Date.now() },
    { merge: true },
  );
}

/** Publishes today's due entries now (same ids as the scheduler → never duplicates). */
export async function publishDueToday(entries: ScheduleEntry[], timeZone: string): Promise<{ published: number; already: number; date: string }> {
  const { db, uid } = await requireSignedIn();
  const today = zoneDate(Date.now(), timeZone);
  let published = 0,
    already = 0;
  for (const e of entries.filter((x) => entryRunsOn(x, today))) {
    const ref = doc(db, 'deens_daily_challenges', instanceId(e.id, today));
    const made = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) return false;
      tx.set(ref, {
        challengeType: 'daily_deen',
        title: e.title.slice(0, 80),
        description: e.description.slice(0, 400),
        instructions: e.instructions.slice(0, 1000),
        category: e.category.slice(0, 30),
        activity: e.activity,
        target: e.activity === 'tasbih' ? Math.max(2, Math.round(e.target)) : 1,
        startDate: today,
        endDate: today,
        requiredDays: 1,
        status: 'published',
        audience: 'all',
        assignedUids: [],
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedBy: uid,
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
      });
      return true;
    });
    if (made) published++;
    else already++;
  }
  return { published, already, date: today };
}
