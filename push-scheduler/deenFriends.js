/* Deen Friends notifications for the free push scheduler (runs with the Admin SDK on GitHub Actions).
 *
 * Every run looks only at what changed since the previous run (a checkpoint document), turns those
 * changes into notifications for the people involved, and sends them to the devices those people
 * registered themselves (deens_push_devices/{uid}/devices/*, owner-only in firestore.rules).
 *
 * Safety:
 *  - Clients never send notifications; there is no client-writable "send" queue to abuse.
 *  - Each notification has a deterministic event id that is claimed once (create-if-absent), so a
 *    re-run, an overlapping run or a retry never sends the same event twice.
 *  - Payloads are data-only and small, and never contain conversation content.
 *  - Per-user category preferences on each device are respected.
 *  - Invalid or expired tokens are deleted when FCM reports them.
 *  - Admin › Notification Settings (notificationPolicy.js) is enforced: the Daily Deen Challenge
 *    (step 6) has its own switch, every other notification here (steps 1–5) is "other". A group
 *    that is turned off is not even queried and its events are skipped for good (the checkpoint
 *    still advances), so turning it back on never releases a backlog. Every send re-checks first.
 */
const { FieldValue } = require('firebase-admin/firestore');
const { createPolicy, categoryAllowed } = require('./notificationPolicy');

const STATE_DOC = 'push_scheduler_state/deen_friends';
const DELIVERIES = 'push_deliveries_df';
const FIRST_RUN_LOOKBACK_MS = 10 * 60 * 1000;
const MAX_WINDOW_MS = 6 * 60 * 60 * 1000;
const NONE = { docs: [] };
/** Admin switch that governs each device category (see notificationPolicy.js). */
const policyCategory = (category) => (category === 'challenges' ? 'dailyChallenge' : 'other');

function invalidToken(code) {
  return /registration-token-not-registered|invalid-registration-token|messaging\/invalid-argument/.test(
    String(code || ''),
  );
}

async function claim(db, eventId) {
  try {
    await db
      .collection(DELIVERIES)
      .doc(eventId.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 300))
      .create({
        createdAt: FieldValue.serverTimestamp(),
        expireAt: new Date(Date.now() + 14 * 86400000), // optional TTL policy field
      });
    return true;
  } catch (error) {
    if (error && (error.code === 6 || /already exists/i.test(String(error.message)))) return false;
    throw error;
  }
}

function makeNameLookup(db) {
  const cache = new Map();
  return async (uid) => {
    if (!cache.has(uid)) {
      const snap = await db.collection('deens_users').doc(uid).get();
      cache.set(
        uid,
        snap.exists ? String(snap.get('displayName') || snap.get('username') || 'A Deen Friend') : 'A Deen Friend',
      );
    }
    return cache.get(uid);
  };
}

async function sendToUser(db, messaging, policy, uid, category, eventId, payload) {
  if (!(await policy.allows(policyCategory(category)))) return 0; // checked before reading the devices
  const devices = await db
    .collection('deens_push_devices')
    .doc(uid)
    .collection('devices')
    .where('active', '==', true)
    .get();
  return sendToDevices(db, messaging, policy, uid, devices.docs, category, eventId, payload);
}

/** Sends to device documents that were already read (active ones only). */
async function sendToDevices(db, messaging, policy, uid, deviceDocs, category, eventId, payload) {
  // Immediately before claiming and sending: a switch turned off mid-run stops further sends.
  if (!(await policy.allows(policyCategory(category)))) return 0;
  const targets = deviceDocs.filter(
    (d) => d.get('active') === true && d.get('fcmToken') && (d.get('categories') || {})[category] !== false,
  );
  if (!targets.length) return 0;
  if (!(await claim(db, eventId))) return 0;
  let sent = 0;
  for (const device of targets) {
    try {
      await messaging.send({
        token: device.get('fcmToken'),
        data: {
          title: payload.title.slice(0, 120),
          message: payload.body.slice(0, 200),
          body: payload.body.slice(0, 200),
          category: `df-${category}`,
          route: payload.route.startsWith('#') ? payload.route : '#deen-friends',
          dedupeId: eventId.slice(0, 120),
        },
        webpush: { headers: { TTL: '3600', Urgency: 'normal' } },
      });
      sent++;
    } catch (error) {
      if (invalidToken(error && error.code)) await device.ref.delete().catch(() => {});
      else console.warn(`Deen Friends push failed for ${uid}`, error && error.message);
    }
  }
  return sent;
}

