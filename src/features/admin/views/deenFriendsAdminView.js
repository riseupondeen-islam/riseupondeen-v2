/**
 * Admin › Deen Friends Trust & Safety console (users, connections, requests, messages, moderation, notices, settings, audit logs).
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { checkUsername } from '../../deen-friends/services/username';
import { rudDfPasswordReset } from '../../deen-friends/services/accountService';
import { S } from '../../../runtime/store';
import { rudDfAdminKey } from '../../home/homeContent';
import { $ } from '../../../runtime/core';
import { firebaseConfig } from '../../../services/firebase/config';
import {
  addDoc,
  collection,
  createUserWithEmailAndPassword,
  deleteApp,
  deleteDoc,
  doc,
  getAuth,
  getDoc,
  getDocs,
  initializeApp,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  signOut,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from '../../../services/firebase/sdk';
import { esc, toast } from '../../../utils/ui';

/** A clear, specific message for a failed console action (the old generic "Action failed." hid the reason). */
function adminErrorMessage(err) {
  const code = String(err?.code || '').replace(/^firestore\//, '');
  const text = String(err?.message || '');
  if (code === 'permission-denied' || /insufficient permissions/i.test(text))
    return 'Permission denied. Your admin role does not allow this, or the latest firestore.rules are not deployed.';
  if (code === 'failed-precondition' && /index/i.test(text))
    return 'This needs a Firestore index. Deploy firestore.indexes.json, wait a few minutes, then retry.';
  if (code === 'unavailable' || code === 'deadline-exceeded' || !navigator.onLine)
    return 'You appear to be offline. Check the connection and retry.';
  if (code === 'resource-exhausted' || /quota/i.test(text))
    return 'Firebase’s free daily limit was reached. Please retry later.';
  if (code === 'not-found') return 'That record no longer exists. Refresh and retry.';
  if (code === 'unauthenticated') return 'Your admin session expired. Sign in again.';
  // Errors thrown by this console carry a readable explanation; show it as-is.
  if (!code && text && text.length < 180) return text;
  return 'The action could not be completed. Refresh and retry.';
}

/** Wraps an async console handler so any failure shows a clear message instead of failing silently. */
function guarded(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error('[Deen Friends Admin]', err);
      toast(adminErrorMessage(err), 'error');
    }
  };
}

