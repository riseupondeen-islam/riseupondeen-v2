/* Admin › RISE Messages: send a message as the RISE team to every member or to one member, through
 * the existing official RISE conversations (deens_rise_threads/{uid}/messages).
 *
 * Every send is a request document  deens_rise_broadcasts/{requestId}  (firestore.rules: Super
 * Admin only). The request id is generated once per composed message, and each delivered copy uses
 * the message id  b_<requestId>, so a double click, a retry or the scheduler running later can never
 * deliver the same message twice.
 *  - All members: the trusted scheduler (push-scheduler/riseBroadcasts.js) delivers it in bounded
 *    pages and records progress on the request — no unbounded writes from the browser.
 *  - One member with an existing conversation: delivered at once from here, inside a transaction
 *    that first checks the copy does not already exist; the request records the direct delivery.
 *  - One member without a conversation yet (the rules only let the member open their thread): the
 *    request is delivered by the scheduler, which creates the conversation for them.
 * The public chat shows these exactly like any reply from the RISE team. Thread status — and so
 * the existing 24-hour retention policy — is never changed. */
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
  setDoc,
  updateDoc,
  where,
} from '../../../services/firebase/sdk';
import { requireSignedIn, currentDeenUser } from '../../deen-friends/services/firebaseSession';
import { DeenFriendsError } from '../../deen-friends/services/errors';

export const RISE_TEXT_MAX = 2000;
const REQUESTS = 'deens_rise_broadcasts';

export interface MemberHit {
  uid: string;
  displayName: string;
  username: string;
  disabled: boolean;
}

export interface OutreachRequest {
  id: string;
  text: string;
  audience: 'all' | 'user';
  targetUid: string;
  targetLabel: string;
  status: 'queued' | 'running' | 'sent' | 'partial' | 'rejected' | 'cancelled';
  createdAtMs: number;
  createdByEmail: string;
  delivered: number;
  duplicates: number;
  skipped: number;
  failed: number;
  directDeliveredAtMs: number;
  finishedAtMs: number;
  lastError: string;
}

function readRequest(id: string, d: Record<string, unknown>): OutreachRequest {
  return {
    id,
    text: String(d.text || ''),
    audience: d.audience === 'user' ? 'user' : 'all',
    targetUid: String(d.targetUid || ''),
    targetLabel: String(d.targetLabel || ''),
    status: (['queued', 'running', 'sent', 'partial', 'rejected', 'cancelled'].includes(String(d.status)) ? d.status : 'queued') as OutreachRequest['status'],
    createdAtMs: Number(d.createdAtMs) || 0,
    createdByEmail: String(d.createdByEmail || ''),
    delivered: Number(d.delivered) || 0,
    duplicates: Number(d.duplicates) || 0,
    skipped: Number(d.skipped) || 0,
    failed: Number(d.failed) || 0,
    directDeliveredAtMs: Number(d.directDeliveredAtMs) || 0,
    finishedAtMs: Number(d.finishedAtMs) || 0,
    lastError: String(d.lastError || ''),
  };
}

