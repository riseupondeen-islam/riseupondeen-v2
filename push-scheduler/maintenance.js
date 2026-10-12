/* Server-side maintenance for Deen Friends V3 (runs with the Admin SDK on the free scheduler).
 *
 * 1. Official RISE chat retention (Section 8)
 *    A message becomes eligible for deletion only when ALL of these hold:
 *      - its conversation is marked solved (status == 'resolved');
 *      - BOTH the user (userSeenAtMs) and the RISE team (riseSeenAtMs) have seen the conversation
 *        after the message was written;
 *      - it is not the one-time automated welcome.
 *    (Checked every 30 minutes, not on every scheduler run.)
 *    The first run that observes eligibility stamps `purgeAt = now + 24h` on the message — so the
 *    24-hour period starts when the read conditions are met, not when the message was sent. A later
 *    run deletes stamped messages whose purgeAt has passed (and a Firestore TTL policy on
 *    `messages.purgeAt` does the same independently). Re-opening a conversation removes the stamps.
 *    Everything is bounded (≤ 400 documents per query), idempotent (deleting twice or stamping twice
 *    changes nothing) and safe to run concurrently. Message text is never logged; the audit log
 *    records only which conversation was purged, when and how many messages.
 *
 * 2. Friend suggestions (Section 9)
 *    At most once every 6 hours, for up to 15 recently active members whose suggestions are older than a
 *    day: friends-of-friends ranked by mutual friends, excluding the member, existing friends,
 *    pending requests either way, blocks either way, and anyone deleted, disabled or not
 *    discoverable. Writes deens_suggestions/{uid} (≤ 20 entries: name, username, avatar only).
 */
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const STATE_DOC = 'push_scheduler_state/maintenance';
const DAY_MS = 86400000;
const RETENTION_MS = DAY_MS;
const PAGE = 400;
const MAX_WINDOW_MS = 7 * DAY_MS;
/* Free-tier Firestore budget: the scheduler runs every ~5 minutes, but neither job needs that.
   Retention deletes 24 hours after eligibility, so checking every 30 minutes changes nothing a user
   sees; suggestions are refreshed at most once a day per member, so checking every 6 hours is enough. */
const RETENTION_EVERY_MS = 30 * 60000;
const SUGGESTIONS_EVERY_MS = 6 * 60 * 60000;

const ts = (ms) => (Timestamp && typeof Timestamp.fromMillis === 'function' ? Timestamp.fromMillis(ms) : new Date(ms));
const millisOf = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : Number(v) || 0);

async function commitInChunks(db, ops) {
  for (let i = 0; i < ops.length; i += PAGE) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + PAGE)) op(batch);
    await batch.commit();
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* 1. RISE retention                                                                               */

async function touchedThreads(db, since, until) {
  const threads = db.collection('deens_rise_threads');
  const fields = ['userSeenAtMs', 'riseSeenAtMs', 'statusChangedAtMs'];
  const snaps = await Promise.all(fields.map((f) => threads.where(f, '>', since).where(f, '<=', until).limit(200).get()));
  const byId = new Map();
  for (const snap of snaps) for (const d of snap.docs) byId.set(d.id, d);
  return [...byId.values()];
}

/** Stamps purgeAt on newly eligible messages; removes stamps from re-opened conversations. */
async function stampThread(db, threadDoc, now) {
  const t = threadDoc.data() || {};
  const messages = threadDoc.ref.collection('messages');
  if (t.status !== 'resolved') {
    const stamped = await messages.where('purgeAt', '>', ts(0)).limit(PAGE).get();
    await commitInChunks(
      db,
      stamped.docs.map((d) => (b) => b.update(d.ref, { purgeAt: FieldValue.delete(), retentionEligibleAtMs: FieldValue.delete() })),
    );
    return { stamped: 0, unstamped: stamped.docs.length };
  }
  const cutoff = Math.min(Number(t.userSeenAtMs) || 0, Number(t.riseSeenAtMs) || 0);
  if (!cutoff) return { stamped: 0, unstamped: 0 };
  const eligible = await messages.where('createdAtMs', '<=', cutoff).orderBy('createdAtMs', 'asc').limit(PAGE).get();
  const fresh = eligible.docs.filter((d) => d.id !== 'welcome' && !d.get('purgeAt'));
  await commitInChunks(
    db,
    fresh.map((d) => (b) => b.update(d.ref, { purgeAt: ts(now + RETENTION_MS), retentionEligibleAtMs: now })),
  );
  return { stamped: fresh.length, unstamped: 0 };
}

/** Deletes stamped RISE messages whose 24 hours have passed (re-checking every condition). */
async function purgeDue(db, now) {
  const due = await db.collectionGroup('messages').where('purgeAt', '<=', ts(now)).limit(PAGE).get();
  const threadCache = new Map();
  const perThread = new Map();
  const ops = [];
  for (const d of due.docs) {
    const parent = d.ref.parent && d.ref.parent.parent;
    if (!parent || !parent.parent || parent.parent.id !== 'deens_rise_threads') continue; // only RISE chats
    if (d.id === 'welcome') continue;
    if (!threadCache.has(parent.id)) {
      const snap = await parent.get();
      threadCache.set(parent.id, snap.exists ? snap.data() || {} : null);
    }
    const thread = threadCache.get(parent.id);
    if (!thread || thread.status !== 'resolved') continue; // re-opened since it was stamped: keep
    const created = Number(d.get('createdAtMs')) || 0;
    const cutoff = Math.min(Number(thread.userSeenAtMs) || 0, Number(thread.riseSeenAtMs) || 0);
    if (!created || created > cutoff) continue; // not seen by both sides: keep
    if (millisOf(d.get('purgeAt')) > now) continue;
    ops.push((b) => b.delete(d.ref));
    perThread.set(parent.id, (perThread.get(parent.id) || 0) + 1);
  }
  await commitInChunks(db, ops);
  // Accountability without content: one audit entry per conversation purged in this run.
  const audits = [...perThread.entries()].map(([uid, count]) => (b) =>
    b.set(db.collection('deens_admin_audit_logs').doc(), {
      adminUid: 'system:retention',
      action: 'RISE_RETENTION_PURGE',
      target: `deens_rise_threads/${uid}`,
      reason: `${count} message(s) removed 24h after both sides had seen them (conversation solved)`,
      timestamp: FieldValue.serverTimestamp(),
    }),
  );
  await commitInChunks(db, audits);
  return [...perThread.values()].reduce((a, b) => a + b, 0);
}

