/* Offline test of Admin › Notification Settings enforcement across EVERY sender of the free scheduler.
 *
 * Part 1 checks the rules (notificationPolicy.js). Part 2 runs the real scheduler entry point
 * (index.js) end to end against an in-memory Firestore / FCM / Auth double: queued admin
 * notifications, prayer reminders, Deen Friends notifications and the Daily Deen Challenge.
 * No credentials, no network, nothing is sent.  Run: node push-scheduler/test/notificationPolicy.test.js
 */
const assert = require('assert');
const Module = require('module');
const path = require('path');

/* ------------------------------------------------------------------ Firestore double */
class Timestamp {
  constructor(ms) {
    this.ms = ms;
  }
  static fromMillis(ms) {
    return new Timestamp(ms);
  }
  toMillis() {
    return this.ms;
  }
  valueOf() {
    return this.ms;
  }
}
const SERVER_TS = { __serverTimestamp: true };
const DELETE = { __delete: true };
const FieldValue = { serverTimestamp: () => SERVER_TS, delete: () => DELETE };

const fake = { store: new Map(), reads: [], failSettingsRead: false, sent: [] };
const plain = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v);
function resolveValues(data, base = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(data || {})) {
    if (v === DELETE) delete out[k];
    else if (v === SERVER_TS) out[k] = new Timestamp(Date.now());
    else out[k] = v;
  }
  return out;
}
function snap(p) {
  const d = fake.store.get(p);
  return { id: p.split('/').pop(), exists: !!d, data: () => d && { ...d }, get: (k) => (d ? d[k] : undefined), ref: docRef(p) };
}
function collRef(p) {
  const parts = p.split('/');
  return {
    id: parts[parts.length - 1],
    path: p,
    get parent() {
      return parts.length > 1 ? docRef(parts.slice(0, -1).join('/')) : null;
    },
  };
}
function docRef(p) {
  const parts = p.split('/');
  return {
    id: parts[parts.length - 1],
    path: p,
    get parent() {
      return collRef(parts.slice(0, -1).join('/'));
    },
    async get() {
      if (p === 'deens_admin_settings/notifications' && fake.failSettingsRead) throw new Error('UNAVAILABLE');
      fake.reads.push(p);
      return snap(p);
    },
    async set(d, o) {
      fake.store.set(p, resolveValues(d, o && o.merge ? fake.store.get(p) || {} : {}));
    },
    async update(d) {
      if (!fake.store.has(p)) throw new Error('NOT_FOUND ' + p);
      fake.store.set(p, resolveValues(d, fake.store.get(p)));
    },
    async create(d) {
      if (fake.store.has(p)) throw Object.assign(new Error('already exists'), { code: 6 });
      fake.store.set(p, resolveValues(d));
    },
    async delete() {
      fake.store.delete(p);
    },
    collection: (c) => coll(`${p}/${c}`),
  };
}
function cmp(op, a, b) {
  a = plain(a);
  b = plain(b);
  if (op === '==') return a === b;
  if (op === 'in') return b.includes(a);
  if (a === undefined || a === null) return false;
  if (op === '>') return a > b;
  if (op === '>=') return a >= b;
  if (op === '<') return a < b;
  if (op === '<=') return a <= b;
  throw new Error('op ' + op);
}
function query(label, match, filters = [], max = Infinity, order = null) {
  return {
    where: (f, op, v) => query(label, match, [...filters, [f, op, v]], max, order),
    limit: (n) => query(label, match, filters, n, order),
    orderBy: (f, dir) => query(label, match, filters, max, { f, desc: dir === 'desc' }),
    startAfter: () => query(label, match, filters, max, order),
    async get() {
      let paths = [...fake.store.keys()].filter(match).filter((p) => filters.every(([f, op, v]) => cmp(op, fake.store.get(p)[f], v)));
      if (order) {
        paths = paths.filter((p) => fake.store.get(p)[order.f] !== undefined);
        paths.sort((x, y) => (plain(fake.store.get(x)[order.f]) - plain(fake.store.get(y)[order.f])) * (order.desc ? -1 : 1));
      }
      paths = paths.slice(0, max);
      fake.reads.push(...(paths.length ? paths.map(() => label) : [label])); // an empty query still costs one read
      const docs = paths.map(snap);
      return { docs, size: docs.length, empty: !docs.length };
    },
  };
}
function coll(c) {
  const depth = c.split('/').length + 1;
  return Object.assign(query(c, (p) => p.startsWith(c + '/') && p.split('/').length === depth), {
    doc: (id) => docRef(`${c}/${id || 'auto' + Math.random().toString(36).slice(2)}`),
    add: async (d) => {
      const r = docRef(`${c}/auto${Math.random().toString(36).slice(2)}`);
      await r.set(d);
      return r;
    },
  });
}
const db = {
  collection: coll,
  doc: docRef,
  collectionGroup: (name) =>
    query(`group:${name}`, (p) => {
      const parts = p.split('/');
      return parts.length % 2 === 0 && parts[parts.length - 2] === name;
    }),
  batch() {
    const ops = [];
    return {
      set: (r, d, o) => ops.push(() => r.set(d, o)),
      update: (r, d) => ops.push(() => r.update(d)),
      delete: (r) => ops.push(() => r.delete()),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  },
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: (r) => (typeof r.get === 'function' ? r.get() : r),
      create: (r, d) => writes.push(() => r.create(d)),
      set: (r, d, o) => writes.push(() => r.set(d, o)),
      update: (r, d) => writes.push(() => r.update(d)),
      delete: (r) => writes.push(() => r.delete()),
    };
    const out = await fn(tx);
    for (const w of writes) await w();
    return out;
  },
};
const messaging = {
  async send(m) {
    fake.sent.push({ token: m.token, category: m.data.category, title: m.data.title });
    return 'id';
  },
};

