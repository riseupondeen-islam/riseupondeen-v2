/* Offline test of push-scheduler/adminJobs.js (Super Admin–requested member deletion).
 * In-memory Firestore + Auth (Admin SDK shape), no credentials, no network.
 * Run: node push-scheduler/test/adminJobs.test.js */
const assert = require('assert');
const { processAdminJobs } = require('../adminJobs');

function makeDb(initial) {
  const store = new Map(Object.entries(initial));
  const field = (p, f) => (store.get(p) || {})[f];
  function ref(path) {
    const parts = path.split('/');
    return {
      id: parts[parts.length - 1],
      path,
      get: async () => snap(path),
      set: async (d, o) => store.set(path, o && o.merge ? { ...(store.get(path) || {}), ...d } : { ...d }),
      delete: async () => store.delete(path),
      collection: (c) => coll(`${path}/${c}`),
    };
  }
  function snap(path) {
    const d = store.get(path);
    return { id: path.split('/').pop(), exists: !!d, data: () => d, ref: ref(path) };
  }
  function query(prefix, filters = [], max = Infinity) {
    const depth = prefix.split('/').length + 1;
    return {
      where: (f, op, v) => query(prefix, [...filters, [f, op, v]], max),
      limit: (n) => query(prefix, filters, n),
      get: async () => {
        const paths = [...store.keys()]
          .filter((p) => p.startsWith(prefix + '/') && p.split('/').length === depth)
          .filter((p) =>
            filters.every(([f, op, v]) => {
              const x = field(p, f);
              if (op === '==') return x === v;
              if (op === 'array-contains') return Array.isArray(x) && x.includes(v);
              throw new Error('op ' + op);
            }),
          )
          .slice(0, max);
        return { docs: paths.map(snap), empty: !paths.length, size: paths.length };
      },
    };
  }
  function coll(c) {
    return Object.assign(query(c), {
      doc: (id) => ref(`${c}/${id}`),
      add: async (d) => {
        const id = `auto${store.size}`;
        store.set(`${c}/${id}`, d);
        return ref(`${c}/${id}`);
      },
      // Like the Admin SDK: every document id under the collection, including ones that only have sub-collections.
      listDocuments: async () => {
        const depth = c.split('/').length + 1;
        const ids = new Set([...store.keys()].filter((p) => p.startsWith(c + '/')).map((p) => p.split('/')[depth - 1]));
        return [...ids].map((id) => ref(`${c}/${id}`));
      },
    });
  }
  return {
    store,
    collection: coll,
    batch: () => {
      const ops = [];
      return { delete: (r) => ops.push(r), commit: async () => ops.forEach((r) => store.delete(r.path)) };
    },
  };
}

function makeAuth(users, { failDelete = false } = {}) {
  const deleted = [];
  return {
    deleted,
    getUser: async (uid) => {
      if (!users[uid]) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
      return { uid, email: users[uid] };
    },
    deleteUser: async (uid) => {
      if (failDelete) throw Object.assign(new Error('backend unavailable'), { code: 'auth/internal-error' });
      if (!users[uid]) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
      deleted.push(uid);
      delete users[uid];
    },
  };
}

