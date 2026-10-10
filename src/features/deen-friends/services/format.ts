/* Pure helpers shared by the Deen Friends services and components (no Firebase, no DOM). */
import {
  AVATAR_KEYS,
  type AvatarKey,
  type ChallengeState,
  type Interaction,
  type PrivacySettings,
  type PublicProfile,
} from '../types';

/* ---------- text ---------- */

/** Collapses whitespace and removes zero-width characters (same normaliser the app always used). */
export function cleanText(value: unknown, maxLength = 500): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** The lookup key stored as deens_users.usernameKey and visitor_usernames/{key}. Unchanged from V1. */
export function usernameKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9؀-ۿ _.-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40);
}

export function initials(name: string): string {
  const letters = cleanText(name, 80)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
  return letters || 'D';
}

/** Converts Arabic-Indic / Persian digits to ASCII so numeric inputs work on every keyboard. */
export function toAsciiDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/* ---------- dates (local calendar days, as the streak data always used) ---------- */

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dayBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1));
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + days));
}

export function daysBetween(fromDay: string, toDay: string): number {
  const [y1, m1, d1] = fromDay.split('-').map(Number);
  const [y2, m2, d2] = toDay.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86400000);
}

export function endOfLocalDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

export function formatClock(ms: number): string {
  if (!ms) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  } catch {
    return '';
  }
}

export function formatDayLabel(ms: number): string {
  if (!ms) return '';
  const day = localDay(new Date(ms));
  const today = localDay();
  if (day === today) return 'Today';
  if (day === dayBefore(today)) return 'Yesterday';
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(
      new Date(ms),
    );
  } catch {
    return day;
  }
}

/** "online" when active in the last 2 minutes, otherwise a short "last seen" label. */
export function presenceLabel(lastActiveAt: number): string {
  if (!lastActiveAt) return 'Deen Friend';
  if (Date.now() - lastActiveAt < 120000) return 'online';
  const day = formatDayLabel(lastActiveAt);
  return day === 'Today' ? `last seen ${formatClock(lastActiveAt)}` : `last seen ${day.toLowerCase()}`;
}

/* ---------- Firestore value readers ---------- */

/** Firestore Timestamp | Date | number | {seconds} -> epoch ms (0 when unknown). */
export function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const v = value as { toMillis?: () => number; seconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return 0;
}

export function asAvatar(value: unknown): AvatarKey {
  return (AVATAR_KEYS as readonly string[]).includes(String(value)) ? (value as AvatarKey) : 'crescent';
}

export function readPrivacy(value: unknown): PrivacySettings {
  const p = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    shareCheckinCards: p.shareCheckinCards !== false,
    showAchievements: p.showAchievements === true,
  };
}

/** deens_users document -> PublicProfile. Email and visitorId are deliberately not copied. */
export function readPublicProfile(uid: string, data: Record<string, unknown> | undefined): PublicProfile {
  const d = data || {};
  const username = String(d.username || '');
  return {
    uid,
    username,
    usernameKey: String(d.usernameKey || usernameKey(username)),
    displayName: String(d.displayName || d.name || username || 'Deen Friend'),
    avatar: asAvatar(d.avatar),
    bio: String(d.bio || ''),
    deenFocus: String(d.deenFocus || d.goals || ''),
    currentFocus: String(d.currentFocus || ''),
    favoriteSurah: String(d.favoriteSurah || ''),
    languages: String(d.languages || ''),
    field: String(d.field || ''),
    lastActiveAt: Number(d.lastActiveAt) || 0,
    privacy: readPrivacy(d.privacy),
  };
}

/* ---------- friend challenges ---------- */

/** Derives the visible state of a friend challenge from its stored status, completions and due time. */
export function challengeState(item: Interaction, now = Date.now()): ChallengeState {
  const status = item.status || 'pending';
  const completedBy = item.completedBy || {};
  if (status === 'declined') return 'declined';
  if ([item.senderUid, item.recipientUid].every((uid) => completedBy[uid])) return 'completed';
  if (now > item.expiresAtMs) return status === 'pending' ? 'expired' : 'missed';
  if (status === 'accepted') return Object.keys(completedBy).length ? 'in_progress' : 'accepted';
  return 'pending';
}

export function isChallengeActive(item: Interaction, now = Date.now()): boolean {
  const state = challengeState(item, now);
  return state === 'pending' || state === 'accepted' || state === 'in_progress';
}

/** A Tasbih challenge is completed by counting in the existing Tasbih. */
export function isTasbihChallenge(item: Interaction): boolean {
  const c = item.challenge;
  if (!c || (Number(c.target) || 1) < 2) return false;
  if (c.activity) return c.activity === 'tasbih';
  return c.type === 'istighfar' || /^(zikr|istighfar)$/i.test(String(c.category || ''));
}

/** Sorted pair id used by deens_friendships and deens_friend_streaks. */
export function friendshipIdFor(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

/** Short random id segment for client-generated document ids. */
export function randomId(length = 12): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
