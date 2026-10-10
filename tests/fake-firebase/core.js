/* In-memory stand-in for the subset of the Firebase JS SDK (v12 modular API) that Rise Upon Deen
 * uses. TEST-ONLY: it lets the end-to-end suite exercise Firebase-backed flows (content sync,
 * admin console, Deen Friends, analytics writes) without network access, and records every write
 * so the data semantics of two builds can be compared operation by operation.
 *
 * State lives on globalThis.__FAKE_FB__ and can be seeded with window.__FAKE_FB_SEED__ =
 * { collections: { content: { id: data } }, users: [{ email, password, uid }] } before load.
 */
import { createRules } from './rules.js';

const G = globalThis;

/* ---------------- Timestamp ---------------- */
export class Timestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static now() {
    return Timestamp.fromMillis(Date.now());
  }
  static fromMillis(ms) {
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  static fromDate(d) {
    return Timestamp.fromMillis(d.getTime());
  }
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate() {
    return new Date(this.toMillis());
  }
  isEqual(o) {
    return o instanceof Timestamp && o.seconds === this.seconds && o.nanoseconds === this.nanoseconds;
  }
  valueOf() {
    return this.toMillis();
  }
  toJSON() {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds };
  }
}
function reviveSeed(v) {
  if (Array.isArray(v)) return v.map(reviveSeed);
  if (v && typeof v === 'object') {
    if (typeof v.__ts === 'number') return Timestamp.fromMillis(v.__ts);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, reviveSeed(x)]));
  }
  return v;
}
const state = (G.__FAKE_FB__ ||= (() => {
  const seed = G.__FAKE_FB_SEED__ || {};
  const docs = new Map(); // path -> data
  for (const [coll, entries] of Object.entries(seed.collections || {}))
    for (const [id, data] of Object.entries(entries)) docs.set(`${coll}/${id}`, reviveSeed(data));
  return {
    docs,
    users: [...(seed.users || [])],
    log: [],
    listeners: new Set(),
    autoId: 0,
    currentUser: null,
    authListeners: new Set(),
    uploads: [],
  };
})());

const rules = createRules(state);
state.rules = rules; // tests can ask the rules model directly
/** Test helper: a server-side write (bypasses rules, like the Admin SDK) that notifies listeners. */
state.serverWrite = (path, data) => {
  if (data === null) state.docs.delete(path);
  else state.docs.set(path, reviveSeed(data));
  notify();
};
function permissionDenied(path) {
  const e = new Error(`Missing or insufficient permissions. (${path})`);
  e.code = 'permission-denied';
  return e;
}
function assertRead(path) {
  if (!rules.allowed('read', path, state.docs.get(path) || null, null)) throw permissionDenied(path);
}
/** Post-write document for a set/update, used to evaluate request.resource.data. */
function afterWrite(op, path, data, options) {
  if (op === 'delete') return null;
  const current = state.docs.get(path);
  if (op === 'update') {
    if (!current) return null;
    const cur = clone(current);
    for (const [k, v] of Object.entries(materialize(data))) {
      const ks = k.split('.');
      let o = cur;
      for (const key of ks.slice(0, -1)) {
        if (!o[key] || typeof o[key] !== 'object') o[key] = {};
        o = o[key];
      }
      o[ks[ks.length - 1]] = v;
    }
    return cur;
  }
  const next = materialize(data);
  return options && (options.merge || options.mergeFields) ? deepMerge(clone(current || {}), next) : next;
}
function assertWrite(op, path, data, options) {
  const before = state.docs.get(path) || null;
  const kind = op === 'delete' ? 'delete' : op === 'update' || before ? 'update' : 'create';
  if (op === 'update' && !before) return; // reported as not-found by applyUpdate
  if (!rules.allowed(kind, path, before, afterWrite(op, path, data, options))) throw permissionDenied(path);
}

