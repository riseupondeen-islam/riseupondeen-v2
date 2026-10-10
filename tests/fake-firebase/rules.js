/* TEST-ONLY: a hand-written JavaScript model of the Deen Friends parts of firestore.rules.
 *
 * The in-memory Firebase double used by the e2e suite had no security rules, so a bug like V1's
 * "read a document that does not exist" (denied in production because the rule dereferences a null
 * `resource`) could never show up in tests. This module mirrors the rules for the collections Deen
 * Friends uses, including that null-resource behaviour, so the e2e flows fail the same way production
 * would. It is a model, not the real rules engine: the Firestore emulator remains the authority
 * (see docs/DEEN-FRIENDS.md for how to run it). Collections not modelled here are allowed.
 */

const SUPER_ADMIN = 'riseupondeen@gmail.com';
const WELCOME =
  'Assalamu alaikum! This is your private conversation with the RiseUponDeen team. Share a question, a suggestion, something you are struggling with, or a problem with the app. A member of the team reads every message and replies here, in sha Allah. This first message is automated.';
const ENCOURAGE = [
  'MashaAllah, keep going.',
  'May Allah make it easy for you.',
  "Keep your Qur'an streak alive.",
  'Alhamdulillah.',
  'May Allah accept it from you.',
  'Ameen 🤲',
  'JazakAllahu khayran 💚',
  'BarakAllahu feek ✨',
  'SubhanAllah 🌙',
];
const DAY = 86400000;

/** Thrown inside a rule when an expression would be an evaluation error (e.g. null.data). */
class RuleError extends Error {}

