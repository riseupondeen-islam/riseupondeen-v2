/* Admin notification switches (Admin Console › Notification Settings), enforced by every sender in
 * this scheduler: queued admin notifications (index.js), prayer reminders (index.js) and Deen Friends
 * notifications including the Daily Deen Challenge (deenFriends.js).
 *
 *   deens_admin_settings/notifications
 *   { masterEnabled, dailyChallengeEnabled, prayerEnabled, otherEnabled, updatedAtMs, updatedBy, updatedByEmail }
 *
 * Rules (mirrored for display only in src/features/admin/services/notificationSettings.ts):
 *  - masterEnabled === false        → nothing is sent. No category can bypass it.
 *  - dailyChallenge                 → on unless explicitly false (the existing workflow stays on by default).
 *  - prayer, other                  → off unless explicitly true.
 *  - document missing               → the defaults above (the read succeeded, so the state is verified).
 *  - document could not be read     → nothing is sent ("unavailable"); callers keep their work for a later run.
 *
 * Firestore cost: the document is read once at the start of a run and re-read before a send only when
 * the copy is older than REFRESH_MS. A switch turned off in the console therefore stops a run that is
 * already sending within ~30 seconds, and the next run (≈5 minutes) never starts sending.
 */
const SETTINGS_PATH = ['deens_admin_settings', 'notifications'];
const REFRESH_MS = 30 * 1000;
const CATEGORIES = ['dailyChallenge', 'prayer', 'other'];

/** Effective switches for a settings document (`null` when it does not exist). */
function resolvePolicy(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    master: d.masterEnabled !== false,
    dailyChallenge: d.dailyChallengeEnabled !== false,
    prayer: d.prayerEnabled === true,
    other: d.otherEnabled === true,
  };
}

const NOTHING = Object.freeze({ master: false, dailyChallenge: false, prayer: false, other: false });

/** True only when the master switch AND the category switch are on. Unknown categories are never allowed. */
function categoryAllowed(policy, category) {
  return !!policy && CATEGORIES.includes(category) && policy.master === true && policy[category] === true;
}

/**
 * One policy reader per scheduler run.
 *   await policy.get()            → current switches (refreshed when stale)
 *   await policy.allows('prayer') → call immediately before each send
 *   policy.unavailable()          → true when the last read failed (nothing is allowed meanwhile)
 */
function createPolicy(db, { now = () => Date.now(), refreshMs = REFRESH_MS } = {}) {
  let current = null;
  let readAt = 0;
  let reads = 0;
  let error = '';
  async function load() {
    try {
      const snap = await db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]).get();
      reads++;
      current = resolvePolicy(snap.exists ? snap.data() : null);
      error = '';
    } catch (e) {
      current = NOTHING;
      error = String((e && e.message) || e);
      console.warn('Notification settings could not be read; no notification will be sent', error);
    }
    readAt = now();
    return current;
  }
  return {
    async get() {
      if (!current || now() - readAt >= refreshMs) await load();
      return current;
    },
    async allows(category) {
      return categoryAllowed(await this.get(), category);
    },
    unavailable() {
      return !!error;
    },
    summary() {
      return { ...(current || NOTHING), reads, ...(error ? { error } : {}) };
    },
  };
}

module.exports = { createPolicy, resolvePolicy, categoryAllowed, SETTINGS_PATH, CATEGORIES, REFRESH_MS };