/* ------------------------------------------------------------------ firebase-admin stubs */
const STUBS = {
  'firebase-admin/app': { initializeApp: () => ({}), cert: (x) => x, getApps: () => [] },
  'firebase-admin/firestore': { getFirestore: () => db, FieldValue, Timestamp },
  'firebase-admin/messaging': { getMessaging: () => messaging },
  'firebase-admin/auth': { getAuth: () => ({ getUser: async () => ({}), deleteUser: async () => {} }) },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return STUBS[request] ? request : origResolve.call(this, request, ...rest);
};
for (const [id, exports] of Object.entries(STUBS)) require.cache[id] = { id, filename: id, loaded: true, exports };
global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) }); // AlAdhan is never reached
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'test', client_email: 'x@test', private_key: 'k' });

const { createPolicy, resolvePolicy, categoryAllowed } = require('../notificationPolicy');
const { processDeenFriendsEvents } = require('../deenFriends');
const INDEX = path.join(__dirname, '..', 'index.js');

/** Runs the real scheduler entry point once and returns its run summary. */
function runScheduler() {
  return new Promise((resolve, reject) => {
    const log = console.log;
    const warn = console.warn;
    const exit = process.exit;
    console.warn = () => {}; // unrelated jobs (maintenance, admin jobs…) may warn against the double
    console.log = (line) => {
      if (typeof line === 'string' && line.startsWith('{"ok":true')) {
        console.log = log;
        console.warn = warn;
        process.exit = exit;
        resolve(JSON.parse(line));
      } else log(line);
    };
    process.exit = (code) => {
      console.log = log;
      console.warn = warn;
      process.exit = exit;
      reject(new Error('scheduler exited with ' + code));
    };
    delete require.cache[INDEX];
    require(INDEX);
  });
}

/* ------------------------------------------------------------------ fixtures */
const NOW = Date.now();
const istParts = (ms) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
const hhmm = (ms) => {
  const p = istParts(ms);
  return `${p.hour}:${p.minute}`;
};
const today = (() => {
  const p = istParts(NOW);
  return `${p.year}-${p.month}-${p.day}`;
})();
const MIN = 60000;

function seed(settings) {
  fake.store.clear();
  fake.sent.length = 0;
  fake.reads.length = 0;
  fake.failSettingsRead = false;
  const put = (p, d) => fake.store.set(p, d);
  if (settings) put('deens_admin_settings/notifications', settings);
  // A prayer subscriber whose Fajr was 2 minutes ago (inside the 30-minute delivery window).
  put('push_subscriptions/v_prayer', {
    visitorId: 'v_prayer',
    active: true,
    fcmToken: 'tok-prayer',
    platform: 'android-pwa',
    schedule: {
      timeZone: 'Asia/Kolkata',
      categories: { prayer: true, announcement: true },
      lat: 19.07,
      lng: 72.87,
      prayers: {
        date: today,
        timings: {
          fajr: hhmm(NOW - 2 * MIN),
          dhuhr: hhmm(NOW + 90 * MIN),
          asr: hhmm(NOW + 180 * MIN),
          maghrib: hhmm(NOW + 270 * MIN),
          isha: hhmm(NOW + 360 * MIN),
        },
      },
    },
    updatedAt: Timestamp.fromMillis(NOW - 10 * MIN),
  });
  // An announcement queued in Admin › Send Notification.
  put('push_jobs/j1', { status: 'queued', category: 'announcement', audience: 'all', title: 'Eid Mubarak', message: 'From RISE', route: '#home' });
  // Deen Friends: a member with challenge + friend-request notifications on.
  put('push_scheduler_state/deen_friends', { sinceMs: NOW - MIN });
  put('deens_users/u2', { displayName: 'Bilal' });
  put('deens_push_devices/u1/devices/d1', { uid: 'u1', fcmToken: 'tok-df', active: true, categories: { challenges: true, friendRequests: true } });
  put('deens_friend_requests/r1', { fromUid: 'u2', toUid: 'u1', status: 'pending', createdAtMs: NOW - 30000 });
  put('deens_daily_challenges/c1', { status: 'published', audience: 'all', title: 'Read Surah Al-Kahf', updatedAtMs: NOW - 20000 });
}
const sentBy = (category) => fake.sent.filter((m) => m.category === category);
const readsOf = (prefix) => fake.reads.filter((r) => r === prefix || r.startsWith(prefix + '/'));