async function processRiseRetention(db, since, until, now = Date.now()) {
  const threads = await touchedThreads(db, since, until);
  let stamped = 0;
  let unstamped = 0;
  for (const t of threads) {
    const r = await stampThread(db, t, now);
    stamped += r.stamped;
    unstamped += r.unstamped;
  }
  const deleted = await purgeDue(db, now);
  return { threads: threads.length, stamped, unstamped, deleted };
}

/* ---------------------------------------------------------------------------------------------- */
/* 2. Friend suggestions                                                                           */

async function friendsOf(db, uid) {
  const snap = await db.collection('deens_friendships').where('members', 'array-contains', uid).limit(100).get();
  const out = new Set();
  for (const d of snap.docs) for (const m of d.get('members') || []) if (m !== uid) out.add(m);
  return out;
}

async function excludedFor(db, uid) {
  const req = db.collection('deens_friend_requests');
  const blocks = db.collection('deens_blocks');
  const [out, inc, b1, b2] = await Promise.all([
    req.where('fromUid', '==', uid).where('status', '==', 'pending').limit(100).get(),
    req.where('toUid', '==', uid).where('status', '==', 'pending').limit(100).get(),
    blocks.where('blockerUid', '==', uid).limit(200).get(),
    blocks.where('blockedUid', '==', uid).limit(200).get(),
  ]);
  const ex = new Set([uid]);
  out.docs.forEach((d) => ex.add(d.get('toUid')));
  inc.docs.forEach((d) => ex.add(d.get('fromUid')));
  b1.docs.filter((d) => d.get('status') !== 'removed').forEach((d) => ex.add(d.get('blockedUid')));
  b2.docs.filter((d) => d.get('status') !== 'removed').forEach((d) => ex.add(d.get('blockerUid')));
  return ex;
}

async function suggestionsFor(db, uid) {
  const mine = await friendsOf(db, uid);
  const excluded = await excludedFor(db, uid);
  const counts = new Map();
  for (const f of [...mine].slice(0, 30)) {
    for (const c of await friendsOf(db, f)) {
      if (c === uid || mine.has(c) || excluded.has(c)) continue;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 40);
  const items = [];
  for (const [cuid, mutualCount] of ranked) {
    if (items.length >= 20) break;
    const [card, user] = await Promise.all([
      db.collection('deens_public_profiles').doc(cuid).get(),
      db.collection('deens_users').doc(cuid).get(),
    ]);
    if (!card.exists || card.get('discoverable') !== true) continue; // opted out
    if (!user.exists || user.get('deenFriendsAccessDisabled') === true) continue; // deleted / disabled
    items.push({
      uid: cuid,
      displayName: String(card.get('displayName') || '').slice(0, 50),
      username: String(card.get('username') || '').slice(0, 50),
      avatar: String(card.get('avatar') || 'crescent').slice(0, 20),
      avatarConfig: card.get('avatarConfig') || null,
      mutualCount,
    });
  }
  return items;
}

async function processSuggestions(db, now = Date.now(), maxUsers = 15) {
  const active = await db
    .collection('deens_public_profiles')
    .where('discoverable', '==', true)
    .orderBy('lastActiveDay', 'desc')
    .limit(60)
    .get();
  let done = 0;
  for (const d of active.docs) {
    if (done >= maxUsers) break;
    const ref = db.collection('deens_suggestions').doc(d.id);
    const current = await ref.get();
    if (current.exists && now - (Number(current.get('generatedAtMs')) || 0) < DAY_MS) continue;
    const items = await suggestionsFor(db, d.id);
    await ref.set({ items, generatedAtMs: now });
    done++;
  }
  return { refreshed: done };
}

/* ---------------------------------------------------------------------------------------------- */

async function runMaintenance(db, now = Date.now()) {
  const stateRef = db.doc(STATE_DOC);
  const state = await stateRef.get();
  const until = now - 3000;
  let since = state.exists ? Number(state.get('sinceMs')) || 0 : 0;
  if (!since || until - since > MAX_WINDOW_MS) since = until - MAX_WINDOW_MS;
  let retention = { skipped: true };
  const lastRetention = state.exists ? Number(state.get('retentionAtMs')) || 0 : 0;
  if (now - lastRetention >= RETENTION_EVERY_MS) {
    retention = await processRiseRetention(db, since, until, now);
    // The window only advances when it was processed, so skipped runs lose no conversation changes.
    await stateRef.set({ sinceMs: until, retentionAtMs: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  let suggestions = { skipped: true };
  const lastSuggest = state.exists ? Number(state.get('suggestionsAtMs')) || 0 : 0;
  if (now - lastSuggest >= SUGGESTIONS_EVERY_MS) {
    suggestions = await processSuggestions(db, now);
    await stateRef.set({ suggestionsAtMs: now }, { merge: true });
  }
  return { retention, suggestions };
}

module.exports = { runMaintenance, processRiseRetention, processSuggestions, suggestionsFor, RETENTION_MS };