export function cleanMessage(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

export function validateMessage(text: string): string | null {
  const body = cleanMessage(text);
  if (!body) return 'Write a message first.';
  if (body.length > RISE_TEXT_MAX) return `Keep the message under ${RISE_TEXT_MAX.toLocaleString()} characters.`;
  return null;
}

/** Finds members by username (prefix) or exact uid. At most 8 results; no private fields are read into the UI. */
export async function searchMembers(text: string): Promise<MemberHit[]> {
  const { db } = await requireSignedIn();
  const raw = text.trim().replace(/^@+/, '');
  if (raw.length < 2) return [];
  const key = raw.toLowerCase();
  const hits = new Map<string, MemberHit>();
  const add = (id: string, d: Record<string, unknown>) =>
    hits.set(id, {
      uid: id,
      displayName: String(d.displayName || d.name || ''),
      username: String(d.username || ''),
      disabled: !!(d.deenFriendsAccessDisabled || d.deletionRequestedAt),
    });
  const [byName, byId] = await Promise.all([
    getDocs(query(collection(db, 'deens_users'), where('usernameKey', '>=', key), where('usernameKey', '<=', `${key}`), limit(8))),
    raw.length >= 20 ? getDoc(doc(db, 'deens_users', raw)).catch(() => null) : Promise.resolve(null),
  ]);
  if (byId && byId.exists()) add(byId.id, byId.data() as Record<string, unknown>);
  byName.docs.forEach((d) => add(d.id, d.data() as Record<string, unknown>));
  return [...hits.values()].slice(0, 8);
}

/** Number of members a message to everyone would currently reach (bounded read). */
export async function countReachableMembers(): Promise<{ count: number; capped: boolean }> {
  const { db } = await requireSignedIn();
  const snap = await getDocs(query(collection(db, 'deens_users'), limit(2000)));
  const count = snap.docs.filter((d) => {
    const u = d.data() as Record<string, unknown>;
    return !u.deenFriendsAccessDisabled && !u.deletionRequestedAt;
  }).length;
  return { count, capped: snap.size >= 2000 };
}

export async function hasRiseConversation(uid: string): Promise<boolean> {
  const { db } = await requireSignedIn();
  const snap = await getDoc(doc(db, 'deens_rise_threads', uid));
  return snap.exists();
}

/** Creates the request (once). Returns false when this request id already exists (a repeated submit). */
async function createRequest(requestId: string, fields: { text: string; audience: 'all' | 'user'; targetUid: string; targetLabel: string }): Promise<boolean> {
  const { db, uid } = await requireSignedIn();
  const ref = doc(db, REQUESTS, requestId);
  const existing = await getDoc(ref);
  if (existing.exists()) return false;
  await setDoc(ref, {
    text: fields.text,
    audience: fields.audience,
    targetUid: fields.targetUid,
    targetLabel: fields.targetLabel.slice(0, 120),
    status: 'queued',
    createdBy: uid,
    createdByEmail: currentDeenUser()?.email || '',
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
  return true;
}

async function audit(action: string, target: string, reason: string) {
  const { db, uid } = await requireSignedIn();
  await setDoc(doc(collection(db, 'deens_admin_audit_logs')), {
    adminUid: uid,
    adminEmail: currentDeenUser()?.email || '',
    adminRole: 'SUPER_ADMIN',
    action,
    target,
    reason: reason.slice(0, 1000),
    timestamp: serverTimestamp(),
    timestampMs: Date.now(),
  });
}

/** Queues a message to every eligible member. */
export async function queueMessageToAll(requestId: string, text: string): Promise<'queued' | 'duplicate'> {
  const problem = validateMessage(text);
  if (problem) throw new DeenFriendsError('invalid', problem);
  const created = await createRequest(requestId, { text: cleanMessage(text), audience: 'all', targetUid: '', targetLabel: 'All members' });
  if (!created) return 'duplicate';
  await audit('RISE_OUTREACH_QUEUED', `${REQUESTS}/${requestId}`, 'Message to all Deen Friends members queued for delivery by the scheduler.').catch(() => undefined);
  return 'queued';
}

/**
 * Sends a message to one member. Delivered immediately when the member already has a RISE
 * conversation; otherwise delivered by the scheduler. Never delivers twice.
 */
export async function sendMessageToMember(
  requestId: string,
  member: MemberHit,
  text: string,
): Promise<'delivered' | 'queued' | 'duplicate'> {
  const problem = validateMessage(text);
  if (problem) throw new DeenFriendsError('invalid', problem);
  if (member.disabled) throw new DeenFriendsError('invalid', 'This member’s account is disabled or being deleted.');
  const body = cleanMessage(text);
  const label = `${member.displayName || 'Member'} (@${member.username || member.uid.slice(0, 6)})`;
  const created = await createRequest(requestId, { text: body, audience: 'user', targetUid: member.uid, targetLabel: label });
  if (!created) return 'duplicate';
  const { db, uid } = await requireSignedIn();
  const threadRef = doc(db, 'deens_rise_threads', member.uid);
  const messageRef = doc(db, 'deens_rise_threads', member.uid, 'messages', `b_${requestId}`);
  const outcome = await runTransaction(db, async (tx) => {
    const [message, thread] = await Promise.all([tx.get(messageRef), tx.get(threadRef)]);
    if (message.exists()) return 'duplicate' as const;
    if (!thread.exists()) return 'queued' as const;
    const now = Date.now();
    const current = thread.data() as Record<string, unknown>;
    tx.set(messageRef, {
      from: 'rise',
      senderUid: uid,
      adminUid: uid,
      text: body,
      automated: false,
      createdAt: serverTimestamp(),
      createdAtMs: now,
    });
    tx.set(
      threadRef,
      {
        lastMessagePreview: body.replace(/\s+/g, ' ').slice(0, 140),
        lastFrom: 'rise',
        lastMessageAtMs: now,
        unreadByUser: Math.min(999, (Number(current.unreadByUser) || 0) + 1),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return 'delivered' as const;
  });
  if (outcome === 'delivered') {
    await updateDoc(doc(db, REQUESTS, requestId), { directDeliveredAtMs: Date.now() }).catch(() => undefined);
    await audit('RISE_DIRECT_MESSAGE_SENT', `deens_rise_threads/${member.uid}`, `Message sent to one member (request ${requestId}).`).catch(() => undefined);
  } else {
    await audit('RISE_OUTREACH_QUEUED', `${REQUESTS}/${requestId}`, 'Message to one member queued (no RISE conversation yet).').catch(() => undefined);
  }
  return outcome === 'duplicate' ? 'delivered' : outcome;
}

export async function cancelRequest(id: string): Promise<void> {
  const { db } = await requireSignedIn();
  await updateDoc(doc(db, REQUESTS, id), { status: 'cancelled', cancelledAt: serverTimestamp() });
  await audit('RISE_OUTREACH_CANCELLED', `${REQUESTS}/${id}`, 'Queued message cancelled before delivery.').catch(() => undefined);
}

/** Live list of the latest requests (history + progress). */
export function listenToRequests(onRows: (rows: OutreachRequest[]) => void, onError: (e: unknown) => void): () => void {
  let stop: () => void = () => undefined;
  let cancelled = false;
  void requireSignedIn()
    .then(({ db }) => {
      if (cancelled) return;
      stop = onSnapshot(
        query(collection(db, REQUESTS), orderBy('createdAtMs', 'desc'), limit(30)),
        (snap) => onRows(snap.docs.map((d) => readRequest(d.id, d.data() as Record<string, unknown>))),
        onError,
      );
    })
    .catch(onError);
  return () => {
    cancelled = true;
    stop();
  };
}
