/* The official, private conversation between a user and the RiseUponDeen team ("RISE").
 *
 *   deens_rise_threads/{uid}                    thread summary (owner + support admins)
 *   deens_rise_threads/{uid}/messages/{msgId}   messages (from "user" or "rise")
 *
 * It is completely separate from friend interactions (deens_friend_messages) and from challenge
 * announcements (Daily Deen Challenges). Users can write normal text here.
 *
 * Welcome message: created once, with the fixed id "welcome", inside a transaction that first checks
 * it does not exist — so reloads, two devices or duplicate listeners can never create a second one.
 * It is stored with automated:true and shown as "Automated message", never as a human reply. */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from '../../../services/firebase/sdk';
import type { OwnProfile, RiseMessage, RiseThread } from '../types';
import { DeenFriendsError } from './errors';
import { cleanText, randomId } from './format';
import { requireSignedIn } from './firebaseSession';

/** Must match RISE_WELCOME_TEXT in firestore.rules exactly. */
export const RISE_WELCOME_TEXT =
  'Assalamu alaikum! This is your private conversation with the RiseUponDeen team. Share a question, a suggestion, something you are struggling with, or a problem with the app. A member of the team reads every message and replies here, in sha Allah. This first message is automated.';

export const RISE_MESSAGE_MAX = 2000;

export function readRiseThread(uid: string, data: Record<string, unknown> | undefined): RiseThread | null {
  if (!data) return null;
  return {
    uid,
    displayName: String(data.displayName || ''),
    username: String(data.username || ''),
    lastMessagePreview: String(data.lastMessagePreview || ''),
    lastFrom: data.lastFrom === 'rise' ? 'rise' : 'user',
    lastMessageAtMs: Number(data.lastMessageAtMs) || 0,
    unreadByUser: Math.max(0, Number(data.unreadByUser) || 0),
    unreadByRise: Math.max(0, Number(data.unreadByRise) || 0),
    status: data.status === 'resolved' ? 'resolved' : 'open',
    userSeenAtMs: Number(data.userSeenAtMs) || 0,
    riseSeenAtMs: Number(data.riseSeenAtMs) || 0,
    clearedAtMs: Number(data.clearedAtMs) || 0,
  };
}

export function readRiseMessage(id: string, data: Record<string, unknown>, pending = false): RiseMessage {
  return {
    id,
    from: data.from === 'rise' ? 'rise' : 'user',
    text: String(data.text || ''),
    createdAtMs: Number(data.createdAtMs) || 0,
    automated: data.automated === true,
    pending,
  };
}

function preview(text: string): string {
  return cleanText(text, 140).replace(/\s+/g, ' ');
}

