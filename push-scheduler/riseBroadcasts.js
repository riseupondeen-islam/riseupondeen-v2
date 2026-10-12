/* RISE outreach for the free scheduler (Admin SDK on GitHub Actions).
 *
 *   deens_rise_broadcasts/{requestId}   queued by the Super Admin in the Admin Console
 *   { text, audience: 'all' | 'user', targetUid, targetLabel, status, createdBy, createdByEmail, ... }
 *
 * Each copy is written into the member's existing official RISE conversation
 * (deens_rise_threads/{uid}/messages) with the FIXED id  b_<requestId>, inside a transaction that
 * first checks the copy does not exist. Retries, overlapping runs and resumed runs therefore never
 * deliver a message twice. The member's thread summary is updated exactly like a normal RISE reply
 * (or the thread is created when the member never opened RISE), so the public chat shows it as a
 * normal message from the RISE team and the existing "RISE replied" push picks it up. The thread's
 * open/solved status — and therefore the existing 24-hour retention policy — is never changed.
 *
 * Status: queued → running → sent | partial (some members failed 3 times) | rejected.
 * Progress (cursor, delivered, skipped, failed) is saved after every page, so a run that stops
 * because of its time budget simply continues on the next run.
 */

const BROADCASTS = 'deens_rise_broadcasts';
const SUPER_ADMIN_EMAIL = 'riseupondeen@gmail.com';
const PAGE = 100;
const MAX_ATTEMPTS = 3;
const MAX_FAILED_KEPT = 500;

const preview = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140);

function eligible(profile) {
  return !!profile && !profile.deenFriendsAccessDisabled && !profile.deletionRequestedAt;
}

/** Delivers one copy. Returns 'delivered' | 'duplicate'. Throws on failure. */
async function deliverOne(db, ts, broadcast, requestId, uid, profile, now) {
  const threadRef = db.collection('deens_rise_threads').doc(uid);
  const messageRef = threadRef.collection('messages').doc(`b_${requestId}`);
  return db.runTransaction(async (tx) => {
    const message = await tx.get(messageRef);
    if (message.exists) return 'duplicate';
    const thread = await tx.get(threadRef);
    tx.create(messageRef, {
      from: 'rise',
      senderUid: broadcast.createdBy,
      adminUid: broadcast.createdBy,
      text: broadcast.text,
      automated: false,
      createdAt: ts(),
      createdAtMs: now,
    });
    const summary = {
      lastMessagePreview: preview(broadcast.text),
      lastFrom: 'rise',
      lastMessageAtMs: now,
      updatedAt: ts(),
    };
    if (thread.exists) {
      const unread = Math.max(0, Number(thread.data().unreadByUser) || 0);
      tx.set(threadRef, { ...summary, unreadByUser: Math.min(999, unread + 1) }, { merge: true });
    } else {
      tx.set(threadRef, {
        uid,
        displayName: String((profile && (profile.displayName || profile.name)) || 'Deen Friend').slice(0, 50),
        username: String((profile && profile.username) || '').slice(0, 50),
        ...summary,
        unreadByUser: 1,
        unreadByRise: 0,
        status: 'open',
        createdAt: ts(),
      });
    }
    return 'delivered';
  });
}

async function requesterIsSuperAdmin(auth, uid) {
  if (!auth) return false;
  try {
    const user = await auth.getUser(String(uid || ''));
    return String(user.email || '').toLowerCase() === SUPER_ADMIN_EMAIL;
  } catch {
    return false;
  }
}

async function audit(db, ts, broadcast, requestId, action, reason, extra = {}) {
  await db.collection('deens_admin_audit_logs').add({
    adminUid: String(broadcast.createdBy || ''),
    adminEmail: String(broadcast.createdByEmail || ''),
    adminRole: 'SUPER_ADMIN',
    action,
    target: `deens_rise_broadcasts/${requestId}`,
    reason,
    timestamp: ts(),
    timestampMs: Date.now(),
    source: 'scheduler',
    ...extra,
  });
}