const SERVER_TS = { __serverTimestamp: true };
export function serverTimestamp() {
  return SERVER_TS;
}

function materialize(v) {
  if (v === SERVER_TS || (v && v.__serverTimestamp)) return Timestamp.now();
  if (v instanceof Date) return Timestamp.fromDate(v);
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(materialize);
  if (v && typeof v === 'object' && !(v instanceof Blob)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = materialize(x);
    return out;
  }
  return v;
}
function clone(v) {
  if (v instanceof Timestamp) return new Timestamp(v.seconds, v.nanoseconds);
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}
/* Comparable form for the operation log: timestamps collapse to a marker. */
function normalizeForLog(v) {
  if (v === SERVER_TS || (v && v.__serverTimestamp)) return '<serverTimestamp>';
  if (v instanceof Timestamp || v instanceof Date) return '<timestamp>';
  if (Array.isArray(v)) return v.map(normalizeForLog);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .filter((k) => v[k] !== undefined)
        .map((k) => [k, normalizeForLog(v[k])]),
    );
  return v;
}
function record(op, path, data, extra) {
  state.log.push({ op, path, ...(data !== undefined ? { data: normalizeForLog(data) } : {}), ...(extra || {}) });
}

/* ---------------- App ---------------- */
export function initializeApp(options, name = '[DEFAULT]') {
  return { name, options, automaticDataCollectionEnabled: false };
}
export function getApp() {
  return { name: '[DEFAULT]' };
}
export async function deleteApp() {}

/* ---------------- Firestore refs ---------------- */
const DB = { type: 'firestore' };
export function initializeFirestore() {
  return DB;
}
export function getFirestore() {
  return DB;
}
function joinPath(parts) {
  return parts
    .map(String)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
}
function collRef(path) {
  const segs = path.split('/');
  return { type: 'collection', path, id: segs[segs.length - 1], firestore: DB };
}
function docRef(path) {
  const segs = path.split('/');
  return {
    type: 'document',
    path,
    id: segs[segs.length - 1],
    firestore: DB,
    parent: collRef(segs.slice(0, -1).join('/')),
  };
}
export function collection(base, ...segments) {
  const prefix = base && base.type === 'document' ? base.path : base && base.type === 'collection' ? base.path : '';
  return collRef(joinPath([prefix, ...segments].filter(Boolean)));
}
export function doc(base, ...segments) {
  if (base && base.type === 'collection' && segments.length === 0) return docRef(`${base.path}/${nextId()}`);
  const prefix = base && (base.type === 'collection' || base.type === 'document') ? base.path : '';
  return docRef(joinPath([prefix, ...segments].filter((x) => x !== undefined && x !== '')));
}
function nextId() {
  state.autoId += 1;
  return `fakeid${String(state.autoId).padStart(5, '0')}`;
}

