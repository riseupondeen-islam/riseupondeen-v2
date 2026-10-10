# Configuration changes

## V2 changes

| File | Change |
| --- | --- |
| `firestore.rules` | **Added** `deens_daily_challenges` (+ `participants`), `deens_rise_threads` (+ `messages`) and `deens_push_devices/{uid}/devices`. In existing Deen Friends rules: 4 more allowed encouragement phrases, the `reminder` content type, and an optional `purgeAt` (≤ 25 h ahead, non-challenge only) on read receipts. **No rule was loosened.** Every new collection is owner- or role-scoped, field-validated, and falls through to the default deny. |
| `firestore.rules` (update 2) | `visitor_usernames`: the **Super Admin only** may create or update a valid username record. The admin console's Create user, Edit profile and Approve username actions need this; they were always denied before. Nothing else changed. |
| `firestore.indexes.json` | Added two `deens_daily_challenges` composite indexes (status + audience, status + assignedUids). Other new queries use automatic single-field indexes. |
| `push-scheduler/index.js` | Calls the new `deenFriends.js` (isolated: a failure there cannot block prayer or queued notifications). |
| `push-scheduler/deenFriends.js` | New trusted sender for Deen Friends events. It uses server-only collections `push_scheduler_state` and `push_deliveries_df`, which have no client rules and are denied by default. |
| `.github/workflows/free-push-scheduler.yml` | Step renamed only; same secret, same schedule. |
| `package.json` | Added the script `test:scheduler`. Dependencies are unchanged, so `package-lock.json` stays valid. |
| Firestore TTL policy (console/gcloud, not a file) | **To enable:** `purgeAt` on `deens_friend_messages` (optionally `expireAt` on `push_deliveries_df`). |

The sections below describe the original migration.


## Unchanged in the original migration (byte-identical to the uploaded project)

`firestore.rules`, `firestore.indexes.json`, `.firebaserc`, `push-scheduler/index.js`,
`push-scheduler/package.json`, `.github/workflows/free-push-scheduler.yml`,
`manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`.

No Firebase project setting, collection, index, rule or backend function was changed or deployed.

## Changed

### `firebase.json`

```diff
-    "public": ".",
-    "ignore": ["firebase.json", "**/.*", "**/node_modules/**", ".github/**", "push-scheduler/**", "README-FREE.md"],
+    "public": "dist",
+    "predeploy": ["npm run build"],
+    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
 …
+      {"source":"/assets/**","headers":[{"key":"Cache-Control","value":"public, max-age=31536000, immutable"}]},
```

- **`public: "dist"`:** Hosting must serve the build output, not the source tree. The old ignore
  entries for `.github` and `push-scheduler` are no longer needed because those folders are not in `dist/`.
- **`predeploy`:** `firebase deploy --only hosting` now always deploys a fresh build.
- **`/assets/**` immutable caching:** Vite file names contain a content hash, so they can be cached
  for a year.
- **Unchanged:** the existing headers (`sw.js` no-cache, `index.html` no-cache, manifest, icons) and the
  SPA rewrite.

### `public/sw.js` (the existing service worker; minimal addition)

The original app was one HTML file, so caching `/` made it work offline. The build now emits hashed
JS, CSS and data files, and the worker must cache them too.

```diff
-const RUD_V2_SHELL_CACHE = 'rud-v2-shell-v8';
+const RUD_V2_SHELL_CACHE = 'rud-v2-shell-v9';
+const RUD_V2_BUILD_ID = 'dev'; /* build:id */          // filled in at build time
+const RUD_V2_BUILD_ASSETS = []; /* build:assets */      // filled in at build time
+const RUD_V2_ASSET_CACHE = `rud-v2-assets-${RUD_V2_BUILD_ID}`;
```

- **install:** also precaches this build's `/assets/*`, including the Qur'an text, so offline reading
  keeps working. Failures are tolerated individually (`Promise.allSettled`), as before.
- **activate:** also removes asset caches of previous builds. **The audio cache
  (`rud-v2-audio-v1`) and the content snapshot cache are kept**, as before.
- **fetch:** same-origin `/assets/*` requests are served cache-first, falling back to the network.
- **Unchanged:** push handling, notification clicks, the FCM background handler, audio range
  handling and the navigation strategy.
- The shell cache name was bumped to `v9`, so the cached single-file app is replaced on update.

`vite.config.ts` (plugin `rud-service-worker-precache`) writes the asset list and build id into
`dist/sw.js` after each build. It fails the build if the markers are missing.

### `index.html`

This is now the Vite entry point.

- **Kept unchanged:** the head metadata, the theme pre-paint script, the manifest link, the VAPID
  key meta and the font loading.
- **Removed:** the `<link rel="modulepreload">` / preconnect hints for the gstatic Firebase CDN,
  because the SDK is now bundled and served from the app's own origin. The Firestore preconnect is kept.
- **Body:** `<div id="root">` plus the module script. The markup and styles moved into `src/`.

### `.gitignore`

The original entries (service-account files, `.env`, `node_modules/`) are kept.
`dist/`, `dist-e2e/`, `.firebase/`, `test-results/` and `playwright-report/` were added.

## New files

| File | Purpose |
| --- | --- |
| `package.json` | Scripts and dependencies: React 19, firebase 12.16, Vite 7, TypeScript 5.9, Playwright, Prettier. Run `npm install` to create the lockfile. |
| `vite.config.ts` | React plugin, SW precache plugin, `--mode e2e` alias to the Firebase test double, chunking |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` | TypeScript (strict) for the app and for the config/tests |
| `playwright.config.ts`, `tests/` | End-to-end suite (uses the in-memory Firebase test double only) |
| `.prettierrc.json`, `.prettierignore` | Code formatting |
| `docs/` | These reports |

## Environment variables

None are required. There is no `.env.example` because the app needs no secrets: the Firebase web
config is public and is enforced by the security rules. The push scheduler keeps reading
`FIREBASE_SERVICE_ACCOUNT_JSON` from GitHub Actions secrets, as before. No credentials are present
in this repository.