/** Processes queued outreach within `budgetMs`. Never sends the same copy twice. */
async function processRiseBroadcasts(db, auth, { now = Date.now(), budgetMs = 45000, serverTimestamp, clock = Date.now } = {}) {
  const ts = serverTimestamp || require('firebase-admin/firestore').FieldValue.serverTimestamp;
  const started = clock();
  const outOfTime = () => clock() - started > budgetMs;
  const snap = await db.collection(BROADCASTS).where('status', 'in', ['queued', 'running']).limit(10).get();
  const jobs = snap.docs.sort((a, b) => (Number(a.data().createdAtMs) || 0) - (Number(b.data().createdAtMs) || 0));
  const result = { processed: 0, delivered: 0, duplicates: 0, failed: 0, finished: 0, rejected: 0 };

  for (const doc of jobs) {
    if (outOfTime()) break;
    const b = doc.data() || {};
    const requestId = doc.id;
    const text = String(b.text || '').trim();
    if (!text || text.length > 2000 || !['all', 'user'].includes(b.audience) || !(await requesterIsSuperAdmin(auth, b.createdBy))) {
      const why = !text || text.length > 2000 ? 'Invalid message.' : 'Requester is not the Super Admin.';
      await doc.ref.set({ status: 'rejected', lastError: why, finishedAtMs: now, updatedAt: ts() }, { merge: true });
      await audit(db, ts, b, requestId, 'RISE_OUTREACH_REJECTED', why).catch(() => undefined);
      result.rejected++;
      continue;
    }
    result.processed++;
    const progress = {
      delivered: Number(b.delivered) || 0,
      duplicates: Number(b.duplicates) || 0,
      skipped: Number(b.skipped) || 0,
      failedUids: Array.isArray(b.failedUids) ? b.failedUids.slice(0, MAX_FAILED_KEPT) : [],
      attempts: { ...(b.attempts || {}) },
      cursor: String(b.cursorUid || ''),
      passDone: b.passDone === true,
    };
    const save = (extra = {}) =>
      doc.ref.set(
        {
          status: 'running',
          delivered: progress.delivered,
          duplicates: progress.duplicates,
          skipped: progress.skipped,
          failed: progress.failedUids.length,
          failedUids: progress.failedUids,
          attempts: progress.attempts,
          cursorUid: progress.cursor,
          passDone: progress.passDone,
          startedAtMs: Number(b.startedAtMs) || now,
          updatedAtMs: clock(),
          updatedAt: ts(),
          ...extra,
        },
        { merge: true },
      );
    const attempt = async (uid, profile) => {
      try {
        const outcome = await deliverOne(db, ts, { ...b, text }, requestId, uid, profile, now);
        if (outcome === 'delivered') {
          progress.delivered++;
          result.delivered++;
        } else {
          progress.duplicates++;
          result.duplicates++;
        }
        progress.failedUids = progress.failedUids.filter((x) => x !== uid);
        delete progress.attempts[uid];
      } catch (error) {
        progress.attempts[uid] = (Number(progress.attempts[uid]) || 0) + 1;
        if (!progress.failedUids.includes(uid) && progress.failedUids.length < MAX_FAILED_KEPT) progress.failedUids.push(uid);
        result.failed++;
        console.warn(`RISE outreach ${requestId} → ${uid} failed`, error && error.message);
      }
    };

    if (b.audience === 'user') {
      const uid = String(b.targetUid || '');
      const profileSnap = await db.collection('deens_users').doc(uid).get();
      if (!profileSnap.exists || !eligible(profileSnap.data())) {
        await doc.ref.set({ status: 'rejected', lastError: 'That member no longer has an active Deen Friends profile.', finishedAtMs: now, updatedAt: ts() }, { merge: true });
        result.rejected++;
        continue;
      }
      await attempt(uid, profileSnap.data());
      progress.passDone = true;
    } else {
      // Main pass over every member, in uid order, resumable from the saved cursor.
      while (!progress.passDone && !outOfTime()) {
        let q = db.collection('deens_users').orderBy('uid').limit(PAGE);
        if (progress.cursor) q = q.startAfter(progress.cursor);
        const page = await q.get();
        for (const p of page.docs) {
          const data = p.data() || {};
          const uid = String(data.uid || p.id);
          if (!eligible(data) || uid !== p.id) progress.skipped++;
          else await attempt(uid, data);
          progress.cursor = uid;
        }
        if (page.docs.length < PAGE) progress.passDone = true;
        await save();
      }
    }

    // Retry members that failed earlier (each at most MAX_ATTEMPTS times).
    if (progress.passDone) {
      for (const uid of [...progress.failedUids]) {
        if (outOfTime()) break;
        if ((Number(progress.attempts[uid]) || 0) >= MAX_ATTEMPTS) continue;
        const profileSnap = await db.collection('deens_users').doc(uid).get();
        if (!profileSnap.exists || !eligible(profileSnap.data())) {
          progress.failedUids = progress.failedUids.filter((x) => x !== uid);
          progress.skipped++;
          continue;
        }
        await attempt(uid, profileSnap.data());
      }
      const retryable = progress.failedUids.filter((uid) => (Number(progress.attempts[uid]) || 0) < MAX_ATTEMPTS);
      if (!retryable.length) {
        const status = progress.failedUids.length ? 'partial' : 'sent';
        await save({ status, finishedAtMs: clock() });
        await audit(
          db,
          ts,
          b,
          requestId,
          status === 'sent' ? 'RISE_OUTREACH_SENT' : 'RISE_OUTREACH_PARTIAL',
          `Delivered ${progress.delivered}, already present ${progress.duplicates}, skipped ${progress.skipped}, failed ${progress.failedUids.length}.`,
          { audience: b.audience, delivered: progress.delivered, failed: progress.failedUids.length },
        ).catch(() => undefined);
        result.finished++;
        continue;
      }
    }
    await save();
  }
  return result;
}

module.exports = { processRiseBroadcasts, deliverOne, SUPER_ADMIN_EMAIL };
