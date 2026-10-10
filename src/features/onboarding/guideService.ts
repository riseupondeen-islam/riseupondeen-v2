/* Loading, caching and publishing the App Guide configuration, and each device's guide progress.
 *
 *   rud_app_guides/published   public read; written only by community-level admins (firestore.rules)
 *   rud_app_guides/draft       admins only
 *
 * The app reads the published document once per session (no listener) and caches it, so the guide
 * also works offline. Progress is kept per device in localStorage. */
import { doc, getDoc, serverTimestamp, setDoc } from '../../services/firebase/sdk';
import { waitForFirebase } from '../deen-friends/services/firebaseSession';
import { DEFAULT_GUIDE, sanitizeGuide, type GuideConfig } from './guideConfig';

const CACHE_KEY = 'rud_app_guide_config_v1';
const PROGRESS_KEY = 'rud_onboarding_v1';

export interface GuideProgress {
  firstRunDone?: boolean;
  /** The configuration version the visitor finished (or dismissed) first-run on. */
  firstRunVersion?: number;
  tours?: Record<string, { doneAt: number }>;
  resume?: { tourId: string; step: number } | null;
}

export function readProgress(): GuideProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
    if (raw && typeof raw === 'object') {
      // Compatibility with the shape used during development ({ done: true }).
      if (raw.done === true && raw.firstRunDone === undefined) raw.firstRunDone = true;
      return raw;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function writeProgress(patch: Partial<GuideProgress>): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...readProgress(), ...patch }));
  } catch {
    /* storage blocked: the guide simply shows again next time */
  }
}

export function markTourDone(tourId: string): void {
  const progress = readProgress();
  writeProgress({ tours: { ...(progress.tours || {}), [tourId]: { doneAt: Date.now() } }, resume: null });
}

export function readCachedGuide(): GuideConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (raw) return sanitizeGuide(raw);
  } catch {
    /* ignore */
  }
  return DEFAULT_GUIDE;
}

let loaded: Promise<GuideConfig> | null = null;

/** The published configuration (cached; one Firestore read per session at most). */
export function loadPublishedGuide(): Promise<GuideConfig> {
  if (loaded) return loaded;
  loaded = (async () => {
    const handles = await waitForFirebase();
    if (!handles) return readCachedGuide();
    try {
      const snap = await getDoc(doc(handles.db, 'rud_app_guides', 'published'));
      if (!snap.exists()) return DEFAULT_GUIDE;
      const config = sanitizeGuide(snap.data());
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(config));
      } catch {
        /* ignore */
      }
      return config;
    } catch {
      return readCachedGuide();
    }
  })();
  return loaded;
}

/** Should the first-run walkthrough be offered on this device? */
export function firstRunDue(config: GuideConfig): boolean {
  if (!config.enabled || !config.firstRunTourId) return false;
  if (!config.tours.some((t) => t.id === config.firstRunTourId && t.enabled && t.steps.length)) return false;
  const progress = readProgress();
  if (!progress.firstRunDone) return true;
  // Re-offer only when an admin explicitly raised reshowOnVersion above what the visitor completed.
  return (progress.firstRunVersion || 1) < config.reshowOnVersion;
}

/* ---------- admin ---------- */

export async function loadGuideDraft(): Promise<{ draft: GuideConfig; published: GuideConfig | null }> {
  const handles = await waitForFirebase();
  if (!handles) throw new Error('Firebase is unavailable.');
  const [draft, published] = await Promise.all([
    getDoc(doc(handles.db, 'rud_app_guides', 'draft')),
    getDoc(doc(handles.db, 'rud_app_guides', 'published')),
  ]);
  const pub = published.exists() ? sanitizeGuide(published.data()) : null;
  return { draft: draft.exists() ? sanitizeGuide(draft.data()) : pub || DEFAULT_GUIDE, published: pub };
}

function payload(config: GuideConfig, uid: string) {
  const clean = sanitizeGuide(config);
  return { ...clean, updatedBy: uid, updatedAt: serverTimestamp(), updatedAtMs: Date.now() };
}

export async function saveGuideDraft(config: GuideConfig): Promise<void> {
  const handles = await waitForFirebase();
  const uid = handles?.auth.currentUser?.uid;
  if (!handles || !uid) throw new Error('Please sign in to the admin console again.');
  await setDoc(doc(handles.db, 'rud_app_guides', 'draft'), payload(config, uid));
}

/** Publishes the draft: the published copy gets the next version number. */
export async function publishGuide(config: GuideConfig, currentPublished: GuideConfig | null): Promise<GuideConfig> {
  const handles = await waitForFirebase();
  const uid = handles?.auth.currentUser?.uid;
  if (!handles || !uid) throw new Error('Please sign in to the admin console again.');
  const next = sanitizeGuide({ ...config, version: (currentPublished?.version || 0) + 1 });
  await setDoc(doc(handles.db, 'rud_app_guides', 'draft'), payload(next, uid));
  await setDoc(doc(handles.db, 'rud_app_guides', 'published'), payload(next, uid));
  loaded = Promise.resolve(next);
  return next;
}
