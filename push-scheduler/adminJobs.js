/* Trusted admin jobs (V3.5), run by the free scheduler with the Admin SDK.
 *
 * Only one job type exists: deleting a Deen Friends member completely, including the login
 * account. The browser cannot delete another person's Firebase Authentication account, and it
 * should not hold the permissions to sweep every collection, so the Super Admin console only
 * queues a request and this trusted process does the work.
 *
 *   deens_admin_jobs/{jobId}  { type: 'deleteDeenUser', targetUid, requestedBy, requestedByEmail,
 *                               status: 'queued', createdAt, createdAtMs }
 *   Only the Super Admin can create a job (firestore.rules), and nobody can edit or delete one from
 *   a browser. This process checks again, independently: the requester must be the Super Admin
 *   account, and the Super Admin account itself can never be deleted.
 *
 * Status: queued → running → done | failed (after MAX_ATTEMPTS) | rejected. Every step is
 * idempotent (deleting twice changes nothing), so a run that times out or fails part-way is simply
 * repeated on the next run. Counts per step are stored on the job and in the audit log; message
 * text and personal data are never logged.
 *
 * Deleted: profile, username reservation, public card, suggestions, friendships and their chats,
 * friend requests, blocks, shared streaks, RISE conversation, push devices, personal streak, daily
 * activity, leaderboard entries, challenge participation and the challenges they created, circle
 * membership and their circle messages, their place in monthly-winner announcements, pending
 * username requests, their Deen Friends activity logs, and the login account.
 * Kept (safety and accountability records): reports, moderation cases, evidence, restrictions,
 * suspensions, appeals, risk signals, admin notes, connection history and the admin audit log. */

const SUPER_ADMIN_EMAIL = 'riseupondeen@gmail.com';
const JOBS = 'deens_admin_jobs';
const PAGE = 400;
const MAX_ATTEMPTS = 3;
const STALE_RUNNING_MS = 10 * 60 * 1000;

async function deleteAll(db, query) {
  let n = 0;
  for (;;) {
    const snap = await query.limit(PAGE).get();
    if (snap.empty) return n;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    n += snap.size;
    if (snap.size < PAGE) return n;
  }
}

async function deleteDoc(ref) {
  const snap = await ref.get();
  if (!snap.exists) return 0;
  await ref.delete();
  return 1;
}

/** Deletes everything listed in the header for one member. Returns counts per step. */
async function deleteDeenUser(db, auth, uid, now = Date.now()) {
  const counts = {};
  const col = (name) => db.collection(name);
  const add = (key, n) => (counts[key] = (counts[key] || 0) + n);

  // Friendships and everything that belongs to them (both members' messages in that chat).
  const friendships = await col('deens_friendships').where('members', 'array-contains', uid).get();
  for (const f of friendships.docs) {
    add('friendMessages', await deleteAll(db, col('deens_friend_messages').where('friendshipId', '==', f.id)));
    add('chatSummaries', await deleteDoc(col('deens_chat_summaries').doc(f.id)));
    add('friendStreaks', await deleteDoc(col('deens_friend_streaks').doc(f.id)));
    add('friendships', await deleteDoc(f.ref));
  }
  // Leftover messages to or from them (e.g. a friendship removed earlier).
  add('friendMessages', await deleteAll(db, col('deens_friend_messages').where('senderUid', '==', uid)));
  add('friendMessages', await deleteAll(db, col('deens_friend_messages').where('recipientUid', '==', uid)));
  add('friendRequests', await deleteAll(db, col('deens_friend_requests').where('fromUid', '==', uid)));
  add('friendRequests', await deleteAll(db, col('deens_friend_requests').where('toUid', '==', uid)));
  add('blocks', await deleteAll(db, col('deens_blocks').where('blockerUid', '==', uid)));
  add('blocks', await deleteAll(db, col('deens_blocks').where('blockedUid', '==', uid)));

  // RISE conversation and push devices (sub-collections first).
  const thread = col('deens_rise_threads').doc(uid);
  add('riseMessages', await deleteAll(db, thread.collection('messages')));
  add('riseThread', await deleteDoc(thread));
  const devices = col('deens_push_devices').doc(uid);
  add('pushDevices', await deleteAll(db, devices.collection('devices')));
  await deleteDoc(devices);

  // Progress: personal streak, daily activity, leaderboard entries, challenge participation.
  add('streak', await deleteDoc(col('deens_streaks').doc(uid)));
  add('activity', await deleteAll(db, col('deens_activity').where('uid', '==', uid)));
  for (const month of await col('deens_leaderboard').listDocuments()) {
    add('leaderboardEntries', await deleteDoc(month.collection('entries').doc(uid)));
  }
  for (const challenge of await col('deens_daily_challenges').listDocuments()) {
    add('dailyParticipation', await deleteDoc(challenge.collection('participants').doc(uid)));
  }
  const created = await col('deens_user_challenges').where('creatorUid', '==', uid).get();
  for (const c of created.docs) {
    add('challengeParticipants', await deleteAll(db, c.ref.collection('participants')));
    add('challengesCreated', await deleteDoc(c.ref));
  }
  const invited = await col('deens_user_challenges').where('invitedUids', 'array-contains', uid).get();
  for (const c of invited.docs) {
    add('challengeParticipants', await deleteDoc(c.ref.collection('participants').doc(uid)));
    const invitedUids = (c.data().invitedUids || []).filter((x) => x !== uid);
    await c.ref.set({ invitedUids, updatedAt: new Date(now) }, { merge: true });
  }

  // Circles: their messages go; they leave the circle (same rules as "remove member" in the app).
  const groups = await col('deens_groups').where('members', 'array-contains', uid).get();
  for (const g of groups.docs) {
    const data = g.data() || {};
    add('circleMessages', await deleteAll(db, g.ref.collection('messages').where('senderUid', '==', uid)));
    const members = (data.members || []).filter((m) => m !== uid);
    const admins = (data.admins || []).filter((m) => m !== uid);
    if (!members.length) {
      add('circleMessages', await deleteAll(db, g.ref.collection('messages')));
      add('circlesDeleted', await deleteDoc(g.ref));
      continue;
    }
    if (!admins.length) admins.push(members[0]);
    const patch = { members, admins, memberCount: members.length, updatedAt: new Date(now) };
    if (data.ownerUid === uid) patch.ownerUid = admins[0];
    await g.ref.set(patch, { merge: true });
    add('circlesLeft', 1);
  }

  // Monthly winner announcements: remove them from the list (a month left with nobody is removed).
  const winners = await col('deens_monthly_winners').where('uids', 'array-contains', uid).get();
  for (const w of winners.docs) {
    const data = w.data() || {};
    const uids = (data.uids || []).filter((x) => x !== uid);
    const people = (data.winners || []).filter((p) => p && p.uid !== uid);
    if (!uids.length) await w.ref.delete();
    else await w.ref.set({ uids, winners: people, updatedAt: new Date(now) }, { merge: true });
    add('winnerAnnouncements', 1);
  }

  add('usernameRequests', await deleteAll(db, col('deens_username_change_requests').where('uid', '==', uid)));
  add('activityLogs', await deleteAll(db, col('deens_activity_logs').where('uid', '==', uid)));
  add('usernames', await deleteAll(db, col('visitor_usernames').where('uid', '==', uid)));
  add('publicProfile', await deleteDoc(col('deens_public_profiles').doc(uid)));
  add('suggestions', await deleteDoc(col('deens_suggestions').doc(uid)));
  add('profile', await deleteDoc(col('deens_users').doc(uid)));

  // Finally the login account.
  try {
    await auth.deleteUser(uid);
    counts.loginAccount = 1;
  } catch (error) {
    if (!/user-not-found/.test(String(error?.code || error?.message || ''))) throw error;
    counts.loginAccount = 0;
  }
  return counts;
}

