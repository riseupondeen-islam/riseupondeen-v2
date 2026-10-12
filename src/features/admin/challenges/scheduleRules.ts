/* Schedule rules shared by the Admin Console. They mirror push-scheduler/challengeScheduler.js
 * exactly (the scheduler is CommonJS on Node, so it keeps its own copy; both are covered by tests:
 * push-scheduler/test/adminAutomation.test.js and tests/e2e/admin-console.spec.ts). */

export type Repeat = 'once' | 'daily' | 'weekly';
export type EntryStatus = 'active' | 'paused' | 'disabled';

export interface ScheduleEntry {
  id: string;
  title: string;
  description: string;
  instructions: string;
  category: string;
  activity: 'manual' | 'tasbih';
  target: number;
  repeat: Repeat;
  /** First (or only) day, YYYY-MM-DD in the automation time zone. */
  date: string;
  /** Last day for repeating entries ('' = no end). */
  endDate: string;
  /** 0 = Sunday … 6 = Saturday (weekly entries). */
  weekdays: number[];
  status: EntryStatus;
  libraryKey?: string;
  dayNumber?: number;
  reference?: string;
  updatedAtMs: number;
}

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
export const INSTANCE_PREFIX = 'sched_';
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function zoneDate(ms: number, timeZone = DEFAULT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function entryRunsOn(entry: Pick<ScheduleEntry, 'status' | 'date' | 'endDate' | 'repeat' | 'weekdays'>, date: string): boolean {
  if (!entry || entry.status !== 'active' || !isDate(entry.date) || !isDate(date)) return false;
  if (date < entry.date) return false;
  if (isDate(entry.endDate) && date > entry.endDate) return false;
  if (entry.repeat === 'daily') return true;
  if (entry.repeat === 'weekly') return Array.isArray(entry.weekdays) && entry.weekdays.map(Number).includes(weekdayOf(date));
  return entry.date === date;
}

export function instanceId(entryId: string, date: string): string {
  return `${INSTANCE_PREFIX}${entryId}_${date.replace(/-/g, '')}`;
}

/** Which entries run on each of the next `days` days (inclusive of `from`). */
export function upcoming(entries: ScheduleEntry[], from: string, days: number): Array<{ date: string; entries: ScheduleEntry[] }> {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, entries: entries.filter((e) => entryRunsOn(e, date)) };
  });
}

export function describeRepeat(e: Pick<ScheduleEntry, 'repeat' | 'date' | 'endDate' | 'weekdays'>): string {
  const until = e.endDate ? ` until ${e.endDate}` : '';
  if (e.repeat === 'daily') return `Every day from ${e.date}${until}`;
  if (e.repeat === 'weekly')
    return `Every ${[...e.weekdays].sort().map((d) => WEEKDAYS[d]).join(', ')} from ${e.date}${until}`;
  return `Once on ${e.date}`;
}