async function deenFriendsAdminView() {
  /* =========================================================
     DEEN FRIENDS — FRESH ADMIN CONSOLE
     This function is intentionally isolated to the admin route.
     Public Deen Friends UI/state/functions are not modified.
     ========================================================= */
  const main = $('#adminMain');
  if (!main) return;
  if (!S.firebaseReady || !S.db || !S.auth?.currentUser) {
    main.innerHTML = `<div class="rud-df-admin"><div class="rud-df-admin-panel" style="padding:28px"><div class="rud-df-admin-alert">Firebase is not ready or the admin account is not signed in. Sign in again and reopen Deen Friends.</div></div></div>`;
    return;
  }

  const ADMIN_EMAIL = 'riseupondeen@gmail.com';
  const me = S.auth.currentUser;
  let tokenResult = null;
  try {
    tokenResult = await me.getIdTokenResult(true);
  } catch (e) {
    console.warn('[Deen Friends Admin] Token refresh failed', e);
  }
  const tokenEmail = String(tokenResult?.claims?.email || me.email || '')
    .trim()
    .toLowerCase();
  const isSuper = tokenEmail === ADMIN_EMAIL;
  if (!isSuper) {
    main.innerHTML = `<div class="rud-df-admin"><div class="rud-df-admin-panel" style="padding:28px"><div class="rud-df-admin-alert">This console is restricted to the authorized Deen Friends administrator.</div></div></div>`;
    return;
  }

  const state = {
    tab: 'command',
    search: '',
    range: '7d',
    users: [],
    requests: [],
    friendships: [],
    streaks: [],
    messages: [],
    reports: [],
    cases: [],
    blocks: [],
    appeals: [],
    restrictions: [],
    suspensions: [],
    usernameChanges: [],
    activity: [],
    analytics: [],
    notices: [],
    settings: [],
    audit: [],
    privateAccess: [],
    privateAccessLogs: [],
    notes: [],
    riskSignals: [],
    evidence: [],
    selectedUser: null,
    selectedConversation: null,
    loaded: {},
    errors: {},
    loading: {},
  };

  const collections = {
    users: 'deens_users',
    requests: 'deens_friend_requests',
    friendships: 'deens_friendships',
    streaks: 'deens_friend_streaks',
    messages: 'deens_friend_messages',
    reports: 'deens_reports',
    cases: 'deens_moderation_cases',
    blocks: 'deens_blocks',
    appeals: 'deens_user_appeals',
    restrictions: 'deens_user_restrictions',
    suspensions: 'deens_user_suspensions',
    usernameChanges: 'deens_username_change_requests',
    activity: 'deens_activity_logs',
    analytics: 'deens_analytics',
    notices: 'deens_community_notices',
    settings: 'deens_admin_settings',
    audit: 'deens_admin_audit_logs',
    privateAccess: 'deens_private_chat_access',
    privateAccessLogs: 'deens_private_chat_access_logs',
    notes: 'deens_admin_user_notes',
    riskSignals: 'deens_risk_signals',
    evidence: 'deens_case_evidence',
    officialChallenges: 'deens_official_challenges',
  };

  const escText = (v) => esc(String(v ?? ''));
  const rudDfAdminUsernameKey = (v) =>
    String(v ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF _.-]/gi, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 40);
  const stamp = (x) => {
    try {
      if (x?.toDate) return x.toDate().getTime();
      if (x?.seconds) return Number(x.seconds) * 1000;
      const n = Number(x);
      if (Number.isFinite(n) && n > 0) return n;
      const d = new Date(x);
      return Number.isFinite(d.getTime()) ? d.getTime() : 0;
    } catch {
      return 0;
    }
  };
  const fmt = (x) => {
    const n = stamp(x);
    if (!n) return '—';
    try {
      return new Date(n).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return '—';
    }
  };
  const shortId = (v) => {
    const s = String(v || '');
    return s.length > 18 ? s.slice(0, 8) + '…' + s.slice(-6) : s;
  };
  const statusClass = (v) => {
    const s = String(v || '').toLowerCase();
    if (/suspend|block|ban|deleted|deletion|high|critical|report/.test(s)) return 'danger';
    if (/pending|review|restrict|new|open/.test(s)) return 'warn';
    if (/accepted|active|resolved|approved|normal|published|live/.test(s)) return 'ok';
    return 'info';
  };
  const pill = (v) => `<span class="rud-df-admin-pill ${statusClass(v)}">${escText(v || '—')}</span>`;
  const load = async (key, force = false) => {
    if (!force && state.loaded[key]) return state[key];
    const name = collections[key];
    if (!name) {
      state.errors[key] = { code: 'unknown-collection', message: 'Unknown Firestore collection', collection: name };
      state[key] = [];
      return state[key];
    }
    state.loading[key] = true;
    delete state.errors[key];
    const readAll = async () => {
      const ref = collection(S.db, name);
      const all = [];
      let cursor = null;
      for (let page = 0; page < 1000; page++) {
        const q = cursor ? query(ref, limit(1000), startAfter(cursor)) : query(ref, limit(1000));
        const snap = await getDocs(q);
        all.push(...snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
        if (snap.docs.length < 1000) break;
        cursor = snap.docs[snap.docs.length - 1];
      }
      return all;
    };
    try {
      let rows;
      try {
        rows = await readAll();
      } catch (firstError) {
        if (firstError?.code === 'permission-denied') {
          try {
            await me.getIdTokenResult(true);
          } catch {}
          rows = await readAll();
        } else throw firstError;
      }
      state[key] = rows;
      state.loaded[key] = true;
      return state[key];
    } catch (e) {
      state[key] = [];
      delete state.loaded[key];
      state.errors[key] = {
        code: String(e?.code || 'unknown'),
        message: String(e?.message || 'Firestore read failed'),
        collection: name,
      };
      console.error(`[Deen Friends Admin] Failed to load ${name}`, e);
      return state[key];
    } finally {
      delete state.loading[key];
    }
  };
  const invalidate = (...keys) =>
    keys.forEach((k) => {
      delete state.loaded[k];
      state[k] = [];
    });
  const writeAudit = async (action, target = '', reason = '', extra = {}) => {
    try {
      await addDoc(collection(S.db, 'deens_admin_audit_logs'), {
        adminUid: me.uid,
        adminEmail: me.email || '',
        adminRole: 'SUPER_ADMIN',
        action,
        target: String(target || ''),
        reason: String(reason || '').slice(0, 1000),
        timestamp: serverTimestamp(),
        timestampMs: Date.now(),
        ...extra,
      });
      invalidate('audit');
      return true;
    } catch (e) {
      console.warn('[Deen Friends Audit]', e);
      return false;
    }
  };
  const userMap = async () => {
    const m = new Map();
    (await load('users')).forEach((u) => m.set(u.id, u));
    return m;
  };
  const uname = (uid, map) => {
    const u = map.get(uid);
    return u?.displayName || u?.name || u?.username || shortId(uid) || 'Unknown';
  };
  const userStatus = async (uid) => {
    const [r, s] = await Promise.all([load('restrictions'), load('suspensions')]);
    const rr = r.find((x) => x.uid === uid && x.active !== false);
    const ss = s.find((x) => x.uid === uid && x.active !== false);
    return ss ? 'SUSPENDED' : rr ? 'RESTRICTED' : 'ACTIVE';
  };
  const metric = (label, value, meta = '') =>
    `<article class="rud-df-admin-stat"><small>${label}</small><strong>${value}</strong><span>${meta}</span></article>`;
  const panel = (title, body, meta = '') =>
    `<section class="rud-df-admin-panel"><div class="rud-df-admin-panel-head"><h3>${title}</h3><span>${meta}</span></div><div class="rud-df-admin-panel-body">${body}</div></section>`;
  const table = (headers, rows, empty = 'No records found.') => {
    if (!rows || !rows.length) return panel('', `<div class="rud-df-admin-empty">${empty}</div>`);
    return `<div class="rud-df-admin-table-wrap"><table class="rud-df-admin-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}"><div class="rud-df-admin-empty">${empty}</div></td></tr>`}</tbody></table></div>`;
  };
  const head = (kicker, title, desc, actions = '') =>
    `<div class="rud-df-admin-page-head"><div><span class="rud-df-admin-kicker">${kicker}</span><h2>${title}</h2><p>${desc}</p></div><div class="rud-df-admin-actions">${actions}</div></div>`;
  const btn = (label, id, cls = '') =>
    `<button type="button" class="rud-df-admin-btn ${cls}" id="${id}">${label}</button>`;
  const mini = (label, action, id, cls = '') =>
    `<button type="button" class="rud-df-admin-mini ${cls}" data-df-action="${action}" data-id="${escText(id)}">${label}</button>`;
  const renderNav = () =>
    [
      ['command', 'Command Center', '⌂'],
      ['user-management', 'User Management', '◉'],
      ['connections', 'Connections', '↔'],
      ['requests', 'Friend Requests', '⇄'],
      ['username', 'Username Changes', '@'],
      ['messages', 'Messages', '▣'],
      ['safety', 'Trust & Safety', '△'],
      ['activity', 'Activity Logs', '◷'],
      ['analytics', 'Analytics', '◌'],
      ['notices', 'Community Notices', '◇'],
      ['settings', 'Settings', '⚙'],
      ['audit', 'Admin Audit Logs', '≡'],
    ]
      .map(
        ([id, label, ico]) =>
          `<button type="button" class="${state.tab === id ? 'active' : ''}" data-df-tab="${id}"><b>${ico}</b><span>${label}</span></button>`,
      )
      .join('');

  main.innerHTML = `<div class="rud-df-admin">
    <div class="rud-df-admin-shell">
      <aside class="rud-df-admin-side" id="rudDfAdminSide">
        <div class="rud-df-admin-brand"><b>DEEN FRIENDS</b><span>PRIVATE ADMIN CONSOLE</span></div>
        <nav class="rud-df-admin-nav">${renderNav()}</nav>
        <div class="rud-df-admin-side-foot">SUPER ADMIN<br>${escText(me.email || '')}<br>All actions are audit logged.</div>
      </aside>
      <section class="rud-df-admin-main">
        <header class="rud-df-admin-top">
          <div style="display:flex;align-items:center;gap:8px">${btn('☰', 'rudDfAdminMenu', 'rud-df-admin-mobile')}<span class="rud-df-admin-top-title" id="rudDfAdminTopTitle">Command Center</span></div>
          <div class="rud-df-admin-top-meta"><span class="rud-df-admin-role">SUPER ADMIN</span><span>${escText(me.email || '')}</span></div>
        </header>
        <main class="rud-df-admin-body" id="rudDfAdminBody"></main>
      </section>
    </div>
  </div>
  <div class="rud-df-admin-drawer" id="rudDfAdminDrawer" hidden>
    <div class="rud-df-admin-drawer-card"><div class="rud-df-admin-drawer-head"><b id="rudDfAdminDrawerTitle">Details</b><button type="button" class="rud-df-admin-btn" id="rudDfAdminDrawerClose">Close</button></div><div class="rud-df-admin-drawer-body" id="rudDfAdminDrawerBody"></div></div>
  </div>`;

  const body = $('#rudDfAdminBody');
  const drawer = $('#rudDfAdminDrawer');
  const drawerBody = $('#rudDfAdminDrawerBody');
  const drawerTitle = $('#rudDfAdminDrawerTitle');
  const openDrawer = (title, content) => {
    drawerTitle.textContent = title;
    drawerBody.innerHTML = content;
    drawer.hidden = false;
  };
  const closeDrawer = () => {
    drawer.hidden = true;
    drawerBody.innerHTML = '';
  };
  const closeSide = () => $('#rudDfAdminSide')?.classList.remove('open');

  const filterRows = (rows, keys) => {
    const q = state.search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((x) =>
      keys.some((k) =>
        String(x?.[k] ?? '')
          .toLowerCase()
          .includes(q),
      ),
    );
  };

  async function command() {
    const keys = [
      'users',
      'requests',
      'friendships',
      'messages',
      'reports',
      'cases',
      'blocks',
      'appeals',
      'restrictions',
      'suspensions',
      'usernameChanges',
      'activity',
    ];
    const [
      users,
      requests,
      friendships,
      messages,
      reports,
      cases,
      blocks,
      appeals,
      restrictions,
      suspensions,
      changes,
      activity,
    ] = await Promise.all(keys.map((k) => load(k)));
    const failed = keys.filter((k) => state.errors[k]);
    const pending = requests.filter((x) => x.status === 'pending').length;
    const activeBlocks = blocks.filter((x) => x.status === 'active').length;
    const openCases = cases.filter(
      (x) => !['resolved', 'closed'].includes(String(x.status || '').toLowerCase()),
    ).length;
    const suspended = suspensions.filter((x) => x.active !== false).length;
    body.innerHTML = head(
      'DEEN FRIENDS · TRUST & SAFETY',
      'Command Center',
      'Complete operational overview for users, relationships, requests, conversations and safety.',
      btn('Refresh', 'rudDfRefresh', 'primary') + btn('Export Snapshot', 'rudDfExport'),
    );
    if (failed.length) {
      const details = failed
        .map((k) => `${collections[k]} — ${String(state.errors[k]?.code || state.errors[k]?.message || 'read failed')}`)
        .join('<br>');
      body.innerHTML += `<div class="rud-df-admin-alert rud-df-admin-read-alert"><b>Firestore read issue</b><br>Some collections could not be read, so their counts are not shown as real zero values.<div class="rud-df-admin-error-list">${details}</div><div class="rud-df-admin-note" style="margin-top:10px">Signed-in account: ${escText(me.email || '')} · Firebase project: ${escText(firebaseConfig?.projectId || 'unknown')} · Token email: ${escText(tokenEmail || 'unknown')}</div><button type="button" class="rud-df-admin-btn primary" id="rudDfRetryReads">Retry reads</button></div>`;
    }
    body.innerHTML += `<div class="rud-df-admin-stats">
      ${metric('Users', users.length, 'registered profiles')}
      ${metric('Connections', friendships.length, 'accepted friendships')}
      ${metric('Pending requests', pending, 'awaiting action')}
      ${metric('Messages', messages.length, 'loaded records')}
      ${metric('Open cases', openCases, 'moderation queue')}
      ${metric('Suspensions', suspended, 'active restrictions')}
    </div>
    <div class="rud-df-admin-grid">
      <div style="display:grid;gap:14px">
        ${panel(
          'Operational health',
          `<div class="rud-df-admin-detail-grid">
          <div><small>Reports</small><b>${reports.length}</b></div><div><small>Blocks</small><b>${activeBlocks}</b></div>
          <div><small>Appeals</small><b>${appeals.length}</b></div><div><small>Username changes</small><b>${changes.filter((x) => x.status === 'pending').length} pending</b></div>
          <div><small>Activity logs</small><b>${activity.length}</b></div><div><small>Moderation cases</small><b>${cases.length}</b></div>
        </div>`,
          'Live Firestore counts',
        )}
        ${panel('Admin principles', `<div class="rud-df-admin-note">This console is isolated from the public Deen Friends UI. User data is displayed here for administration. Safety decisions remain human decisions; signals never automatically ban a user.</div>`, 'Governance')}
      </div>
      ${panel(
        'Quick actions',
        `
        <div class="rud-df-admin-actions" style="justify-content:flex-start">
          ${btn('Users', 'rudDfGoUsers', 'primary')}${btn('Requests', 'rudDfGoRequests')}${btn('Messages', 'rudDfGoMessages')}${btn('Trust & Safety', 'rudDfGoSafety')}
        </div>
        <div style="height:10px"></div>
        <div class="rud-df-admin-note">Message access is visible to this Super Admin because the Firestore rules explicitly authorize the Super Admin account.</div>`,
        'Navigation',
      )}
    </div>`;
    $('#rudDfRefresh').onclick = () => renderTab(true);
    $('#rudDfRetryReads')?.addEventListener('click', () => {
      keys.forEach((k) => {
        delete state.loaded[k];
        delete state.errors[k];
      });
      renderTab(true);
    });
    $('#rudDfExport').onclick = () =>
      exportJSON(
        {
          users,
          requests,
          friendships,
          messages,
          reports,
          cases,
          blocks,
          appeals,
          restrictions,
          suspensions,
          changes,
          activity,
        },
        'deen-friends-command-snapshot',
      );
    $('#rudDfGoUsers').onclick = () => go('users');
    $('#rudDfGoRequests').onclick = () => go('requests');
    $('#rudDfGoMessages').onclick = () => go('messages');
    $('#rudDfGoSafety').onclick = () => go('safety');
  }

  async function userManagement() {
    const sub = state.userManagementTab || 'accounts';
    const usersRows = await load('users');
    const count = usersRows.length;
    const tabs = `<div class="rud-df-admin-subtabs" role="tablist">
      <button type="button" class="${sub === 'accounts' ? 'active' : ''}" data-df-user-subtab="accounts">Accounts & Profiles</button>
      <button type="button" class="${sub === 'firestore' ? 'active' : ''}" data-df-user-subtab="firestore">Firestore Data</button>
    </div>`;
    if (sub === 'firestore') {
      await firestoreDataManager();
      return;
    }
    await users();
    const bodyNow = $('#rudDfAdminBody');
    if (bodyNow) {
      const wrap = document.createElement('div');
      wrap.className = 'rud-df-admin-user-management-tabs';
      wrap.innerHTML = tabs;
      bodyNow.insertBefore(wrap, bodyNow.firstChild);
      wrap.querySelectorAll('[data-df-user-subtab]').forEach(
        (b) =>
          (b.onclick = () => {
            state.userManagementTab = b.dataset.dfUserSubtab;
            renderTab(true);
          }),
      );
    }
  }

  async function firestoreDataManager() {
    const allowed = Object.entries(collections);
    const selected = state.firestoreCollection || 'users';
    const rows = await load(selected);
    const collectionName = collections[selected];
    const selectedId = state.firestoreRecordId || '';
    const selectedRecord = rows.find((x) => x.id === selectedId) || null;
    body.innerHTML = head(
      'USER MANAGEMENT · FIRESTORE',
      'Firestore Data',
      'Inspect and safely modify Deen Friends Firestore records. Changes are validated and audit logged.',
      btn('Refresh', 'rudDfFirestoreRefresh') + btn('New record', 'rudDfFirestoreNew', 'primary'),
    );
    body.innerHTML += `<div class="rud-df-admin-user-management-tabs" role="tablist"><button type="button" data-df-user-subtab="accounts">Accounts & Profiles</button><button type="button" class="active" data-df-user-subtab="firestore">Firestore Data</button></div>
      <div class="rud-df-admin-toolbar"><label class="rud-df-admin-field" style="min-width:240px;flex:1"><span>Collection</span><select class="rud-df-admin-select" id="rudDfFirestoreCollection">${allowed.map(([k, n]) => `<option value="${escText(k)}" ${k === selected ? 'selected' : ''}>${escText(n)}</option>`).join('')}</select></label><span class="rud-df-admin-muted">${rows.length} records loaded</span></div>
      <div class="rud-df-admin-grid"><div>${table(
        ['Record ID', 'Summary', 'Updated', 'Actions'],
        rows
          .map((x) => {
            const summary = Object.entries(x)
              .filter(([k]) => k !== 'id')
              .slice(0, 4)
              .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}`)
              .join(' · ');
            return `<tr><td class="rud-df-admin-code">${escText(x.id)}</td><td>${escText(summary.slice(0, 220))}</td><td>${fmt(x.updatedAt || x.createdAt || x.timestamp || x.timestampMs)}</td><td>${mini('Edit', 'firestoreEdit', x.id, 'primary')}${mini('Delete', 'firestoreDelete', x.id, 'danger')}</td></tr>`;
          })
          .join(''),
        'No records found.',
      )}</div>
      <div id="rudDfFirestoreEditor">${selectedRecord ? firestoreEditor(selectedRecord, collectionName) : `<div class="rud-df-admin-panel"><div class="rud-df-admin-empty">Select a record to edit it, or create a new record.</div></div>`}</div></div>`;
    $('#rudDfFirestoreCollection').onchange = (e) => {
      state.firestoreCollection = e.target.value;
      state.firestoreRecordId = '';
      renderTab(true);
    };
    $('#rudDfFirestoreRefresh').onclick = () => {
      invalidate(selected);
      renderTab(true);
    };
    $('#rudDfFirestoreNew').onclick = () => openFirestoreEditor(null, collectionName);
    body.querySelectorAll('[data-df-user-subtab]').forEach(
      (b) =>
        (b.onclick = () => {
          state.userManagementTab = b.dataset.dfUserSubtab;
          renderTab(true);
        }),
    );
  }

  function firestoreEditor(record, collectionName) {
    const id = record?.id || '';
    const raw = record
      ? JSON.stringify(Object.fromEntries(Object.entries(record).filter(([k]) => k !== 'id')), null, 2)
      : collectionName === 'deens_official_challenges'
        ? JSON.stringify(
            {
              title: '',
              description: '',
              category: 'Zikr',
              activity: 'tasbih',
              target: 100,
              durationDays: 1,
              active: true,
              featured: false,
            },
            null,
            2,
          )
        : '';
    return `<section class="rud-df-admin-panel"><div class="rud-df-admin-panel-head"><h3>${id ? 'Edit' : 'Create'} Firestore record</h3><span>${escText(collectionName)}</span></div><div class="rud-df-admin-field"><label>Document ID</label><input class="rud-df-admin-input" id="rudDfFirestoreId" value="${escText(id)}" ${id ? 'readonly' : ''}></div><div class="rud-df-admin-field"><label>Document JSON</label><textarea class="rud-df-admin-textarea" id="rudDfFirestoreJson" spellcheck="false" rows="18">${escText(raw)}</textarea></div><div class="rud-df-admin-actions" style="justify-content:flex-start">${btn('Save record', 'rudDfFirestoreSave', 'primary')}${id ? btn('Delete record', 'rudDfFirestoreDelete', 'danger') : ''}<span id="rudDfFirestoreStatus" class="rud-df-auth-status"></span></div></section>`;
  }

  function openFirestoreEditor(record, collectionName) {
    state.firestoreRecordId = record?.id || '';
    openDrawer(record ? 'Edit Firestore record' : 'Create Firestore record', firestoreEditor(record, collectionName));
    $('#rudDfFirestoreSave').onclick = guarded(async () => {
      const status = $('#rudDfFirestoreStatus'),
        id = $('#rudDfFirestoreId').value.trim(),
        raw = $('#rudDfFirestoreJson').value.trim();
      try {
        if (!id || !/^[-A-Za-z0-9_]{1,150}$/.test(id)) throw Error('Enter a valid Firestore document ID.');
        if (!raw) throw Error('Document JSON is required.');
        let value;
        try {
          value = JSON.parse(raw);
        } catch {
          throw Error('Document JSON is not valid JSON.');
        }
        if (!value || Array.isArray(value) || typeof value !== 'object')
          throw Error('Document JSON must be an object.');
        delete value.id;
        value.updatedAt = serverTimestamp();
        value.updatedAtMs = Date.now();
        value.updatedBy = me.uid;
        await setDoc(doc(S.db, collectionName, id), value, { merge: true });
        await writeAudit(
          record ? 'FIRESTORE_RECORD_UPDATED' : 'FIRESTORE_RECORD_CREATED',
          `${collectionName}/${id}`,
          'Super Admin modified Deen Friends Firestore data.',
        );
        closeDrawer();
        state.firestoreRecordId = id;
        invalidate(selectedKeyForCollection(collectionName));
        renderTab(true);
        toast(record ? 'Firestore record updated.' : 'Firestore record created.');
      } catch (e) {
        status.textContent = e.message || 'Unable to save record.';
      }
    });
    $('#rudDfFirestoreDelete')?.addEventListener(
      'click',
      guarded(async () => {
        if (!confirm('Delete this Firestore document permanently?')) return;
        try {
          await deleteDoc(doc(S.db, collectionName, record.id));
          await writeAudit(
            'FIRESTORE_RECORD_DELETED',
            `${collectionName}/${record.id}`,
            'Super Admin deleted a Deen Friends Firestore record.',
          );
          closeDrawer();
          state.firestoreRecordId = '';
          invalidate(selectedKeyForCollection(collectionName));
          renderTab(true);
          toast('Firestore record deleted.');
        } catch (e) {
          toast(e.message || 'Unable to delete record.', 'error');
        }
      }),
    );
  }

  function selectedKeyForCollection(name) {
    return Object.entries(collections).find(([, v]) => v === name)?.[0] || '';
  }

  async function users() {
    const users = filterRows(await load('users'), [
      'id',
      'uid',
      'displayName',
      'name',
      'username',
      'usernameKey',
      'visitorId',
    ]);
    const selected = state.selectedUser;
    const map = new Map((await load('users')).map((x) => [x.id, x]));
    body.innerHTML = head(
      'IDENTITY · 360°',
      'Users · 360°',
      'Search every registered Deen Friends profile and inspect the complete operational record.',
      btn('Create user', 'rudDfCreateUser', 'primary') +
        btn('Refresh', 'rudDfUsersRefresh') +
        btn('Export CSV', 'rudDfUsersExport'),
    );
    body.innerHTML += `<div class="rud-df-admin-grid">
      <div>${
        `<div class="rud-df-admin-toolbar"><input class="rud-df-admin-search" id="rudDfUsersSearch" value="${escText(state.search)}" placeholder="Search name, username, UID or visitor ID"><span class="rud-df-admin-muted" style="font-size:9px">${users.length} shown</span></div>` +
        table(
          ['User', 'Username', 'UID', 'Created', 'Status', 'Actions'],
          users
            .map(
              (u) => `<tr>
        <td><b>${escText(u.displayName || u.name || 'Unnamed')}</b><br><span class="rud-df-admin-muted">${escText(u.email || 'No password account')}</span></td>
        <td>@${escText(u.username || '—')}</td><td class="rud-df-admin-code">${escText(shortId(u.uid || u.id))}</td>
        <td>${fmt(u.createdAt)}</td><td id="rudDfStatus_${escText(u.id)}">${pill('loading')}</td>
        <td><div class="rud-df-admin-row-actions">${mini('360°', 'user360', u.id)}${mini('Select', 'selectUser', u.id)}${mini('Delete Deen Friends', 'userDelete', u.id, 'danger')}</div></td>
      </tr>`,
            )
            .join(''),
          'No user profiles found.',
        )
      }</div>
      <div class="rud-df-admin-detail" id="rudDfUserDetail">${selected ? await userDetail(selected) : `<div class="rud-df-admin-panel"><div class="rud-df-admin-empty">Select a user to open the full 360° record.</div></div>`}</div>
    </div>`;
    const input = $('#rudDfUsersSearch');
    input.oninput = () => {
      state.search = input.value;
      users();
    };
    $('#rudDfCreateUser').onclick = () => adminCreateUserForm();
    $('#rudDfUsersRefresh').onclick = () => {
      invalidate('users', 'restrictions', 'suspensions');
      users();
    };
    $('#rudDfUsersExport').onclick = () =>
      exportCSV(
        users,
        ['id', 'uid', 'displayName', 'username', 'visitorId', 'createdAt', 'updatedAt', 'lastActiveAt'],
        'deen-friends-users.csv',
      );
    users.forEach(async (u) => {
      const st = u.deletionRequestedAt ? 'deletion pending' : await userStatus(u.id);
      const el = $(`#rudDfStatus_${u.id}`);
      if (el) el.innerHTML = pill(st);
    });
  }

  async function adminCreateUserForm() {
    openDrawer(
      'Create Deen Friends user',
      `<form class="ruddm-user-modal" id="ruddmCreateUserForm" novalidate autocomplete="off">
      <div class="ruddm-field"><label class="ruddm-label" for="ruddmNewEmail">Email</label><input class="ruddm-input" id="ruddmNewEmail" name="ruddm-email" type="email" autocomplete="off" inputmode="email" required></div>
      <div class="ruddm-field"><label class="ruddm-label" for="ruddmNewPassword">Temporary password</label><input class="ruddm-input" id="ruddmNewPassword" name="ruddm-password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div>
      <div class="ruddm-field"><label class="ruddm-label" for="ruddmNewName">Display name</label><input class="ruddm-input" id="ruddmNewName" name="ruddm-display-name" type="text" autocomplete="off" maxlength="40" required></div>
      <div class="ruddm-field"><label class="ruddm-label" for="ruddmNewUsername">Username</label><input class="ruddm-input" id="ruddmNewUsername" name="ruddm-username" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="30" required></div>
      <div class="ruddm-note">Free Firebase Spark-compatible account creation. The Super Admin session stays signed in while the new Firebase Authentication account is created through a separate client Auth instance. Passwords are never stored in Firestore.</div>
      <div class="ruddm-actions"><button type="submit" class="rud-df-admin-btn primary" id="ruddmCreateSave">Create user</button><span class="ruddm-status" id="ruddmCreateStatus" aria-live="polite"></span></div>
    </form>`,
    );
    const form = $('#ruddmCreateUserForm'),
      status = $('#ruddmCreateStatus');
    const clear = () =>
      ['#ruddmNewEmail', '#ruddmNewPassword', '#ruddmNewName', '#ruddmNewUsername'].forEach((sel) => {
        const el = $(sel);
        if (el) {
          el.value = '';
          el.removeAttribute('value');
        }
      });
    clear();
    setTimeout(clear, 60);
    setTimeout(clear, 300);
    $('#ruddmNewEmail')?.focus();
    form.onsubmit = guarded(async (e) => {
      e.preventDefault();
      const b = $('#ruddmCreateSave'),
        em = $('#ruddmNewEmail').value.trim().toLowerCase(),
        pw = $('#ruddmNewPassword').value,
        name = $('#ruddmNewName').value.trim().replace(/\s+/g, ' '),
        un = $('#ruddmNewUsername').value.trim().replace(/^@+/, '').replace(/\s+/g, '');
      status.className = 'ruddm-status';
      status.textContent = '';
      let secondaryApp = null,
        secondaryAuth = null,
        createdUid = '';
      try {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw Error('Enter a valid email address.');
        if (pw.length < 8) throw Error('Password must be at least 8 characters.');
        if (name.length < 2 || name.length > 40) throw Error('Display name must contain 2 to 40 characters.');
        /* V3: one username rule everywhere (features/deen-friends/services/username.ts). */
        const unCheck = checkUsername(un);
        if (!unCheck.ok) throw Error(unCheck.message);
        if (!S.firebaseReady || !S.db || !S.auth?.currentUser)
          throw Error('The Super Admin session is not ready. Sign in again and retry.');
        b.disabled = true;
        b.textContent = 'Creating…';
        const usernameKey = rudDfAdminUsernameKey(un);
        secondaryApp = initializeApp(
          firebaseConfig,
          `rud-df-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );
        secondaryAuth = getAuth(secondaryApp);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, em, pw);
        createdUid = String(cred.user.uid);
        const userRef = doc(S.db, 'deens_users', createdUid),
          usernameRef = doc(S.db, 'visitor_usernames', usernameKey);
        await runTransaction(S.db, async (tx) => {
          const taken = await tx.get(usernameRef);
          if (taken.exists() && String(taken.data()?.ownerUid || '') !== createdUid)
            throw Error('That username is already taken.');
          const existing = await tx.get(userRef);
          if (existing.exists()) throw Error('A Deen Friends profile already exists for this account.');
          tx.set(usernameRef, {
            visitorId: `admin_${createdUid}`,
            ownerUid: createdUid,
            name: un,
            nameKey: usernameKey,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          tx.set(userRef, {
            uid: createdUid,
            visitorId: `admin_${createdUid}`,
            username: un,
            usernameKey,
            displayName: name,
            name,
            email: em,
            authProvider: 'password',
            passwordEnabled: true,
            avatar: 'crescent',
            bio: '',
            deenFocus: '',
            currentFocus: '',
            favoriteSurah: '',
            languages: '',
            field: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastActiveAt: Date.now(),
            createdByAdminUid: me.uid,
          });
        });
        await writeAudit(
          'USER_CREATED',
          createdUid,
          'Super Admin created a Deen Friends account using Firebase client Auth on the free Spark-compatible path.',
        );
        status.className = 'ruddm-status success';
        status.textContent = 'User created successfully.';
        form.reset();
        setTimeout(() => {
          closeDrawer();
          invalidate('users');
          state.tab = 'user-management';
          state.userManagementTab = 'accounts';
          userManagement();
          toast('User account created.');
        }, 300);
      } catch (e) {
        if (createdUid) {
          try {
            await deleteDoc(doc(S.db, 'deens_users', createdUid));
          } catch {}
          try {
            await deleteDoc(doc(S.db, 'visitor_usernames', rudDfAdminUsernameKey(un)));
          } catch {}
          try {
            if (secondaryAuth?.currentUser?.uid === createdUid) await secondaryAuth.currentUser.delete();
          } catch {}
        }
        status.className = 'ruddm-status error';
        status.textContent = e?.message || 'Could not create the user.';
        b.disabled = false;
        b.textContent = 'Create user';
      } finally {
        try {
          if (secondaryAuth) await signOut(secondaryAuth);
        } catch {}
        try {
          if (secondaryApp && typeof deleteApp === 'function') await deleteApp(secondaryApp);
        } catch {}
      }
    });
  }
  async function adminEditUserForm(uid) {
    const u = (await load('users')).find((x) => x.id === uid);
    if (!u) throw Error('User profile not found.');
    openDrawer(
      'Edit Deen Friends profile',
      `<form class="rud-df-admin-form" id="rudDfEditUserForm">
      <div class="rud-df-admin-field"><label>Display name</label><input class="rud-df-admin-input" id="rudDfEditName" maxlength="40" value="${escText(u.displayName || u.name || '')}" required></div>
      <div class="rud-df-admin-field"><label>Username</label><input class="rud-df-admin-input" id="rudDfEditUsername" maxlength="30" value="${escText(u.username || '')}" required></div>
      <div class="rud-df-admin-field"><label>Bio</label><textarea class="rud-df-admin-textarea" id="rudDfEditBio" maxlength="500">${escText(u.bio || '')}</textarea></div>
      <div class="rud-df-admin-field"><label>Deen focus</label><input class="rud-df-admin-input" id="rudDfEditFocus" maxlength="120" value="${escText(u.deenFocus || '')}"></div>
      <div class="rud-df-admin-field"><label>Current focus</label><input class="rud-df-admin-input" id="rudDfEditCurrentFocus" maxlength="120" value="${escText(u.currentFocus || '')}"></div>
      ${btn('Save profile', 'rudDfEditUserSave', 'primary')} <span id="rudDfEditUserStatus" class="rud-df-auth-status"></span>
    </form>`,
    );
    $('#rudDfEditUserSave').onclick = guarded(async () => {
      const b = $('#rudDfEditUserSave'),
        status = $('#rudDfEditUserStatus');
      b.disabled = true;
      b.textContent = 'Saving…';
      try {
        const name = String($('#rudDfEditName').value || '')
          .trim()
          .replace(/\s+/g, ' ');
        const username = String($('#rudDfEditUsername').value || '')
          .trim()
          .replace(/^@+/, '')
          .replace(/\s+/g, ' ');
        const usernameKey = rudDfAdminUsernameKey(username);
        if (name.length < 2 || name.length > 40) throw Error('Display name must contain 2 to 40 characters.');
        if (usernameKey.length < 3) throw Error('Username must contain at least 3 valid characters.');
        /* Existing (legacy) usernames may be kept as they are; a new or changed one must follow the V3 rule. */
        if (rudDfAdminKey(username) !== rudDfAdminKey(u.username || '')) {
          const unCheck = checkUsername(username);
          if (!unCheck.ok) throw Error(unCheck.message);
        }
        const newUid = String(uid),
          oldKey = rudDfAdminKey(u.username || '');
        await runTransaction(S.db, async (tx) => {
          const userRef = doc(S.db, 'deens_users', newUid),
            userSnap = await tx.get(userRef);
          if (!userSnap.exists()) throw Error('User profile no longer exists.');
          const usernameRef = doc(S.db, 'visitor_usernames', usernameKey),
            existing = await tx.get(usernameRef),
            owner = String(existing.data()?.ownerUid || '');
          if (existing.exists() && owner && owner !== newUid) throw Error('That username is already taken.');
          const data = userSnap.data() || {};
          tx.set(
            usernameRef,
            {
              visitorId: String(data.visitorId || u.visitorId || ''),
              ownerUid: newUid,
              name: username,
              nameKey: usernameKey,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
          tx.set(
            userRef,
            {
              displayName: name,
              name,
              username,
              usernameKey,
              bio: String($('#rudDfEditBio').value || '').trim(),
              deenFocus: String($('#rudDfEditFocus').value || '').trim(),
              currentFocus: String($('#rudDfEditCurrentFocus').value || '').trim(),
              updatedAt: serverTimestamp(),
              updatedBy: me.uid,
            },
            { merge: true },
          );
          if (oldKey && oldKey !== usernameKey) tx.delete(doc(S.db, 'visitor_usernames', oldKey));
        });
        await writeAudit('USER_PROFILE_UPDATED', uid, 'Super Admin modified the Deen Friends profile.');
        closeDrawer();
        invalidate('users');
        state.userManagementTab = 'accounts';
        await userManagement();
        toast('User profile updated.');
      } catch (e) {
        status.textContent = e.message || 'Unable to update profile.';
        b.disabled = false;
        b.textContent = 'Save profile';
      }
    });
  }

  async function adminChangeUserPasswordForm(uid) {
    const u = (await load('users')).find((x) => x.id === uid);
    if (!u?.email) throw Error('This user has no email address on the Deen Friends profile.');
    openDrawer(
      'Send password reset',
      `<div class="ruddm-reset-card"><p>Send a Firebase password-reset email to <strong>${escText(u.email)}</strong>. The Super Admin never sees or stores the password.</p>${btn('Send reset email', 'ruddmResetPassword', 'primary')}<span id="ruddmResetStatus" class="ruddm-status" aria-live="polite"></span></div>`,
    );
    $('#ruddmResetPassword').onclick = guarded(async () => {
      const b = $('#ruddmResetPassword'),
        st = $('#ruddmResetStatus');
      b.disabled = true;
      b.textContent = 'Sending…';
      try {
        await rudDfPasswordReset(u.email);
        await writeAudit('PASSWORD_RESET_REQUESTED', uid, 'Super Admin sent a password reset email.');
        st.className = 'ruddm-status success';
        st.textContent = 'Password reset email sent.';
        b.textContent = 'Sent';
      } catch (e) {
        st.className = 'ruddm-status error';
        st.textContent = e.message || 'Could not send reset email.';
        b.disabled = false;
        b.textContent = 'Send reset email';
      }
    });
  }
  async function userDetail(uid) {
    const u = (await load('users')).find((x) => x.id === uid);
    if (!u) return `<div class="rud-df-admin-panel"><div class="rud-df-admin-empty">User not found.</div></div>`;
    state.selectedUser = uid;
    const [reqs, friends, reports, blocks, appeals, restrictions, suspensions, activity, notes, changes] =
      await Promise.all([
        load('requests'),
        load('friendships'),
        load('reports'),
        load('blocks'),
        load('appeals'),
        load('restrictions'),
        load('suspensions'),
        load('activity'),
        load('notes'),
        load('usernameChanges'),
      ]);
    const uidSet = (x) =>
      x.uid === uid ||
      x.fromUid === uid ||
      x.toUid === uid ||
      x.reporterUid === uid ||
      x.reportedUid === uid ||
      x.blockerUid === uid ||
      x.blockedUid === uid ||
      x.adminUid === uid;
    const friendsN = friends.filter((x) => Array.isArray(x.members) && x.members.includes(uid)).length;
    const reqN = reqs.filter(uidSet).length,
      repN = reports.filter(uidSet).length,
      blockN = blocks.filter(uidSet).length;
    const st = suspensions.find((x) => x.uid === uid && x.active !== false),
      rr = restrictions.find((x) => x.uid === uid && x.active !== false);
    return `<div class="rud-df-admin-panel rud-df-admin-detail-card">
      <span class="rud-df-admin-detail-id">${escText(u.id)}</span>
      <h3>${escText(u.displayName || u.name || 'Unnamed')}</h3>
      <div class="rud-df-admin-detail-sub">@${escText(u.username || '—')} · ${pill(st ? 'SUSPENDED' : rr ? 'RESTRICTED' : 'ACTIVE')}</div>
      <div class="rud-df-admin-detail-grid">
        <div><small>Friends</small><b>${friendsN}</b></div><div><small>Requests</small><b>${reqN}</b></div>
        <div><small>Reports</small><b>${repN}</b></div><div><small>Blocks</small><b>${blockN}</b></div>
        <div><small>Appeals</small><b>${appeals.filter((x) => x.uid === uid).length}</b></div><div><small>Activity</small><b>${activity.filter((x) => x.uid === uid).length}</b></div>
      </div>
      <dl class="rud-df-admin-kv">
        <dt>UID</dt><dd>${escText(u.uid || u.id)}</dd><dt>Visitor ID</dt><dd>${escText(u.visitorId || '—')}</dd>
        <dt>Username key</dt><dd>${escText(u.usernameKey || '—')}</dd><dt>Created</dt><dd>${fmt(u.createdAt)}</dd>
        <dt>Updated</dt><dd>${fmt(u.updatedAt)}</dd><dt>Last active</dt><dd>${fmt(u.lastActiveAt)}</dd>
      </dl>
      <div class="rud-df-admin-actions" style="justify-content:flex-start;margin-top:14px">
        ${btn('Edit profile', 'rudDfEditUser', 'primary')}${btn('Inspect all records', 'rudDfInspectUser')}${btn('Change password', 'rudDfChangeUserPassword')}${btn('Delete user logs', 'rudDfDeleteUserLogs', 'danger')}${btn('Add admin note', 'rudDfAddNote')}
        ${btn(st ? 'Lift suspension' : 'Suspend user', st ? 'rudDfLiftSuspension' : 'rudDfSuspendUser', st ? 'success' : 'danger')}
        ${btn(rr ? 'Remove restriction' : 'Restrict user', rr ? 'rudDfLiftRestriction' : 'rudDfRestrictUser', rr ? 'success' : 'danger')}
        ${btn('Delete Deen Friends user', 'rudDfDeleteUser', 'danger')}
      </div>
      <div id="rudDfUserActionForm" style="margin-top:12px"></div>
    </div>`;
  }

  async function inspectUser(uid) {
    const [users, reqs, friends, msgs, reports, blocks, appeals, restrictions, suspensions, activity, notes, changes] =
      await Promise.all([
        load('users'),
        load('requests'),
        load('friendships'),
        load('messages'),
        load('reports'),
        load('blocks'),
        load('appeals'),
        load('restrictions'),
        load('suspensions'),
        load('activity'),
        load('notes'),
        load('usernameChanges'),
      ]);
    const related = (arr, keys) => arr.filter((x) => keys.some((k) => x?.[k] === uid));
    const relatedMsgs = msgs.filter((x) => x.senderUid === uid || x.recipientUid === uid);
    openDrawer(
      'User 360° record',
      `
      <div class="rud-df-admin-grid single">
        ${panel(
          'Identity',
          table(
            ['Field', 'Value'],
            Object.entries(users.find((x) => x.id === uid) || {})
              .map(
                ([k, v]) =>
                  `<tr><td>${escText(k)}</td><td class="rud-df-admin-code">${escText(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`,
              )
              .join(''),
          ),
        )}
        ${panel(
          'Requests / connections',
          table(
            ['Type', 'Record', 'Status', 'Time'],
            related(reqs, ['fromUid', 'toUid'])
              .map(
                (x) =>
                  `<tr><td>Request</td><td>${escText(x.fromUid)} → ${escText(x.toUid)}</td><td>${pill(x.status)}</td><td>${fmt(x.createdAt)}</td></tr>`,
              )
              .join('') +
              friends
                .filter((x) => x.members?.includes(uid))
                .map(
                  (x) =>
                    `<tr><td>Friendship</td><td>${escText((x.members || []).filter((v) => v !== uid).join(', '))}</td><td>${pill('accepted')}</td><td>${fmt(x.createdAt)}</td></tr>`,
                )
                .join(''),
          ),
        )}
        ${panel(
          'Messages involving user',
          table(
            ['Time', 'Sender', 'Recipient', 'Message'],
            relatedMsgs
              .sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt))
              .map(
                (x) =>
                  `<tr><td>${fmt(x.createdAt)}</td><td>${escText(x.senderUid)}</td><td>${escText(x.recipientUid)}</td><td><div class="rud-df-admin-message">${escText(x.text || x.message || x.body || '')}</div></td></tr>`,
              )
              .join(''),
            'No messages found.',
          ),
        )}
        ${panel(
          'Safety records',
          table(
            ['Collection', 'Status', 'Details', 'Time'],
            related(reports, ['reporterUid', 'reportedUid'])
              .map(
                (x) =>
                  `<tr><td>Report</td><td>${pill(x.status)}</td><td>${escText(x.category || x.reason || '')}</td><td>${fmt(x.createdAt)}</td></tr>`,
              )
              .join('') +
              related(blocks, ['blockerUid', 'blockedUid'])
                .map(
                  (x) =>
                    `<tr><td>Block</td><td>${pill(x.status)}</td><td>${escText(x.blockerUid)} → ${escText(x.blockedUid)}</td><td>${fmt(x.createdAt)}</td></tr>`,
                )
                .join('') +
              restrictions
                .filter((x) => x.uid === uid)
                .map(
                  (x) =>
                    `<tr><td>Restriction</td><td>${pill(x.active === false ? 'removed' : 'active')}</td><td>${escText(x.reason || '')}</td><td>${fmt(x.createdAt)}</td></tr>`,
                )
                .join('') +
              suspensions
                .filter((x) => x.uid === uid)
                .map(
                  (x) =>
                    `<tr><td>Suspension</td><td>${pill(x.active === false ? 'lifted' : 'active')}</td><td>${escText(x.reason || '')}</td><td>${fmt(x.createdAt)}</td></tr>`,
                )
                .join(''),
          ),
        )}
        ${panel(
          'Appeals / username changes / notes',
          table(
            ['Collection', 'Status', 'Text', 'Time'],
            appeals
              .filter((x) => x.uid === uid)
              .map(
                (x) =>
                  `<tr><td>Appeal</td><td>${pill(x.status)}</td><td>${escText(x.reason || '')}</td><td>${fmt(x.createdAt)}</td></tr>`,
              )
              .join('') +
              changes
                .filter((x) => x.uid === uid)
                .map(
                  (x) =>
                    `<tr><td>Username</td><td>${pill(x.status)}</td><td>${escText(x.currentUsername)} → ${escText(x.requestedUsername)}</td><td>${fmt(x.createdAt)}</td></tr>`,
                )
                .join('') +
              notes
                .filter((x) => x.uid === uid || x.userUid === uid)
                .map(
                  (x) =>
                    `<tr><td>Admin note</td><td>${pill('internal')}</td><td>${escText(x.note || x.text || '')}</td><td>${fmt(x.createdAt)}</td></tr>`,
                )
                .join(''),
          ),
        )}
      </div>`,
    );
  }

  async function connections() {
    const [friends, map] = await Promise.all([load('friendships'), userMap()]);
    const rows = filterRows(friends, ['id', 'friendshipId', 'members']).sort(
      (a, b) => stamp(b.updatedAt) - stamp(a.updatedAt),
    );
    body.innerHTML = head(
      'RELATIONSHIPS',
      'Connections',
      'Every accepted Deen Friends connection and its operational metadata.',
      btn('Refresh', 'rudDfConnectionsRefresh') + btn('Export CSV', 'rudDfConnectionsExport'),
    );
    body.innerHTML +=
      `<div class="rud-df-admin-toolbar"><input class="rud-df-admin-search" id="rudDfConnectionsSearch" value="${escText(state.search)}" placeholder="Search friendship ID or user UID"></div>` +
      table(
        ['Users', 'Friendship ID', 'Streak', 'Created', 'Updated', 'Actions'],
        rows
          .map((x) => {
            const members = Array.isArray(x.members) ? x.members : [];
            return `<tr><td><b>${escText(uname(members[0], map))}</b> ↔ <b>${escText(uname(members[1], map))}</b><br><span class="rud-df-admin-muted">${members.map(shortId).join(' · ')}</span></td><td class="rud-df-admin-code">${escText(x.id)}</td><td>${escText(x.streakCount ?? x.count ?? 0)}</td><td>${fmt(x.createdAt)}</td><td>${fmt(x.updatedAt)}</td><td>${mini('Messages', 'conversation', x.id)} ${mini('Clear activity', 'clearInteraction', x.id, 'danger')}</td></tr>`;
          })
          .join(''),
        'No friendships found.',
      );
    $('#rudDfConnectionsSearch').oninput = (e) => {
      state.search = e.target.value;
      connections();
    };
    $('#rudDfConnectionsRefresh').onclick = () => {
      invalidate('friendships');
      connections();
    };
    $('#rudDfConnectionsExport').onclick = () =>
      exportCSV(rows, ['id', 'members', 'streakCount', 'createdAt', 'updatedAt'], 'deen-friends-connections.csv');
  }

  async function requests() {
    const [reqs, map] = await Promise.all([load('requests'), userMap()]);
    const rows = filterRows(reqs, ['id', 'fromUid', 'toUid', 'status']).sort(
      (a, b) => stamp(b.createdAt) - stamp(a.createdAt),
    );
    body.innerHTML = head(
      'RELATIONSHIPS',
      'Friend Requests',
      'Review pending, accepted and declined friend requests.',
      btn('Refresh', 'rudDfRequestsRefresh') + btn('Export CSV', 'rudDfRequestsExport'),
    );
    body.innerHTML += `<div class="rud-df-admin-toolbar"><input class="rud-df-admin-search" id="rudDfRequestsSearch" value="${escText(state.search)}" placeholder="Search users, request ID or status"><select class="rud-df-admin-select" id="rudDfRequestsFilter"><option value="">All statuses</option><option>pending</option><option>accepted</option><option>declined</option></select></div>`;
    const statusFilter = () => $('#rudDfRequestsFilter')?.value || '';
    const render = () => {
      const rr = rows.filter((x) => !statusFilter() || x.status === statusFilter());
      const tbl = table(
        ['From', 'To', 'Status', 'Created', 'Actions'],
        rr
          .map(
            (x) =>
              `<tr><td>${escText(uname(x.fromUid, map))}<br><span class="rud-df-admin-muted">${shortId(x.fromUid)}</span></td><td>${escText(uname(x.toUid, map))}<br><span class="rud-df-admin-muted">${shortId(x.toUid)}</span></td><td>${pill(x.status)}</td><td>${fmt(x.createdAt)}</td><td><div class="rud-df-admin-row-actions">${x.status === 'pending' ? mini('Accept', 'requestAccept', x.id, 'success') + mini('Decline', 'requestDecline', x.id, 'danger') : ''}${mini('Audit', 'requestAudit', x.id)}</div></td></tr>`,
          )
          .join(''),
        'No requests found.',
      );
      const old = document.querySelector('#rudDfRequestsTable');
      if (old)
        old.outerHTML = tbl.replace(
          /^<div class="rud-df-admin-table-wrap"/,
          '<div id="rudDfRequestsTable" class="rud-df-admin-table-wrap"',
        );
      else $('#rudDfRequestsTableHost').innerHTML = tbl;
    };
    // Render the full table (with Accept / Decline for pending requests) from the start; before, the
    // first render showed only "Open" and the actions appeared only after changing the status filter.
    body.innerHTML += `<div id="rudDfRequestsTableHost"></div>`;
    render();
    $('#rudDfRequestsSearch').oninput = (e) => {
      state.search = e.target.value;
      requests();
    };
    $('#rudDfRequestsFilter').onchange = render;
    $('#rudDfRequestsRefresh').onclick = () => {
      invalidate('requests');
      requests();
    };
    $('#rudDfRequestsExport').onclick = () =>
      exportCSV(rows, ['id', 'fromUid', 'toUid', 'status', 'createdAt', 'updatedAt'], 'deen-friends-requests.csv');
  }

  async function usernameChanges() {
    const [rows, map] = await Promise.all([load('usernameChanges'), userMap()]);
    const rr = filterRows(rows, ['id', 'uid', 'currentUsername', 'requestedUsername', 'status']);
    body.innerHTML = head(
      'IDENTITY GOVERNANCE',
      'Username Changes',
      'Approve or reject username-change requests without touching the public Deen Friends interface.',
      btn('Refresh', 'rudDfUsernameRefresh') + btn('Export CSV', 'rudDfUsernameExport'),
    );
    body.innerHTML +=
      `<div class="rud-df-admin-toolbar"><input class="rud-df-admin-search" id="rudDfUsernameSearch" value="${escText(state.search)}" placeholder="Search username, UID or status"></div>` +
      table(
        ['User', 'Current', 'Requested', 'Reason', 'Status', 'Created', 'Actions'],
        rr
          .map(
            (x) =>
              `<tr><td>${escText(uname(x.uid, map))}<br><span class="rud-df-admin-code">${shortId(x.uid)}</span></td><td>@${escText(x.currentUsername)}</td><td>@${escText(x.requestedUsername)}</td><td>${escText(x.reason || '—')}</td><td>${pill(x.status)}</td><td>${fmt(x.createdAt)}</td><td>${x.status === 'pending' ? mini('Approve', 'usernameApprove', x.id, 'success') + mini('Reject', 'usernameReject', x.id, 'danger') : ''}</td></tr>`,
          )
          .join(''),
        'No username requests found.',
      );
    $('#rudDfUsernameSearch').oninput = (e) => {
      state.search = e.target.value;
      usernameChanges();
    };
    $('#rudDfUsernameRefresh').onclick = () => {
      invalidate('usernameChanges');
      usernameChanges();
    };
    $('#rudDfUsernameExport').onclick = () =>
      exportCSV(
        rr,
        ['id', 'uid', 'currentUsername', 'requestedUsername', 'reason', 'status', 'createdAt'],
        'deen-friends-username-changes.csv',
      );
  }

  async function adminMessages() {
    const [msgs, map] = await Promise.all([load('messages'), userMap()]);
    let rows = filterRows(msgs, ['id', 'friendshipId', 'senderUid', 'recipientUid', 'text', 'message', 'body']).sort(
      (a, b) => stamp(b.createdAt) - stamp(a.createdAt),
    );
    const convs = [...new Set(rows.map((x) => x.friendshipId).filter(Boolean))];
    body.innerHTML = head(
      'PRIVATE CONVERSATIONS',
      'Messages',
      'Super Admin message investigation view. All loaded message records are private operational data.',
      btn('Refresh', 'rudDfMessagesRefresh') + btn('Export CSV', 'rudDfMessagesExport'),
    );
    body.innerHTML += `<div class="rud-df-admin-alert" style="margin-bottom:12px">Use message access only for legitimate safety, support or administrative purposes. Access is audit logged.</div>
      <div class="rud-df-admin-toolbar"><input class="rud-df-admin-search" id="rudDfMessagesSearch" value="${escText(state.search)}" placeholder="Search message text, conversation or user UID"><select class="rud-df-admin-select" id="rudDfConversationFilter"><option value="">All conversations</option>${convs.map((c) => `<option value="${escText(c)}">${escText(shortId(c))}</option>`).join('')}</select></div>`;
    const render = () => {
      const q = state.search.toLowerCase();
      let r = rows.filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q));
      const c = $('#rudDfConversationFilter')?.value;
      if (c) r = r.filter((x) => x.friendshipId === c);
      $('#rudDfMessagesHost').innerHTML = table(
        ['Time', 'Conversation', 'Sender', 'Recipient', 'Message', 'Actions'],
        r
          .map(
            (x) =>
              `<tr><td>${fmt(x.createdAt)}</td><td class="rud-df-admin-code">${shortId(x.friendshipId)}</td><td>${escText(uname(x.senderUid, map))}</td><td>${escText(uname(x.recipientUid, map))}</td><td><div class="rud-df-admin-message">${escText(x.text || x.message || x.body || '')}</div></td><td>${mini('Open', 'messageOpen', x.id)}</td></tr>`,
          )
          .join(''),
        'No messages found.',
      );
    };
    body.innerHTML += `<div id="rudDfMessagesHost"></div>`;
    render();
    $('#rudDfMessagesSearch').oninput = (e) => {
      state.search = e.target.value;
      render();
    };
    $('#rudDfConversationFilter').onchange = render;
    $('#rudDfMessagesRefresh').onclick = () => {
      invalidate('messages');
      adminMessages();
    };
    $('#rudDfMessagesExport').onclick = () =>
      exportCSV(
        rows,
        ['id', 'friendshipId', 'senderUid', 'recipientUid', 'text', 'message', 'body', 'createdAt'],
        'deen-friends-messages.csv',
      );
  }

  async function safety() {
    const [reports, cases, blocks, appeals, risk, evidence, restrictions, suspensions, privateAccessLogs] =
      await Promise.all([
        load('reports'),
        load('cases'),
        load('blocks'),
        load('appeals'),
        load('riskSignals'),
        load('evidence'),
        load('restrictions'),
        load('suspensions'),
        load('privateAccessLogs'),
      ]);
    const [map] = await Promise.all([userMap()]);
    body.innerHTML = head(
      'TRUST & SAFETY',
      'Safety Operations',
      'Reports, moderation cases, blocks, appeals, restrictions and risk signals in one investigation workspace.',
      btn('Refresh', 'rudDfSafetyRefresh') + btn('Export', 'rudDfSafetyExport'),
    );
    body.innerHTML += `<div class="rud-df-admin-stats">${metric('Reports', reports.length)}${metric('Open cases', cases.filter((x) => !['resolved', 'closed'].includes(String(x.status || '').toLowerCase())).length)}${metric('Blocks', blocks.length)}${metric('Appeals', appeals.length)}${metric('Risk signals', risk.length)}${metric('Evidence', evidence.length)}</div>`;
    const section = (title, headers, rows) => panel(title, table(headers, rows));
    body.innerHTML += `<div class="rud-df-admin-grid single">
      ${section(
        'Reports',
        ['Reporter', 'Reported user', 'Category', 'Status', 'Reason', 'Created'],
        reports
          .sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt))
          .map(
            (x) =>
              `<tr><td>${escText(uname(x.reporterUid, map))}</td><td>${escText(uname(x.reportedUid, map))}</td><td>${pill(x.category)}</td><td>${pill(x.status)}</td><td>${escText(x.reason || '')}</td><td>${fmt(x.createdAt)}</td></tr>`,
          )
          .join(''),
      )}
      ${section('Moderation cases', ['Case', 'User', 'Type', 'Status', 'Priority', 'Created', 'Actions'], cases.map((x) => `<tr><td class="rud-df-admin-code">${escText(x.id)}</td><td>${escText(uname(x.uid || x.reportedUid, map))}</td><td>${escText(x.type || x.category || '—')}</td><td>${pill(x.status)}</td><td>${pill(x.priority || 'normal')}</td><td>${fmt(x.createdAt)}</td><td>${mini('Update', 'caseUpdate', x.id)}</td></tr>`).join(''))}
      ${section('Blocks', ['Blocker', 'Blocked', 'Status', 'Created', 'Updated', 'Actions'], blocks.map((x) => `<tr><td>${escText(uname(x.blockerUid, map))}</td><td>${escText(uname(x.blockedUid, map))}</td><td>${pill(x.status)}</td><td>${fmt(x.createdAt)}</td><td>${fmt(x.updatedAt)}</td><td>${x.status === 'active' ? mini('Remove', 'blockRemove', x.id, 'danger') : ''}</td></tr>`).join(''))}
      ${section('Appeals', ['User', 'Status', 'Reason', 'Created', 'Actions'], appeals.map((x) => `<tr><td>${escText(uname(x.uid, map))}</td><td>${pill(x.status)}</td><td>${escText(x.reason || '')}</td><td>${fmt(x.createdAt)}</td><td>${mini('Review', 'appealReview', x.id)}</td></tr>`).join(''))}
      ${section('Restrictions', ['User', 'Status', 'Reason', 'Created'], restrictions.map((x) => `<tr><td>${escText(uname(x.uid, map))}</td><td>${pill(x.active === false ? 'removed' : 'active')}</td><td>${escText(x.reason || '')}</td><td>${fmt(x.createdAt)}</td></tr>`).join(''))}
      ${section('Suspensions', ['User', 'Status', 'Reason', 'Ends', 'Created'], suspensions.map((x) => `<tr><td>${escText(uname(x.uid, map))}</td><td>${pill(x.active === false ? 'lifted' : 'active')}</td><td>${escText(x.reason || '')}</td><td>${fmt(x.endsAt)}</td><td>${fmt(x.createdAt)}</td></tr>`).join(''))}
      ${section('Private chat access logs', ['Admin', 'Conversation', 'Case', 'Reason', 'Time'], privateAccessLogs.map((x) => `<tr><td>${escText(x.adminUid)}</td><td class="rud-df-admin-code">${escText(x.conversationId || '—')}</td><td>${escText(x.caseId || '—')}</td><td>${escText(x.reason || '')}</td><td>${fmt(x.timestamp)}</td></tr>`).join(''))}
      ${section('Risk signals', ['User', 'Signal', 'Severity', 'Status', 'Created'], risk.map((x) => `<tr><td>${escText(uname(x.uid, map))}</td><td>${escText(x.signalType || x.type || '—')}</td><td>${pill(x.severity || 'normal')}</td><td>${pill(x.status || 'review')}</td><td>${fmt(x.createdAt)}</td></tr>`).join(''))}
    </div>`;
    $('#rudDfSafetyRefresh').onclick = () => {
      invalidate('reports', 'cases', 'blocks', 'appeals', 'riskSignals', 'evidence');
      safety();
    };
    $('#rudDfSafetyExport').onclick = () =>
      exportJSON({ reports, cases, blocks, appeals, riskSignals: risk, evidence }, 'deen-friends-safety');
  }

  async function activity() {
    const [rows, map] = await Promise.all([load('activity'), userMap()]);
    const rr = filterRows(rows, ['id', 'uid', 'eventType', 'route', 'action', 'source']).sort(
      (a, b) => stamp(b.createdAt) - stamp(a.createdAt),
    );
    body.innerHTML = head(
      'OBSERVABILITY',
      'Activity Logs',
      'Read-only activity records for operational investigation.',
      btn('Delete all activity logs', 'rudDfActivityDelete', 'danger') +
        btn('Refresh', 'rudDfActivityRefresh') +
        btn('Export CSV', 'rudDfActivityExport'),
    );
    body.innerHTML +=
      `<div class="rud-df-admin-toolbar"><input class="rud-df-admin-search" id="rudDfActivitySearch" value="${escText(state.search)}" placeholder="Search UID, event, route or action"></div>` +
      table(
        ['Time', 'User', 'Event', 'Route', 'Source', 'Details'],
        rr
          .map(
            (x) =>
              `<tr><td>${fmt(x.createdAt)}</td><td>${escText(uname(x.uid, map))}<br><span class="rud-df-admin-code">${shortId(x.uid)}</span></td><td>${escText(x.eventType || x.action || '—')}</td><td>${escText(x.route || '—')}</td><td>${escText(x.source || '—')}</td><td class="rud-df-admin-code">${escText(JSON.stringify(x.details || x.metadata || {}))}</td></tr>`,
          )
          .join(''),
        'No activity logs found.',
      );
    $('#rudDfActivitySearch').oninput = (e) => {
      state.search = e.target.value;
      activity();
    };
    $('#rudDfActivityDelete').onclick = guarded(async () => {
      if (
        !rr.length ||
        !confirm('Permanently delete all currently loaded Deen Friends activity logs? This cannot be undone.')
      )
        return;
      for (let i = 0; i < rr.length; i += 450) {
        const b = writeBatch(S.db);
        rr.slice(i, i + 450).forEach((x) => b.delete(doc(S.db, 'deens_activity_logs', x.id)));
        await b.commit();
      }
      await writeAudit('ACTIVITY_LOGS_DELETED', 'ALL', 'Super Admin deleted Deen Friends activity logs.');
      invalidate('activity');
      activity();
      toast('Activity logs deleted.');
    });
    $('#rudDfActivityRefresh').onclick = () => {
      invalidate('activity');
      activity();
    };
    $('#rudDfActivityExport').onclick = () =>
      exportCSV(
        rr,
        ['id', 'uid', 'eventType', 'route', 'source', 'createdAt', 'details', 'metadata'],
        'deen-friends-activity.csv',
      );
  }

  async function analytics() {
    const rows = await load('analytics');
    body.innerHTML = head(
      'MEASUREMENT',
      'Analytics',
      'Stored Deen Friends analytics records. No new analytics data is generated by this console.',
      btn('Refresh', 'rudDfAnalyticsRefresh') + btn('Export', 'rudDfAnalyticsExport'),
    );
    body.innerHTML += table(
      ['Record', 'Metric', 'Value', 'Period', 'Updated'],
      rows
        .sort((a, b) => stamp(b.updatedAt) - stamp(a.updatedAt))
        .map(
          (x) =>
            `<tr><td class="rud-df-admin-code">${escText(x.id)}</td><td>${escText(x.metric || x.key || '—')}</td><td class="rud-df-admin-code">${escText(typeof x.value === 'object' ? JSON.stringify(x.value) : x.value)}</td><td>${escText(x.period || x.date || '—')}</td><td>${fmt(x.updatedAt)}</td></tr>`,
        )
        .join(''),
      'No analytics records found.',
    );
    $('#rudDfAnalyticsRefresh').onclick = () => {
      invalidate('analytics');
      analytics();
    };
    $('#rudDfAnalyticsExport').onclick = () => exportJSON(rows, 'deen-friends-analytics');
  }

  async function notices() {
    const rows = await load('notices');
    body.innerHTML = head(
      'COMMUNITY COMMUNICATION',
      'Community Notices',
      'Manage Deen Friends notices without touching the rest of Rise Upon Deen content.',
      btn('Create notice', 'rudDfNewNotice', 'primary') + btn('Refresh', 'rudDfNoticesRefresh'),
    );
    body.innerHTML += table(
      ['Title', 'Status', 'Published', 'Created', 'Updated', 'Actions'],
      rows
        .sort((a, b) => stamp(b.updatedAt || b.createdAt) - stamp(a.updatedAt || a.createdAt))
        .map(
          (x) =>
            `<tr><td><b>${escText(x.title || 'Untitled')}</b><br><span class="rud-df-admin-muted">${escText(x.message || '')}</span></td><td>${pill(x.status || 'draft')}</td><td>${x.published === true ? pill('published') : pill('draft')}</td><td>${fmt(x.createdAt)}</td><td>${fmt(x.updatedAt)}</td><td>${mini('Edit', 'noticeEdit', x.id)}${mini('Delete', 'noticeDelete', x.id, 'danger')}</td></tr>`,
        )
        .join(''),
      'No notices found.',
    );
    $('#rudDfNewNotice').onclick = () => noticeForm();
    $('#rudDfNoticesRefresh').onclick = () => {
      invalidate('notices');
      notices();
    };
  }

  function noticeForm(existing = null) {
    openDrawer(
      existing ? 'Edit notice' : 'Create notice',
      `<form class="rud-df-admin-form" id="rudDfNoticeForm">
      <div class="rud-df-admin-field"><label>Title</label><input class="rud-df-admin-input" id="rudDfNoticeTitle" value="${escText(existing?.title || '')}" required></div>
      <div class="rud-df-admin-field"><label>Message</label><textarea class="rud-df-admin-textarea" id="rudDfNoticeMessage" required>${escText(existing?.message || '')}</textarea></div>
      <label class="rud-df-admin-check"><input type="checkbox" id="rudDfNoticePublished" ${existing?.published === true ? 'checked' : ''}> Publish to Deen Friends</label>
      <div class="rud-df-admin-actions" style="justify-content:flex-start">${btn(existing ? 'Save changes' : 'Create notice', 'rudDfNoticeSave', 'primary')}</div>
    </form>`,
    );
    $('#rudDfNoticeForm').onsubmit = (e) => e.preventDefault();
    $('#rudDfNoticeSave').onclick = guarded(async () => {
      const title = $('#rudDfNoticeTitle').value.trim(),
        message = $('#rudDfNoticeMessage').value.trim(),
        published = $('#rudDfNoticePublished').checked;
      if (!title || !message) return toast('Title and message are required.', 'error');
      try {
        const data = {
          title,
          message,
          published,
          status: published ? 'published' : 'draft',
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
        };
        if (existing) await updateDoc(doc(S.db, 'deens_community_notices', existing.id), data);
        else
          await addDoc(collection(S.db, 'deens_community_notices'), {
            ...data,
            createdAt: serverTimestamp(),
            createdAtMs: Date.now(),
            createdBy: me.uid,
          });
        await writeAudit(existing ? 'NOTICE_UPDATED' : 'NOTICE_CREATED', existing?.id || title);
        closeDrawer();
        invalidate('notices');
        notices();
        toast('Notice saved.');
      } catch (e) {
        console.error(e);
        toast('Unable to save notice. Check Firestore rules.', 'error');
      }
    });
  }

  async function settings() {
    const rows = await load('settings');
    body.innerHTML = head(
      'SYSTEM GOVERNANCE',
      'Settings',
      'Read and manage only Deen Friends admin settings stored in the dedicated settings collection.',
      btn('New setting', 'rudDfNewSetting', 'primary') + btn('Refresh', 'rudDfSettingsRefresh'),
    );
    body.innerHTML += table(
      ['Key', 'Value', 'Updated', 'Actions'],
      rows
        .map(
          (x) =>
            `<tr><td class="rud-df-admin-code">${escText(x.id || x.key)}</td><td class="rud-df-admin-code">${escText(JSON.stringify(x.value ?? x))}</td><td>${fmt(x.updatedAt)}</td><td>${mini('Edit', 'settingEdit', x.id)}${mini('Delete', 'settingDelete', x.id, 'danger')}</td></tr>`,
        )
        .join(''),
      'No Deen Friends settings found.',
    );
    $('#rudDfNewSetting').onclick = () => settingForm();
    $('#rudDfSettingsRefresh').onclick = () => {
      invalidate('settings');
      settings();
    };
  }
  function settingForm(existing = null) {
    openDrawer(
      existing ? 'Edit setting' : 'Create setting',
      `<form class="rud-df-admin-form">
      <div class="rud-df-admin-field"><label>Key</label><input class="rud-df-admin-input" id="rudDfSettingKey" value="${escText(existing?.id || existing?.key || '')}" ${existing ? 'readonly' : ''}></div>
      <div class="rud-df-admin-field"><label>Value JSON</label><textarea class="rud-df-admin-textarea" id="rudDfSettingValue">${escText(JSON.stringify(existing?.value ?? existing?.config ?? {}, null, 2))}</textarea></div>
      ${btn('Save', 'rudDfSettingSave', 'primary')}
    </form>`,
    );
    $('#rudDfSettingSave').onclick = guarded(async () => {
      const key = $('#rudDfSettingKey').value.trim(),
        raw = $('#rudDfSettingValue').value.trim();
      if (!key) return toast('A key is required.', 'error');
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        return toast('Value must be valid JSON.', 'error');
      }
      try {
        await setDoc(
          doc(S.db, 'deens_admin_settings', key),
          { key, value, updatedAt: serverTimestamp(), updatedAtMs: Date.now(), updatedBy: me.uid },
          { merge: true },
        );
        await writeAudit(existing ? 'SETTING_UPDATED' : 'SETTING_CREATED', key);
        closeDrawer();
        invalidate('settings');
        settings();
        toast('Setting saved.');
      } catch (e) {
        toast('Unable to save setting. Check Firestore rules.', 'error');
      }
    });
  }

  async function audit() {
    const rows = filterRows(
      (await load('audit')).sort((a, b) => stamp(b.timestamp || b.timestampMs) - stamp(a.timestamp || a.timestampMs)),
      ['id', 'adminUid', 'adminEmail', 'action', 'target', 'reason'],
    );
    body.innerHTML = head(
      'IMMUTABLE GOVERNANCE',
      'Admin Audit Logs',
      'Every Deen Friends admin mutation written by this console is recorded here. Logs are read-only.',
      btn('Delete all audit logs', 'rudDfAuditDelete', 'danger') +
        btn('Refresh', 'rudDfAuditRefresh') +
        btn('Export CSV', 'rudDfAuditExport'),
    );
    body.innerHTML +=
      `<div class="rud-df-admin-toolbar"><input class="rud-df-admin-search" id="rudDfAuditSearch" value="${escText(state.search)}" placeholder="Search action, target, admin or reason"></div>` +
      table(
        ['Time', 'Admin', 'Action', 'Target', 'Reason'],
        rows
          .map(
            (x) =>
              `<tr><td>${fmt(x.timestamp || x.timestampMs)}</td><td>${escText(x.adminEmail || shortId(x.adminUid))}</td><td>${pill(x.action)}</td><td class="rud-df-admin-code">${escText(x.target || '—')}</td><td>${escText(x.reason || '—')}</td></tr>`,
          )
          .join(''),
        'No audit logs found.',
      );
    $('#rudDfAuditSearch').oninput = (e) => {
      state.search = e.target.value;
      audit();
    };
    $('#rudDfAuditDelete').onclick = guarded(async () => {
      if (
        !rows.length ||
        !confirm(
          'Permanently delete ALL Deen Friends admin audit logs? This removes the audit history and cannot be undone. Continue?',
        )
      )
        return;
      for (let i = 0; i < rows.length; i += 450) {
        const b = writeBatch(S.db);
        rows.slice(i, i + 450).forEach((x) => b.delete(doc(S.db, 'deens_admin_audit_logs', x.id)));
        await b.commit();
      }
      invalidate('audit');
      audit();
      toast('Admin audit logs deleted.');
    });
    $('#rudDfAuditRefresh').onclick = () => {
      invalidate('audit');
      audit();
    };
    $('#rudDfAuditExport').onclick = () =>
      exportCSV(
        rows,
        ['id', 'adminUid', 'adminEmail', 'action', 'target', 'reason', 'timestamp', 'timestampMs'],
        'deen-friends-admin-audit.csv',
      );
  }

  async function renderTab(force = false) {
    closeSide();
    $('#rudDfAdminTopTitle').textContent =
      {
        command: 'Command Center',
        'user-management': 'User Management',
        connections: 'Connections',
        requests: 'Friend Requests',
        username: 'Username Changes',
        messages: 'Messages',
        safety: 'Trust & Safety',
        activity: 'Activity Logs',
        analytics: 'Analytics',
        notices: 'Community Notices',
        settings: 'Settings',
        audit: 'Admin Audit Logs',
      }[state.tab] || 'Command Center';
    const fn =
      {
        command,
        'user-management': userManagement,
        connections,
        requests,
        username: usernameChanges,
        messages: adminMessages,
        safety,
        activity,
        analytics,
        notices,
        settings,
        audit,
      }[state.tab] || command;
    try {
      await fn(force);
    } catch (e) {
      console.error(e);
      body.innerHTML = `<div class="rud-df-admin-alert">Unable to load this admin section. Check Firestore rules and the signed-in Super Admin account.<br><br><span class="rud-df-admin-code">${escText(e?.message || e)}</span></div>`;
    }
  }
  const go = (tab) => {
    state.tab = tab;
    state.search = '';
    main.querySelectorAll('[data-df-tab]').forEach((b) => b.classList.toggle('active', b.dataset.dfTab === tab));
    renderTab();
  };
  const exportCSV = (rows, keys, name) => {
    const csv = [
      keys,
      ...rows.map((r) =>
        keys.map((k) => {
          const v = r?.[k];
          return JSON.stringify(typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? ''));
        }),
      ),
    ]
      .map((r) => r.join(','))
      .join('\n');
    downloadText(csv, name, 'text/csv;charset=utf-8');
  };
  const exportJSON = (data, name) =>
    downloadText(JSON.stringify(data, null, 2), name + '.json', 'application/json;charset=utf-8');
  const downloadText = (text, name, type) => {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  /* V3.5 — real deletion. The browser cannot delete another person's login account and should not
     sweep every collection, so the Super Admin queues a request in deens_admin_jobs (only the Super
     Admin may create one — firestore.rules) and the trusted scheduler (push-scheduler/adminJobs.js,
     Admin SDK) deletes the member's whole Deen Friends footprint and their login within ~5 minutes.
     Their access is switched off immediately. Safety records (reports, cases, evidence, restrictions,
     suspensions, appeals, risk signals, admin notes, connection history) and the audit log are kept. */
  const DELETION_REMOVES = [
    'Profile, username and public card',
    'Friendships, friend requests, blocks and shared streaks',
    'All messages in their one-to-one chats (both sides) and their circle messages',
    'Their RISE conversation and notification devices',
    'Streak, daily activity, leaderboard entries and challenge progress (and challenges they created)',
    'Their place in circles and monthly-winner announcements',
    'Their Deen Friends activity logs and pending username requests',
    'Their login account (email and password)',
  ];
  const DELETION_KEEPS = [
    'Reports, moderation cases, evidence, restrictions, suspensions and appeals',
    'Risk signals, admin notes, connection history and the admin audit log',
    'Everything belonging to other members',
  ];

  /** Shows the deletion confirmation in the drawer. Resolves true only after the username is typed. */
  function confirmDeletion(uid, profile) {
    const username = String(profile.username || '').trim();
    const name = String(profile.displayName || profile.name || username || uid);
    return new Promise((resolve) => {
      openDrawer(
        'Delete Deen Friends member',
        `<div class="rud-df-admin-delete" role="group" aria-label="Confirm member deletion">
          <p class="rud-df-admin-note"><b>${escText(name)}</b>${username ? ` · @${escText(username)}` : ''}<br><span class="rud-df-admin-code">${escText(uid)}</span></p>
          <h4>Permanently removed</h4><ul>${DELETION_REMOVES.map((x) => `<li>${escText(x)}</li>`).join('')}</ul>
          <h4>Kept</h4><ul>${DELETION_KEEPS.map((x) => `<li>${escText(x)}</li>`).join('')}</ul>
          <p class="rud-df-admin-muted">Their access stops now. The deletion itself runs on the secure scheduler and finishes within about 5 minutes. This cannot be undone.</p>
          <div class="rud-df-admin-field"><label for="rudDfDeleteConfirmInput">Type <b>${escText(username || uid)}</b> to confirm</label><input class="rud-df-admin-input" id="rudDfDeleteConfirmInput" autocomplete="off" spellcheck="false"></div>
          <div class="rud-df-admin-actions" style="justify-content:flex-start">${btn('Delete member permanently', 'rudDfDeleteConfirmGo', 'danger')}${btn('Cancel', 'rudDfDeleteConfirmCancel')}</div>
        </div>`,
      );
      const input = $('#rudDfDeleteConfirmInput');
      const go = $('#rudDfDeleteConfirmGo');
      const expected = (username || uid).toLowerCase();
      go.disabled = true;
      input.addEventListener('input', () => (go.disabled = input.value.trim().toLowerCase() !== expected));
      const finish = (value) => {
        closeDrawer();
        resolve(value);
      };
      go.addEventListener('click', () => !go.disabled && finish(true), { once: true });
      $('#rudDfDeleteConfirmCancel').addEventListener('click', () => finish(false), { once: true });
      input.focus();
    });
  }

  async function deleteDeenUser(uid) {
    uid = String(uid || '').trim();
    if (!uid) throw Error('User UID is required.');
    if (uid === String(me.uid)) throw Error('The Super Admin account cannot be deleted here.');
    const profileRef = doc(S.db, 'deens_users', uid);
    const profileSnap = await getDoc(profileRef);
    if (!profileSnap.exists()) throw Error('The Deen Friends profile no longer exists.');
    // One request at a time per member (double taps, two open consoles).
    const pending = await getDocs(query(collection(S.db, 'deens_admin_jobs'), where('targetUid', '==', uid), limit(10)));
    if (pending.docs.some((d) => ['queued', 'running'].includes(d.data()?.status)))
      throw Error('A deletion for this member is already in progress.');
    if (!(await confirmDeletion(uid, profileSnap.data() || {}))) return false;
    try {
      await setDoc(
        profileRef,
        { deenFriendsAccessDisabled: true, disabledAt: serverTimestamp(), disabledBy: me.uid, deletionRequestedAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true },
      );
      const jobRef = doc(collection(S.db, 'deens_admin_jobs'));
      await setDoc(jobRef, {
        type: 'deleteDeenUser',
        targetUid: uid,
        requestedBy: me.uid,
        requestedByEmail: me.email || '',
        status: 'queued',
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
      });
      await writeAudit('USER_DELETION_REQUESTED', uid, 'Super Admin requested permanent deletion of a Deen Friends member and login.', { jobId: jobRef.id });
      state.selectedUser = null;
      invalidate('users');
      state.userManagementTab = 'accounts';
      await userManagement();
      toast('Deletion queued. Access is off now; the account and data are removed within about 5 minutes.');
      return true;
    } catch (e) {
      throw Error(adminErrorMessage(e) || 'Could not queue the deletion.');
    }
  }

  async function deleteDeenUserLogs(uid) {
    const linked = [
      ['deens_activity_logs', 'uid'],
      ['deens_admin_user_notes', 'uid'],
      ['deens_admin_user_notes', 'userUid'],
      ['deens_risk_signals', 'uid'],
      ['deens_risk_signals', 'userUid'],
      ['deens_risk_signals', 'reportedUid'],
      ['deens_case_evidence', 'uid'],
      ['deens_case_evidence', 'userUid'],
      ['deens_case_evidence', 'reportedUid'],
      ['deens_private_chat_access_logs', 'uid'],
      ['deens_private_chat_access_logs', 'userUid'],
    ];
    let deleted = 0;
    for (const [c, f] of linked) {
      try {
        const snap = await getDocs(query(collection(S.db, c), where(f, '==', uid)));
        for (let i = 0; i < snap.docs.length; i += 450) {
          const b = writeBatch(S.db);
          snap.docs.slice(i, i + 450).forEach((d) => b.delete(d.ref));
          await b.commit();
          deleted += Math.min(450, snap.docs.length - i);
        }
      } catch (e) {
        console.warn('[Deen Friends Admin] log cleanup skipped', c, f, e);
      }
    }
    await writeAudit('USER_LOGS_DELETED', uid, 'Super Admin deleted user-linked Deen Friends logs.', {
      deletedRecords: deleted,
    });
    invalidate('activity', 'notes', 'riskSignals', 'evidence', 'privateAccessLogs');
  }

  async function conversationRows(fid) {
    const snap = await getDocs(
      query(collection(S.db, collections.messages), where('friendshipId', '==', String(fid)), limit(300)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  }
  /* Clear ONE interaction: targeted, batched (400/commit), audit-logged. Friendship, profiles and the streak are untouched.
     Open clients receive Firestore 'removed' changes and drop the cards live. */
  async function clearInteraction(fid) {
    fid = String(fid || '').trim();
    if (!fid) throw Error('Friendship ID is required.');
    const q = () => query(collection(S.db, collections.messages), where('friendshipId', '==', fid), limit(400));
    let snap = await getDocs(q());
    if (!snap.docs.length) {
      toast('This interaction has no activity to clear.');
      return 0;
    }
    const oldest = Math.min(...snap.docs.map((d) => Number(d.data().createdAtMs) || Date.now()));
    if (
      !confirm(
        `Are you sure you want to clear this Deen Friend activity?\n\nFriendship: ${fid}\nActivity records: ${snap.docs.length}${snap.docs.length === 400 ? '+' : ''}\nOldest: ${new Date(oldest).toLocaleString()}\n\nThis permanently deletes the shared Qur'an / Dua / Hadith / Zikr cards, challenges, check-ins and encouragements in this interaction. The friendship, both profiles and the shared streak are NOT affected.`,
      )
    )
      return 0;
    let deleted = 0;
    while (snap.docs.length) {
      const b = writeBatch(S.db);
      snap.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
      deleted += snap.docs.length;
      if (snap.docs.length < 400) break;
      snap = await getDocs(q());
    }
    await writeAudit('DEEN_INTERACTION_CLEARED', fid, 'Admin cleared Deen Friend activity for one friendship.', {
      scope: 'friendship',
      deletedRecords: deleted,
    });
    invalidate('messages', 'audit');
    toast(`${deleted} activity record${deleted === 1 ? '' : 's'} cleared.`);
    return deleted;
  }

  // One delegated handler for all Deen Friends Admin actions.
  main.addEventListener(
    'click',
    guarded(async (e) => {
      if (e.target.closest?.('#rudDfAdminMenu')) {
        $('#rudDfAdminSide')?.classList.toggle('open');
        return;
      }
      if (e.target.closest?.('#rudDfAdminDrawerClose')) {
        closeDrawer();
        return;
      }
      if (e.target.closest?.('[data-df-action="userDelete"]')) {
        const uid = e.target.closest('[data-df-action="userDelete"]').dataset.id;
        const b = e.target.closest('button');
        if (b) b.disabled = true;
        try {
          await deleteDeenUser(uid);
        } catch (err) {
          if (b) b.disabled = false;
          toast(err.message || 'Unable to delete user.', 'error');
        }
        return;
      }
      if (e.target.id === 'rudDfEditUser' && state.selectedUser) {
        await adminEditUserForm(state.selectedUser);
        return;
      }
      if (e.target.id === 'rudDfInspectUser' && state.selectedUser) {
        inspectUser(state.selectedUser);
        return;
      }
      if (e.target.id === 'rudDfChangeUserPassword' && state.selectedUser) {
        adminChangeUserPasswordForm(state.selectedUser);
        return;
      }
      if (e.target.id === 'rudDfDeleteUserLogs' && state.selectedUser) {
        const uid = String(state.selectedUser);
        if (
          !confirm('Delete all Deen Friends logs and investigation notes linked to this user? This cannot be undone.')
        )
          return;
        try {
          await deleteDeenUserLogs(uid);
          state.userManagementTab = 'accounts';
          userManagement();
          toast('User-linked logs deleted.');
        } catch (err) {
          toast(err.message || 'Unable to delete user logs.', 'error');
        }
        return;
      }
      if (e.target.id === 'rudDfAddNote' && state.selectedUser) {
        openDrawer(
          'Add internal admin note',
          `<form class="rud-df-admin-form"><div class="rud-df-admin-field"><label>Internal note</label><textarea class="rud-df-admin-textarea" id="rudDfNoteText"></textarea></div>${btn('Save note', 'rudDfNoteSave', 'primary')}</form>`,
        );
        $('#rudDfNoteSave').onclick = guarded(async () => {
          const note = $('#rudDfNoteText').value.trim();
          if (!note) return toast('Enter a note.', 'error');
          await addDoc(collection(S.db, 'deens_admin_user_notes'), {
            uid: state.selectedUser,
            userUid: state.selectedUser,
            note,
            createdBy: me.uid,
            createdByEmail: me.email || '',
            createdAt: serverTimestamp(),
            createdAtMs: Date.now(),
          });
          await writeAudit('USER_NOTE_CREATED', state.selectedUser);
          closeDrawer();
          invalidate('notes');
          users();
          toast('Internal note saved.');
        });
        return;
      }
      if (e.target.id === 'rudDfSuspendUser' && state.selectedUser) {
        openDrawer(
          'Suspend user',
          `<form class="rud-df-admin-form"><div class="rud-df-admin-field"><label>Reason</label><textarea class="rud-df-admin-textarea" id="rudDfSuspendReason"></textarea></div><div class="rud-df-admin-field"><label>End time (optional)</label><input type="datetime-local" class="rud-df-admin-input" id="rudDfSuspendUntil"></div>${btn('Suspend', 'rudDfSuspendSave', 'danger')}</form>`,
        );
        $('#rudDfSuspendSave').onclick = guarded(async () => {
          const reason = $('#rudDfSuspendReason').value.trim();
          if (!reason) return toast('Reason is required.', 'error');
          const raw = $('#rudDfSuspendUntil').value;
          const end = raw ? new Date(raw) : null;
          await setDoc(
            doc(S.db, 'deens_user_suspensions', state.selectedUser),
            {
              uid: state.selectedUser,
              active: true,
              reason,
              createdBy: me.uid,
              createdAt: serverTimestamp(),
              createdAtMs: Date.now(),
              endsAt: end || null,
            },
            { merge: true },
          );
          await writeAudit('USER_SUSPENDED', state.selectedUser, reason);
          closeDrawer();
          invalidate('suspensions');
          state.userManagementTab = 'accounts';
          userManagement();
          toast('User suspended.');
        });
        return;
      }
      if (e.target.id === 'rudDfLiftSuspension' && state.selectedUser) {
        await updateDoc(doc(S.db, 'deens_user_suspensions', state.selectedUser), {
          active: false,
          updatedBy: me.uid,
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
        });
        await writeAudit('USER_SUSPENSION_LIFTED', state.selectedUser);
        invalidate('suspensions');
        state.userManagementTab = 'accounts';
        userManagement();
        toast('Suspension lifted.');
        return;
      }
      if (e.target.id === 'rudDfRestrictUser' && state.selectedUser) {
        openDrawer(
          'Restrict user',
          `<form class="rud-df-admin-form"><div class="rud-df-admin-field"><label>Reason</label><textarea class="rud-df-admin-textarea" id="rudDfRestrictReason"></textarea></div>${btn('Restrict', 'rudDfRestrictSave', 'danger')}</form>`,
        );
        $('#rudDfRestrictSave').onclick = guarded(async () => {
          const reason = $('#rudDfRestrictReason').value.trim();
          if (!reason) return toast('Reason is required.', 'error');
          await setDoc(
            doc(S.db, 'deens_user_restrictions', state.selectedUser),
            {
              uid: state.selectedUser,
              active: true,
              reason,
              createdBy: me.uid,
              createdAt: serverTimestamp(),
              createdAtMs: Date.now(),
            },
            { merge: true },
          );
          await writeAudit('USER_RESTRICTED', state.selectedUser, reason);
          closeDrawer();
          invalidate('restrictions');
          state.userManagementTab = 'accounts';
          userManagement();
          toast('User restricted.');
        });
        return;
      }
      if (e.target.id === 'rudDfLiftRestriction' && state.selectedUser) {
        await updateDoc(doc(S.db, 'deens_user_restrictions', state.selectedUser), {
          active: false,
          updatedBy: me.uid,
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
        });
        await writeAudit('USER_RESTRICTION_LIFTED', state.selectedUser);
        invalidate('restrictions');
        state.userManagementTab = 'accounts';
        userManagement();
        toast('Restriction lifted.');
        return;
      }
      if (e.target.id === 'rudDfDeleteUser' && state.selectedUser) {
        const button = e.target.closest('button');
        if (button) {
          button.disabled = true;
          button.textContent = 'Deleting…';
        }
        try {
          await deleteDeenUser(state.selectedUser);
        } catch (err) {
          if (button) {
            button.disabled = false;
            button.textContent = 'Delete Deen Friends user';
          }
          toast(err.message || 'Unable to delete user.', 'error');
        }
        return;
      }
      const nav = e.target.closest('[data-df-tab]');
      if (nav) {
        go(nav.dataset.dfTab);
        return;
      }
      const a = e.target.closest('[data-df-action]');
      if (a) {
        const action = a.dataset.dfAction,
          id = a.dataset.id;
        try {
          if (action === 'selectUser' || action === 'user360') {
            state.selectedUser = id;
            state.tab = 'user-management';
            state.userManagementTab = 'accounts';
            await userManagement();
            if (action === 'user360') await inspectUser(id);
            return;
          }
          if (action === 'firestoreEdit') {
            const rows = await load(state.firestoreCollection || 'users');
            const record = rows.find((x) => x.id === id);
            if (record) openFirestoreEditor(record, collections[state.firestoreCollection || 'users']);
            return;
          }
          if (action === 'firestoreDelete') {
            const name = collections[state.firestoreCollection || 'users'];
            if (!name || !confirm('Delete this Firestore document permanently?')) return;
            await deleteDoc(doc(S.db, name, id));
            await writeAudit(
              'FIRESTORE_RECORD_DELETED',
              `${name}/${id}`,
              'Super Admin deleted a Deen Friends Firestore record.',
            );
            state.firestoreRecordId = '';
            invalidate(state.firestoreCollection || 'users');
            renderTab(true);
            toast('Firestore record deleted.');
            return;
          }
          if (action === 'clearInteraction') {
            await clearInteraction(id);
            return;
          }
          if (action === 'conversation') {
            const msgs = (await conversationRows(id)).sort((x, y) => stamp(x.createdAt) - stamp(y.createdAt));
            openDrawer(
              'Conversation',
              table(
                ['Time', 'Sender', 'Recipient', 'Message'],
                msgs
                  .map(
                    (x) =>
                      `<tr><td>${fmt(x.createdAt)}</td><td>${escText(x.senderUid)}</td><td>${escText(x.recipientUid)}</td><td><div class="rud-df-admin-message">${escText(x.text || x.message || x.body || '')}</div></td></tr>`,
                  )
                  .join(''),
                'No messages in this friendship.',
              ) +
                '<div class="rud-df-admin-note" style="margin-top:12px">Conversation access is audit logged by this console when a conversation is opened.</div>',
            );
            await writeAudit('PRIVATE_CONVERSATION_VIEWED', id, 'Super Admin opened friendship conversation');
            return;
          }
          if (action === 'messageOpen') {
            const x = (await load('messages')).find((v) => v.id === id);
            if (x) {
              openDrawer(
                'Private message',
                `<dl class="rud-df-admin-kv"><dt>Message ID</dt><dd>${escText(x.id)}</dd><dt>Conversation</dt><dd>${escText(x.friendshipId)}</dd><dt>Sender</dt><dd>${escText(x.senderUid)}</dd><dt>Recipient</dt><dd>${escText(x.recipientUid)}</dd><dt>Time</dt><dd>${fmt(x.createdAt)}</dd><dt>Message</dt><dd><div class="rud-df-admin-message">${escText(x.text || x.message || x.body || '')}</div></dd></dl>`,
              );
              await writeAudit('PRIVATE_MESSAGE_VIEWED', id, 'Super Admin opened private message');
            }
            return;
          }
          if (action === 'requestAccept' || action === 'requestDecline') {
            const status = action === 'requestAccept' ? 'accepted' : 'declined';
            const x = (await load('requests', true)).find((v) => v.id === id);
            if (!x) throw Error('This friend request no longer exists.');
            if (String(x.status || 'pending') !== 'pending') throw Error(`This request is already ${x.status}.`);
            await updateDoc(doc(S.db, 'deens_friend_requests', id), {
              status,
              updatedAt: serverTimestamp(),
              updatedAtMs: Date.now(),
            });
            // Accepting must also create the connection (same shape as when the user accepts), otherwise
            // the request shows as accepted but the two people never appear in each other's circle.
            if (status === 'accepted' && x.fromUid && x.toUid) {
              const members = [String(x.fromUid), String(x.toUid)].sort();
              const fid = members.join('_');
              const existing = await getDoc(doc(S.db, 'deens_friendships', fid));
              if (!existing.exists()) {
                await setDoc(doc(S.db, 'deens_friendships', fid), {
                  members,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                  streakCount: 0,
                });
              }
              await setDoc(
                doc(S.db, 'deens_friend_streaks', fid),
                { members, count: 0, lastBothDate: '', checkins: {}, bothDates: [], updatedAt: serverTimestamp() },
                { merge: true },
              );
            }
            await writeAudit('FRIEND_REQUEST_' + status.toUpperCase(), id, `Admin set request to ${status}`);
            invalidate('requests', 'friendships');
            requests();
            toast(`Request ${status}.`);
            return;
          }
          if (action === 'requestAudit') {
            const x = (await load('requests')).find((v) => v.id === id);
            openDrawer(
              'Friend request record',
              table(
                ['Field', 'Value'],
                Object.entries(x || {})
                  .map(
                    ([k, v]) =>
                      `<tr><td>${escText(k)}</td><td class="rud-df-admin-code">${escText(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`,
                  )
                  .join(''),
              ),
            );
            return;
          }
          if (action === 'usernameApprove' || action === 'usernameReject') {
            const request = (await load('usernameChanges')).find((v) => v.id === id);
            if (!request) throw Error('Username request not found.');
            if (String(request.status || '') !== 'pending')
              throw Error('This username request has already been handled.');
            if (action === 'usernameReject') {
              await updateDoc(doc(S.db, 'deens_username_change_requests', id), {
                status: 'rejected',
                decision: 'rejected',
                handledBy: me.uid,
                handledByEmail: me.email || '',
                handledAt: serverTimestamp(),
                handledAtMs: Date.now(),
              });
              await writeAudit('USERNAME_REQUEST_REJECTED', id, `Rejected username change for ${request.uid}`);
              invalidate('usernameChanges');
              usernameChanges();
              toast('Username request rejected.');
              return;
            }
            const uid = String(request.uid || ''),
              requested = String(request.requestedUsername || '')
                .trim()
                .replace(/^@+/, '')
                .toLowerCase(),
              newKey = rudDfAdminKey(requested),
              oldKey = rudDfAdminKey(request.currentUsername || '');
            if (!uid || newKey.length < 3) throw Error('Invalid username request data.');
            const reqCheck = checkUsername(requested);
            if (!reqCheck.ok) throw Error(`This request can't be approved: ${reqCheck.message}`);
            await runTransaction(S.db, async (tx) => {
              const userRef = doc(S.db, 'deens_users', uid),
                newNameRef = doc(S.db, 'visitor_usernames', newKey),
                oldNameRef = doc(S.db, 'visitor_usernames', oldKey);
              const userSnap = await tx.get(userRef);
              if (!userSnap.exists()) throw Error('The user profile no longer exists.');
              const existing = await tx.get(newNameRef),
                owner = String(existing.data()?.ownerUid || '');
              if (existing.exists() && owner && owner !== uid) throw Error('That username is already taken.');
              const ud = userSnap.data() || {};
              tx.set(
                newNameRef,
                {
                  visitorId: String(ud.visitorId || ''),
                  ownerUid: uid,
                  name: requested,
                  nameKey: newKey,
                  updatedAt: serverTimestamp(),
                },
                { merge: true },
              );
              tx.set(
                userRef,
                {
                  uid,
                  username: requested,
                  usernameKey: newKey,
                  updatedAt: serverTimestamp(),
                  lastActiveAt: Number(ud.lastActiveAt) || Date.now(),
                },
                { merge: true },
              );
              if (oldKey && oldKey !== newKey) tx.delete(oldNameRef);
              tx.update(doc(S.db, 'deens_username_change_requests', id), {
                status: 'handled',
                decision: 'approved',
                approvedUsername: requested,
                handledBy: me.uid,
                handledByEmail: me.email || '',
                handledAt: serverTimestamp(),
                handledAtMs: Date.now(),
              });
            });
            await writeAudit('USERNAME_REQUEST_APPROVED', id, `Approved ${requested} for ${uid}`);
            invalidate('usernameChanges', 'users');
            usernameChanges();
            toast(`Username @${requested} approved and applied.`);
            return;
          }
          if (action === 'blockRemove') {
            await updateDoc(doc(S.db, 'deens_blocks', id), {
              status: 'removed',
              updatedAt: serverTimestamp(),
              updatedAtMs: Date.now(),
            });
            await writeAudit('BLOCK_REMOVED', id);
            invalidate('blocks');
            safety();
            toast('Block removed.');
            return;
          }
          if (action === 'appealReview') {
            const x = (await load('appeals')).find((v) => v.id === id);
            openDrawer(
              'Appeal review',
              `<form class="rud-df-admin-form"><div class="rud-df-admin-note">${escText(x?.reason || 'No reason supplied.')}</div><div class="rud-df-admin-field"><label>Status</label><select class="rud-df-admin-select" id="rudDfAppealStatus"><option>submitted</option><option>under_review</option><option>approved</option><option>rejected</option></select></div>${btn('Save review', 'rudDfAppealSave', 'primary')}</form>`,
            );
            $('#rudDfAppealStatus').value = x?.status || 'submitted';
            $('#rudDfAppealSave').onclick = guarded(async () => {
              await updateDoc(doc(S.db, 'deens_user_appeals', id), {
                status: $('#rudDfAppealStatus').value,
                reviewedBy: me.uid,
                reviewedAt: serverTimestamp(),
              });
              await writeAudit('APPEAL_REVIEWED', id);
              closeDrawer();
              invalidate('appeals');
              safety();
              toast('Appeal updated.');
            });
            return;
          }
          if (action === 'caseUpdate') {
            const x = (await load('cases')).find((v) => v.id === id);
            openDrawer(
              'Moderation case',
              `<form class="rud-df-admin-form"><div class="rud-df-admin-field"><label>Status</label><select class="rud-df-admin-select" id="rudDfCaseStatus"><option>open</option><option>under_review</option><option>resolved</option><option>closed</option></select></div><div class="rud-df-admin-field"><label>Priority</label><select class="rud-df-admin-select" id="rudDfCasePriority"><option>low</option><option>normal</option><option>high</option><option>critical</option></select></div><div class="rud-df-admin-field"><label>Resolution note</label><textarea class="rud-df-admin-textarea" id="rudDfCaseNote">${escText(x?.resolutionNote || '')}</textarea></div>${btn('Save case', 'rudDfCaseSave', 'primary')}</form>`,
            );
            $('#rudDfCaseStatus').value = x?.status || 'open';
            $('#rudDfCasePriority').value = x?.priority || 'normal';
            $('#rudDfCaseSave').onclick = guarded(async () => {
              await updateDoc(doc(S.db, 'deens_moderation_cases', id), {
                status: $('#rudDfCaseStatus').value,
                priority: $('#rudDfCasePriority').value,
                resolutionNote: $('#rudDfCaseNote').value.trim(),
                updatedBy: me.uid,
                updatedAt: serverTimestamp(),
              });
              await writeAudit('MODERATION_CASE_UPDATED', id);
              closeDrawer();
              invalidate('cases');
              safety();
              toast('Case updated.');
            });
            return;
          }
          if (action === 'noticeEdit') {
            const x = (await load('notices')).find((v) => v.id === id);
            noticeForm(x);
            return;
          }
          if (action === 'noticeDelete') {
            if (!confirm('Delete this notice permanently?')) return;
            await deleteDoc(doc(S.db, 'deens_community_notices', id));
            await writeAudit('NOTICE_DELETED', id);
            invalidate('notices');
            notices();
            toast('Notice deleted.');
            return;
          }
          if (action === 'settingEdit') {
            settingForm((await load('settings')).find((v) => v.id === id));
            return;
          }
          if (action === 'settingDelete') {
            if (!confirm('Delete this admin setting?')) return;
            await deleteDoc(doc(S.db, 'deens_admin_settings', id));
            await writeAudit('SETTING_DELETED', id);
            invalidate('settings');
            settings();
            toast('Setting deleted.');
            return;
          }
        } catch (err) {
          console.error(err);
          toast(adminErrorMessage(err), 'error');
        }
      }
    }),
  );

  // One delegated handler for all User Management actions.

  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) closeDrawer();
  });
  renderTab();
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { deenFriendsAdminView };
