/* Daily Deen Challenge automation for the free scheduler (Admin SDK on GitHub Actions, every ~5 min).
 *
 *   deens_challenge_schedule/{entryId}            the plan, managed in the Admin Console
 *   deens_admin_settings/challenge_automation     { enabled, timeZone } + last-run summary
 *   deens_daily_challenges/sched_<entry>_<yyyymmdd>  the published challenge for one day
 *
 * Every run:
 *  1. Works out "today" in the configured time zone (default Asia/Kolkata, the zone the rest of
 *     Deen Friends already uses for days and streaks).
 *  2. For each active entry that runs today (once on its date, every day, or on chosen weekdays,
 *     never after its end date) it creates that day's challenge with a FIXED document id inside a
 *     create-if-absent transaction. A retry, an overlapping run or the Admin Console publishing the
 *     same day can therefore never create a second copy.
 *  3. Archives scheduler-made challenges whose day has passed (yesterday is kept for late time
 *     zones). Users only see challenges whose end date has not passed, so this keeps the public
 *     "published" list short; progress documents are never touched.
 *
 * Missed runs: if the scheduler is down for a whole day, that day is not published afterwards — a
 * daily challenge can only be completed on its own day, so publishing it late would only show users
 * something they can no longer do. Any run during the day publishes it.
 */

const SCHEDULE = 'deens_challenge_schedule';
const CHALLENGES = 'deens_daily_challenges';
const SETTINGS_PATH = ['deens_admin_settings', 'challenge_automation'];
const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
const ID_PREFIX = 'sched_';

function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(tz) });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD of `ms` in `timeZone`. */
function zoneDate(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date (independent of any time zone). */
function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Does this schedule entry publish a challenge on `date`? (Shared logic with the Admin Console.) */
function entryRunsOn(entry, date) {
  if (!entry || entry.status !== 'active' || !isDate(entry.date) || !isDate(date)) return false;
  if (date < entry.date) return false;
  if (isDate(entry.endDate) && date > entry.endDate) return false;
  if (entry.repeat === 'daily') return true;
  if (entry.repeat === 'weekly')
    return Array.isArray(entry.weekdays) && entry.weekdays.map(Number).includes(weekdayOf(date));
  return entry.date === date; // 'once'
}

function instanceId(entryId, date) {
  return `${ID_PREFIX}${entryId}_${date.replace(/-/g, '')}`;
}

/** The published challenge for one day, in exactly the shape firestore.rules (validDailyChallenge) expects. */
function challengeFromEntry(entry, date, nowMs, serverTimestamp) {
  const activity = entry.activity === 'tasbih' ? 'tasbih' : 'manual';
  return {
    challengeType: 'daily_deen',
    title: String(entry.title || '').slice(0, 80),
    description: String(entry.description || '').slice(0, 400),
    instructions: String(entry.instructions || '').slice(0, 1000),
    category: String(entry.category || 'Deen').slice(0, 30),
    activity,
    target: activity === 'tasbih' ? Math.max(2, Math.min(10000, Math.round(Number(entry.target) || 33))) : 1,
    startDate: date,
    endDate: date,
    requiredDays: 1,
    status: 'published',
    audience: 'all',
    assignedUids: [],
    createdBy: String(entry.createdBy || entry.updatedBy || 'scheduler'),
    createdAt: serverTimestamp(),
    updatedBy: String(entry.updatedBy || entry.createdBy || 'scheduler'),
    updatedAt: serverTimestamp(),
    updatedAtMs: nowMs,
  };
}

async function readSettings(db) {
  const snap = await db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]).get();
  const data = snap.exists ? snap.data() || {} : {};
  const timeZone = validTimeZone(data.timeZone) ? String(data.timeZone) : DEFAULT_TIME_ZONE;
  return { enabled: data.enabled !== false, timeZone };
}

/**
 * Publishes today's scheduled challenges and archives finished ones.
 * `serverTimestamp` is FieldValue.serverTimestamp (injected so the module is testable offline).
 */
async function runChallengeSchedule(db, { now = Date.now(), serverTimestamp } = {}) {
  const ts = serverTimestamp || require('firebase-admin/firestore').FieldValue.serverTimestamp;
  const settings = await readSettings(db);
  const today = zoneDate(now, settings.timeZone);
  const result = { today, timeZone: settings.timeZone, published: 0, alreadyPublished: 0, archived: 0, failed: 0 };
  const settingsRef = db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]);

  if (!settings.enabled) {
    result.skipped = 'automation paused';
  } else {
    const entries = await db.collection(SCHEDULE).where('status', '==', 'active').limit(500).get();
    for (const doc of entries.docs) {
      const entry = doc.data() || {};
      if (!entryRunsOn(entry, today)) continue;
      const ref = db.collection(CHALLENGES).doc(instanceId(doc.id, today));
      try {
        const created = await db.runTransaction(async (tx) => {
          const existing = await tx.get(ref);
          if (existing.exists) return false;
          tx.create(ref, challengeFromEntry(entry, today, now, ts));
          return true;
        });
        if (created) result.published++;
        else result.alreadyPublished++;
      } catch (error) {
        result.failed++;
        console.warn(`Scheduled challenge ${doc.id} failed`, error && error.message);
      }
    }
  }

  // Archive scheduler-made challenges whose day is over (keep yesterday for late time zones).
  const cutoff = addDays(today, -1);
  const published = await db.collection(CHALLENGES).where('status', '==', 'published').limit(300).get();
  for (const doc of published.docs) {
    const c = doc.data() || {};
    if (!doc.id.startsWith(ID_PREFIX) || !isDate(c.endDate) || c.endDate >= cutoff) continue;
    try {
      await doc.ref.set({ status: 'archived', updatedAt: ts(), updatedAtMs: now }, { merge: true });
      result.archived++;
    } catch (error) {
      result.failed++;
      console.warn(`Archiving ${doc.id} failed`, error && error.message);
    }
  }

  await settingsRef.set(
    {
      lastRunAtMs: now,
      lastRunDate: today,
      lastRunPublished: result.published,
      lastRunArchived: result.archived,
      lastRunFailed: result.failed,
      lastRunNote: result.skipped || '',
    },
    { merge: true },
  );
  return result;
}

module.exports = {
  runChallengeSchedule,
  entryRunsOn,
  instanceId,
  challengeFromEntry,
  zoneDate,
  addDays,
  weekdayOf,
  DEFAULT_TIME_ZONE,
};
