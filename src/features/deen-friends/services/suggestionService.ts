/* Friend suggestions (Section 9) without exposing the user collection.
 *
 *   deens_public_profiles/{uid}   a minimal card each member keeps for discovery:
 *                                 { uid, username, displayName, avatar, avatarConfig, discoverable,
 *                                   lastActiveDay } — never email, bio, focus or any private field.
 *                                 Readable by signed-in members only when discoverable == true.
 *   deens_suggestions/{uid}       people you may know, computed by the trusted scheduler
 *                                 (push-scheduler/maintenance.js) from mutual friendships, excluding
 *                                 blocked, disabled, deleted, non-discoverable accounts, friends and
 *                                 pending requests. Readable only by its owner.
 *
 * The client shows mutual-friend suggestions first, then every other member (paged), and filters
 * again locally against live friendships, requests and blocks. */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
} from '../../../services/firebase/sdk';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { readAvatarConfig } from '../../../components/avatar/avatarConfig';
import type { AvatarConfig, AvatarKey, OwnProfile } from '../types';
import { asAvatar } from './format';
import { requireSignedIn } from './firebaseSession';
import { connectionStatus, type RelationshipSnapshot } from './friendService';
import { istDayIndex } from './progressService';

export interface Suggestion {
  uid: string;
  displayName: string;
  username: string;
  avatar: AvatarKey;
  avatarConfig: AvatarConfig | null;
  mutualCount: number;
  reason: 'mutual' | 'active';
}

const SYNC_KEY = 'rud_df_public_card_v1';

/** Keeps my discovery card in step with my profile (writes only when something changed, ≤1/day). */
export async function syncPublicCard(profile: OwnProfile): Promise<void> {
  const card = {
    uid: profile.uid,
    username: profile.username,
    usernameKey: profile.usernameKey,
    displayName: profile.displayName.slice(0, 50),
    avatar: profile.avatar,
    avatarConfig: profile.avatarConfig || null,
    discoverable: profile.privacy.discoverable,
    lastActiveDay: istDayIndex(),
  };
  const signature = JSON.stringify(card);
  try {
    if (localStorage.getItem(SYNC_KEY) === signature) return;
  } catch {
    /* ignore */
  }
  const { db, uid } = await requireSignedIn();
  if (uid !== profile.uid) return;
  await setDoc(doc(db, 'deens_public_profiles', uid), { ...card, updatedAt: serverTimestamp() });
  try {
    localStorage.setItem(SYNC_KEY, signature);
  } catch {
    /* ignore */
  }
}

function readSuggestion(data: Record<string, unknown>, reason: Suggestion['reason']): Suggestion | null {
  const uid = String(data.uid || '');
  if (!uid) return null;
  return {
    uid,
    displayName: String(data.displayName || data.username || 'Deen Friend'),
    username: String(data.username || ''),
    avatar: asAvatar(data.avatar),
    avatarConfig: readAvatarConfig(data.avatarConfig),
    mutualCount: Math.max(0, Number(data.mutualCount) || 0),
    reason,
  };
}

const DISMISSED_KEY = 'rud_df_dismissed_suggestions';
export function dismissedSuggestions(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(v) ? v.map(String).slice(-200) : [];
  } catch {
    return [];
  }
}
export function dismissSuggestion(uid: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedSuggestions(), uid].slice(-200)));
  } catch {
    /* ignore */
  }
}

/** UIDs I blocked or who blocked me (both directions; rules allow reading both). */
export async function loadBlockedUids(): Promise<Set<string>> {
  const { db, uid } = await requireSignedIn();
  const col = collection(db, 'deens_blocks');
  const [mine, theirs] = await Promise.all([
    getDocs(query(col, where('blockerUid', '==', uid), where('status', '==', 'active'), limit(200))).catch(() => null),
    getDocs(query(col, where('blockedUid', '==', uid), where('status', '==', 'active'), limit(200))).catch(() => null),
  ]);
  const out = new Set<string>();
  mine?.docs.forEach((d) => out.add(String(d.data().blockedUid || '')));
  theirs?.docs.forEach((d) => out.add(String(d.data().blockerUid || '')));
  return out;
}

export function eligible(s: Suggestion, rel: RelationshipSnapshot, blocked: Set<string>, dismissed: string[]): boolean {
  return connectionStatus(s.uid, rel) === 'none' && !blocked.has(s.uid) && !dismissed.includes(s.uid);
}

/** Mutual-friend suggestions prepared by the scheduler (one read). */
export async function loadMutualSuggestions(): Promise<{ items: Suggestion[]; generatedAtMs: number }> {
  const { db, uid } = await requireSignedIn();
  const snap = await getDoc(doc(db, 'deens_suggestions', uid)).catch(() => null);
  if (!snap || !snap.exists()) return { items: [], generatedAtMs: 0 };
  const data = snap.data() as Record<string, unknown>;
  const items = (Array.isArray(data.items) ? data.items : [])
    .map((x) => readSuggestion((x || {}) as Record<string, unknown>, 'mutual'))
    .filter((x): x is Suggestion => !!x);
  return { items, generatedAtMs: Number(data.generatedAtMs) || 0 };
}

export interface MembersPage {
  items: Suggestion[];
  cursor: QueryDocumentSnapshot | null;
  done: boolean;
}

const MEMBERS_PAGE = 30;

/** Everyone with a Deen Friends account (V3.1), 30 per page in a stable order. Members who turned
 *  "Show me in suggestions" off and disabled accounts are skipped; only name, username and avatar
 *  are used (deens_users is already readable by signed-in members). */
export async function loadMembers(cursor: QueryDocumentSnapshot | null): Promise<MembersPage> {
  const { db, uid } = await requireSignedIn();
  const col = collection(db, 'deens_users');
  const q = cursor ? query(col, startAfter(cursor), limit(MEMBERS_PAGE)) : query(col, limit(MEMBERS_PAGE));
  const snap = await getDocs(q);
  const items: Suggestion[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const privacy = (data.privacy || {}) as Record<string, unknown>;
    if (d.id === uid || data.deenFriendsAccessDisabled === true || privacy.discoverable === false || !data.username) continue;
    const item = readSuggestion({ uid: d.id, username: data.username, displayName: data.displayName, avatar: data.avatar, avatarConfig: data.avatarConfig }, 'active');
    if (item) items.push(item);
  }
  return { items, cursor: snap.docs[snap.docs.length - 1] || cursor, done: snap.docs.length < MEMBERS_PAGE };
}
