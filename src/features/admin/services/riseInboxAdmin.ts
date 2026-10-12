/* Admin › RISE Inbox — deletion tools (Super Admin; enforced by firestore.rules:
 * deens_rise_threads/{uid} and its messages may be deleted only by the Super Admin, except the
 * existing "Clear chat" for solved conversations, which support admins may use).
 *
 * Deletion is persistent: the documents are removed from Firestore and the inbox listener drops
 * them, so they do not come back after a refresh or reload. Only the selected message or the
 * selected member's conversation is touched — never the member's account or anything else.
 * If the member later opens RISE again, the app starts a fresh conversation for them (with the
 * usual one-time automated welcome), exactly as for a member who never wrote before. */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from '../../../services/firebase/sdk';
import type { RiseThread } from '../../deen-friends/types';
import { DeenFriendsError } from '../../deen-friends/services/errors';
import { currentDeenUser, requireSignedIn } from '../../deen-friends/services/firebaseSession';

const SUPER_ADMIN_EMAIL = 'riseupondeen@gmail.com';
export const isSuperAdminSession = () => String(currentDeenUser()?.email || '').toLowerCase() === SUPER_ADMIN_EMAIL;

async function audit(action: string, target: string, reason: string) {
  const { db, uid } = await requireSignedIn();
  await setDoc(doc(collection(db, 'deens_admin_audit_logs')), {
    adminUid: uid,
    adminEmail: currentDeenUser()?.email || '',
    adminRole: 'SUPER_ADMIN',
    action,
    target,
    reason,
    timestamp: serverTimestamp(),
    timestampMs: Date.now(),
  });
}

/** Deletes one message, then refreshes the conversation preview from what remains. */
export async function deleteRiseMessage(thread: RiseThread, messageId: string): Promise<void> {
  if (!messageId) throw new DeenFriendsError('invalid', 'Choose a message.');
  const { db } = await requireSignedIn();
  await deleteDoc(doc(db, 'deens_rise_threads', thread.uid, 'messages', messageId));
  const latest = await getDocs(query(collection(db, 'deens_rise_threads', thread.uid, 'messages'), orderBy('createdAtMs', 'desc'), limit(1)));
  const top = latest.docs[0]?.data() as Record<string, unknown> | undefined;
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'deens_rise_threads', thread.uid),
    {
      lastMessagePreview: top ? String(top.text || '').replace(/\s+/g, ' ').slice(0, 140) : 'Message removed by the RISE team.',
      lastFrom: top?.from === 'user' ? 'user' : 'rise',
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
  await audit('RISE_MESSAGE_DELETED', `deens_rise_threads/${thread.uid}/messages/${messageId}`, 'Super Admin deleted one message in a RISE conversation.').catch(() => undefined);
}

/**
 * Deletes a member's whole RISE conversation (all messages, then the conversation itself).
 * Requires typing the member's @username. Returns the number of messages deleted.
 */
export async function deleteRiseConversation(thread: RiseThread, confirmUsername: string): Promise<number> {
  if (!isSuperAdminSession()) throw new DeenFriendsError('permission', 'Only the Super Admin can delete a conversation.');
  const expected = (thread.username || thread.uid).toLowerCase();
  if (confirmUsername.trim().replace(/^@+/, '').toLowerCase() !== expected)
    throw new DeenFriendsError('invalid', `Type @${thread.username || thread.uid} exactly to confirm which conversation to delete.`);
  const { db } = await requireSignedIn();
  let deleted = 0;
  for (let page = 0; page < 50; page++) {
    const snap = await getDocs(query(collection(db, 'deens_rise_threads', thread.uid, 'messages'), limit(400)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 400) break;
  }
  await deleteDoc(doc(db, 'deens_rise_threads', thread.uid));
  await audit('RISE_THREAD_DELETED', `deens_rise_threads/${thread.uid}`, `Super Admin deleted the conversation (${deleted} message(s)).`).catch(() => undefined);
  return deleted;
}