(async () => {
  /* ---------------------------------------------------------------- 1. rules */
  const d = resolvePolicy(null);
  assert.deepStrictEqual(d, { master: true, dailyChallenge: true, prayer: false, other: false }, 'defaults');
  assert(categoryAllowed(d, 'dailyChallenge') && !categoryAllowed(d, 'prayer') && !categoryAllowed(d, 'other'));
  const masterOff = resolvePolicy({ masterEnabled: false, dailyChallengeEnabled: true, prayerEnabled: true, otherEnabled: true });
  for (const c of ['dailyChallenge', 'prayer', 'other']) assert(!categoryAllowed(masterOff, c), `master off blocks ${c}`);
  assert(!categoryAllowed(resolvePolicy({ prayerEnabled: 'true', otherEnabled: 1 }), 'prayer'), 'only boolean true enables');
  assert(!categoryAllowed(resolvePolicy({ dailyChallengeEnabled: false }), 'dailyChallenge'));
  assert(!categoryAllowed(d, 'announcement'), 'unknown categories are never allowed');
  // Refresh: a switch turned off is seen by a running sender once the cached copy is older than refreshMs.
  {
    let clock = 0;
    seed({ masterEnabled: true });
    const p = createPolicy(db, { now: () => clock, refreshMs: 30000 });
    assert(await p.allows('dailyChallenge'));
    fake.store.set('deens_admin_settings/notifications', { masterEnabled: false });
    clock = 10000;
    assert(await p.allows('dailyChallenge'), 'cached within 30 s');
    clock = 31000;
    assert(!(await p.allows('dailyChallenge')), 're-read after 30 s');
    assert.strictEqual(p.summary().reads, 2, 'at most one read per 30 s');
    fake.failSettingsRead = true;
    clock = 62000;
    assert(!(await p.allows('dailyChallenge')) && p.unavailable(), 'unreadable settings allow nothing');
  }
  console.log('PASS notification rules');

  /* ---------------------------------------------------------------- 2. defaults (no settings document) */
  seed(null);
  let run = await runScheduler();
  assert.strictEqual(sentBy('df-challenges').length, 1, 'Daily Deen Challenge is delivered by default');
  assert.strictEqual(sentBy('prayer').length, 0, 'no prayer reminder by default');
  assert.strictEqual(sentBy('announcement').length, 0, 'no admin announcement by default');
  assert.strictEqual(sentBy('df-friendRequests').length, 0, 'no Deen Friends request notification by default');
  assert.strictEqual(fake.sent.length, 1, 'only the Daily Deen Challenge');
  assert.strictEqual(fake.store.get('push_jobs/j1').status, 'blocked', 'a due job that is not allowed is cancelled');
  assert.strictEqual(readsOf('push_subscriptions').length, 0, 'prayer pipeline reads no subscriptions while off');
  assert.strictEqual(readsOf('push_scheduler_state/prayer').length, 0, 'prayer pipeline reads nothing while off');
  assert.strictEqual(readsOf('deens_friend_requests').length, 0, '"other" Deen Friends events are not even queried');
  assert.strictEqual(readsOf('deens_admin_settings/notifications').length, 1, 'settings read once per run');
  assert.deepStrictEqual(
    { master: run.notificationSettings.master, daily: run.notificationSettings.dailyChallenge, prayer: run.notificationSettings.prayer, other: run.notificationSettings.other },
    { master: true, daily: true, prayer: false, other: false },
  );
  console.log('PASS defaults: only the Daily Deen Challenge is sent', JSON.stringify(run.prayers), JSON.stringify(run.jobs));

  // Re-run with the Deen Friends checkpoint rewound: no duplicate Daily Deen Challenge, and the
  // finished fan-out marker means the devices are not even re-read.
  fake.store.set('push_scheduler_state/deen_friends', { sinceMs: NOW - MIN });
  fake.sent.length = 0;
  fake.reads.length = 0;
  await runScheduler();
  assert.strictEqual(fake.sent.length, 0, 'no duplicate on re-run');
  assert.strictEqual(readsOf('group:devices').length, 0, 'announced challenge does not re-read all devices');
  console.log('PASS idempotent re-run (no duplicate Daily Deen Challenge)');

  // Turning "other" and prayer on later releases no backlog: the friend request and the cancelled job stay unsent.
  fake.store.set('deens_admin_settings/notifications', { masterEnabled: true, dailyChallengeEnabled: true, prayerEnabled: false, otherEnabled: true });
  fake.sent.length = 0;
  await runScheduler();
  assert.strictEqual(fake.sent.length, 0, 'changing a switch sends nothing by itself');
  assert.strictEqual(fake.store.get('push_jobs/j1').status, 'blocked', 'a cancelled job is never sent later');
  console.log('PASS changing switches sends nothing and releases no backlog');

  /* ---------------------------------------------------------------- 3. master switch off */
  seed({ masterEnabled: false, dailyChallengeEnabled: true, prayerEnabled: true, otherEnabled: true });
  run = await runScheduler();
  assert.strictEqual(fake.sent.length, 0, 'master off: nothing at all is sent');
  assert.strictEqual(fake.store.get('push_jobs/j1').status, 'blocked');
  assert(fake.store.get('push_scheduler_state/deen_friends').sinceMs > NOW - MIN, 'events skipped while off are not saved for later');
  assert.strictEqual(readsOf('push_subscriptions').length, 0);
  console.log('PASS master switch off blocks every sender');

  /* ---------------------------------------------------------------- 4. everything on */
  seed({ masterEnabled: true, dailyChallengeEnabled: true, prayerEnabled: true, otherEnabled: true });
  run = await runScheduler();
  assert.strictEqual(sentBy('prayer').length, 1, 'prayer reminder sent when enabled');
  assert.strictEqual(sentBy('announcement').length, 1, 'queued job sent when enabled');
  assert.strictEqual(fake.store.get('push_jobs/j1').status, 'sent');
  assert.strictEqual(sentBy('df-friendRequests').length, 1, 'friend request notification sent when enabled');
  assert.strictEqual(sentBy('df-challenges').length, 1, 'Daily Deen Challenge sent');
  const total = fake.sent.length;
  fake.store.set('push_scheduler_state/deen_friends', { sinceMs: NOW - MIN });
  await runScheduler();
  assert.strictEqual(fake.sent.length, total, 'no duplicates on the next run');
  console.log('PASS every category on: each sender delivers once', JSON.stringify(run.prayers));

  /* ---------------------------------------------------------------- 5. prayer alone, Daily Challenge off */
  seed({ masterEnabled: true, dailyChallengeEnabled: false, prayerEnabled: true, otherEnabled: false });
  await runScheduler();
  assert.deepStrictEqual(fake.sent.map((m) => m.category), ['prayer'], 'only the enabled category');
  console.log('PASS categories are independent');

  /* ---------------------------------------------------------------- 6. settings unreadable */
  seed({ masterEnabled: true, dailyChallengeEnabled: true, prayerEnabled: true, otherEnabled: true });
  fake.failSettingsRead = true;
  run = await runScheduler();
  assert.strictEqual(fake.sent.length, 0, 'unreadable settings: nothing is sent');
  assert.strictEqual(fake.store.get('push_jobs/j1').status, 'queued', 'the job is kept for a run that can verify the settings');
  assert.strictEqual(fake.store.get('push_scheduler_state/deen_friends').sinceMs, NOW - MIN, 'the checkpoint is kept');
  assert(run.notificationSettings.error, 'reported in the run summary');
  console.log('PASS fail-safe when the settings cannot be read');

  /* ---------------------------------------------------------------- 7. switched off mid-run */
  seed({ masterEnabled: true, dailyChallengeEnabled: true });
  for (let i = 2; i <= 4; i++)
    fake.store.set(`deens_push_devices/u${i}/devices/d${i}`, { uid: `u${i}`, fcmToken: `tok-${i}`, active: true, categories: { challenges: true } });
  let checks = 0;
  const flipping = {
    async get() {
      return { master: true, dailyChallenge: true, prayer: false, other: false };
    },
    async allows(category) {
      checks++;
      return category === 'dailyChallenge' && checks <= 1; // the admin turns it off after the first send
    },
    unavailable: () => false,
  };
  await processDeenFriendsEvents(db, messaging, { policy: flipping });
  assert.strictEqual(fake.sent.length, 1, 'sending stops as soon as the switch is seen off');
  assert(!fake.store.has('push_deliveries_df/daily-done:c1'), 'an interrupted fan-out is not marked complete');
  console.log('PASS a switch turned off mid-run stops further sends');

  console.log('notificationPolicy.test.js: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
