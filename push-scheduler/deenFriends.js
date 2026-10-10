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
 */
const { FieldValue } = require('firebase-admin/firestore');

const STATE_DOC = 'push_scheduler_state/deen_friends';
const DELIVERIES = 'push_deliveries_df';
const FIRST_RUN_LOOKBACK_MS = 10 * 60 * 1000;
const MAX_WINDOW_MS = 6 * 60 * 60 * 1000;

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

async function sendToUser(db, messaging, uid, category, eventId, payload) {
  const devices = await db
    .collection('deens_push_devices')
    .doc(uid)
    .collection('devices')
    .where('active', '==', true)
    .get();
  const targets = devices.docs.filter((d) => d.get('fcmToken') && (d.get('categories') || {})[category] !== false);
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

async function processDeenFriendsEvents(db, messaging) {
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
  const created = await range('createdAtMs')(db.collection('deens_friend_requests')).limit(300).get();
  for (const doc of created.docs) {
    const r = doc.data();
    if (r.status !== 'pending' || !r.toUid) continue;
    sent += await sendToUser(db, messaging, r.toUid, 'friendRequests', `fr:${doc.id}`, {
      title: 'New Deen Friend request',
      body: `${await nameOf(r.fromUid)} would like to connect with you.`,
      route: '#deen-friends',
    });
  }

  // 2. Accepted requests -> the person who asked.
  const answered = await range('updatedAtMs')(db.collection('deens_friend_requests')).limit(300).get();
  for (const doc of answered.docs) {
    const r = doc.data();
    if (r.status !== 'accepted' || !r.fromUid) continue;
    sent += await sendToUser(db, messaging, r.fromUid, 'friendRequests', `fa:${doc.id}`, {
      title: 'Request accepted',
      body: `${await nameOf(r.toUid)} accepted your Deen Friend request.`,
      route: '#deen-friends',
    });
  }

  // 3. New Deen interactions -> one notification per sender/recipient pair per run (no content).
  const interactions = await range('createdAtMs')(db.collection('deens_friend_messages')).limit(500).get();
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
    sent += await sendToUser(db, messaging, g.recipient, 'friendActivity', `msg:${g.recipient}:${g.newest}`, {
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
  const responded = await range('respondedAtMs')(db.collection('deens_friend_messages')).limit(300).get();
  for (const doc of responded.docs) {
    const m = doc.data();
    if (m.kind !== 'challenge' || !m.senderUid) continue;
    sent += await sendToUser(db, messaging, m.senderUid, 'friendActivity', `chr:${doc.id}:${m.status}`, {
      title: m.status === 'accepted' ? 'Challenge accepted' : 'Challenge declined',
      body: `${await nameOf(m.recipientUid)} ${m.status === 'accepted' ? 'accepted' : 'declined'} your challenge.`,
      route: m.friendshipId ? `#deen-friends/chat/${encodeURIComponent(m.friendshipId)}` : '#deen-friends/chats',
    });
  }

  // 5. Replies from RISE -> the user (never the reply text).
  const threads = await range('lastMessageAtMs')(db.collection('deens_rise_threads')).limit(300).get();
  for (const doc of threads.docs) {
    const t = doc.data();
    if (t.lastFrom !== 'rise') continue;
    // Trust the message itself, not the user-editable summary: only a real (non-automated) reply
    // written by a support admin notifies. The automated welcome never does.
    const latest = await doc.ref.collection('messages').orderBy('createdAtMs', 'desc').limit(1).get();
    const reply = latest.docs[0];
    if (!reply || reply.get('from') !== 'rise' || reply.get('automated') !== false || !reply.get('adminUid')) continue;
    if (Number(reply.get('createdAtMs')) <= since) continue;
    sent += await sendToUser(db, messaging, doc.id, 'rise', `rise:${doc.id}:${reply.id}`, {
      title: 'RISE replied to you',
      body: 'Open Deen Friends to read the reply from the RiseUponDeen team.',
      route: '#deen-friends/rise',
    });
  }

  // 6. Newly published Daily Deen Challenges -> assigned users (or everyone with challenges on).
  const challenges = await range('updatedAtMs')(db.collection('deens_daily_challenges')).limit(50).get();
  for (const doc of challenges.docs) {
    const c = doc.data();
    if (c.status !== 'published') continue;
    let recipients = Array.isArray(c.assignedUids) ? c.assignedUids : [];
    if (c.audience === 'all') {
      const devices = await db.collectionGroup('devices').limit(2000).get();
      recipients = [
        ...new Set(
          devices.docs
            .filter(
              (d) =>
                d.ref.parent.parent &&
                d.ref.parent.parent.parent.id === 'deens_push_devices' &&
                d.get('active') === true,
            )
            .map((d) => d.get('uid')),
        ),
      ];
    }
    for (const uid of recipients) {
      sent += await sendToUser(db, messaging, uid, 'challenges', `daily:${doc.id}:${uid}`, {
        title: 'New Daily Deen Challenge',
        body: String(c.title || 'A new challenge from RISE').slice(0, 120),
        route: '#deen-friends/challenges',
      });
    }
  }

  await stateRef.set({ sinceMs: until, updatedAt: FieldValue.serverTimestamp(), lastSent: sent }, { merge: true });
  return { since, until, sent };
}

module.exports = { processDeenFriendsEvents };
