/* Admin Dashboard data. Every number comes from the existing Firestore collections through the
 * signed-in administrator's normal, rule-checked reads — nothing is estimated or invented.
 *
 * Reads are bounded (each query has a limit) and the result is kept for 15 minutes in memory and in
 * this tab's sessionStorage (cleared on sign-out), so moving between sections or reloading the console
 * does not re-read the same data; Refresh always re-reads. Every read counts against the project's
 * free daily Firestore quota, which the website and the scheduler share. When a limit is reached the card says
 * so ("based on the latest N…") instead of presenting a partial count as a total.
 *
 * Days are grouped in India Standard Time (Asia/Kolkata), the day boundary Deen Friends already uses
 * for streaks and daily activity. */
import { S } from '../../../runtime/store';
import { collection, getDocs, limit, orderBy, query, where } from '../../../services/firebase/sdk';
import { requireSignedIn } from '../../deen-friends/services/firebaseSession';
import { friendlyMessage } from '../../deen-friends/services/errors';

export const INSIGHT_TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 19800000;
const DAY = 86400000;
const CACHE_MS = 15 * 60 * 1000;
const CACHE_KEY = 'rud_admin_insights_v1';
const CHALLENGE_ROWS = 14;

export const LIMITS = { sessions: 800, users: 2000, activity: 3000, threads: 200, challenges: 60, participants: 250, reports: 200 };

export interface Section<T> {
  ok: boolean;
  data: T;
  error?: string;
  capped?: boolean;
}

export interface Insights {
  loadedAt: number;
  days: string[]; // last 30 IST dates, oldest first
  visitors: Section<{ uniqueByDay: number[]; sessionsByDay: number[]; installedByDay: number[]; topRoutes: Array<{ label: string; value: number }>; devices: Array<{ label: string; value: number }> }>;
  members: Section<{ total: number; newByDay: number[]; disabled: number }>;
  activity: Section<{ activeByDay: number[]; pointsByDay: number[] }>;
  challenges: Section<{
    rows: Array<{ id: string; title: string; date: string; status: string; participants: number; completed: number }>;
    completionsByDay: number[];
  }>;
  rise: Section<{ open: number; resolved: number; unread: number; activeByDay: number[]; total: number }>;
  reports: Section<{ open: number; total: number }>;
}

let cache: { at: number; value: Insights } | null = readStoredCache();

function readStoredCache(): { at: number; value: Insights } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    return saved && Number(saved.at) && saved.value ? saved : null;
  } catch {
    return null;
  }
}
let inflight: Promise<Insights> | null = null;

/** YYYY-MM-DD in IST. */
export function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}
export function istDayIndex(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY);
}
export function lastDays(n: number, now = Date.now()): string[] {
  const today = istDayIndex(now);
  return Array.from({ length: n }, (_, i) => new Date((today - (n - 1 - i)) * DAY).toISOString().slice(0, 10));
}
const toMs = (v: unknown): number => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const t = v as { toMillis?: () => number; seconds?: number; toDate?: () => Date };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  const d = new Date(v as string);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
};

async function safe<T>(fallback: T, run: () => Promise<{ data: T; capped?: boolean }>): Promise<Section<T>> {
  try {
    const out = await run();
    return { ok: true, data: out.data, capped: out.capped };
  } catch (err) {
    return { ok: false, data: fallback, error: friendlyMessage(err, 'Could not be loaded.') };
  }
}

