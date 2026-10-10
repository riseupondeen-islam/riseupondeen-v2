# Rise Upon Deen V2 — React + Vite + TypeScript

This is the React migration of the Rise Upon Deen V2 web app (previously one 4.5 MB, 21,258-line
`index.html`). The UI, content, Firebase project, data model, security rules, PWA behaviour and
push scheduler are unchanged. The internal architecture is new, and a set of verified bugs is fixed.

- What changed and why: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Feature-by-feature checklist: [`docs/MIGRATION-CHECKLIST.md`](docs/MIGRATION-CHECKLIST.md)
- Bug-fix report: [`docs/BUG-FIXES.md`](docs/BUG-FIXES.md)
- Configuration changes: [`docs/CONFIG-CHANGES.md`](docs/CONFIG-CHANGES.md)
- Build, test results and known limitations: [`docs/TEST-REPORT.md`](docs/TEST-REPORT.md)
- Bundle size and performance: [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)
- **V2:** Deen Friends rebuild, data contracts, root causes and the TTL setup: [`docs/DEEN-FRIENDS.md`](docs/DEEN-FRIENDS.md)
- **V2:** Free push notifications (FCM + GitHub Actions): [`docs/PUSH-NOTIFICATIONS.md`](docs/PUSH-NOTIFICATIONS.md)

## Requirements

- Node.js 20.19+ (or 22.12+) and npm
- Firebase CLI (`npm i -g firebase-tools`) for deployment

No environment variables are needed. The Firebase web config lives in `src/services/firebase/config.ts`.
It contains the same public client identifiers the original page shipped. They are not secrets,
because access is enforced by `firestore.rules`. `public/sw.js` keeps its own copy for background push.

## First-time setup

```bash
npm ci                 # installs exactly what package-lock.json lists
npx playwright install chromium   # only needed for the end-to-end tests
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 (uses the **live** Firebase project) |
| `npm run build` | Type-check (`tsc -b`) and production build into `dist/` |
| `npm run preview` | Serve `dist/` locally on http://localhost:4173 |
| `npm run typecheck` | TypeScript only |
| `npm run test:scheduler` | Offline test of the Deen Friends notification sender (no credentials, sends nothing) |
| `npm run test:e2e` | Builds with `--mode e2e` (Firebase replaced by an in-memory test double) and runs the Playwright suite. It never touches production data. |
| `npm run deploy:hosting` | Build, then `firebase deploy --only hosting` |

The admin console is at `/#admin` (it redirects to the existing hidden login route).

## Deploying

Hosting now serves the build output (`dist/`) instead of the repository root:

```bash
npm run build
firebase deploy --only hosting
```

`firebase.json` also has a `predeploy` hook that runs `npm run build` automatically.
**V2 changed `firestore.rules` and `firestore.indexes.json`** (new Deen Friends collections and
tighter validation; nothing was loosened). Deploy them with the hosting build, and test them in the
emulator first:

```bash
firebase emulators:start --only firestore,auth   # optional check
firebase deploy --only firestore:rules,firestore:indexes
npm run build && firebase deploy --only hosting
gcloud firestore fields ttls update purgeAt --collection-group=deens_friend_messages --enable-ttl
```

The push scheduler (`push-scheduler/`) now also sends Deen Friends notifications. It needs the
`FIREBASE_SERVICE_ACCOUNT_JSON` repository secret, as before (see docs/PUSH-NOTIFICATIONS.md).
Nothing was deployed from this environment.

After the first deploy, existing installed PWAs update on their next launch. The service worker
replaces the old single-file app shell, keeps the Qur'an audio cache and the content snapshot, and
precaches the new hashed files so offline use continues to work.

## Project layout

```
index.html                 Vite entry (head metadata + the theme pre-paint script, unchanged)
public/                    sw.js, manifest.webmanifest, icons (served as-is)
src/
  main.tsx                 React root; starts the Firebase SDK download
  app/                     App, the static shell, routing (router, route surfaces), global UI
    pages/reactPageOutlet  How React feature pages render into the #dynamicPage route surface
  components/              Shell components (header, explore drawer, back lane, background, …)
  features/<feature>/      One folder per feature: React components (.tsx) and controllers (.js/.ts)
  hooks/                   React hooks (theme, route chrome, zoom lock, visibility, perf budget)
  runtime/                 Controller runtime: start-up order, document-lifecycle emulation, shared state
  services/                Firebase (single SDK loader + init), content cache/sync, theme
  styles/                  The original stylesheets, split into 12 files in the original cascade order
  types/                   Shared data types (Firestore content model)
tests/
  e2e/                     Playwright end-to-end tests
  fake-firebase/           In-memory Firebase test double (used only by `--mode e2e`)
  fixtures/                Test content and seeds
push-scheduler/            GitHub Actions push dispatcher (prayer, queued, Deen Friends)
firestore.rules, firestore.indexes.json   V2: Deen Friends additions
```

## How the app is put together (short version)

1. **React renders the application shell.** The header, home sections, explore drawer, overlays and
   admin shell are React components (`src/components`, `src/features/**/components`) with the
   original markup.
2. **Feature controllers attach behaviour.** These are the original scripts, now ES modules with
   explicit imports. Once the shell has rendered, `runtime/legacyRuntime.ts` starts them in their
   original order. Routes such as Qur'an, Prayer, Tasbih, the libraries, My Deen, Deen Friends and
   Ask Rise are rendered by these controllers into `#dynamicPage`, as before.
3. **Some features are fully converted to React:** Zakat, Sadaqah, Hajj & Umrah, the Names dialog,
   the theme toggle, the back lane / library close, and the app-level hooks. They use the same
   markup and CSS, verified identical.
4. **The admin console is a lazily loaded chunk.** It is downloaded only on the admin route.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains the design, the reasoning behind it, and how to
convert further features to React safely.

## Code formatting

Prettier settings are in `.prettierrc.json`. To format, run `npm run format`.
The stylesheets are kept exactly as migrated and are excluded from formatting.
