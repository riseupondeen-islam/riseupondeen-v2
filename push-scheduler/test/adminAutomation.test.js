/* Offline test of the Admin Console automation run by the free scheduler:
 *   push-scheduler/challengeScheduler.js  (Daily Deen Challenge schedule → one published challenge per day)
 *   push-scheduler/riseBroadcasts.js      (RISE outreach → one copy per member, never twice)
 * In-memory Firestore + Auth with the Admin SDK shape the modules use. No credentials, no network.
 * Run: node push-scheduler/test/adminAutomation.test.js */
const assert = require('assert');
const { runChallengeSchedule, entryRunsOn, instanceId, zoneDate } = require('../challengeScheduler');
const { processRiseBroadcasts } = require('../riseBroadcasts');

const TS = () => 'SERVER_TS';

function makeDb(initial = {}) {
  const store = new Map(Object.entries(initial));
  let autoId = 0;
  const writes = [];
  const depthOf = (p) => p.split('/').length;
  function snap(path) {
    const d = store.get(path);
    return { id: path.split('/').pop(), exists: !!d, data: () => d, get: (k) => (d ? d[k] : undefined), ref: ref(path) };
  }
  function ref(path) {
    return {
      id: path.split('/').pop(),
      path,
      get: async () => snap(path),
      set: async (d, o) => {
        writes.push(['set', path]);
        store.set(path, o && o.merge ? { ...(store.get(path) || {}), ...d } : { ...d });
      },
      create: async (d) => {
        if (store.has(path)) throw Object.assign(new Error('already exists'), { code: 6 });
        writes.push(['create', path]);
        store.set(path, { ...d });
      },
      collection: (c) => coll(`${path}/${c}`),
    };
  }
  function query(prefix, filters = [], max = Infinity, order = null, after = null) {
    return {
      where: (f, op, v) => query(prefix, [...filters, [f, op, v]], max, order, after),
      limit: (n) => query(prefix, filters, n, order, after),
      orderBy: (f) => query(prefix, filters, max, f, after),
      startAfter: (v) => query(prefix, filters, max, order, v),
      get: async () => {
        let paths = [...store.keys()].filter((p) => p.startsWith(prefix + '/') && depthOf(p) === depthOf(prefix) + 1);
        paths = paths.filter((p) =>
          filters.every(([f, op, v]) => {
            const x = (store.get(p) || {})[f];
            if (op === '==') return x === v;
            if (op === 'in') return v.includes(x);
            throw new Error('op ' + op);
          }),
        );
        if (order) {
          paths = paths.filter((p) => (store.get(p) || {})[order] !== undefined);
          paths.sort((a, b) => String(store.get(a)[order]).localeCompare(String(store.get(b)[order])));
          if (after !== null) paths = paths.filter((p) => String(store.get(p)[order]) > String(after));
        }
        paths = paths.slice(0, max);
        return { docs: paths.map(snap), empty: !paths.length, size: paths.length };
      },
    };
  }
  function coll(c) {
    return Object.assign(query(c), {
      doc: (id) => ref(`${c}/${id}`),
      add: async (d) => {
        const id = `auto${++autoId}`;
        store.set(`${c}/${id}`, d);
        return ref(`${c}/${id}`);
      },
    });
  }
  const db = {
    store,
    writes,
    collection: coll,
    // Transactions: reads then buffered writes, applied at commit (like the Admin SDK).
    runTransaction: async (fn) => {
      const buffered = [];
      const tx = {
        get: async (r) => snap(r.path),
        create: (r, d) => buffered.push(() => r.create(d)),
        set: (r, d, o) => buffered.push(() => r.set(d, o)),
      };
      const out = await fn(tx);
      for (const w of buffered) await w();
      return out;
    },
  };
  return db;
}

const auth = {
  getUser: async (uid) => {
    if (uid === 'admin1') return { uid, email: 'riseupondeen@gmail.com' };
    if (uid === 'mallory') return { uid, email: 'mallory@example.com' };
    throw new Error('user-not-found');
  },
};