const USERS = () => ({ S: 'riseupondeen@gmail.com', A: 'a@example.com', B: 'b@example.com', C: 'c@example.com', D: 'd@example.com' });
const seed = () => ({
  // The member being deleted: A.
  'deens_users/A': { username: 'aisha' },
  'deens_users/B': { username: 'bilal' },
  'visitor_usernames/aisha': { uid: 'A' },
  'visitor_usernames/bilal': { uid: 'B' },
  'deens_public_profiles/A': { uid: 'A' },
  'deens_public_profiles/B': { uid: 'B' },
  'deens_suggestions/A': { list: [] },
  'deens_friendships/A_B': { members: ['A', 'B'] },
  'deens_friendships/B_C': { members: ['B', 'C'] },
  'deens_friend_streaks/A_B': { members: ['A', 'B'] },
  'deens_friend_streaks/B_C': { members: ['B', 'C'] },
  'deens_chat_summaries/A_B': { x: 1 },
  'deens_friend_messages/m1': { friendshipId: 'A_B', senderUid: 'A', recipientUid: 'B' },
  'deens_friend_messages/m2': { friendshipId: 'A_B', senderUid: 'B', recipientUid: 'A' },
  'deens_friend_messages/m3': { friendshipId: 'B_C', senderUid: 'B', recipientUid: 'C' },
  'deens_friend_requests/r1': { fromUid: 'A', toUid: 'C' },
  'deens_friend_requests/r2': { fromUid: 'D', toUid: 'A' },
  'deens_friend_requests/r3': { fromUid: 'D', toUid: 'B' },
  'deens_blocks/k1': { blockerUid: 'D', blockedUid: 'A' },
  'deens_rise_threads/A': { uid: 'A' },
  'deens_rise_threads/A/messages/welcome': { from: 'rise' },
  'deens_rise_threads/A/messages/u1': { from: 'user' },
  'deens_rise_threads/B': { uid: 'B' },
  'deens_push_devices/A/devices/d1': { uid: 'A' },
  'deens_streaks/A': { uid: 'A' },
  'deens_streaks/B': { uid: 'B' },
  'deens_activity/A_2026-10-01': { uid: 'A' },
  'deens_activity/B_2026-10-01': { uid: 'B' },
  'deens_leaderboard/2026-09/entries/A': { uid: 'A' },
  'deens_leaderboard/2026-10/entries/A': { uid: 'A' },
  'deens_leaderboard/2026-10/entries/B': { uid: 'B' },
  'deens_daily_challenges/dc1': { title: 'x' },
  'deens_daily_challenges/dc1/participants/A': { uid: 'A' },
  'deens_daily_challenges/dc1/participants/B': { uid: 'B' },
  'deens_user_challenges/uc1': { creatorUid: 'A', invitedUids: ['B'] },
  'deens_user_challenges/uc1/participants/B': { uid: 'B' },
  'deens_user_challenges/uc2': { creatorUid: 'B', invitedUids: ['A', 'C'] },
  'deens_user_challenges/uc2/participants/A': { uid: 'A' },
  'deens_user_challenges/uc2/participants/C': { uid: 'C' },
  'deens_groups/g1': { ownerUid: 'A', members: ['A', 'B', 'C', 'D'], admins: ['A'], memberCount: 4 },
  'deens_groups/g1/messages/x1': { senderUid: 'A' },
  'deens_groups/g1/messages/x2': { senderUid: 'B' },
  'deens_monthly_winners/2026-09': { uids: ['A', 'B'], winners: [{ uid: 'A' }, { uid: 'B' }] },
  'deens_monthly_winners/2026-08': { uids: ['A'], winners: [{ uid: 'A' }] },
  'deens_username_change_requests/q1': { uid: 'A' },
  'deens_activity_logs/l1': { uid: 'A' },
  'deens_activity_logs/l2': { uid: 'B' },
  // Safety and accountability records about A are kept.
  'deens_reports/rep1': { reportedUid: 'A' },
  'deens_moderation_cases/case1': { userUid: 'A' },
  'deens_admin_audit_logs/old': { action: 'X' },
  // Unrelated public content.
  'content/c1': { type: 'dua' },
});