/* ---------------- Query constraints ---------------- */
export function where(field, op, value) {
  return { kind: 'where', field, op, value };
}
export function orderBy(field, dir = 'asc') {
  return { kind: 'orderBy', field, dir };
}
export function limit(n) {
  return { kind: 'limit', n };
}
export function startAfter(...values) {
  return { kind: 'startAfter', values };
}
export function query(base, ...constraints) {
  return { type: 'query', path: base.path, constraints: [...(base.constraints || []), ...constraints], firestore: DB };
}
function getField(data, field) {
  return String(field)
    .split('.')
    .reduce((o, k) => (o == null ? undefined : o[k]), data);
}
function cmp(a, b) {
  const av = a instanceof Timestamp ? a.toMillis() : a,
    bv = b instanceof Timestamp ? b.toMillis() : b;
  if (av === bv) return 0;
  if (av === undefined || av === null) return -1;
  if (bv === undefined || bv === null) return 1;
  return av < bv ? -1 : 1;
}
function matches(data, w) {
  const v = getField(data, w.field);
  const x = w.value instanceof Date ? Timestamp.fromDate(w.value) : w.value;
  switch (w.op) {
    case '==':
      return cmp(v, x) === 0 && v !== undefined;
    case '!=':
      return v !== undefined && cmp(v, x) !== 0;
    case '<':
      return v !== undefined && cmp(v, x) < 0;
    case '<=':
      return v !== undefined && cmp(v, x) <= 0;
    case '>':
      return v !== undefined && cmp(v, x) > 0;
    case '>=':
      return v !== undefined && cmp(v, x) >= 0;
    case 'array-contains':
      return Array.isArray(v) && v.some((y) => cmp(y, x) === 0);
    case 'array-contains-any':
      return Array.isArray(v) && v.some((y) => x.some((z) => cmp(y, z) === 0));
    case 'in':
      return x.some((z) => cmp(v, z) === 0);
    case 'not-in':
      return v !== undefined && !x.some((z) => cmp(v, z) === 0);
    default:
      throw new Error('fake firestore: unsupported operator ' + w.op);
  }
}
function runQuery(target) {
  if (target.type === 'document') {
    return state.docs.has(target.path) ? [[target.path, state.docs.get(target.path)]] : [];
  }
  const depth = target.path.split('/').length + 1;
  let rows = [...state.docs.entries()].filter(
    ([p]) => p.startsWith(target.path + '/') && p.split('/').length === depth,
  );
  const cs = target.constraints || [];
  for (const w of cs.filter((c) => c.kind === 'where')) rows = rows.filter(([, d]) => matches(d, w));
  const orders = cs.filter((c) => c.kind === 'orderBy');
  // Firestore excludes documents that lack an orderBy field.
  for (const o of orders) rows = rows.filter(([, d]) => getField(d, o.field) !== undefined);
  rows.sort((a, b) => {
    for (const o of orders) {
      const c = cmp(getField(a[1], o.field), getField(b[1], o.field));
      if (c) return o.dir === 'desc' ? -c : c;
    }
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  const after = cs.find((c) => c.kind === 'startAfter');
  if (after) {
    const cur = after.values[0];
    if (cur && cur.__fakeSnapshot) {
      const i = rows.findIndex(([p]) => p === cur.ref.path);
      rows = i >= 0 ? rows.slice(i + 1) : rows;
    } else if (orders.length)
      rows = rows.filter(([, d]) => {
        const c = cmp(getField(d, orders[0].field), cur);
        return orders[0].dir === 'desc' ? c < 0 : c > 0;
      });
  }
  const lim = cs.find((c) => c.kind === 'limit');
  if (lim) rows = rows.slice(0, lim.n);
  return rows;
}

/* ---------------- Snapshots ---------------- */
const META = Object.freeze({ fromCache: false, hasPendingWrites: false });
function docSnapshot(path, data) {
  const ref = docRef(path);
  return {
    __fakeSnapshot: true,
    id: ref.id,
    ref,
    metadata: META,
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : clone(data)),
    get: (f) => (data === undefined ? undefined : clone(getField(data, f))),
  };
}
function querySnapshot(rows, changes) {
  const docs = rows.map(([p, d]) => docSnapshot(p, d));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    metadata: META,
    forEach: (fn) => docs.forEach(fn),
    docChanges: () => changes || docs.map((d, i) => ({ type: 'added', doc: d, oldIndex: -1, newIndex: i })),
  };
}
export async function getDoc(ref) {
  await tick();
  record('getDoc', ref.path);
  assertRead(ref.path);
  return docSnapshot(ref.path, state.docs.get(ref.path));
}
export async function getDocs(q) {
  await tick();
  record('getDocs', q.path, undefined, { constraints: normalizeForLog(q.constraints || []) });
  const rows = runQuery(q);
  for (const [p] of rows) assertRead(p);
  return querySnapshot(rows);
}
function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

