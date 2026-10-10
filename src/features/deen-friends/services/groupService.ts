/* Deen circles (group chats) — Section 19.
 *
 *   deens_groups/{groupId}                 name, avatar, ownerUid, members[], admins[], memberCount
 *   deens_groups/{groupId}/messages/{id}   Deen actions only, like friend chats (encouragement from the
 *                                          fixed list, or shared Qur’an/dua/hadith/zikr/reminder)
 *
 * Rules (firestore.rules) enforce what the client checks here:
 *  - at least 4 participants including the creator; no duplicates; the creator is a member;
 *  - every person added must already be the creator's (or the adding admin's) Deen Friend;
 *  - only members read the group and its messages; only admins rename, add or remove members;
 *  - members can leave; a group never drops below 3 by removal (it is archived instead).
 * The same no-free-text policy as one-to-one chats applies. */
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from '../../../services/firebase/sdk';
import type { SharedContent } from '../types';
import { DeenFriendsError } from './errors';
import { cleanText, randomId } from './format';
import { requireSignedIn } from './firebaseSession';
import { ENCOURAGEMENTS, QUICK_REACTIONS } from './interactionService';
import { sharedContentForStorage } from './sharedContent';

export const MIN_GROUP_SIZE = 4;
/** Creation checks each invitee's friendship in the rules, which caps a single write at 8 people. */
export const MAX_GROUP_CREATE = 8;
export const MAX_GROUP_SIZE = 30;

export interface DeenGroup {
  id: string;
  name: string;
  avatar: string;
  ownerUid: string;
  members: string[];
  admins: string[];
  lastMessageAtMs: number;
  lastPreview: string;
  createdAtMs: number;
}

export interface GroupMessage {
  id: string;
  senderUid: string;
  kind: 'encourage' | 'content' | 'system';
  text: string;
  sharedContent?: SharedContent;
  createdAtMs: number;
  pending?: boolean;
}

export function readGroup(id: string, data: Record<string, unknown>): DeenGroup {
  return {
    id,
    name: String(data.name || 'Deen circle'),
    avatar: String(data.avatar || 'mosque'),
    ownerUid: String(data.ownerUid || ''),
    members: Array.isArray(data.members) ? data.members.map(String) : [],
    admins: Array.isArray(data.admins) ? data.admins.map(String) : [],
    lastMessageAtMs: Number(data.lastMessageAtMs) || 0,
    lastPreview: String(data.lastPreview || ''),
    createdAtMs: Number(data.createdAtMs) || 0,
  };
}

/** Plain-language guidance for the participant count (creator included). */
export function groupSizeMessage(selectedFriends: number): { ok: boolean; text: string } {
  const total = selectedFriends + 1;
  if (total < MIN_GROUP_SIZE) {
    const need = MIN_GROUP_SIZE - total;
    return {
      ok: false,
      text: `${total} participant${total === 1 ? '' : 's'} including you — add ${need} more ${need === 1 ? 'friend' : 'friends'} (a circle needs at least ${MIN_GROUP_SIZE}).`,
    };
  }
  if (total > MAX_GROUP_CREATE)
    return { ok: false, text: `Start with at most ${MAX_GROUP_CREATE} people; you can add more after creating the circle.` };
  return { ok: true, text: `${total} participants including you.` };
}

export function validateGroup(name: string, memberUids: string[], friendUids: string[], myUid: string): string | null {
  if (cleanText(name, 40).length < 2) return 'Give your circle a name.';
  const unique = [...new Set(memberUids.filter((u) => u && u !== myUid))];
  if (unique.length !== memberUids.filter((u) => u !== myUid).length) return 'Each person can be added only once.';
  if (unique.some((u) => !friendUids.includes(u))) return 'You can only add people who are your Deen Friends.';
  const size = groupSizeMessage(unique.length);
  return size.ok ? null : size.text;
}

