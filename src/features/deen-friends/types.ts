/* Data contracts for Deen Friends.
 *
 * These mirror the documents that already exist in Firestore (see firestore.rules). Field names are
 * kept exactly as stored so existing production data keeps working. New collections added in V2
 * (Daily Deen Challenges and the official RISE conversation) are documented next to their types.
 */

export const AVATAR_KEYS = ['crescent', 'mecca', 'madina', 'mosque', 'quran', 'lantern', 'minaret'] as const;
export type AvatarKey = (typeof AVATAR_KEYS)[number];

/** What a user chooses to share with friends. Absent fields mean the private default. */
export interface PrivacySettings {
  /** Post a "checked in today" card into the chat when I check in. Default: true (it was always on). */
  shareCheckinCards: boolean;
  /** Show my milestone badges on my profile card to friends. Default: false. */
  showAchievements: boolean;
}

/** deens_users/{uid} as seen by other signed-in users (email is never read into this type). */
export interface PublicProfile {
  uid: string;
  username: string;
  usernameKey: string;
  displayName: string;
  avatar: AvatarKey;
  bio: string;
  deenFocus: string;
  currentFocus: string;
  favoriteSurah: string;
  languages: string;
  field: string;
  /** Epoch ms of the last activity heartbeat (used for "online" / "last seen"). */
  lastActiveAt: number;
  privacy: PrivacySettings;
}

/** The signed-in user's own profile. */
export interface OwnProfile extends PublicProfile {
  email: string;
  visitorId: string;
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'rejected';

/** deens_friend_requests/{requestId} */
export interface FriendRequest {
  id: string;
  fromUid: string;
  toUid: string;
  status: FriendRequestStatus;
  createdAtMs: number;
}

/** deens_friendships/{uidA_uidB} — the ID is the two UIDs sorted and joined with "_". */
export interface Friendship {
  id: string;
  members: string[];
  friendUid: string;
  streakCount: number;
  createdAtMs: number;
}

/** deens_friend_streaks/{friendshipId} */
export interface StreakRecord {
  id: string;
  members: string[];
  count: number;
  /** Last local date (YYYY-MM-DD) on which BOTH friends checked in. */
  lastBothDate: string;
  /** uid -> last local date that member checked in. */
  checkins: Record<string, string>;
  bothDates: string[];
}

export type ChallengeActivity = 'manual' | 'tasbih';

export interface ChallengeDetails {
  /** Recommended goal key, 'custom' for user-created, 'official' for an admin template. */
  type: string;
  category: string;
  title: string;
  description?: string;
  target: number;
  activity?: ChallengeActivity;
  official?: boolean;
  officialId?: string;
}

export type InteractionKind = 'challenge' | 'checkin' | 'encourage' | 'content';

export type SharedContentType = 'quran' | 'dua' | 'hadith' | 'zikr' | 'reminder';

export interface SharedContent {
  id: string;
  type: SharedContentType;
  title: string;
  preview?: string;
  reference?: string;
  arabic?: string;
}

export type ChallengeStatus = 'pending' | 'accepted' | 'declined';

/** deens_friend_messages/{id} — one record per Deen interaction between two friends. */
export interface Interaction {
  id: string;
  friendshipId: string;
  senderUid: string;
  recipientUid: string;
  kind: InteractionKind;
  text: string;
  createdAtMs: number;
  expiresAtMs: number;
  readAtMs?: number;
  challenge?: ChallengeDetails;
  status?: ChallengeStatus;
  completedBy?: Record<string, string>;
  sharedContent?: SharedContent;
  /** Local write not yet confirmed by the server. */
  pending?: boolean;
}

/** Derived (never stored) state of a friend challenge. */
export type ChallengeState = 'pending' | 'accepted' | 'in_progress' | 'completed' | 'declined' | 'expired' | 'missed';

/* ---------------------------------------------------------------------------------------------
   Daily Deen Challenges (admin-created) — collection deens_daily_challenges/{challengeId}
   Kept separate from friend challenges (deens_friend_messages, kind "challenge") on purpose:
   different author, audience and lifecycle. challengeType is always "daily_deen".
   --------------------------------------------------------------------------------------------- */
export type DailyChallengeStatus = 'draft' | 'published' | 'archived';
export type DailyChallengeAudience = 'all' | 'selected';

export interface DailyChallenge {
  id: string;
  challengeType: 'daily_deen';
  title: string;
  description: string;
  instructions: string;
  category: string;
  activity: ChallengeActivity;
  /** Count per day (Tasbih target) — 1 for "mark as done". */
  target: number;
  /** Local dates, YYYY-MM-DD, inclusive. */
  startDate: string;
  endDate: string;
  /** Days of completion needed to finish the challenge (1 … length of the date range). */
  requiredDays: number;
  status: DailyChallengeStatus;
  audience: DailyChallengeAudience;
  assignedUids: string[];
  createdBy: string;
  updatedAtMs: number;
}

/** deens_daily_challenges/{challengeId}/participants/{uid} — written only by that user. */
export interface DailyChallengeProgress {
  uid: string;
  challengeId: string;
  completedDates: string[];
  completedCount: number;
  lastCompletedDate: string;
  status: 'active' | 'completed';
}

/* ---------------------------------------------------------------------------------------------
   Official RISE conversation — deens_rise_threads/{uid} (+ /messages/{messageId})
   One private thread per user with the RiseUponDeen team. Separate from friend interactions.
   --------------------------------------------------------------------------------------------- */
export type RiseSender = 'user' | 'rise';

export interface RiseMessage {
  id: string;
  from: RiseSender;
  text: string;
  createdAtMs: number;
  /** True for system-generated messages (the one-time welcome). Never shown as a human reply. */
  automated: boolean;
  pending?: boolean;
}

export interface RiseThread {
  uid: string;
  displayName: string;
  username: string;
  lastMessagePreview: string;
  lastFrom: RiseSender;
  lastMessageAtMs: number;
  unreadByUser: number;
  unreadByRise: number;
  status: 'open' | 'resolved';
}