export function onSnapshot(target, ...args) {
  const fns = args.filter(
    (a) => typeof a === 'function' || (a && typeof a === 'object' && typeof a.next === 'function'),
  );
  const obs = typeof fns[0] === 'function' ? { next: fns[0], error: fns[1] } : fns[0];
  const listener = { target, last: null, obs, active: true };
  record(
    'listen',
    target.path,
    undefined,
    target.constraints ? { constraints: normalizeForLog(target.constraints) } : undefined,
  );
  state.listeners.add(listener);
  setTimeout(() => deliver(listener), 0);
  return () => {
    listener.active = false;
    state.listeners.delete(listener);
    record('unlisten', target.path);
  };
}
function deliver(listener) {
  if (!listener.active) return;
  const rows = runQuery(listener.target);
  try {
    if (listener.target.type === 'document') assertRead(listener.target.path);
    else for (const [p] of rows) assertRead(p);
  } catch (e) {
    listener.active = false;
    state.listeners.delete(listener);
    try {
      listener.obs.error?.(e);
    } catch {}
    return;
  }
  const sig = JSON.stringify(rows.map(([p, d]) => [p, normalizeForLogDeep(d)]));
  if (sig === listener.last) return;
  const prev = listener.prevRows || [];
  listener.last = sig;
  listener.prevRows = rows;
  try {
    if (listener.target.type === 'document')
      listener.obs.next(docSnapshot(listener.target.path, state.docs.get(listener.target.path)));
    else {
      const prevMap = new Map(prev),
        nowMap = new Map(rows),
        changes = [];
      rows.forEach(([p, d], i) => {
        if (!prevMap.has(p)) changes.push({ type: 'added', doc: docSnapshot(p, d), oldIndex: -1, newIndex: i });
        else if (JSON.stringify(normalizeForLogDeep(prevMap.get(p))) !== JSON.stringify(normalizeForLogDeep(d)))
          changes.push({ type: 'modified', doc: docSnapshot(p, d), oldIndex: i, newIndex: i });
      });
      prev.forEach(([p, d], i) => {
        if (!nowMap.has(p)) changes.push({ type: 'removed', doc: docSnapshot(p, d), oldIndex: i, newIndex: -1 });
      });
      listener.obs.next(querySnapshot(rows, changes));
    }
  } catch (e) {
    console.error('[fake firestore] listener threw', e);
  }
}
function normalizeForLogDeep(v) {
  return v instanceof Timestamp
    ? v.toMillis()
    : Array.isArray(v)
      ? v.map(normalizeForLogDeep)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeForLogDeep(x)]))
        : v;
}
function notify() {
  setTimeout(() => {
    for (const l of [...state.listeners]) deliver(l);
  }, 0);
}