async function load(): Promise<Insights> {
  const { db } = await requireSignedIn();
  const now = Date.now();
  const days = lastDays(30, now);
  const index = new Map(days.map((d, i) => [d, i]));
  const zeros = () => days.map(() => 0);

  const visitors = safe({ uniqueByDay: zeros(), sessionsByDay: zeros(), installedByDay: zeros(), topRoutes: [], devices: [] }, async () => {
    const snap = await getDocs(query(collection(db, 'visitor_sessions'), orderBy('lastSeenAt', 'desc'), limit(LIMITS.sessions)));
    const unique = days.map(() => new Set<string>());
    const sessionsByDay = zeros();
    const installedByDay = zeros();
    const routes = new Map<string, number>();
    const devices = new Map<string, number>();
    snap.docs.forEach((d) => {
      const s = d.data() as Record<string, unknown>;
      const ms = toMs(s.startedAt) || toMs(s.lastSeenAt);
      const i = index.get(istDate(ms));
      if (i === undefined) return;
      sessionsByDay[i]++;
      unique[i].add(String(s.visitorId || d.id));
      if (s.appSession === true || ['standalone', 'fullscreen', 'minimal-ui'].includes(String(s.appMode || ''))) installedByDay[i]++;
      const route = String(s.route || 'home').split('/')[0] || 'home';
      routes.set(route, (routes.get(route) || 0) + 1);
      const device = String(s.device || 'Unknown');
      devices.set(device, (devices.get(device) || 0) + 1);
    });
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
    return {
      data: { uniqueByDay: unique.map((u) => u.size), sessionsByDay, installedByDay, topRoutes: top(routes), devices: top(devices) },
      capped: snap.size >= LIMITS.sessions,
    };
  });

  const members = safe({ total: 0, newByDay: zeros(), disabled: 0 }, async () => {
    const snap = await getDocs(query(collection(db, 'deens_users'), limit(LIMITS.users)));
    const newByDay = zeros();
    let disabled = 0;
    snap.docs.forEach((d) => {
      const u = d.data() as Record<string, unknown>;
      if (u.deenFriendsAccessDisabled || u.deletionRequestedAt) disabled++;
      const i = index.get(istDate(toMs(u.createdAt)));
      if (i !== undefined) newByDay[i]++;
    });
    return { data: { total: snap.size, newByDay, disabled }, capped: snap.size >= LIMITS.users };
  });

  const activity = safe({ activeByDay: zeros(), pointsByDay: zeros() }, async () => {
    const first = istDayIndex(now) - 29;
    const snap = await getDocs(query(collection(db, 'deens_activity'), where('dayIndex', '>=', first), limit(LIMITS.activity)));
    const activeByDay = zeros();
    const pointsByDay = zeros();
    snap.docs.forEach((d) => {
      const a = d.data() as Record<string, unknown>;
      const i = Number(a.dayIndex) - first;
      if (i < 0 || i >= days.length) return;
      activeByDay[i]++;
      pointsByDay[i] += Math.max(0, Number(a.count) || 0);
    });
    return { data: { activeByDay, pointsByDay }, capped: snap.size >= LIMITS.activity };
  });

  const challenges = safe({ rows: [] as Insights['challenges']['data']['rows'], completionsByDay: zeros() }, async () => {
    const snap = await getDocs(query(collection(db, 'deens_daily_challenges'), limit(LIMITS.challenges)));
    const list = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as Record<string, unknown> & { id: string })
      .filter((c) => String(c.status) !== 'draft' && String(c.endDate || '') >= days[0])
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))
      .slice(0, CHALLENGE_ROWS);
    const completionsByDay = zeros();
    const rows = await Promise.all(
      list.map(async (c) => {
        const p = await getDocs(query(collection(db, 'deens_daily_challenges', c.id, 'participants'), limit(LIMITS.participants)));
        let completed = 0;
        p.docs.forEach((d) => {
          const v = d.data() as Record<string, unknown>;
          if (v.status === 'completed') completed++;
          (Array.isArray(v.completedDates) ? v.completedDates : []).forEach((day) => {
            const i = index.get(String(day));
            if (i !== undefined) completionsByDay[i]++;
          });
        });
        return {
          id: c.id,
          title: String(c.title || 'Challenge'),
          date: String(c.startDate || ''),
          status: String(c.status || ''),
          participants: p.size,
          completed,
        };
      }),
    );
    return { data: { rows, completionsByDay }, capped: rows.some((r) => r.participants >= LIMITS.participants) };
  });

  const rise = safe({ open: 0, resolved: 0, unread: 0, activeByDay: zeros(), total: 0 }, async () => {
    const snap = await getDocs(query(collection(db, 'deens_rise_threads'), orderBy('lastMessageAtMs', 'desc'), limit(LIMITS.threads)));
    let open = 0,
      resolved = 0,
      unread = 0;
    const activeByDay = zeros();
    snap.docs.forEach((d) => {
      const t = d.data() as Record<string, unknown>;
      if (t.status === 'resolved') resolved++;
      else open++;
      if (Number(t.unreadByRise) > 0) unread++;
      const i = index.get(istDate(Number(t.lastMessageAtMs) || 0));
      if (i !== undefined) activeByDay[i]++;
    });
    return { data: { open, resolved, unread, activeByDay, total: snap.size }, capped: snap.size >= LIMITS.threads };
  });

  const reports = safe({ open: 0, total: 0 }, async () => {
    const snap = await getDocs(query(collection(db, 'deens_reports'), limit(LIMITS.reports)));
    const open = snap.docs.filter((d) => !['resolved', 'closed', 'dismissed'].includes(String((d.data() as Record<string, unknown>).status || '').toLowerCase())).length;
    return { data: { open, total: snap.size }, capped: snap.size >= LIMITS.reports };
  });

  const [v, m, a, c, r, rep] = await Promise.all([visitors, members, activity, challenges, rise, reports]);
  return { loadedAt: Date.now(), days, visitors: v, members: m, activity: a, challenges: c, rise: r, reports: rep };
}

/** Loads (or returns the recent cached) dashboard data. `force` re-reads; concurrent calls share one load. */
export function loadInsights(force = false): Promise<Insights> {
  if (!cache) cache = readStoredCache();
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.value);
  if (inflight) return inflight;
  inflight = load()
    .then((value) => {
      cache = { at: Date.now(), value };
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch {}
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function clearInsightsCache(): void {
  cache = null;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {}
}

/** Content library counts from the console's live content list (no extra reads). */
export function contentSummary() {
  const items = (S.adminContent || []).filter((x) => x && x.type !== 'site' && x.type !== 'article');
  const types: Record<string, { published: number; draft: number }> = {};
  let scheduled = 0;
  for (const i of items as Array<Record<string, unknown>>) {
    const t = String(i.type || 'other');
    types[t] ||= { published: 0, draft: 0 };
    if (i.published) types[t].published++;
    else types[t].draft++;
    if (!i.published && i.scheduleStatus === 'scheduled') scheduled++;
  }
  return { total: items.length, published: items.filter((i) => (i as { published?: boolean }).published).length, scheduled, types };
}