async function processDeenFriendsEvents(db, messaging, { policy = createPolicy(db) } = {}) {
  const switches = await policy.get();
  // Settings unreadable: send nothing and keep the checkpoint, so a later run can still deliver these
  // events once the switches are verified (bounded by MAX_WINDOW_MS).
  if (policy.unavailable()) return { skipped: 'notification settings unavailable', sent: 0 };
  const otherOn = categoryAllowed(switches, 'other'); // steps 1–5, off by default
  const dailyOn = categoryAllowed(switches, 'dailyChallenge'); // step 6, on by default
  const notify = (uid, category, eventId, payload) =>
    sendToUser(db, messaging, policy, uid, category, eventId, payload);
  const stateRef = db.doc(STATE_DOC);
  const stateSnap = await stateRef.get();
  const until = Date.now() - 3000; // leave room for clocks and in-flight writes
  let since = stateSnap.exists ? Number(stateSnap.get('sinceMs')) || 0 : 0;
  if (!since) since = until - FIRST_RUN_LOOKBACK_MS;
  if (until - since > MAX_WINDOW_MS) since = until - MAX_WINDOW_MS; // after a long outage, skip stale events
  const nameOf = makeNameLookup(db);
  const range = (field) => (ref) => ref.where(field, '>', since).where(field, '<=', until);
  let sent = 0;

  // 1. New friend requests -> the recipient.
  const created = otherOn ? await range('createdAtMs')(db.collection('deens_friend_requests')).limit(300).get() : NONE;
  for (const doc of created.docs) {
    const r = doc.data();
    if (r.status !== 'pending' || !r.toUid) continue;
    sent += await notify(r.toUid, 'friendRequests', `fr:${doc.id}`, {
      title: 'New Deen Friend request',
      body: `${await nameOf(r.fromUid)} would like to connect with you.`,
      route: '#deen-friends',
    });
  }

  // 2. Accepted requests -> the person who asked.
  const answered = otherOn ? await range('updatedAtMs')(db.collection('deens_friend_requests')).limit(300).get() : NONE;
  for (const doc of answered.docs) {
    const r = doc.data();
    if (r.status !== 'accepted' || !r.fromUid) continue;
    sent += await notify(r.fromUid, 'friendRequests', `fa:${doc.id}`, {
      title: 'Request accepted',
      body: `${await nameOf(r.toUid)} accepted your Deen Friend request.`,
      route: '#deen-friends',
    });
  }

  // 3. New Deen interactions -> one notification per sender/recipient pair per run (no content).
  const interactions = otherOn
    ? await range('createdAtMs')(db.collection('deens_friend_messages')).limit(500).get()
    : NONE;
  const grouped = new Map();
  for (const doc of interactions.docs) {
    const m = doc.data();
    if (!m.recipientUid || !m.senderUid) continue;
    const key = `${m.recipientUid}|${m.senderUid}`;
    const entry = grouped.get(key) || {
      recipient: m.recipientUid,
      sender: m.senderUid,
      friendshipId: m.friendshipId,
      count: 0,
      challenge: false,
      newest: '',
      newestAt: 0,
    };
    entry.count++;
    if (Number(m.createdAtMs) >= entry.newestAt) {
      entry.newestAt = Number(m.createdAtMs);
      entry.newest = doc.id;
    }
    entry.challenge = entry.challenge || m.kind === 'challenge';
    grouped.set(key, entry);
  }
  for (const g of grouped.values()) {
    const who = await nameOf(g.sender);
    sent += await notify(g.recipient, 'friendActivity', `msg:${g.recipient}:${g.newest}`, {
      title: who,
      body: g.challenge
        ? 'sent you a Deen challenge.'
        : g.count > 1
          ? `shared ${g.count} things with you.`
          : 'shared something with you.',
      route: g.friendshipId ? `#deen-friends/chat/${encodeURIComponent(g.friendshipId)}` : '#deen-friends/chats',
    });
  }

  // 4. Challenge accepted / declined -> the friend who sent it.
  const responded = otherOn
    ? await range('respondedAtMs')(db.collection('deens_friend_messages')).limit(300).get()
    : NONE;
  for (const doc of responded.docs) {
    const m = doc.data();
    if (m.kind !== 'challenge' || !m.senderUid) continue;
    sent += await notify(m.senderUid, 'friendActivity', `chr:${doc.id}:${m.status}`, {
      title: m.status === 'accepted' ? 'Challenge accepted' : 'Challenge declined',
      body: `${await nameOf(m.recipientUid)} ${m.status === 'accepted' ? 'accepted' : 'declined'} your challenge.`,
      route: m.friendshipId ? `#deen-friends/chat/${encodeURIComponent(m.friendshipId)}` : '#deen-friends/chats',
    });
  }

  // 5. Replies from RISE -> the user (never the reply text).
  const threads = otherOn ? await range('lastMessageAtMs')(db.collection('deens_rise_threads')).limit(300).get() : NONE;
  for (const doc of threads.docs) {
    const t = doc.data();
    if (t.lastFrom !== 'rise') continue;
    // Trust the message itself, not the user-editable summary: only a real (non-automated) reply
    // written by a support admin notifies. The automated welcome never does.
    const latest = await doc.ref.collection('messages').orderBy('createdAtMs', 'desc').limit(1).get();
    const reply = latest.docs[0];
    if (!reply || reply.get('from') !== 'rise' || reply.get('automated') !== false || !reply.get('adminUid')) continue;
    if (Number(reply.get('createdAtMs')) <= since) continue;
    sent += await notify(doc.id, 'rise', `rise:${doc.id}:${reply.id}`, {
      title: 'RISE replied to you',
      body: 'Open Deen Friends to read the reply from the RiseUponDeen team.',
      route: '#deen-friends/rise',
    });
  }

  // 6. Newly published Daily Deen Challenges -> assigned users (or everyone with challenges on).
  // For "everyone", all registered devices are read once per run and reused for every recipient
  // (before, each recipient's devices were read a second time: twice the reads for the same result).
  // Every (challenge, member) pair is claimed once; a finished fan-out also leaves a marker, so an
  // admin edit of an already-announced challenge does not re-read every device just to send nothing.
  const challenges = dailyOn
    ? await range('updatedAtMs')(db.collection('deens_daily_challenges')).limit(50).get()
    : NONE;
  let devicesByUid = null;
  const allDevices = async () => {
    if (!devicesByUid) {
      devicesByUid = new Map();
      const devices = await db.collectionGroup('devices').limit(2000).get();
      for (const d of devices.docs) {
        const owner = d.ref.parent.parent;
        if (!owner || owner.parent.id !== 'deens_push_devices' || d.get('active') !== true) continue;
        const uid = d.get('uid') || owner.id;
        devicesByUid.set(uid, [...(devicesByUid.get(uid) || []), d]);
      }
    }
    return devicesByUid;
  };
  for (const doc of challenges.docs) {
    const c = doc.data();
    if (c.status !== 'published') continue;
    const payload = {
      title: 'New Daily Deen Challenge',
      body: String(c.title || 'A new challenge from RISE').slice(0, 120),
      route: '#deen-friends/challenges',
    };
    if (c.audience === 'all') {
      const doneRef = db.collection(DELIVERIES).doc(`daily-done:${doc.id}`.replace(/[^a-zA-Z0-9_:-]/g, '_'));
      if ((await doneRef.get()).exists) continue;
      for (const [uid, docs] of await allDevices()) {
        sent += await sendToDevices(db, messaging, policy, uid, docs, 'challenges', `daily:${doc.id}:${uid}`, payload);
      }
      // Only a complete fan-out is marked (one stopped by the switch is not; nothing more is sent anyway).
      if (await policy.allows('dailyChallenge'))
        await doneRef
          .create({ createdAt: FieldValue.serverTimestamp(), expireAt: new Date(Date.now() + 14 * 86400000) })
          .catch(() => {});
      continue;
    }
    for (const uid of Array.isArray(c.assignedUids) ? c.assignedUids : []) {
      sent += await notify(uid, 'challenges', `daily:${doc.id}:${uid}`, payload);
    }
  }

  await stateRef.set({ sinceMs: until, updatedAt: FieldValue.serverTimestamp(), lastSent: sent }, { merge: true });
  return { since, until, sent, other: otherOn, dailyChallenge: dailyOn };
}

module.exports = { processDeenFriendsEvents };
