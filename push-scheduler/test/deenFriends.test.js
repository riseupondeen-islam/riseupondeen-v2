/* Offline test of the Deen Friends notification logic with an in-memory Firestore and FCM.
 * Run: node push-scheduler/test/deenFriends.test.js   (no credentials, no network, sends nothing) */
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'firebase-admin/firestore') return 'firebase-admin/firestore';
  return origResolve.call(this, request, ...rest);
};
require.cache['firebase-admin/firestore'] = {
  id: 'x',
  filename: 'x',
  loaded: true,
  exports: { FieldValue: { serverTimestamp: () => 'TS' } },
};
const assert = require('assert');
const store = new Map(); // path -> data
const now = Date.now();
function snapOf(path) {
  const d = store.get(path);
  return { id: path.split('/').pop(), exists: !!d, data: () => d, get: (k) => d && d[k], ref: ref(path) };
}
function ref(path) {
  return {
    id: path.split('/').pop(),
    path,
    get parent() {
      const p = path.split('/');
      const c = p.slice(0, -1).join('/');
      return {
        id: p[p.length - 2],
        get parent() {
          const pp = c.split('/').slice(0, -1).join('/');
          return pp
            ? {
                id: pp.split('/').pop(),
                get parent() {
                  const ppp = pp.split('/').slice(0, -1).join('/');
                  return { id: ppp.split('/').pop() };
                },
              }
            : null;
        },
      };
    },
    get: async () => snapOf(path),
    create: async (d) => {
      if (store.has(path)) {
        const e = new Error('already exists');
        e.code = 6;
        throw e;
      }
      store.set(path, d);
    },
    set: async (d, o) => store.set(path, o && o.merge ? { ...(store.get(path) || {}), ...d } : d),
    delete: async () => store.delete(path),
    collection: (c) => coll(path + '/' + c),
  };
}
function q(match, filters = []) {
  return {
    where: (f, op, v) => q(match, [...filters, [f, op, v]]),
    limit: () => q(match, filters),
    orderBy: (f, dir) => {
      const o = q(match, filters);
      const g = o.get;
      o.get = async () => {
        const r = await g();
        r.docs.sort((a, b) => (b.data()[f] - a.data()[f]) * (dir === 'desc' ? 1 : -1));
        return r;
      };
      o.limit = () => o;
      return o;
    },
    get: async () => {
      const docs = [...store.keys()]
        .filter(match)
        .filter((p) =>
          filters.every(([f, op, v]) => {
            const x = store.get(p)[f];
            return op == '==' ? x === v : op == '>' ? x > v : op == '<=' ? x <= v : false;
          }),
        )
        .map(snapOf);
      return { docs, empty: !docs.length };
    },
  };
}
function coll(c) {
  const depth = c.split('/').length + 1;
  return Object.assign(
    q((p) => p.startsWith(c + '/') && p.split('/').length === depth),
    { doc: (id) => ref(c + '/' + id) },
  );
}
const db = {
  collection: coll,
  doc: ref,
  collectionGroup: (n) => q((p) => p.split('/').length % 2 === 0 && p.split('/').slice(-2)[0] === n),
};
const sentMsgs = [];
const messaging = {
  send: async (m) => {
    if (m.token === 'bad') {
      const e = new Error('x');
      e.code = 'messaging/registration-token-not-registered';
      throw e;
    }
    sentMsgs.push(m);
  },
};
const put = (p, d) => store.set(p, d);
put('push_scheduler_state/deen_friends', { sinceMs: now - 60000 });
put('deens_users/a', { displayName: 'Aisha' });
put('deens_users/b', { displayName: 'Bilal' });
const cats = { friendRequests: true, friendActivity: true, rise: true, challenges: true };
put('deens_push_devices/a/devices/d1', { uid: 'a', fcmToken: 'tA', active: true, categories: cats });
put('deens_push_devices/b/devices/d2', {
  uid: 'b',
  fcmToken: 'tB',
  active: true,
  categories: { ...cats, rise: false },
});
put('deens_push_devices/b/devices/d3', { uid: 'b', fcmToken: 'bad', active: true, categories: cats });
put('deens_friend_requests/r1', { fromUid: 'a', toUid: 'b', status: 'pending', createdAtMs: now - 30000 });
put('deens_friend_requests/r0', {
  fromUid: 'b',
  toUid: 'a',
  status: 'accepted',
  createdAtMs: now - 900000,
  updatedAtMs: now - 20000,
});
put('deens_friend_messages/m1', {
  senderUid: 'a',
  recipientUid: 'b',
  friendshipId: 'a_b',
  kind: 'encouragement',
  text: 'SECRET',
  createdAtMs: now - 25000,
});
put('deens_friend_messages/m2', {
  senderUid: 'a',
  recipientUid: 'b',
  friendshipId: 'a_b',
  kind: 'challenge',
  createdAtMs: now - 24000,
});
put('deens_rise_threads/b', { lastFrom: 'rise', lastMessageAtMs: now - 10000 });
put('deens_rise_threads/a', { lastFrom: 'rise', lastMessageAtMs: now - 10000 });
put('deens_rise_threads/a/messages/welcome', { from: 'rise', automated: true, createdAtMs: now - 10000 });
put('deens_rise_threads/b/messages/r1', { from: 'rise', automated: false, adminUid: 'adm', createdAtMs: now - 10000 });
put('deens_users/c', { displayName: 'C' });
put('deens_push_devices/c/devices/d4', { uid: 'c', fcmToken: 'tC', active: true, categories: cats });
put('deens_rise_threads/c', { lastFrom: 'rise', lastMessageAtMs: now - 9000 });
put('deens_rise_threads/c/messages/r2', {
  from: 'rise',
  automated: false,
  adminUid: 'adm',
  text: 'SECRET reply',
  createdAtMs: now - 9000,
});
put('deens_daily_challenges/c1', {
  status: 'published',
  audience: 'all',
  title: 'Read Surah Al-Kahf',
  updatedAtMs: now - 15000,
});
put('deens_daily_challenges/c2', { status: 'draft', audience: 'all', title: 'Draft', updatedAtMs: now - 15000 });
const { processDeenFriendsEvents } = require('../deenFriends');
(async () => {
  const r1 = await processDeenFriendsEvents(db, messaging);
  const summary = sentMsgs.map((m) => `${m.token}:${m.data.category}:${m.data.title}|${m.data.body}`);
  console.log(r1, summary);
  assert(!JSON.stringify(sentMsgs).includes('SECRET'), 'no content');
  assert(summary.some((s) => s.startsWith('tB:df-friendRequests:New Deen Friend request')));
  assert(summary.some((s) => s.startsWith('tB:df-friendRequests:Request accepted')));
  assert(summary.some((s) => s.startsWith('tB:df-friendActivity:Aisha|sent you a Deen challenge')));
  assert(!summary.some((s) => s.startsWith('tB:') && s.includes('RISE replied')), 'rise pref off for b');
  assert(!summary.some((s) => s.startsWith('tA:') && s.includes('RISE replied')), 'welcome never notifies');
  assert(
    summary.some((s) => s.startsWith('tC:df-rise:RISE replied')),
    'real reply notifies',
  );
  assert(summary.filter((s) => s.includes('Daily Deen')).length === 3);
  assert(!summary.some((s) => s.includes('Draft')));
  assert(!store.has('deens_push_devices/b/devices/d3'), 'invalid token removed');
  for (const m of sentMsgs) {
    assert(!m.notification);
    assert(m.data.route.startsWith('#'));
  }
  // re-run with same window: rewind checkpoint -> nothing duplicated
  const n = sentMsgs.length;
  put('push_scheduler_state/deen_friends', { sinceMs: now - 60000 });
  await processDeenFriendsEvents(db, messaging);
  const dup = sentMsgs.slice(n).filter(() => true);
  assert.strictEqual(dup.length, 0, 'idempotent re-run');
  console.log('PASS scheduler logic', n, 'sent; duplicates on re-run:', sentMsgs.length - n);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