/* ---------------- Writes ---------------- */
function applySet(path, data, options) {
  const next = materialize(data);
  if (options && (options.merge || options.mergeFields)) {
    const cur = clone(state.docs.get(path) || {});
    state.docs.set(path, deepMerge(cur, next));
  } else state.docs.set(path, next);
}
function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v instanceof Timestamp) &&
      a[k] &&
      typeof a[k] === 'object' &&
      !Array.isArray(a[k]) &&
      !(a[k] instanceof Timestamp)
    )
      a[k] = deepMerge(a[k], v);
    else a[k] = v;
  }
  return a;
}
function applyUpdate(path, data) {
  if (!state.docs.has(path)) {
    const e = new Error(`No document to update: ${path}`);
    e.code = 'not-found';
    throw e;
  }
  const cur = clone(state.docs.get(path));
  for (const [k, v] of Object.entries(materialize(data))) {
    const keys = k.split('.');
    let o = cur;
    for (const key of keys.slice(0, -1)) {
      if (!o[key] || typeof o[key] !== 'object') o[key] = {};
      o = o[key];
    }
    o[keys[keys.length - 1]] = v;
  }
  state.docs.set(path, cur);
}
function checkRules(op, path) {
  const deny = (G.__FAKE_FB_DENY__ || []).find((r) => path.startsWith(r));
  if (deny) {
    const e = new Error('Missing or insufficient permissions.');
    e.code = 'permission-denied';
    throw e;
  }
}
export async function setDoc(ref, data, options) {
  await tick();
  checkRules('set', ref.path);
  assertWrite('set', ref.path, data, options);
  record('set', ref.path, data, options ? { options } : undefined);
  applySet(ref.path, data, options);
  notify();
}
export async function updateDoc(ref, data) {
  await tick();
  checkRules('update', ref.path);
  assertWrite('update', ref.path, data);
  record('update', ref.path, data);
  applyUpdate(ref.path, data);
  notify();
}
export async function addDoc(coll, data) {
  await tick();
  const ref = doc(coll);
  checkRules('add', ref.path);
  assertWrite('set', ref.path, data);
  record('add', coll.path, data);
  applySet(ref.path, data);
  notify();
  return ref;
}
export async function deleteDoc(ref) {
  await tick();
  checkRules('delete', ref.path);
  assertWrite('delete', ref.path);
  record('delete', ref.path);
  state.docs.delete(ref.path);
  notify();
}
export function writeBatch() {
  const ops = [];
  const batch = {
    set(ref, data, options) {
      ops.push(['set', ref, data, options]);
      return batch;
    },
    update(ref, data) {
      ops.push(['update', ref, data]);
      return batch;
    },
    delete(ref) {
      ops.push(['delete', ref]);
      return batch;
    },
    async commit() {
      await tick();
      for (const [op, ref] of ops) checkRules(op, ref.path);
      for (const [op, ref, data, options] of ops) assertWrite(op, ref.path, data, options);
      record('batch', '', undefined, {
        ops: ops.map(([op, ref, data, options]) => ({
          op,
          path: ref.path,
          ...(data !== undefined ? { data: normalizeForLog(data) } : {}),
          ...(options ? { options } : {}),
        })),
      });
      for (const [op, ref, data, options] of ops) {
        if (op === 'set') applySet(ref.path, data, options);
        else if (op === 'update') applyUpdate(ref.path, data);
        else state.docs.delete(ref.path);
      }
      notify();
    },
  };
  return batch;
}
export async function runTransaction(db, fn) {
  const ops = [];
  const tx = {
    async get(ref) {
      assertRead(ref.path);
      return docSnapshot(ref.path, state.docs.get(ref.path));
    },
    set(ref, data, options) {
      ops.push(['set', ref, data, options]);
      return tx;
    },
    update(ref, data) {
      ops.push(['update', ref, data]);
      return tx;
    },
    delete(ref) {
      ops.push(['delete', ref]);
      return tx;
    },
  };
  await tick();
  const result = await fn(tx);
  for (const [op, ref] of ops) checkRules(op, ref.path);
  for (const [op, ref, data, options] of ops) assertWrite(op, ref.path, data, options);
  record('transaction', '', undefined, {
    ops: ops.map(([op, ref, data, options]) => ({
      op,
      path: ref.path,
      ...(data !== undefined ? { data: normalizeForLog(data) } : {}),
      ...(options ? { options } : {}),
    })),
  });
  for (const [op, ref, data, options] of ops) {
    if (op === 'set') applySet(ref.path, data, options);
    else if (op === 'update') applyUpdate(ref.path, data);
    else state.docs.delete(ref.path);
  }
  notify();
  return result;
}