(async () => {
  // 1. A valid request deletes A's whole Deen Friends footprint and login, and nothing else.
  {
    const db = makeDb({ ...seed(), 'deens_admin_jobs/j1': { type: 'deleteDeenUser', targetUid: 'A', requestedBy: 'S', requestedByEmail: 'riseupondeen@gmail.com', status: 'queued' } });
    const auth = makeAuth(USERS());
    const result = await processAdminJobs(db, auth);
    assert.deepStrictEqual(result, { done: 1, failed: 0, rejected: 0, retry: 0 });
    const left = [...db.store.keys()];
    const mentionsA = left.filter((p) => !/^deens_(reports|moderation_cases|admin_audit_logs|admin_jobs)\//.test(p) && (/\/A(\/|_|$)|A_B/.test(p) || JSON.stringify(db.store.get(p)).includes('"A"')));
    assert.deepStrictEqual(mentionsA, [], 'no Deen Friends data of A remains: ' + mentionsA.join(', '));
    for (const keep of ['deens_users/B', 'visitor_usernames/bilal', 'deens_friendships/B_C', 'deens_friend_messages/m3', 'deens_friend_requests/r3', 'deens_rise_threads/B', 'deens_leaderboard/2026-10/entries/B', 'deens_daily_challenges/dc1/participants/B', 'deens_activity_logs/l2', 'deens_reports/rep1', 'deens_moderation_cases/case1', 'deens_admin_audit_logs/old', 'content/c1', 'deens_user_challenges/uc2/participants/C'])
      assert.ok(db.store.has(keep), 'kept ' + keep);
    assert.deepStrictEqual(db.store.get('deens_groups/g1').members, ['B', 'C', 'D']);
    assert.strictEqual(db.store.get('deens_groups/g1').ownerUid, 'B'); // ownership handed to the next admin
    assert.ok(!db.store.has('deens_groups/g1/messages/x1') && db.store.has('deens_groups/g1/messages/x2'));
    assert.deepStrictEqual(db.store.get('deens_user_challenges/uc2').invitedUids, ['C']);
    assert.ok(!db.store.has('deens_user_challenges/uc1') && !db.store.has('deens_user_challenges/uc1/participants/B'));
    assert.deepStrictEqual(db.store.get('deens_monthly_winners/2026-09').uids, ['B']);
    assert.ok(!db.store.has('deens_monthly_winners/2026-08'));
    assert.deepStrictEqual(auth.deleted, ['A']);
    const job = db.store.get('deens_admin_jobs/j1');
    assert.strictEqual(job.status, 'done');
    assert.strictEqual(job.counts.friendMessages, 2);
    assert.strictEqual(job.counts.loginAccount, 1);
    const auditRow = [...db.store.entries()].find(([p, d]) => p.startsWith('deens_admin_audit_logs/') && d.action === 'USER_DELETED');
    assert.ok(auditRow && auditRow[1].target === 'A' && !JSON.stringify(auditRow[1]).includes('example.com'));
    // Running again is harmless (idempotent).
    db.store.set('deens_admin_jobs/j2', { type: 'deleteDeenUser', targetUid: 'A', requestedBy: 'S', status: 'queued' });
    assert.deepStrictEqual(await processAdminJobs(db, auth), { done: 1, failed: 0, rejected: 0, retry: 0 });
    assert.strictEqual(db.store.get('deens_admin_jobs/j2').counts.loginAccount, 0);
  }
  // 2. A job not requested by the Super Admin is rejected and deletes nothing.
  {
    const db = makeDb({ ...seed(), 'deens_admin_jobs/j1': { type: 'deleteDeenUser', targetUid: 'A', requestedBy: 'B', status: 'queued' } });
    const auth = makeAuth(USERS());
    assert.deepStrictEqual(await processAdminJobs(db, auth), { done: 0, failed: 0, rejected: 1, retry: 0 });
    assert.ok(db.store.has('deens_users/A') && !auth.deleted.length);
  }
  // 3. The Super Admin account can never be deleted this way.
  {
    const db = makeDb({ 'deens_users/S': { x: 1 }, 'deens_admin_jobs/j1': { type: 'deleteDeenUser', targetUid: 'S', requestedBy: 'S', status: 'queued' } });
    const auth = makeAuth(USERS());
    assert.deepStrictEqual(await processAdminJobs(db, auth), { done: 0, failed: 0, rejected: 1, retry: 0 });
    assert.ok(db.store.has('deens_users/S'));
  }
  // 4. A failure part-way is retried on the next runs, then reported as failed (never silently "done").
  {
    const db = makeDb({ ...seed(), 'deens_admin_jobs/j1': { type: 'deleteDeenUser', targetUid: 'A', requestedBy: 'S', status: 'queued' } });
    const auth = makeAuth(USERS(), { failDelete: true });
    assert.deepStrictEqual(await processAdminJobs(db, auth), { done: 0, failed: 0, rejected: 0, retry: 1 });
    assert.strictEqual(db.store.get('deens_admin_jobs/j1').status, 'queued');
    await processAdminJobs(db, auth);
    assert.deepStrictEqual(await processAdminJobs(db, auth), { done: 0, failed: 1, rejected: 0, retry: 0 });
    const job = db.store.get('deens_admin_jobs/j1');
    assert.strictEqual(job.status, 'failed');
    assert.match(job.lastError, /backend unavailable/);
  }
  console.log('PASS admin jobs (member deletion scope, authorisation, idempotency, retries)');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
