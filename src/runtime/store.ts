/* Shared mutable state for bindings that were global variables in the original script and are
   assigned from more than one feature module (Firebase handles, live content arrays, admin
   listeners). ES module imports are read-only, so these live on one typed object. */
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore, Unsubscribe } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { ContentItem } from '../types/content';

export interface AppState {
  /** Firebase handles — created once by services/firebase/firebaseInit. */
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
  storage: FirebaseStorage | null;
  firebaseReady: boolean;
  /** Published content shown publicly (from cache, then Firestore). */
  publicContent: ContentItem[];
  /** All content including drafts (admin console only). */
  adminContent: ContentItem[];
  publicUnsub: Unsubscribe | null;
  maintenanceUnsub: Unsubscribe | null;
  adminUnsub: Unsubscribe | null;
  adminScheduleTimer: ReturnType<typeof setTimeout> | null;
  currentAdminView: string;
  editingId: string | null;
  deleteTargetId: string | null;
  /** Signature of the last rendered home content (avoids rebuilding identical cards). */
  rudHomeLiveSig: string | null;
  adminAnalyticsUnsub: Unsubscribe | null;
  /** Rows parsed from an admin bulk-upload file, and the preset content type. */
  bulkRows: Array<Record<string, unknown>>;
  bulkPresetType: string;
}

export const S: AppState = {
  app: null,
  auth: null,
  db: null,
  storage: null,
  firebaseReady: false,
  publicContent: [],
  adminContent: [],
  publicUnsub: null,
  maintenanceUnsub: null,
  adminUnsub: null,
  adminScheduleTimer: null,
  currentAdminView: 'names',
  editingId: null,
  deleteTargetId: null,
  rudHomeLiveSig: null,
  adminAnalyticsUnsub: null,
  bulkRows: [],
  bulkPresetType: '',
};