(async () => {
  /* ---------- schedule rules ---------- */
  const base = { status: 'active', date: '2026-10-10', endDate: '', weekdays: [] };
  assert.equal(entryRunsOn({ ...base, repeat: 'once' }, '2026-10-10'), true);
  assert.equal(entryRunsOn({ ...base, repeat: 'once' }, '2026-10-11'), false);
  assert.equal(entryRunsOn({ ...base, repeat: 'daily' }, '2026-10-09'), false, 'never before its start date');
  assert.equal(entryRunsOn({ ...base, repeat: 'daily' }, '2026-12-01'), true);
  assert.equal(entryRunsOn({ ...base, repeat: 'daily', endDate: '2026-10-12' }, '2026-10-13'), false, 'never after its end');
  // 2026-10-16 is a Friday (5)
  assert.equal(entryRunsOn({ ...base, repeat: 'weekly', weekdays: [5] }, '2026-10-16'), true);
  assert.equal(entryRunsOn({ ...base, repeat: 'weekly', weekdays: [5] }, '2026-10-15'), false);
  assert.equal(entryRunsOn({ ...base, repeat: 'daily', status: 'paused' }, '2026-10-12'), false, 'paused entries never run');
  // IST "today": 2026-10-11 20:00 UTC is already 2026-10-12 in India.
  assert.equal(zoneDate(Date.parse('2026-10-11T20:00:00Z'), 'Asia/Kolkata'), '2026-10-12');

  /* ---------- publication ---------- */
  const now = Date.parse('2026-10-12T03:00:00Z'); // 08:30 IST, 2026-10-12
  const entry = (extra) => ({
    title: 'Morning remembrance',
    description: 'd',
    instructions: 'i',
    category: 'Zikr',
    activity: 'manual',
    target: 1,
    repeat: 'once',
    date: '2026-10-12',
    endDate: '',
    weekdays: [],
    status: 'active',
    createdBy: 'admin1',
    updatedBy: 'admin1',
    ...extra,
  });
  const db = makeDb({
    'deens_challenge_schedule/day01': entry({}),
    'deens_challenge_schedule/day02': entry({ date: '2026-10-13' }),
    'deens_challenge_schedule/fri': entry({ repeat: 'weekly', weekdays: [1], date: '2026-10-01' }), // Monday
    'deens_challenge_schedule/paused': entry({ status: 'paused' }),
    'deens_daily_challenges/sched_old_20261009': { status: 'published', endDate: '2026-10-09' },
    'deens_daily_challenges/sched_yday_20261011': { status: 'published', endDate: '2026-10-11' },
    'deens_daily_challenges/manual1': { status: 'published', endDate: '2026-01-01' },
  });
  const first = await runChallengeSchedule(db, { now, serverTimestamp: TS });
  assert.equal(first.today, '2026-10-12');
  assert.equal(first.published, 2, 'the one-off for today and the Monday repeat');
  const published = db.store.get(`deens_daily_challenges/${instanceId('day01', '2026-10-12')}`);
  assert.ok(published, 'fixed id');
  assert.deepEqual(
    [published.status, published.startDate, published.endDate, published.requiredDays, published.audience, published.challengeType],
    ['published', '2026-10-12', '2026-10-12', 1, 'all', 'daily_deen'],
  );
  assert.ok(!db.store.has(`deens_daily_challenges/${instanceId('day02', '2026-10-12')}`), 'tomorrow is not published early');
  assert.ok(!db.store.has(`deens_daily_challenges/${instanceId('paused', '2026-10-12')}`), 'paused is not published');
  assert.equal(db.store.get('deens_daily_challenges/sched_old_20261009').status, 'archived', 'finished day archived');
  assert.equal(db.store.get('deens_daily_challenges/sched_yday_20261011').status, 'published', 'yesterday kept for late zones');
  assert.equal(db.store.get('deens_daily_challenges/manual1').status, 'published', 'manual challenges are never touched');

  // A retry / overlapping run never publishes a second copy.
  const second = await runChallengeSchedule(db, { now: now + 60000, serverTimestamp: TS });
  assert.equal(second.published, 0);
  assert.equal(second.alreadyPublished, 2);
  const copies = [...db.store.keys()].filter((k) => k.startsWith('deens_daily_challenges/sched_day01_'));
  assert.equal(copies.length, 1);

  // Pausing the automation stops publication.
  await db.collection('deens_admin_settings').doc('challenge_automation').set({ enabled: false }, { merge: true });
  const paused = await runChallengeSchedule(db, { now: now + 86400000, serverTimestamp: TS });
  assert.equal(paused.published, 0);
  assert.equal(paused.skipped, 'automation paused');
  assert.ok(!db.store.has(`deens_daily_challenges/${instanceId('day02', '2026-10-13')}`));

  /* ---------- RISE outreach ---------- */
  const users = {};
  for (let i = 1; i <= 230; i++) {
    const uid = `u${String(i).padStart(3, '0')}`;
    users[`deens_users/${uid}`] = { uid, displayName: `User ${i}`, username: `user${i}` };
  }
  users['deens_users/u005'].deenFriendsAccessDisabled = true; // being deleted → skipped
  const rdb = makeDb({
    ...users,
    'deens_rise_threads/u001': { uid: 'u001', displayName: 'User 1', username: 'user1', unreadByUser: 2, status: 'resolved', lastFrom: 'user' },
    'deens_rise_broadcasts/req_all_00001': { text: 'Eid Mubarak from the RISE team', audience: 'all', targetUid: '', status: 'queued', createdBy: 'admin1', createdByEmail: 'riseupondeen@gmail.com', createdAtMs: 1 },
    'deens_rise_broadcasts/req_bad_00001': { text: 'hi', audience: 'all', targetUid: '', status: 'queued', createdBy: 'mallory', createdAtMs: 0 },
  });
  // A tiny time budget forces the job to stop part-way and resume on the next run.
  let ticks = 0;
  const clock = () => (ticks += 1);
  const r1 = await processRiseBroadcasts(rdb, auth, { now, serverTimestamp: TS, budgetMs: 3, clock });
  assert.equal(rdb.store.get('deens_rise_broadcasts/req_bad_00001').status, 'rejected', 'non–Super Admin request is rejected');
  const mid = rdb.store.get('deens_rise_broadcasts/req_all_00001');
  assert.equal(mid.status, 'running', 'stopped part-way, resumes next run');
  assert.ok(r1.delivered > 0 && r1.delivered < 229);
  // Resume until finished.
  for (let i = 0; i < 10 && rdb.store.get('deens_rise_broadcasts/req_all_00001').status === 'running'; i++)
    await processRiseBroadcasts(rdb, auth, { now, serverTimestamp: TS, budgetMs: 100000 });
  const done = rdb.store.get('deens_rise_broadcasts/req_all_00001');
  assert.equal(done.status, 'sent');
  assert.equal(done.delivered, 229, '230 members minus the one being deleted');
  assert.equal(done.skipped, 1);
  const copiesAll = [...rdb.store.keys()].filter((k) => /^deens_rise_threads\/u\d+\/messages\/b_req_all_00001$/.test(k));
  assert.equal(copiesAll.length, 229, 'exactly one copy per eligible member');
  const msg = rdb.store.get('deens_rise_threads/u010/messages/b_req_all_00001');
  assert.deepEqual([msg.from, msg.adminUid, msg.automated, msg.text], ['rise', 'admin1', false, 'Eid Mubarak from the RISE team']);
  // Existing thread: summary updated, status (retention policy) unchanged, unread +1.
  const t1 = rdb.store.get('deens_rise_threads/u001');
  assert.deepEqual([t1.status, t1.unreadByUser, t1.lastFrom], ['resolved', 3, 'rise']);
  // New thread: created open, with the member's names.
  const t2 = rdb.store.get('deens_rise_threads/u002');
  assert.deepEqual([t2.status, t2.unreadByUser, t2.unreadByRise, t2.username], ['open', 1, 0, 'user2']);
  assert.ok(!rdb.store.has('deens_rise_threads/u005/messages/b_req_all_00001'));

  // Re-running a finished job (or replaying it) never duplicates.
  rdb.store.set('deens_rise_broadcasts/req_all_00001', { ...done, status: 'queued', cursorUid: '', passDone: false, delivered: 0 });
  await processRiseBroadcasts(rdb, auth, { now, serverTimestamp: TS, budgetMs: 100000 });
  const replay = rdb.store.get('deens_rise_broadcasts/req_all_00001');
  assert.equal(replay.delivered, 0);
  assert.equal(replay.duplicates, 229);
  assert.equal([...rdb.store.keys()].filter((k) => k.endsWith('/messages/b_req_all_00001')).length, 229);

  // Single-member request.
  rdb.store.set('deens_rise_broadcasts/req_one_00001', { text: 'Salam, your request is done', audience: 'user', targetUid: 'u120', status: 'queued', createdBy: 'admin1', createdAtMs: 5 });
  await processRiseBroadcasts(rdb, auth, { now, serverTimestamp: TS });
  assert.equal(rdb.store.get('deens_rise_broadcasts/req_one_00001').status, 'sent');
  assert.ok(rdb.store.has('deens_rise_threads/u120/messages/b_req_one_00001'));
  assert.ok(!rdb.store.has('deens_rise_threads/u121/messages/b_req_one_00001'), 'only the selected member');

  console.log('adminAutomation.test.js: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