/** Creates the thread and the one-time welcome message if they do not exist yet. Safe to call often. */
export async function ensureRiseThread(profile: OwnProfile): Promise<void> {
  const { db, uid } = await requireSignedIn();
  const threadRef = doc(db, 'deens_rise_threads', uid);
  const welcomeRef = doc(db, 'deens_rise_threads', uid, 'messages', 'welcome');
  await runTransaction(db, async (tx) => {
    const [thread, welcome] = await Promise.all([tx.get(threadRef), tx.get(welcomeRef)]);
    if (thread.exists() && welcome.exists()) return;
    const now = Date.now();
    if (!thread.exists()) {
      tx.set(threadRef, {
        uid,
        displayName: profile.displayName.slice(0, 50),
        username: profile.username.slice(0, 50),
        lastMessagePreview: preview(RISE_WELCOME_TEXT),
        lastFrom: 'rise',
        lastMessageAtMs: now,
        unreadByUser: 1,
        unreadByRise: 0,
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    if (!welcome.exists()) {
      // The welcome always sorts first, even when it is (re)created after earlier messages.
      const created = thread.exists() ? (thread.data() as Record<string, unknown>).createdAt : null;
      const createdMs =
        created && typeof (created as { toMillis?: () => number }).toMillis === 'function'
          ? (created as { toMillis: () => number }).toMillis()
          : 0;
      const welcomeAt = createdMs ? Math.min(now, createdMs) : thread.exists() ? 1 : now;
      tx.set(welcomeRef, {
        from: 'rise',
        senderUid: uid,
        text: RISE_WELCOME_TEXT,
        automated: true,
        createdAt: serverTimestamp(),
        createdAtMs: welcomeAt,
      });
    }
  });
}

/** Live thread summary (for the unread badge). */
export function listenToRiseThread(
  onThread: (thread: RiseThread | null) => void,
  onError: (e: unknown) => void,
): () => void {
  let stop: () => void = () => undefined;
  let cancelled = false;
  void requireSignedIn()
    .then(({ db, uid }) => {
      if (cancelled) return;
      stop = onSnapshot(
        doc(db, 'deens_rise_threads', uid),
        (snap) => onThread(snap.exists() ? readRiseThread(uid, snap.data() as Record<string, unknown>) : null),
        onError,
      );
    })
    .catch(onError);
  return () => {
    cancelled = true;
    stop();
  };
}

/** Live messages of a thread (newest 100). `threadUid` is my uid, or a user's uid for support admins. */
export function listenToRiseMessages(
  threadUid: string | null,
  onRows: (rows: RiseMessage[]) => void,
  onError: (e: unknown) => void,
): () => void {
  let stop: () => void = () => undefined;
  let cancelled = false;
  void requireSignedIn()
    .then(({ db, uid }) => {
      if (cancelled) return;
      stop = onSnapshot(
        query(
          collection(db, 'deens_rise_threads', threadUid || uid, 'messages'),
          orderBy('createdAtMs', 'desc'),
          limit(100),
        ),
        (snap) => {
          const rows = snap.docs.map((d) =>
            readRiseMessage(d.id, d.data() as Record<string, unknown>, d.metadata.hasPendingWrites),
          );
          rows.sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
          onRows(rows);
        },
        onError,
      );
    })
    .catch(onError);
  return () => {
    cancelled = true;
    stop();
  };
}

/**
 * Sends my message to RISE. The message id is generated once by the caller and reused on retry, so a
 * retried send can never create a duplicate (a repeated create of the same id is refused by the rules).
 */
export async function sendRiseMessage(
  profile: OwnProfile,
  text: string,
  messageId: string,
  thread: RiseThread | null,
): Promise<void> {
  const body = text.replace(/\r\n/g, '\n').trim();
  if (!body) throw new DeenFriendsError('invalid', 'Write a message first.');
  if (body.length > RISE_MESSAGE_MAX)
    throw new DeenFriendsError('invalid', `Please keep messages under ${RISE_MESSAGE_MAX} characters.`);
  const { db, uid } = await requireSignedIn();
  if (!thread) await ensureRiseThread(profile);
  // The rules allow raising unreadByRise by at most one per write. Read the current value instead of
  // trusting the screen's copy: after RISE reads the thread (counter reset to 0) a stale local value
  // made the next message fail with "permission denied".
  const current = await getDoc(doc(db, 'deens_rise_threads', uid)).catch(() => null);
  const unreadNow = Number(current?.exists() ? current.data()?.unreadByRise : thread?.unreadByRise) || 0;
  const now = Date.now();
  const batch = writeBatch(db);
  batch.set(doc(db, 'deens_rise_threads', uid, 'messages', messageId), {
    from: 'user',
    senderUid: uid,
    text: body,
    automated: false,
    createdAt: serverTimestamp(),
    createdAtMs: now,
  });
  batch.set(
    doc(db, 'deens_rise_threads', uid),
    {
      uid,
      displayName: profile.displayName.slice(0, 50),
      username: profile.username.slice(0, 50),
      lastMessagePreview: preview(body),
      lastFrom: 'user',
      lastMessageAtMs: now,
      unreadByRise: Math.min(999, unreadNow + 1),
      unreadByUser: 0,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
}

export function newRiseMessageId(): string {
  return `u_${Date.now().toString(36)}_${randomId(8)}`;
}

/**
 * Clears my unread counter and records that I have seen the conversation up to now (V3: the 24-hour
 * retention clock only starts once BOTH the user and the RISE team have seen a message).
 * Writes only when something is new, so reopening the chat costs nothing.
 */
export async function markRiseThreadRead(thread: RiseThread | null): Promise<void> {
  if (!thread) return;
  const needsSeen = thread.lastMessageAtMs > thread.userSeenAtMs;
  if (!thread.unreadByUser && !needsSeen) return;
  const { db, uid } = await requireSignedIn();
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'deens_rise_threads', uid),
    { unreadByUser: 0, userSeenAtMs: Date.now(), updatedAt: serverTimestamp() },
    { merge: true },
  );
  await batch.commit();
}

/* ---------- support admin side (rules: isSupportAdmin; every thread opening is audit-logged) ---------- */

export async function adminReply(threadUid: string, text: string, thread: RiseThread): Promise<void> {
  const body = text.trim();
  if (!body) throw new DeenFriendsError('invalid', 'Write a reply first.');
  if (body.length > RISE_MESSAGE_MAX) throw new DeenFriendsError('invalid', 'Reply is too long.');
  const { db, uid } = await requireSignedIn();
  const now = Date.now();
  const batch = writeBatch(db);
  batch.set(doc(db, 'deens_rise_threads', threadUid, 'messages', `r_${now.toString(36)}_${randomId(8)}`), {
    from: 'rise',
    senderUid: uid,
    adminUid: uid,
    text: body,
    automated: false,
    createdAt: serverTimestamp(),
    createdAtMs: now,
  });
  batch.set(
    doc(db, 'deens_rise_threads', threadUid),
    {
      lastMessagePreview: preview(body),
      lastFrom: 'rise',
      lastMessageAtMs: now,
      unreadByUser: Math.min(999, thread.unreadByUser + 1),
      unreadByRise: 0,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
}

export async function adminSetThreadStatus(threadUid: string, status: 'open' | 'resolved'): Promise<void> {
  const { db } = await requireSignedIn();
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'deens_rise_threads', threadUid),
    // statusChangedAtMs lets the trusted scheduler find threads whose retention state changed.
    { status, unreadByRise: 0, statusChangedAtMs: Date.now(), updatedAt: serverTimestamp() },
    { merge: true },
  );
  await batch.commit();
}

/** Records that the RISE team has seen the conversation up to now (support side of the retention policy). */
export async function adminMarkThreadSeen(threadUid: string, thread: RiseThread): Promise<void> {
  if (thread.lastMessageAtMs <= thread.riseSeenAtMs && !thread.unreadByRise) return;
  const { db } = await requireSignedIn();
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'deens_rise_threads', threadUid),
    { riseSeenAtMs: Date.now(), unreadByRise: 0, updatedAt: serverTimestamp() },
    { merge: true },
  );
  await batch.commit();
}

/**
 * Admin "Clear Chat" (Section 8): deletes every message of ONE resolved conversation except the
 * one-time automated welcome, then records who cleared it and when. firestore.rules allow support
 * admins to delete messages only while the thread is resolved; the audit log keeps who/when/how many
 * (never message text). Returns the number of deleted messages.
 */
export async function adminClearThread(threadUid: string, thread: RiseThread, confirmUsername: string): Promise<number> {
  if (thread.uid !== threadUid) throw new DeenFriendsError('invalid', 'This conversation changed. Please reopen it.');
  if (thread.status !== 'resolved') throw new DeenFriendsError('invalid', 'Mark the issue as solved before clearing the chat.');
  if (confirmUsername.trim().replace(/^@+/, '').toLowerCase() !== thread.username.toLowerCase())
    throw new DeenFriendsError('invalid', `Type @${thread.username} exactly to confirm which conversation to clear.`);
  const { db, uid } = await requireSignedIn();
  let deleted = 0;
  // Bounded pages of 400 (a batch allows 500 writes); stop when only the welcome remains.
  for (let page = 0; page < 25; page++) {
    const snap = await getDocs(query(collection(db, 'deens_rise_threads', threadUid, 'messages'), orderBy('createdAtMs', 'asc'), limit(400)));
    const targets = snap.docs.filter((d) => d.id !== 'welcome');
    if (!targets.length) break;
    const batch = writeBatch(db);
    targets.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += targets.length;
    if (snap.size < 400) break;
  }
  const now = Date.now();
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'deens_rise_threads', threadUid),
    {
      lastMessagePreview: 'Conversation cleared by the RISE team.',
      lastFrom: 'rise',
      unreadByUser: 0,
      unreadByRise: 0,
      clearedAtMs: now,
      clearedBy: uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  batch.set(doc(collection(db, 'deens_admin_audit_logs')), {
    adminUid: uid,
    action: 'RISE_THREAD_CLEARED',
    target: `deens_rise_threads/${threadUid}`,
    reason: `Cleared ${deleted} message(s) after the issue was marked solved`,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
  return deleted;
}

export async function adminLogThreadAccess(threadUid: string): Promise<void> {
  const { db, uid } = await requireSignedIn();
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'deens_admin_audit_logs')), {
    adminUid: uid,
    action: 'RISE_THREAD_OPENED',
    target: `deens_rise_threads/${threadUid}`,
    reason: 'Reading a support conversation addressed to RISE',
    timestamp: serverTimestamp(),
  });
  await batch.commit();
}

export function listenToRiseInbox(onThreads: (rows: RiseThread[]) => void, onError: (e: unknown) => void): () => void {
  let stop: () => void = () => undefined;
  let cancelled = false;
  void requireSignedIn()
    .then(({ db }) => {
      if (cancelled) return;
      stop = onSnapshot(
        query(collection(db, 'deens_rise_threads'), orderBy('lastMessageAtMs', 'desc'), limit(100)),
        (snap) =>
          onThreads(
            snap.docs
              .map((d) => readRiseThread(d.id, d.data() as Record<string, unknown>))
              .filter(Boolean) as RiseThread[],
          ),
        onError,
      );
    })
    .catch(onError);
  return () => {
    cancelled = true;
    stop();
  };
}
