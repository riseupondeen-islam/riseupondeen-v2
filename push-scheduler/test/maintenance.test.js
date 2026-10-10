/* Offline test of push-scheduler/maintenance.js (RISE retention + friend suggestions).
 * In-memory Firestore (Admin SDK shape), no credentials, no network.
 * Run: node push-scheduler/test/maintenance.test.js */
const Module = require('module');
const assert = require('assert');

const DELETE = { __delete: true };
class FakeTimestamp {
  constructor(ms) {
    this.ms = ms;
  }
  static fromMillis(ms) {
    return new FakeTimestamp(ms);
  }
  toMillis() {
    return this.ms;
  }
}
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-admin/firestore')
    return { FieldValue: { serverTimestamp: () => 'TS', delete: () => DELETE }, Timestamp: FakeTimestamp };
  return origLoad.call(this, request, ...rest);
};

const store = new Map();
const val = (v) => (v instanceof FakeTimestamp ? v.ms : v);
function snap(path) {
  const d = store.get(path);
  return { id: path.split('/').pop(), exists: !!d, data: () => d, get: (k) => (d ? d[k] : undefined), ref: ref(path) };
}
function ref(path) {
  const parts = path.split('/');
  return {
    id: parts[parts.length - 1],
    path,
    get parent() {
      const collPath = parts.slice(0, -1).join('/');
      return {
        id: parts[parts.length - 2],
        get parent() {
          const docPath = parts.slice(0, -2).join('/');
          return docPath ? ref(docPath) : null;
        },
      };
    },
    get: async () => snap(path),
    set: async (d, o) => store.set(path, o && o.merge ? { ...(store.get(path) || {}), ...d } : { ...d }),
    collection: (c) => coll(`${path}/${c}`),
  };
}
function query(match, filters = [], order = null, max = Infinity) {
  return {
    where: (f, op, v) => query(match, [...filters, [f, op, v]], order, max),
    orderBy: (f, dir = 'asc') => query(match, filters, [f, dir], max),
    limit: (n) => query(match, filters, order, n),
    get: async () => {
      let paths = [...store.keys()].filter(match).filter((p) =>
        filters.every(([f, op, v]) => {
          const x = val(store.get(p)[f]);
          const y = val(v);
          if (x === undefined) return false;
          if (op === '==') return x === y;
          if (op === '>') return x > y;
          if (op === '<=') return x <= y;
          if (op === 'array-contains') return Array.isArray(x) && x.includes(y);
          throw new Error('op ' + op);
        }),
      );
      if (order) paths.sort((a, b) => (val(store.get(a)[order[0]]) - val(store.get(b)[order[0]])) * (order[1] === 'desc' ? -1 : 1));
      paths = paths.slice(0, max);
      return { docs: paths.map(snap), empty: !paths.length, size: paths.length };
    },
  };
}
function coll(c) {
  const depth = c.split('/').length + 1;
  let n = 0;
  return Object.assign(
    query((p) => p.startsWith(c + '/') && p.split('/').length === depth),
    { doc: (id) => ref(`${c}/${id || 'auto' + ++n + Math.random().toString(36).slice(2, 6)}`) },
  );
}
let batches = 0;
const db = {
  collection: coll,
  doc: ref,
  collectionGroup: (name) => query((p) => p.split('/').length % 2 === 0 && p.split('/').slice(-2)[0] === name),
  batch: () => {
    const ops = [];
    return {
      set: (r, d) => ops.push(() => store.set(r.path, { ...d })),
      update: (r, d) =>
        ops.push(() => {
          const cur = { ...(store.get(r.path) || {}) };
          for (const [k, v] of Object.entries(d)) v === DELETE ? delete cur[k] : (cur[k] = v);
          store.set(r.path, cur);
        }),
      delete: (r) => ops.push(() => store.delete(r.path)),
      commit: async () => {
        batches++;
        ops.forEach((o) => o());
      },
    };
  },
};
const put = (p, d) => store.set(p, d);
const { processRiseRetention, processSuggestions } = require('../maintenance');