const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const isInt = (v) => Number.isInteger(v);
const isTs = (v) => !!v && typeof v === 'object' && typeof v.toMillis === 'function';
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !isTs(v);
const keys = (d) => Object.keys(d || {});
const hasOnly = (d, list) => keys(d).every((k) => list.includes(k));
const hasAll = (d, list) => list.every((k) => k in (d || {}));
/** resource.data — a null resource is an evaluation error, exactly like in the real rules. */
const data = (resource) => {
  if (!resource) throw new RuleError('null resource');
  return resource;
};
function changedKeys(before, after) {
  const all = new Set([...keys(before), ...keys(after)]);
  return [...all].filter((k) => JSON.stringify(norm(before?.[k])) !== JSON.stringify(norm(after?.[k])));
}
function norm(v) {
  if (isTs(v)) return v.toMillis();
  if (Array.isArray(v)) return v.map(norm);
  if (isMap(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v;
}

export function createRules(state) {
  const auth = () => state.currentUser;
  const signedIn = () => !!auth();
  const uid = () => auth()?.uid;
  const role = () => auth()?.role || '';
  const isSuper = () => signedIn() && String(auth().email || '').toLowerCase() === SUPER_ADMIN;
  const isTrust = () => isSuper() || role() === 'TRUST_SAFETY_ADMIN';
  const isCommunity = () => isTrust() || role() === 'COMMUNITY_ADMIN';
  const isSupport = () => isCommunity() || role() === 'SUPPORT_ADMIN';
  const isOwner = (id) => signedIn() && uid() === id;
  const get = (path) => state.docs.get(path) || null;
  const friendship = (fid) => get(`deens_friendships/${fid}`);
  const isFriendMember = (fid) => signedIn() && !!friendship(fid) && (friendship(fid).members || []).includes(uid());
  const recent = (ts) => isTs(ts) && Math.abs(ts.toMillis() - Date.now()) < 60000; // == request.time

  /* ---------- deens_friend_messages ---------- */
  const msgBaseKeys = [
    'friendshipId',
    'senderUid',
    'recipientUid',
    'text',
    'createdAt',
    'createdAtMs',
    'kind',
    'expiresAtMs',
  ];
  function validMsgBase(d) {
    const f = friendship(d.friendshipId);
    return (
      signedIn() &&
      hasAll(d, msgBaseKeys) &&
      isStr(d.friendshipId, 260) &&
      !!f &&
      [d.senderUid, d.recipientUid].every((u) => f.members.includes(u)) &&
      d.senderUid === uid() &&
      d.recipientUid !== uid() &&
      typeof d.text === 'string' &&
      recent(d.createdAt) &&
      isInt(d.createdAtMs) &&
      Math.abs(d.createdAtMs - Date.now()) <= DAY &&
      isInt(d.expiresAtMs) &&
      d.expiresAtMs > d.createdAtMs &&
      d.expiresAtMs <= d.createdAtMs + 7948800000
    );
  }
  function validChallengeMsg(id, d) {
    const c = d.challenge;
    if (
      !(d.kind === 'challenge' && hasOnly(d, [...msgBaseKeys, 'challenge', 'status', 'completedBy']) && d.text === '')
    )
      return false;
    if (!new RegExp(`^ch_${d.friendshipId}_.*$`).test(id) || !isMap(c)) return false;
    if (
      !hasOnly(c, [
        'type',
        'custom',
        'official',
        'officialId',
        'category',
        'title',
        'description',
        'target',
        'activity',
      ])
    )
      return false;
    if (!hasAll(c, ['type', 'category', 'title', 'target'])) return false;
    if (!(isStr(c.type, 40) && isStr(c.category, 30) && isStr(c.title, 80) && c.title.length >= 3)) return false;
    if (!isStr(c.description ?? '', 200) || !isInt(c.target) || c.target < 1 || c.target > 1000) return false;
    if (!['manual', 'tasbih'].includes(c.activity ?? 'manual')) return false;
    if ((c.official ?? false) !== false) {
      const o = get(`deens_official_challenges/${c.officialId}`);
      if (!o || o.active !== true) return false;
    }
    return d.status === 'pending' && isMap(d.completedBy) && keys(d.completedBy).length === 0;
  }
  function validCheckinMsg(id, d) {
    const s = get(`deens_friend_streaks/${d.friendshipId}`);
    return (
      d.kind === 'checkin' &&
      hasOnly(d, msgBaseKeys) &&
      d.text === '' &&
      new RegExp(`^ck_${d.friendshipId}_${uid()}_.*$`).test(id) &&
      !!s &&
      String((s.checkins || {})[uid()] || '').length === 10
    );
  }
  const validEncourageMsg = (d) => d.kind === 'encourage' && hasOnly(d, msgBaseKeys) && ENCOURAGE.includes(d.text);
  function validContentMsg(d) {
    const sc = d.sharedContent;
    return (
      d.kind === 'content' &&
      hasOnly(d, [...msgBaseKeys, 'sharedContent']) &&
      d.text === '' &&
      validSharedContent(sc)
    );
  }
  // V3: complete shared content (firestore.rules validSharedContent).
  function validSharedContent(sc) {
    return (
      isMap(sc) &&
      hasOnly(sc, ['id', 'type', 'title', 'preview', 'reference', 'arabic', 'translation', 'transliteration', 'source']) &&
      hasAll(sc, ['id', 'type', 'title']) &&
      isStr(sc.id, 200) &&
      ['quran', 'dua', 'hadith', 'zikr', 'reminder'].includes(sc.type) &&
      isStr(sc.title, 200) &&
      isStr(sc.preview ?? '', 300) &&
      isStr(sc.reference ?? '', 200) &&
      isStr(sc.arabic ?? '', 8000) &&
      isStr(sc.translation ?? '', 8000) &&
      isStr(sc.transliteration ?? '', 6000) &&
      isStr(sc.source ?? '', 200)
    );
  }
  const messages = {
    read: (r) => {
      const d = data(r);
      return signedIn() && (d.recipientUid === uid() || d.senderUid === uid() || isFriendMember(d.friendshipId));
    },
    create: (id, d) =>
      validMsgBase(d) &&
      (validChallengeMsg(id, d) || validCheckinMsg(id, d) || validEncourageMsg(d) || validContentMsg(d)),
    update: (id, r, d) => {
      const old = data(r);
      const changed = changedKeys(old, d);
      const only = (list) => changed.every((k) => list.includes(k));
      const active = Date.now() <= old.expiresAtMs;
      const receipt =
        old.recipientUid === uid() &&
        only(['readAt', 'readAtMs', 'purgeAt']) &&
        isInt(d.readAtMs) &&
        recent(d.readAt) &&
        (!changed.includes('purgeAt') ||
          ((old.kind || '') !== 'challenge' && isTs(d.purgeAt) && d.purgeAt.toMillis() <= Date.now() + 25 * 3600000));
      const respond =
        (old.kind || '') === 'challenge' &&
        old.recipientUid === uid() &&
        old.status === 'pending' &&
        active &&
        only(['status', 'respondedAtMs', 'purgeAt']) &&
        ['accepted', 'declined'].includes(d.status) &&
        isInt(d.respondedAtMs) &&
        (!changed.includes('purgeAt') || (d.status === 'declined' && isTs(d.purgeAt)));
      const completedChanged = changedKeys(old.completedBy || {}, d.completedBy || {});
      const complete =
        (old.kind || '') === 'challenge' &&
        [old.senderUid, old.recipientUid].includes(uid()) &&
        old.status === 'accepted' &&
        active &&
        only(['completedBy', 'purgeAt']) &&
        (!changed.includes('purgeAt') ||
          (isTs(d.purgeAt) && hasAll(d.completedBy, [old.senderUid, old.recipientUid]))) &&
        !(uid() in (old.completedBy || {})) &&
        completedChanged.every((k) => k === uid()) &&
        typeof (d.completedBy || {})[uid()] === 'string';
      return signedIn() && (receipt || respond || complete);
    },
    delete: (id, r) => signedIn() && data(r).senderUid === uid(),
  };

  /* ---------- requests, friendships, streaks ---------- */
  const requests = {
    read: (r) => {
      const d = data(r);
      return signedIn() && (d.fromUid === uid() || d.toUid === uid() || isCommunity());
    },
    create: (id, d) =>
      signedIn() &&
      d.fromUid === uid() &&
      d.toUid !== uid() &&
      isStr(d.fromUid, 128) &&
      isStr(d.toUid, 128) &&
      d.status === 'pending' &&
      isTs(d.createdAt) &&
      isInt(d.createdAtMs),
    update: (id, r, d) => {
      const old = data(r);
      return (
        signedIn() &&
        old.status === 'pending' &&
        ((old.toUid === uid() &&
          d.fromUid === old.fromUid &&
          d.toUid === old.toUid &&
          ['accepted', 'declined'].includes(d.status)) ||
          (old.fromUid === uid() && d.fromUid === old.fromUid && d.toUid === old.toUid && d.status === 'cancelled') ||
          isCommunity()) &&
        isTs(d.updatedAt)
      );
    },
    delete: (id, r) => {
      const d = data(r);
      return signedIn() && (d.fromUid === uid() || d.toUid === uid() || isCommunity());
    },
  };
  const friendships = {
    read: (r) => signedIn() && ((data(r).members || []).includes(uid()) || isCommunity()),
    create: (id, d) =>
      signedIn() &&
      Array.isArray(d.members) &&
      d.members.length === 2 &&
      d.members.includes(uid()) &&
      d.members[0] !== d.members[1] &&
      isTs(d.createdAt) &&
      isTs(d.updatedAt) &&
      isInt(d.streakCount) &&
      d.streakCount >= 0,
    update: (id, r, d) => {
      const old = data(r);
      return (
        signedIn() &&
        ((old.members || []).includes(uid()) || isCommunity()) &&
        JSON.stringify(d.members) === JSON.stringify(old.members) &&
        norm(d.createdAt) === norm(old.createdAt) &&
        isTs(d.updatedAt) &&
        isInt(d.streakCount) &&
        d.streakCount >= 0
      );
    },
    delete: (id, r) => signedIn() && ((data(r).members || []).includes(uid()) || isCommunity()),
  };
  const streakShape = (d) =>
    isInt(d.count) &&
    d.count >= 0 &&
    typeof d.lastBothDate === 'string' &&
    isMap(d.checkins) &&
    Array.isArray(d.bothDates) &&
    isTs(d.updatedAt);
  const streaks = {
    read: (r, id) => (signedIn() && r && (r.members || []).includes(uid())) || isFriendMember(id) || isCommunity(),
    create: (id, d) =>
      isFriendMember(id) && JSON.stringify(d.members) === JSON.stringify(friendship(id).members) && streakShape(d),
    update: (id, r, d) =>
      isFriendMember(id) &&
      JSON.stringify(d.members) === JSON.stringify(data(r).members) &&
      streakShape(d) &&
      d.bothDates.length <= 365,
    delete: (id) => isFriendMember(id),
  };

  /* ---------- users ---------- */
  const validAvatar = (a) =>
    a === null ||
    (isMap(a) &&
      hasOnly(a, ['v', 'shape', 'background', 'pattern', 'figure', 'outfit', 'accent', 'motif', 'initials']) &&
      a.v === 1 &&
      ['circle', 'arch', 'octagon', 'star'].includes(a.shape) &&
      ['cream', 'sage', 'sand', 'sky', 'rose', 'lilac', 'night', 'ink'].includes(a.background) &&
      ['none', 'stars', 'girih', 'arches', 'dots'].includes(a.pattern) &&
      ['none', 'hijab', 'kufi', 'turban', 'shawl'].includes(a.figure) &&
      ['emerald', 'navy', 'maroon', 'charcoal', 'sand', 'teal', 'plum', 'ivory'].includes(a.outfit) &&
      ['gold', 'silver', 'rosegold', 'emerald', 'ivory'].includes(a.accent) &&
      ['none', 'crescent', 'lantern', 'mosque', 'book', 'tasbih'].includes(a.motif) &&
      typeof a.initials === 'boolean');
  const users = {
    read: () => signedIn(),
    create: (id, d) =>
      isOwner(id) &&
      d.uid === id &&
      isStr(d.visitorId, 120) &&
      isStr(d.username, 50) &&
      /^[A-Za-z0-9]{3,20}$/.test(d.username) && // V3 username rule
      d.usernameKey === d.username.toLowerCase() &&
      isStr(d.displayName, 50) &&
      validAvatar(d.avatarConfig ?? null) &&
      isTs(d.createdAt) &&
      isTs(d.updatedAt) &&
      isInt(d.lastActiveAt),
    update: (id, r, d) => {
      const old = data(r);
      return (
        isOwner(id) &&
        d.uid === id &&
        (d.visitorId === old.visitorId || (!('visitorId' in old) && isStr(d.visitorId, 120))) &&
        d.usernameKey === old.usernameKey &&
        isStr(d.username, 50) &&
        isStr(d.displayName, 50) &&
        validAvatar(d.avatarConfig ?? null) &&
        isTs(d.updatedAt) &&
        isInt(d.lastActiveAt)
      );
    },
    delete: () => false,
  };
  // Super Admin console: may reserve / move a username for a user it manages (fields still validated).
  const superUsername = (id, d) =>
    isSuper() &&
    isStr(d.ownerUid, 128) &&
    d.ownerUid.length > 0 &&
    isStr(d.visitorId, 120) &&
    isStr(d.name, 50) &&
    d.nameKey === id;
  const usernames = {
    read: () => signedIn(),
    create: (id, d) =>
      (signedIn() && d.ownerUid === uid() && isStr(d.visitorId, 120) && isStr(d.name, 50) && d.nameKey === id) ||
      superUsername(id, d),
    update: (id, r, d) =>
      (signedIn() &&
        data(r).ownerUid === uid() &&
        d.ownerUid === data(r).ownerUid &&
        d.nameKey === data(r).nameKey &&
        d.name === data(r).name) ||
      superUsername(id, d),
    delete: () => isSuper(),
  };

  /* ---------- daily challenges ---------- */
  const visibleDaily = (d) =>
    d.status === 'published' && (d.audience === 'all' || (d.assignedUids || []).includes(uid()));
  const dailyKeys = [
    'challengeType',
    'title',
    'description',
    'instructions',
    'category',
    'activity',
    'target',
    'startDate',
    'endDate',
    'requiredDays',
    'status',
    'audience',
    'assignedUids',
    'updatedBy',
    'updatedAt',
    'updatedAtMs',
  ];
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const validDaily = (d) =>
    hasAll(d, dailyKeys) &&
    hasOnly(d, [...dailyKeys, 'createdBy', 'createdAt']) &&
    d.challengeType === 'daily_deen' &&
    isStr(d.title, 80) &&
    d.title.length >= 3 &&
    isStr(d.description, 400) &&
    isStr(d.instructions, 1000) &&
    isStr(d.category, 30) &&
    ['manual', 'tasbih'].includes(d.activity) &&
    isInt(d.target) &&
    d.target >= 1 &&
    d.target <= 10000 &&
    dateRe.test(d.startDate) &&
    dateRe.test(d.endDate) &&
    d.endDate >= d.startDate &&
    isInt(d.requiredDays) &&
    d.requiredDays >= 1 &&
    d.requiredDays <= 90 &&
    ['draft', 'published', 'archived'].includes(d.status) &&
    ['all', 'selected'].includes(d.audience) &&
    Array.isArray(d.assignedUids) &&
    d.assignedUids.length <= 200 &&
    (d.audience === 'all' || d.assignedUids.length >= 1) &&
    d.updatedBy === uid() &&
    recent(d.updatedAt) &&
    isInt(d.updatedAtMs);
  const daily = {
    read: (r) => isCommunity() || (signedIn() && visibleDaily(data(r))),
    create: (id, d) => isCommunity() && validDaily(d) && d.createdBy === uid() && recent(d.createdAt),
    update: (id, r, d) => isCommunity() && validDaily(d) && (d.createdBy || '') === (data(r).createdBy || ''),
    delete: () => isTrust(),
  };
  const participants = (challengeId, owner) => ({
    read: () => isOwner(owner) || isCommunity(),
    write: (d) => {
      const c = get(`deens_daily_challenges/${challengeId}`);
      return (
        isOwner(owner) &&
        !!c &&
        visibleDaily(c) &&
        hasOnly(d, [
          'uid',
          'challengeId',
          'completedDates',
          'completedCount',
          'lastCompletedDate',
          'status',
          'updatedAt',
          'updatedAtMs',
        ]) &&
        d.uid === owner &&
        d.challengeId === challengeId &&
        Array.isArray(d.completedDates) &&
        d.completedDates.length <= 120 &&
        d.completedCount === d.completedDates.length &&
        typeof d.lastCompletedDate === 'string' &&
        ['active', 'completed'].includes(d.status) &&
        recent(d.updatedAt) &&
        isInt(d.updatedAtMs)
      );
    },
  });

  /* ---------- RISE threads ---------- */
  const threadKeys = [
    'uid',
    'displayName',
    'username',
    'lastMessagePreview',
    'lastFrom',
    'lastMessageAtMs',
    'unreadByUser',
    'unreadByRise',
    'status',
    'createdAt',
    'updatedAt',
    'userSeenAtMs',
    'riseSeenAtMs',
    'statusChangedAtMs',
    'clearedAtMs',
    'clearedBy',
  ];
  const threadOk = (d, owner) =>
    hasOnly(d, threadKeys) &&
    d.uid === owner &&
    isStr(d.displayName, 50) &&
    isStr(d.username, 50) &&
    isStr(d.lastMessagePreview, 160) &&
    ['user', 'rise'].includes(d.lastFrom) &&
    isInt(d.lastMessageAtMs) &&
    isInt(d.unreadByUser) &&
    d.unreadByUser >= 0 &&
    d.unreadByUser <= 999 &&
    isInt(d.unreadByRise) &&
    d.unreadByRise >= 0 &&
    d.unreadByRise <= 999 &&
    ['open', 'resolved'].includes(d.status) &&
    recent(d.updatedAt);
  const threads = (owner) => ({
    read: () => isOwner(owner) || isSupport(),
    create: (id, d) => isOwner(owner) && threadOk(d, owner) && d.status === 'open' && recent(d.createdAt),
    update: (id, r, d) => {
      const old = data(r);
      return (
        (isOwner(owner) &&
          threadOk(d, owner) &&
          d.status === old.status &&
          norm(d.createdAt) === norm(old.createdAt) &&
          d.unreadByRise <= old.unreadByRise + 1 &&
          (d.riseSeenAtMs ?? 0) === (old.riseSeenAtMs ?? 0) &&
          (d.clearedAtMs ?? 0) === (old.clearedAtMs ?? 0)) ||
        (isSupport() &&
          threadOk(d, owner) &&
          d.displayName === old.displayName &&
          d.username === old.username &&
          (d.userSeenAtMs ?? 0) === (old.userSeenAtMs ?? 0))
      );
    },
    delete: () => isSuper(),
  });
  const riseMessages = (owner, messageId) => ({
    read: () => isOwner(owner) || isSupport(),
    create: (d) =>
      hasOnly(d, ['from', 'senderUid', 'adminUid', 'text', 'automated', 'createdAt', 'createdAtMs']) &&
      recent(d.createdAt) &&
      isInt(d.createdAtMs) &&
      typeof d.automated === 'boolean' &&
      ((isOwner(owner) &&
        messageId !== 'welcome' &&
        d.from === 'user' &&
        d.senderUid === owner &&
        d.automated === false &&
        !('adminUid' in d) &&
        typeof d.text === 'string' &&
        d.text.length >= 1 &&
        d.text.length <= 2000) ||
        (isOwner(owner) &&
          messageId === 'welcome' &&
          d.from === 'rise' &&
          d.senderUid === owner &&
          d.automated === true &&
          d.text === WELCOME) ||
        (isSupport() &&
          messageId !== 'welcome' &&
          d.from === 'rise' &&
          d.senderUid === uid() &&
          d.adminUid === uid() &&
          d.automated === false &&
          typeof d.text === 'string' &&
          d.text.length >= 1 &&
          d.text.length <= 2000)),
  });

  /** Returns true when the operation is allowed. `op`: read | create | update | delete. */
  function allowed(op, path, before, after) {
    if (
      isSuper() &&
      /^deens_(users|friend_requests|friendships|friend_streaks|friend_messages|official_challenges)\//.test(path)
    )
      return true;
    const seg = path.split('/');
    try {
      if (seg.length === 2) {
        const [coll, id] = seg;
        const table = {
          deens_friend_messages: messages,
          deens_friend_requests: requests,
          deens_friendships: friendships,
          deens_friend_streaks: streaks,
          deens_users: users,
          visitor_usernames: usernames,
          deens_daily_challenges: daily,
          deens_rise_threads: threads(id),
        }[coll];
        if (coll === 'deens_official_challenges')
          return op === 'read' ? signedIn() && (data(before).active === true || isCommunity()) : isCommunity();
        if (table) {
          if (op === 'read') return table.read(before, id);
          if (op === 'create') return table.create(id, after);
          if (op === 'update') return table.update(id, before, after);
          return table.delete(id, before);
        }
        // Not a legacy table: fall through to the V3 models below (unmodelled collections are allowed at the end).
      }
      if (seg.length === 4 && seg[0] === 'deens_daily_challenges' && seg[2] === 'participants') {
        const p = participants(seg[1], seg[3]);
        if (op === 'read') return p.read();
        if (op === 'delete') return isOwner(seg[3]) || isTrust();
        return p.write(after);
      }
      if (seg.length === 4 && seg[0] === 'deens_rise_threads' && seg[2] === 'messages') {
        const m = riseMessages(seg[1], seg[3]);
        if (op === 'read') return m.read();
        if (op === 'create') return m.create(after);
        if (op === 'update') return false;
        // V3 Clear Chat: support admins, solved conversations only, never the welcome.
        return isSuper() || (isSupport() && seg[3] !== 'welcome' && get(`deens_rise_threads/${seg[1]}`)?.status === 'resolved');
      }
      /* ---------- V3 collections (model of firestore.rules; getAfter checks are not modelled) ---------- */
      const pair = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
      const friends = (a, b) => !!get(`deens_friendships/${pair(a, b)}`);
      if (seg[0] === 'deens_groups' && seg.length === 2) {
        const before0 = before;
        if (op === 'read') return signedIn() && (data(before0).members || []).includes(uid());
        if (op === 'create') {
          const d = after;
          const members = d.members || [];
          return (
            signedIn() &&
            /^g_[a-z0-9]{8,40}$/.test(seg[1]) &&
            d.ownerUid === uid() &&
            members.length >= 4 && // at least 4 participants including the creator
            members.length <= 8 &&
            members[0] === uid() &&
            new Set(members).size === members.length &&
            members.slice(1).every((m) => friends(uid(), m)) &&
            d.memberCount === members.length &&
            isStr(d.name, 40) &&
            d.name.length >= 2
          );
        }
        if (op === 'update') {
          const old = data(before0);
          if (!(old.members || []).includes(uid())) return false;
          const changed = changedKeys(old, after);
          if (changed.every((k) => ['lastMessageAtMs', 'lastPreview', 'updatedAt'].includes(k))) return true;
          if (changed.every((k) => ['name', 'updatedAt'].includes(k))) return old.admins.includes(uid());
          if (changed.every((k) => ['members', 'memberCount', 'updatedAt'].includes(k)) && after.members.length === old.members.length + 1) {
            const added = after.members[after.members.length - 1];
            return old.admins.includes(uid()) && !old.members.includes(added) && friends(uid(), added) && after.members.length <= 30;
          }
          if (after.members.length === old.members.length - 1) {
            const leaving = !after.members.includes(uid());
            return leaving || (old.admins.includes(uid()) && after.members.includes(old.ownerUid));
          }
          return false;
        }
        return isTrust();
      }
      if (seg[0] === 'deens_groups' && seg.length === 4 && seg[2] === 'messages') {
        const g = get(`deens_groups/${seg[1]}`);
        const member = signedIn() && !!g && (g.members || []).includes(uid());
        if (op === 'read') return member;
        if (op === 'create') {
          const d = after;
          return (
            member &&
            d.senderUid === uid() &&
            ((d.kind === 'encourage' && ENCOURAGE.includes(d.text)) ||
              (d.kind === 'content' && d.text === '' && validSharedContent(d.sharedContent)))
          );
        }
        if (op === 'update') return false;
        return data(before).senderUid === uid() || isTrust();
      }
      if (seg[0] === 'deens_user_challenges' && seg.length === 2) {
        if (op === 'read')
          return signedIn() && (before ? before.creatorUid === uid() || (before.invitedUids || []).includes(uid()) : seg[1].split('_')[0] === uid());
        if (op === 'create') {
          const d = after;
          const inv = d.invitedUids || [];
          return (
            signedIn() &&
            new RegExp(`^${uid()}_[0-9]+_[0-2]$`).test(seg[1]) &&
            d.creatorUid === uid() &&
            inv.length >= 1 &&
            inv.length <= 8 &&
            new Set(inv).size === inv.length &&
            !inv.includes(uid()) &&
            inv.every((m) => friends(uid(), m)) &&
            d.requiredDays >= 1 &&
            d.requiredDays <= 60
          );
        }
        if (op === 'update') return data(before).creatorUid === uid() && after.status === 'cancelled';
        return isTrust();
      }
      if (seg[0] === 'deens_user_challenges' && seg.length === 4) {
        const ch = get(`deens_user_challenges/${seg[1]}`);
        if (op === 'read') return isOwner(seg[3]) || (signedIn() && !!ch && (ch.creatorUid === uid() || ch.invitedUids.includes(uid())));
        if (op === 'delete') return isTrust();
        if (!isOwner(seg[3])) return false;
        if (op === 'create') return after.completedCount === 0 && ['accepted', 'declined'].includes(after.status);
        const old = data(before);
        return (
          (old.completedCount === 0 && after.completedCount === 0) ||
          (old.status === 'accepted' && after.completedCount === old.completedCount + 1 && after.completedCount <= (ch?.requiredDays ?? 0))
        );
      }
      if (seg[0] === 'deens_activity' && seg.length === 2) {
        if (op === 'read') return signedIn() && seg[1].split('_')[0] === uid();
        if (op === 'delete') return isSuper();
        const d = after;
        const okId = seg[1] === `${uid()}_${d.dayIndex}`;
        if (op === 'create') return okId && d.uid === uid() && d.count === 1 && d.sources.length === 1;
        const old = data(before);
        return okId && d.count === old.count + 1 && d.count <= 3 && d.sources.length === old.sources.length + 1 && !old.sources.includes(d.sources[d.sources.length - 1]);
      }
      if (seg[0] === 'deens_streaks' && seg.length === 2) {
        if (op === 'read') return isOwner(seg[1]) || (signedIn() && data(before).visible === true);
        if (op === 'delete') return isSuper();
        return isOwner(seg[1]) && after.uid === seg[1] && typeof after.visible === 'boolean';
      }
      if (seg[0] === 'deens_leaderboard' && seg.length === 4) {
        if (op === 'read') return isOwner(seg[3]) || (signedIn() && data(before).visible === true);
        if (op === 'delete') return isSuper();
        const old = before || { points: 0, completions: 0 };
        const pointUp = after.points === old.points + 1 && after.completions === old.completions + 1;
        const privacyOnly = !!before && changedKeys(before, after).every((k) => ['visible', 'displayName', 'avatar', 'avatarConfig', 'updatedAt'].includes(k));
        return isOwner(seg[3]) && after.monthId === seg[1] && (pointUp || privacyOnly);
      }
      if (seg[0] === 'deens_public_profiles' && seg.length === 2) {
        if (op === 'read') return isOwner(seg[1]) || (signedIn() && data(before).discoverable === true);
        if (op === 'delete') return isOwner(seg[1]) || isTrust();
        return isOwner(seg[1]) && after.uid === seg[1] && !('email' in after) && typeof after.discoverable === 'boolean';
      }
      if (seg[0] === 'deens_suggestions' && seg.length === 2) return op === 'read' ? isOwner(seg[1]) : false;
      if (seg[0] === 'rud_app_guides' && seg.length === 2) {
        if (op === 'read') return seg[1] === 'published' || isCommunity();
        return isCommunity() && ['draft', 'published'].includes(seg[1]);
      }
      if (seg.length === 4 && seg[0] === 'deens_push_devices' && seg[2] === 'devices') {
        const [, owner, , deviceId] = seg;
        if (op === 'read' || op === 'delete') return isOwner(owner);
        const d = after || {};
        const allowedKeys = [
          'uid',
          'deviceId',
          'fcmToken',
          'platform',
          'categories',
          'active',
          'updatedAt',
          'updatedAtMs',
        ];
        const cats = d.categories;
        return (
          isOwner(owner) &&
          Object.keys(d).every((k) => allowedKeys.includes(k)) &&
          d.uid === owner &&
          d.deviceId === deviceId &&
          deviceId.length <= 120 &&
          typeof d.fcmToken === 'string' &&
          d.fcmToken.length <= 4096 &&
          typeof d.platform === 'string' &&
          d.platform.length <= 30 &&
          !!cats &&
          typeof cats === 'object' &&
          Object.keys(cats).every((k) => ['friendRequests', 'friendActivity', 'rise', 'challenges'].includes(k)) &&
          typeof d.active === 'boolean' &&
          recent(d.updatedAt) &&
          isInt(d.updatedAtMs)
        );
      }
      return true;
    } catch (error) {
      if (error instanceof RuleError) return false;
      throw error;
    }
  }
  return { allowed };
}
