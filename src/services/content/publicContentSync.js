/**
 * Published-content sync: cache-first render, lightweight version check and refresh from Firestore.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { rudIsAdminRoute } from '../../app/routing/routeState';
import { rudRouteAfterContent } from '../../app/routing/surfaces';
import { renderHomeLive } from '../../features/home/homeContent';
import { syncMaintenanceFromContent } from '../../features/maintenance/maintenance';
import { $, COLLECTION } from '../../runtime/core';
import {
  PUBLIC_CACHE_KEY,
  PUBLIC_REVALIDATE_MS,
  cachePublicContent,
  readPublicCache,
  readSharedPublicCache,
  rudDeduplicateContent,
} from './publicContentCache';
import { firebaseInitPromise } from '../firebase/firebaseInit';
import { collection, getDocs, limit, orderBy, query, where } from '../firebase/sdk';
import { millis, sorted } from '../../utils/ui';

let publicReadyResolve, publicReadyPromise, publicSnapshotComplete, publicSharedCacheChecked, publicFetchPromise;

function publicFailure() {
  S.rudHomeLiveSig = null;
  const x = `<div class="empty-live">The content library is temporarily unavailable.</div>`;
  ['#latestLiveGrid', '#featuredLiveGrid'].forEach((s) => {
    const el = $(s);
    if (el) el.innerHTML = x;
  });

  /* Guidance teasers remain usable even if Firestore is temporarily unavailable. */
  const duaRoot = $('#homeDuaSpotlight');
  if (duaRoot) {
    duaRoot.innerHTML = `<div class="guidance-ribbon-copy"><strong>Turn to Allah.</strong><span>Explore Duas.</span></div><a class="guidance-ribbon-link" href="#duas" data-public-route="#duas">Explore Duas <i>↗</i></a>`;
  }
  const hadithRoot = $('#homeHadithSpotlight');
  if (hadithRoot) {
    hadithRoot.innerHTML = `<div class="guidance-ribbon-copy"><strong>Prophetic Guidance.</strong><span>Explore Hadith.</span></div><a class="guidance-ribbon-link" href="#hadith" data-public-route="#hadith">Explore Hadith <i>↗</i></a>`;
  }
}
function finishPublicReady() {
  if (publicSnapshotComplete && publicReadyResolve) {
    const resolve = publicReadyResolve;
    publicReadyResolve = null;
    resolve(S.publicContent);
  }
}
function applyPublishedSnapshot(snapshot) {
  const live = rudDeduplicateContent(
    sorted(snapshot).filter((x) => x.type !== 'article'),
    { publishedOnly: true },
  );
  S.publicContent = live;
  publicSnapshotComplete = true;
  window.RUD_PUBLIC_CONTENT = S.publicContent;
  cachePublicContent(S.publicContent);
  syncMaintenanceFromContent(S.publicContent);
  renderHomeLive();
  rudRouteAfterContent();
  finishPublicReady();
  try {
    window.dispatchEvent(new CustomEvent('rud:public-content-updated', { detail: { routerRendered: true } }));
  } catch {}
}
async function startPublic({ force = false } = {}) {
  /* Readiness is sampled before the asynchronous shared-cache read below. In the original page
     the CDN SDK was practically never ready at start-up, so the first call always scheduled a
     background refresh of the published content once Firebase connected. The bundled SDK can be
     ready a few milliseconds earlier; sampling here keeps that start-up refresh deterministic. */
  const firebaseReadyAtStart = S.firebaseReady;
  const cached = readPublicCache();
  let bestCache = cached;

  /* Cache-first: render an already-published snapshot immediately. */
  if (!S.publicContent.length && cached.items.length) {
    S.publicContent = rudDeduplicateContent(cached.items, { publishedOnly: true });
    window.RUD_PUBLIC_CONTENT = S.publicContent;
    syncMaintenanceFromContent(S.publicContent);
    renderHomeLive();
    rudRouteAfterContent();
  }

  /* Installed/PWA mode can reuse the shared origin snapshot even when its
     localStorage partition starts empty. Preserve the original cache age. */
  if (!publicSharedCacheChecked) {
    publicSharedCacheChecked = true;
    const shared = await readSharedPublicCache();
    if (shared.items.length && (!bestCache.items.length || shared.savedAt > bestCache.savedAt)) {
      bestCache = shared;
      S.publicContent = rudDeduplicateContent(shared.items, { publishedOnly: true });
      window.RUD_PUBLIC_CONTENT = S.publicContent;
      try {
        localStorage.setItem(
          PUBLIC_CACHE_KEY,
          JSON.stringify({
            items: shared.items,
            savedAt: shared.savedAt,
            version: shared.version,
            complete: shared.complete,
          }),
        );
      } catch {}
      syncMaintenanceFromContent(S.publicContent);
      renderHomeLive();
      rudRouteAfterContent();
    }
  }

  if (!firebaseReadyAtStart || !S.firebaseReady) {
    publicSnapshotComplete = bestCache.complete === true || bestCache.items.length > 0;
    finishPublicReady();
    firebaseInitPromise
      .then(() => {
        if (S.firebaseReady && !rudIsAdminRoute() && S.publicContent.length) {
          startPublic({ force: true }).catch((err) =>
            console.warn('[Rise Upon Deen] Background public sync deferred.', err),
          );
        }
      })
      .catch(() => {});
    return S.publicContent;
  }
  if (rudIsAdminRoute()) return S.publicContent;

  const fresh =
    bestCache.complete === true &&
    bestCache.items.length > 0 &&
    Date.now() - Number(bestCache.savedAt || 0) < PUBLIC_REVALIDATE_MS;
  if (!force && fresh) {
    publicSnapshotComplete = true;
    finishPublicReady();
    return S.publicContent;
  }
  if (publicFetchPromise) return publicFetchPromise;

  /* Static public content does not keep a permanent listener. When a complete
     cache exists, first read only the newest updated document as a lightweight
     version signal; the full published snapshot is fetched only when changed. */
  publicFetchPromise = (async () => {
    try {
      if (!force && bestCache.complete === true && bestCache.items.length) {
        try {
          const latest = await getDocs(query(collection(S.db, COLLECTION), orderBy('updatedAt', 'desc'), limit(1)));
          const newest = latest.docs[0]?.data?.() || null;
          const remoteVersion = Math.max(millis(newest?.updatedAt), millis(newest?.createdAt));
          if (remoteVersion && remoteVersion <= Number(bestCache.version || 0)) {
            cachePublicContent(S.publicContent);
            publicSnapshotComplete = true;
            finishPublicReady();
            return S.publicContent;
          }
        } catch (versionError) {
          console.warn('Lightweight public version check unavailable; using normal refresh.', versionError);
        }
      }
      const snapshot = await getDocs(query(collection(S.db, COLLECTION), where('published', '==', true)));
      applyPublishedSnapshot(snapshot);
      return S.publicContent;
    } catch (err) {
      console.error('Published content refresh failed', err);
      const fallback = readPublicCache();
      if (fallback.items.length && !S.publicContent.length) {
        S.publicContent = rudDeduplicateContent(fallback.items, { publishedOnly: true });
        window.RUD_PUBLIC_CONTENT = S.publicContent;
        syncMaintenanceFromContent(S.publicContent);
        renderHomeLive();
        rudRouteAfterContent();
      } else if (!S.publicContent.length) {
        publicFailure();
      }
      publicSnapshotComplete = true;
      finishPublicReady();
      if (err?.code === 'permission-denied')
        console.warn('Published content cannot be read publicly. Check Firestore Rules.');
      return S.publicContent;
    } finally {
      publicFetchPromise = null;
    }
  })();
  return publicFetchPromise;
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  publicReadyResolve = null;
  publicReadyPromise = new Promise((resolve) => {
    publicReadyResolve = resolve;
  });
  publicSnapshotComplete = false;
  publicSharedCacheChecked = false;
  publicFetchPromise = null;
  window.RUD_startPublic = startPublic;
  window.RUD_whenPublicReady = () => (publicSnapshotComplete ? Promise.resolve(S.publicContent) : publicReadyPromise);
}

export { publicSnapshotComplete, startPublic };