async function audit(db, job, action, reason, extra = {}) {
  await db.collection('deens_admin_audit_logs').add({
    adminUid: String(job.requestedBy || ''),
    adminEmail: String(job.requestedByEmail || ''),
    adminRole: 'SUPER_ADMIN',
    action,
    target: String(job.targetUid || ''),
    reason,
    timestamp: new Date(),
    timestampMs: Date.now(),
    source: 'scheduler',
    ...extra,
  });
}

async function runJob(db, auth, ref, job) {
  if (job.type !== 'deleteDeenUser' || typeof job.targetUid !== 'string' || !job.targetUid) {
    await ref.set({ status: 'rejected', lastError: 'Unknown job.', finishedAt: new Date() }, { merge: true });
    return 'rejected';
  }
  // Independent authorisation check (the rules already require the Super Admin to create the job).
  let requester = null;
  try {
    requester = await auth.getUser(String(job.requestedBy || ''));
  } catch {
    requester = null;
  }
  const requesterOk = !!requester && String(requester.email || '').toLowerCase() === SUPER_ADMIN_EMAIL;
  let target = null;
  try {
    target = await auth.getUser(job.targetUid);
  } catch {
    target = null; // already gone: the data sweep still runs
  }
  const targetIsSuper = String(target?.email || '').toLowerCase() === SUPER_ADMIN_EMAIL || job.targetUid === job.requestedBy;
  if (!requesterOk || targetIsSuper) {
    const why = !requesterOk ? 'Requester is not the Super Admin.' : 'The Super Admin account cannot be deleted.';
    await ref.set({ status: 'rejected', lastError: why, finishedAt: new Date() }, { merge: true });
    await audit(db, job, 'USER_DELETION_REJECTED', why, { jobId: ref.id });
    return 'rejected';
  }
  const attempts = Number(job.attempts || 0) + 1;
  await ref.set({ status: 'running', attempts, startedAt: new Date(), startedAtMs: Date.now() }, { merge: true });
  try {
    const counts = await deleteDeenUser(db, auth, job.targetUid);
    await ref.set({ status: 'done', counts, lastError: null, finishedAt: new Date() }, { merge: true });
    await audit(db, job, 'USER_DELETED', 'Deen Friends member and login account deleted on Super Admin request.', { jobId: ref.id, counts });
    return 'done';
  } catch (error) {
    const lastError = String(error?.message || error).slice(0, 300);
    const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
    await ref.set({ status, lastError, attemptedAt: new Date() }, { merge: true });
    if (status === 'failed') await audit(db, job, 'USER_DELETION_FAILED', lastError, { jobId: ref.id, attempts });
    return status;
  }
}

/** Runs queued jobs (and jobs stuck in "running" after a crashed run). */
async function processAdminJobs(db, auth, now = Date.now()) {
  const [queued, running] = await Promise.all([
    db.collection(JOBS).where('status', '==', 'queued').limit(10).get(),
    db.collection(JOBS).where('status', '==', 'running').limit(10).get(),
  ]);
  const docs = [...queued.docs, ...running.docs.filter((d) => now - Number(d.data().startedAtMs || 0) > STALE_RUNNING_MS)];
  const result = { done: 0, failed: 0, rejected: 0, retry: 0 };
  for (const d of docs) {
    const status = await runJob(db, auth, d.ref, d.data() || {});
    if (status === 'done') result.done++;
    else if (status === 'failed') result.failed++;
    else if (status === 'rejected') result.rejected++;
    else result.retry++;
  }
  return result;
}

module.exports = { processAdminJobs, deleteDeenUser, SUPER_ADMIN_EMAIL };
