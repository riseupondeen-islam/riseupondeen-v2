/* Monthly winners (V3.1): RISE admins announce the winner(s) of a month's leaderboard.
 *
 *   deens_monthly_winners/{YYYY-MM}   { monthId, uids, winners[], title, message, published,
 *                                       announcedAt, announcedAtMs, announcedBy }
 *
 * Read by signed-in members; written only by Community / Trust & Safety admins (firestore.rules).
 * Winners get a premium gold visiting card and a "Winner" badge on their public profile. */
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
  where,
} from '../../../services/firebase/sdk';
import { readAvatarConfig } from '../../../components/avatar/avatarConfig';
import type { AvatarConfig, AvatarKey } from '../types';
import { asAvatar } from './format';
import { requireSignedIn } from './firebaseSession';
import type { LeaderboardEntry } from './progressService';

export interface WinnerPerson {
  uid: string;
  displayName: string;
  username: string;
  avatar: AvatarKey;
  avatarConfig: AvatarConfig | null;
  points: number;
  activeDays: number;
}

export interface MonthlyWinner {
  monthId: string;
  title: string;
  message: string;
  winners: WinnerPerson[];
  announcedAtMs: number;
}

function readWinner(id: string, d: Record<string, unknown>): MonthlyWinner {
  const winners = (Array.isArray(d.winners) ? d.winners : []).map((w) => {
    const x = (w || {}) as Record<string, unknown>;
    return {
      uid: String(x.uid || ''),
      displayName: String(x.displayName || 'Deen Friend'),
      username: String(x.username || ''),
      avatar: asAvatar(x.avatar),
      avatarConfig: readAvatarConfig(x.avatarConfig),
      points: Number(x.points) || 0,
      activeDays: Number(x.activeDays) || 0,
    };
  });
  return {
    monthId: String(d.monthId || id),
    title: String(d.title || ''),
    message: String(d.message || ''),
    winners: winners.filter((w) => w.uid),
    announcedAtMs: Number(d.announcedAtMs) || 0,
  };
}

let latest: Promise<MonthlyWinner | null> | null = null;

/** The most recent published announcement (one read per session). */
export function loadLatestWinner(force = false): Promise<MonthlyWinner | null> {
  if (latest && !force) return latest;
  latest = (async () => {
    const { db } = await requireSignedIn();
    const snap = await getDocs(
      query(collection(db, 'deens_monthly_winners'), where('published', '==', true), orderBy('monthId', 'desc'), limit(1)),
    );
    const d = snap.docs[0];
    return d ? readWinner(d.id, d.data() as Record<string, unknown>) : null;
  })().catch(() => null);
  return latest;
}

const wins = new Map<string, Promise<string[]>>();

/** Months a member won (for the premium card and badge). */
export function loadWinsFor(uid: string): Promise<string[]> {
  if (!uid) return Promise.resolve([]);
  const cached = wins.get(uid);
  if (cached) return cached;
  const p = (async () => {
    const { db } = await requireSignedIn();
    const snap = await getDocs(
      query(collection(db, 'deens_monthly_winners'), where('uids', 'array-contains', uid), limit(24)),
    );
    return snap.docs
      .filter((d) => (d.data() as Record<string, unknown>).published === true)
      .map((d) => d.id)
      .sort()
      .reverse();
  })().catch(() => [] as string[]);
  wins.set(uid, p);
  return p;
}

/* ---------- admin ---------- */

export async function adminLoadWinner(monthId: string): Promise<MonthlyWinner | null> {
  const { db } = await requireSignedIn();
  const snap = await getDocs(query(collection(db, 'deens_monthly_winners'), where('monthId', '==', monthId), limit(1)));
  const d = snap.docs[0];
  return d ? readWinner(d.id, d.data() as Record<string, unknown>) : null;
}

export async function announceWinner(
  monthId: string,
  people: Array<LeaderboardEntry>,
  title: string,
  message: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(monthId)) throw new Error('Choose a month.');
  if (!people.length) throw new Error('Choose at least one winner.');
  if (people.length > 3) throw new Error('Choose at most three winners.');
  const { db, uid } = await requireSignedIn();
  await setDoc(doc(db, 'deens_monthly_winners', monthId), {
    monthId,
    uids: people.map((p) => p.uid),
    winners: people.map((p) => ({
      uid: p.uid,
      displayName: p.displayName.slice(0, 50),
      username: p.username.slice(0, 50),
      avatar: String(p.avatar || 'crescent').slice(0, 20),
      avatarConfig: p.avatarConfig || null,
      points: p.points,
      activeDays: p.activeDays,
    })),
    title: title.trim().slice(0, 80) || 'Winner of the month',
    message: message.trim().slice(0, 400),
    published: true,
    announcedBy: uid,
    announcedAt: serverTimestamp(),
    announcedAtMs: Date.now(),
  });
  latest = null;
  wins.clear();
}

export async function withdrawWinner(monthId: string): Promise<void> {
  const { db } = await requireSignedIn();
  await deleteDoc(doc(db, 'deens_monthly_winners', monthId));
  latest = null;
  wins.clear();
}