/* ---------------- Auth ---------------- */
export const indexedDBLocalPersistence = { type: 'LOCAL', name: 'indexedDB' };
export const browserLocalPersistence = { type: 'LOCAL', name: 'localStorage' };
const AUTH = {
  app: null,
  get currentUser() {
    return state.currentUser;
  },
  async authStateReady() {},
};
export function initializeAuth(app) {
  AUTH.app = app;
  return AUTH;
}
export function getAuth(app) {
  AUTH.app = app || AUTH.app;
  return AUTH;
}
function makeUser(u) {
  return {
    uid: u.uid,
    email: u.email || null,
    isAnonymous: !!u.isAnonymous,
    emailVerified: true,
    displayName: null,
    providerData: [],
    role: u.role || '',
    getIdToken: async () => 'fake-token',
    getIdTokenResult: async () => ({ claims: { email: u.email || null, role: u.role || undefined } }),
    reload: async () => {},
    delete: async () => {
      state.users = state.users.filter((x) => x.uid !== u.uid);
      setUser(null);
    },
  };
}
function setUser(u) {
  state.currentUser = u ? makeUser(u) : null;
  for (const cb of [...state.authListeners]) setTimeout(() => cb(state.currentUser), 0);
}
export function onAuthStateChanged(auth, cb) {
  state.authListeners.add(cb);
  setTimeout(() => cb(state.currentUser), 0);
  return () => state.authListeners.delete(cb);
}
function authError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}
export async function signInWithEmailAndPassword(auth, email, password) {
  await tick();
  const u = state.users.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
  record('auth.signIn', String(email).toLowerCase());
  if (!u || u.password !== password) throw authError('auth/invalid-credential');
  setUser(u);
  return { user: state.currentUser };
}
export async function createUserWithEmailAndPassword(auth, email, password) {
  await tick();
  if (state.users.some((x) => x.email.toLowerCase() === String(email).toLowerCase()))
    throw authError('auth/email-already-in-use');
  const u = { email: String(email), password, uid: `fakeuid${String(state.users.length + 1).padStart(3, '0')}` };
  state.users.push(u);
  record('auth.createUser', u.email.toLowerCase());
  setUser(u);
  return { user: state.currentUser };
}
export async function signInAnonymously() {
  await tick();
  record('auth.anonymous', '');
  setUser({ uid: 'fakeanon001', isAnonymous: true });
  return { user: state.currentUser };
}
export async function signOut() {
  await tick();
  record('auth.signOut', '');
  setUser(null);
}
export async function sendPasswordResetEmail(auth, email) {
  await tick();
  record('auth.passwordReset', String(email).toLowerCase());
}
export async function updatePassword(user, pw) {
  await tick();
  record('auth.updatePassword', user?.uid || '');
  const u = state.users.find((x) => x.uid === user?.uid);
  if (u) u.password = pw;
}

/* ---------------- Storage ---------------- */
const STORAGE = { type: 'storage' };
export function getStorage() {
  return STORAGE;
}
export function ref(storage, path) {
  return { fullPath: path, name: String(path).split('/').pop() };
}
export function uploadBytesResumable(r, file) {
  record('storage.upload', r.fullPath, { size: file?.size || 0, type: file?.type || '' });
  const snapshot = { ref: r, bytesTransferred: file?.size || 0, totalBytes: file?.size || 0, state: 'success' };
  const task = {
    snapshot,
    on(evt, progress, error, complete) {
      setTimeout(() => {
        try {
          progress && progress(snapshot);
        } catch {}
        complete && complete();
      }, 0);
      return () => {};
    },
    then(res, rej) {
      return Promise.resolve(snapshot).then(res, rej);
    },
    catch(rej) {
      return Promise.resolve(snapshot).catch(rej);
    },
  };
  return task;
}
export async function getDownloadURL(r) {
  return `https://fake-storage.invalid/${encodeURIComponent(r.fullPath)}`;
}

/* ---------------- Messaging (notifications are reported unsupported in tests) ---------------- */
export async function isSupported() {
  return false;
}
export function getMessaging() {
  return {};
}
export async function getToken() {
  throw new Error('messaging unsupported in tests');
}
export async function deleteToken() {
  return true;
}
export function onMessage() {
  return () => {};
}

/* Test helpers */
export function __fakeState() {
  return state;
}
