/* Data model of the existing Firestore `content` collection (unchanged by the migration).
   One collection holds every content type; `type` selects which fields are used. */

/** Firestore Timestamp as returned by the SDK, or its cached `{ seconds }` form in localStorage. */
export type TimestampLike = { seconds: number; nanoseconds?: number; toMillis?: () => number; toDate?: () => Date };

export type ContentType =
  | 'hadith'
  | 'dua'
  | 'reminder'
  | 'name'
  | 'zikr'
  | 'sadaqah'
  | 'reflection'
  | 'article'
  | 'site';

export interface ContentItem {
  id: string;
  type: ContentType | string;
  title?: string;
  number?: number | null;
  description?: string;
  content?: string;
  author?: string;
  image?: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaType?: string;
  arabic?: string;
  translation?: string;
  source?: string;
  reference?: string;
  reflection?: string;
  transliteration?: string;
  meaning?: string;
  whenToRecite?: string;
  recommendedCount?: number | null;
  displayOrder?: number | null;
  /** Sadaqah requests */
  upiId?: string;
  verifiedDate?: string;
  fulfilled?: boolean;
  category?: string;
  keywords?: string;
  featured?: boolean;
  published?: boolean;
  scheduledAt?: TimestampLike | Date | null;
  scheduleStatus?: 'scheduled' | null;
  createdAt?: TimestampLike;
  updatedAt?: TimestampLike;
  /** Site content (type "site") and maintenance config carry extra keys. */
  [key: string]: unknown;
}

/** localStorage "rud_public_firestore_v2": the published snapshot used for instant/offline start-up. */
export interface PublicContentCache {
  items: ContentItem[];
  savedAt: number;
  version: number;
  complete: boolean;
}