export async function createGroup(name: string, avatar: string, memberUids: string[], friendUids: string[]): Promise<string> {
  const { db, uid } = await requireSignedIn();
  const problem = validateGroup(name, memberUids, friendUids, uid);
  if (problem) throw new DeenFriendsError('invalid', problem);
  const members = [uid, ...new Set(memberUids.filter((u) => u !== uid))];
  const groupId = `g_${Date.now().toString(36)}${randomId(8)}`;
  const now = Date.now();
  const batch = writeBatch(db);
  batch.set(doc(db, 'deens_groups', groupId), {
    name: cleanText(name, 40),
    avatar: String(avatar || 'mosque').slice(0, 20),
    ownerUid: uid,
    members,
    admins: [uid],
    memberCount: members.length,
    lastMessageAtMs: now,
    lastPreview: 'Circle created',
    createdAt: serverTimestamp(),
    createdAtMs: now,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return groupId;
}

export function listenToMyGroups(onRows: (rows: DeenGroup[]) => void, onError: (e: unknown) => void): () => void {
  let stop: () => void = () => undefined;
  let cancelled = false;
  void requireSignedIn()
    .then(({ db, uid }) => {
      if (cancelled) return;
      stop = onSnapshot(
        query(collection(db, 'deens_groups'), where('members', 'array-contains', uid), limit(50)),
        (snap) => onRows(snap.docs.map((d) => readGroup(d.id, d.data() as Record<string, unknown>)).sort((a, b) => b.lastMessageAtMs - a.lastMessageAtMs)),
        onError,
      );
    })
    .catch(onError);
  return () => {
    cancelled = true;
    stop();
  };
}

export function listenToGroupMessages(groupId: string, onRows: (rows: GroupMessage[]) => void, onError: (e: unknown) => void): () => void {
  let stop: () => void = () => undefined;
  let cancelled = false;
  void requireSignedIn()
    .then(({ db }) => {
      if (cancelled) return;
      stop = onSnapshot(
        query(collection(db, 'deens_groups', groupId, 'messages'), orderBy('createdAtMs', 'desc'), limit(80)),
        (snap) => {
          const rows = snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              senderUid: String(data.senderUid || ''),
              kind: (data.kind === 'content' ? 'content' : data.kind === 'system' ? 'system' : 'encourage') as GroupMessage['kind'],
              text: String(data.text || ''),
              sharedContent: data.sharedContent && typeof data.sharedContent === 'object' ? (data.sharedContent as SharedContent) : undefined,
              createdAtMs: Number(data.createdAtMs) || 0,
              pending: d.metadata.hasPendingWrites,
            } satisfies GroupMessage;
          });
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

async function postToGroup(group: DeenGroup, payload: Record<string, unknown>, preview: string): Promise<void> {
  const { db, uid } = await requireSignedIn();
  if (!group.members.includes(uid)) throw new DeenFriendsError('permission', 'You are no longer in this circle.');
  const now = Date.now();
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'deens_groups', group.id, 'messages')), {
    senderUid: uid,
    createdAt: serverTimestamp(),
    createdAtMs: now,
    ...payload,
  });
  batch.update(doc(db, 'deens_groups', group.id), { lastMessageAtMs: now, lastPreview: preview.slice(0, 120), updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function sendGroupEncouragement(group: DeenGroup, text: string): Promise<void> {
  const allowed = [...ENCOURAGEMENTS, ...QUICK_REACTIONS.map((r) => r.text)] as string[];
  if (!allowed.includes(text)) throw new DeenFriendsError('invalid', 'Please choose one of the suggested messages.');
  await postToGroup(group, { kind: 'encourage', text }, text);
}

export async function shareToGroup(group: DeenGroup, content: SharedContent): Promise<void> {
  const sharedContent = sharedContentForStorage(content);
  await postToGroup(group, { kind: 'content', text: '', sharedContent }, `Shared: ${sharedContent.title}`);
}

export async function addGroupMember(group: DeenGroup, uidToAdd: string, friendUids: string[]): Promise<void> {
  const { db, uid } = await requireSignedIn();
  if (!group.admins.includes(uid)) throw new DeenFriendsError('permission', 'Only circle admins can add people.');
  if (group.members.includes(uidToAdd)) throw new DeenFriendsError('invalid', 'They are already in this circle.');
  if (!friendUids.includes(uidToAdd)) throw new DeenFriendsError('invalid', 'You can only add your Deen Friends.');
  if (group.members.length >= MAX_GROUP_SIZE) throw new DeenFriendsError('invalid', `A circle can have up to ${MAX_GROUP_SIZE} people.`);
  const members = [...group.members, uidToAdd];
  await setDoc(doc(db, 'deens_groups', group.id), { members, memberCount: members.length, updatedAt: serverTimestamp() }, { merge: true });
}

export async function removeGroupMember(group: DeenGroup, uidToRemove: string): Promise<void> {
  const { db, uid } = await requireSignedIn();
  const self = uidToRemove === uid;
  if (!self && !group.admins.includes(uid)) throw new DeenFriendsError('permission', 'Only circle admins can remove people.');
  if (uidToRemove === group.ownerUid && !self) throw new DeenFriendsError('permission', 'The circle’s creator can’t be removed.');
  const members = group.members.filter((m) => m !== uidToRemove);
  const admins = group.admins.filter((m) => m !== uidToRemove);
  if (!admins.length && members.length) admins.push(members[0]);
  await setDoc(
    doc(db, 'deens_groups', group.id),
    { members, admins, memberCount: members.length, ...(uidToRemove === group.ownerUid ? { ownerUid: admins[0] || '' } : {}), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function renameGroup(group: DeenGroup, name: string): Promise<void> {
  const { db, uid } = await requireSignedIn();
  if (!group.admins.includes(uid)) throw new DeenFriendsError('permission', 'Only circle admins can rename it.');
  const clean = cleanText(name, 40);
  if (clean.length < 2) throw new DeenFriendsError('invalid', 'Give your circle a name.');
  await setDoc(doc(db, 'deens_groups', group.id), { name: clean, updatedAt: serverTimestamp() }, { merge: true });
}

/** For tests/diagnostics: how many circles I am in (bounded). */
export async function countMyGroups(): Promise<number> {
  const { db, uid } = await requireSignedIn();
  const snap = await getDocs(query(collection(db, 'deens_groups'), where('members', 'array-contains', uid), limit(50)));
  return snap.size;
}