(async () => {
  const H = 3600000;
  const t0 = Date.UTC(2026, 9, 10, 6, 0, 0);

  /* ---------- RISE retention ---------- */
  // u1: solved, both sides saw everything at t0-10m -> eligible
  put('deens_rise_threads/u1', { status: 'resolved', userSeenAtMs: t0 - 600000, riseSeenAtMs: t0 - 300000, statusChangedAtMs: t0 - 200000 });
  put('deens_rise_threads/u1/messages/welcome', { from: 'rise', automated: true, createdAtMs: t0 - 5 * H, text: 'W' });
  put('deens_rise_threads/u1/messages/m1', { from: 'user', createdAtMs: t0 - 2 * H, text: 'private 1' });
  put('deens_rise_threads/u1/messages/m2', { from: 'rise', createdAtMs: t0 - H, text: 'private 2' });
  put('deens_rise_threads/u1/messages/m3', { from: 'user', createdAtMs: t0 - 60000, text: 'not yet seen by RISE' });
  // u2: open (unresolved) and seen -> never eligible
  put('deens_rise_threads/u2', { status: 'open', userSeenAtMs: t0 - 600000, riseSeenAtMs: t0 - 600000, statusChangedAtMs: t0 - 500000 });
  put('deens_rise_threads/u2/messages/m1', { from: 'user', createdAtMs: t0 - 2 * H, text: 'x' });
  // u3: solved but the user never opened it -> not eligible
  put('deens_rise_threads/u3', { status: 'resolved', userSeenAtMs: 0, riseSeenAtMs: t0 - 600000, statusChangedAtMs: t0 - 500000 });
  put('deens_rise_threads/u3/messages/m1', { from: 'user', createdAtMs: t0 - 2 * H, text: 'x' });
  // a group chat message with a past purgeAt must never be touched by RISE retention
  put('deens_groups/g_abc12345/messages/x', { kind: 'encourage', createdAtMs: t0 - 3 * DAY(), purgeAt: new FakeTimestamp(t0 - H) });

  const r1 = await processRiseRetention(db, t0 - DAY(), t0, t0);
  console.log('run 1', r1);
  assert.strictEqual(r1.stamped, 2, 'm1 and m2 stamped (welcome kept, m3 unseen by RISE)');
  assert.strictEqual(r1.deleted, 0, 'nothing deleted before 24 hours');
  assert.ok(store.get('deens_rise_threads/u1/messages/m1').purgeAt.toMillis() === t0 + DAY(), 'clock starts when both have seen');
  assert.ok(!store.get('deens_rise_threads/u1/messages/welcome').purgeAt, 'welcome never stamped');
  assert.ok(!store.get('deens_rise_threads/u1/messages/m3').purgeAt, 'unseen message not stamped');
  assert.ok(!store.get('deens_rise_threads/u2/messages/m1').purgeAt, 'unresolved thread not stamped');
  assert.ok(!store.get('deens_rise_threads/u3/messages/m1').purgeAt, 'unseen by user not stamped');

  // Idempotent: same window again stamps nothing new and keeps the original time.
  const r2 = await processRiseRetention(db, t0 - DAY(), t0, t0 + 1000);
  assert.strictEqual(r2.stamped, 0, 'idempotent stamping');
  assert.strictEqual(store.get('deens_rise_threads/u1/messages/m1').purgeAt.toMillis(), t0 + DAY());

  // 24h later: stamped messages are deleted, others stay; group message untouched; audit written.
  const r3 = await processRiseRetention(db, t0, t0, t0 + DAY() + 1000);
  console.log('run 3', r3);
  assert.strictEqual(r3.deleted, 2);
  assert.ok(!store.has('deens_rise_threads/u1/messages/m1') && !store.has('deens_rise_threads/u1/messages/m2'));
  assert.ok(store.has('deens_rise_threads/u1/messages/welcome') && store.has('deens_rise_threads/u1/messages/m3'));
  assert.ok(store.has('deens_groups/g_abc12345/messages/x'), 'other collections untouched');
  const audits = [...store.entries()].filter(([p]) => p.startsWith('deens_admin_audit_logs/')).map(([, d]) => d);
  assert.strictEqual(audits.length, 1);
  assert.ok(!JSON.stringify(audits).includes('private'), 'audit has no message text');
  // Deleting again is a no-op.
  const r4 = await processRiseRetention(db, t0, t0, t0 + DAY() + 2000);
  assert.strictEqual(r4.deleted, 0);

  // Re-opening a conversation removes pending stamps (nothing is deleted from open conversations).
  put('deens_rise_threads/u5', { status: 'resolved', userSeenAtMs: t0, riseSeenAtMs: t0, statusChangedAtMs: t0 });
  put('deens_rise_threads/u5/messages/m1', { from: 'user', createdAtMs: t0 - H, text: 'x' });
  await processRiseRetention(db, t0 - 1, t0, t0);
  assert.ok(store.get('deens_rise_threads/u5/messages/m1').purgeAt);
  put('deens_rise_threads/u5', { ...store.get('deens_rise_threads/u5'), status: 'open', statusChangedAtMs: t0 + 5000 });
  const r5 = await processRiseRetention(db, t0, t0 + 6000, t0 + 6000);
  assert.strictEqual(r5.unstamped, 1);
  assert.ok(!store.get('deens_rise_threads/u5/messages/m1').purgeAt, 're-opened: stamp removed');
  const r6 = await processRiseRetention(db, t0 + 6000, t0 + 6000, t0 + 3 * DAY());
  assert.strictEqual(r6.deleted, 0, 're-opened conversation never purged');
  assert.ok(store.has('deens_rise_threads/u5/messages/m1'));

  /* ---------- suggestions ---------- */
  const fr = (a, b) => put(`deens_friendships/${[a, b].sort().join('_')}`, { members: [a, b].sort() });
  const card = (u, discoverable = true, day = 20000) =>
    put(`deens_public_profiles/${u}`, { uid: u, username: u, displayName: u.toUpperCase(), avatar: 'crescent', discoverable, lastActiveDay: day });
  for (const u of ['me', 'f1', 'f2', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']) put(`deens_users/${u}`, { username: u, displayName: u, email: `${u}@x.test` });
  put('deens_users/c5', { username: 'c5', deenFriendsAccessDisabled: true });
  ['me', 'f1', 'f2', 'c1', 'c2', 'c4', 'c5', 'c6'].forEach((u) => card(u));
  card('c3', false); // not discoverable
  fr('me', 'f1');
  fr('me', 'f2');
  fr('f1', 'c1');
  fr('f2', 'c1'); // c1: 2 mutual
  fr('f1', 'c2'); // c2: 1 mutual
  fr('f1', 'c3'); // opted out
  fr('f1', 'c4'); // pending request -> excluded
  fr('f1', 'c5'); // disabled -> excluded
  fr('f1', 'c6'); // blocked -> excluded
  put('deens_friend_requests/r1', { fromUid: 'me', toUid: 'c4', status: 'pending' });
  put('deens_blocks/b1', { blockerUid: 'c6', blockedUid: 'me', status: 'active' });
  const s1 = await processSuggestions(db, t0, 50);
  const mine = store.get('deens_suggestions/me');
  console.log('suggestions', s1, mine.items.map((i) => `${i.uid}:${i.mutualCount}`));
  assert.deepStrictEqual(mine.items.map((i) => i.uid), ['c1', 'c2']);
  assert.strictEqual(mine.items[0].mutualCount, 2);
  assert.ok(!JSON.stringify(mine).includes('@x.test'), 'no email in suggestions');
  // Fresh suggestions are not recomputed within a day.
  const before = batches;
  const s2 = await processSuggestions(db, t0 + 1000, 50);
  assert.strictEqual(s2.refreshed, 0);
  assert.strictEqual(batches, before);
  console.log('PASS maintenance (RISE retention + suggestions)');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function DAY() {
  return 86400000;
}
