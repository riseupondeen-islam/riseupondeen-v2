# Bundle size and performance

## How these numbers were measured

Vite could not be installed in the migration environment (no npm registry access). The sizes below
come from a minified, code-split **esbuild** production bundle of the same sources. Vite uses the
same minifier, but Rollup draws chunk boundaries slightly differently. `npm run build` prints the
exact Vite numbers.

gzip sizes are measured at level 9 (Firebase Hosting compresses responses automatically). The
**Firebase SDK is excluded from both columns**: the original loaded it from the gstatic CDN, and the
new build ships the same SDK version (12.16) as lazily imported chunks.

## Initial page load (public visitor)

| | Original `index.html` | React build |
| --- | --- | --- |
| HTML | 4,518,456 B (1,227,982 B gzip). The single file contains everything below | 4.6 KB (2.0 KB gzip) |
| JavaScript downloaded and parsed on every load | 3,422,222 B (unminified), including 2.58 MB of Qur'an text | 676,504 B minified (199,277 B gzip), including React DOM |
| CSS | 868,496 B inline | 755,446 B minified (130,109 B gzip). The 40 KB Sadaqah image moved out of the CSS |
| Logo | Embedded 3× as base64 (≈190 KB of text) | One cached PNG, 47,480 B |
| **Total transferred (gzip)** | **≈1.23 MB** | **≈0.38 MB** (≈69% less) |

Additional effects:

- **The theme pre-paint is unchanged.** The static home page is painted by React as soon as the
  main chunk has run, before the feature controllers load. For returning visitors in the same
  session, the intro preloader is rendered already hidden, so nothing flashes while the controllers load.
- **The browser no longer parses 2.5 MB of Qur'an text on every page view.** Only visitors who open
  the Qur'an reader download it.

## Loaded on demand

| Chunk | Size (minified) | gzip | When |
| --- | --- | --- | --- |
| Qur'an text (Arabic + Saheeh International, 114 surahs) | 2,563,726 B (JSON) | 668,251 B | The first time the Qur'an reader opens a surah. Precached by the service worker for offline use. |
| Admin console (all admin views, bulk upload, preview, pager) | 232,973 B | 61,703 B | Only on the admin route |
| Firebase Messaging | (SDK) | | Only after the visitor enables notifications (unchanged) |

## Runtime work removed from public pages

- The admin table pager's `MutationObserver` watched the whole `<body>` subtree on every page and
  ran on every DOM change, for example Qur'an player time updates and Tasbih taps. It now runs only
  inside the admin console.
- Window/document listener counts are stable across navigation (measured: 31 window and 26
  document listeners after 1 and after 4 full cycles through 18 routes). There is one audio element
  and two Firestore listeners in steady state.
- React pages unmount on navigation. Their state, timers and listeners are cleaned up (React effects).

## Firestore reads and writes

React does not reduce Firestore usage by itself, and the migration did not change any query.
The tested flows were compared operation by operation against the original: the public live sync,
admin sign-in, all 13 admin views, content create/feature/delete, and Deen Friends sign-up. The
reads, listeners and writes were identical; only timing-dependent analytics heartbeats differed in
count.

One start-up behaviour was made deterministic instead of timing-dependent. On every page load, the
original practically always refreshed the published content from Firestore in the background,
because the CDN SDK finished loading after start-up. The bundled SDK can be ready a few
milliseconds earlier, which would have silently skipped that refresh for up to 30 minutes. The
refresh is now always scheduled exactly as before (`services/content/publicContentSync.js`), so
content freshness is unchanged.

## Caching

- Hashed `/assets/*` files: `Cache-Control: public, max-age=31536000, immutable` (Hosting), and
  cache-first in the service worker.
- `index.html` and `sw.js`: no-cache (unchanged), so deployments are picked up immediately.
- If an already-open tab requests a code chunk that a new deployment removed, the page reloads once
  (at most once a minute, and only when online).
