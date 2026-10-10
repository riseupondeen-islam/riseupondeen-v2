# Architecture

## Starting point

The original app was a single `index.html` (4.5 MB, 21,258 lines):

| Part | Size | Notes |
| --- | --- | --- |
| CSS | ~1 MB in **95 `<style>` blocks** | Layer upon layer of "final/fix" overrides, so cascade order matters |
| Body markup | ~218 KB | ≈600 elements. Most of the bytes were the logo, embedded three times as base64 |
| JavaScript | ~790 KB in 17 scripts | One 650 KB main script with ~550 global declarations; a 2.7 MB script, of which **2.5 MB was the embedded Qur'an text**; 15 smaller IIFE controllers |
| Firebase | `import()` from the gstatic CDN | Loaded dynamically so the app keeps working in cached/static mode when the CDN is unreachable |

Routing is hash-based (`#quran/2/255`, `#dua/<id>`, `#admin`, …). The home page is static markup. Every
other route is rendered as an HTML string into `<main id="dynamicPage">` by the scripts, which
attach behaviour mostly through delegated `document` listeners.

## Design goals and the trade-off made

You set the priorities in this order: **correctness → feature parity → UI fidelity → data integrity →
security → maintainability**. A from-scratch React rewrite of ~790 KB of imperative code could not be
verified against the live Firebase project from the migration environment. It would have put
admin, Deen Friends and user data at risk.

So the migration is done in two layers:

1. **Everything is now a structured React + Vite + TypeScript application.** React owns the
   application shell and lifecycle. Styles, markup, assets, data and controllers are separate
   modules with explicit dependencies. The build is code-split and lazy-loaded. Nothing is rendered
   through an iframe or as one giant component.
2. **Where behaviour could be proven identical, features are idiomatic React components.** For
   these features, the old controller has been deleted.

Large Firebase-backed flows (admin console, Deen Friends, Qur'an player, Ask Rise, My Deen, Prayer,
Tasbih) still run their original logic. That logic now lives in feature modules (ES modules with
imports and exports, Prettier-formatted, with a header comment). They are started in their
original order by a small runtime. They are ready to be converted to React one at a time, behind the
same tests (see "Converting a feature to React" below).

## The pieces

### React shell

`src/app/AppShell.tsx` renders the original `<body>` content in its original order: 25 components
such as `AppHeader`, `HomePage` (with 5 section components), `ExploreDrawer`, `AskRiseOverlay`,
`AdminApp`, `NameModal`, `Preloader` and `ToastStack`. The markup was converted to JSX mechanically
(see the verification notes). Whitespace text nodes are preserved, so inline layout is identical.
`#root` uses `display: contents`, so the original layout (designed for direct `<body>` children) is
unchanged. The four stylesheet selectors that used `body > main` / `body > footer` now use
`body > #root > …`.

The shell never re-renders (it is memoised and has no state). This matters: the controllers own the
DOM nodes they update.

### Feature controllers (the migrated scripts)

The split was produced with a scope-analysis script (built on the ESLint scope analyser, kept out
of this repository because it is only needed once). The script did the following:

- split each original script into feature modules (for example `features/quran/quran.js`,
  `features/admin/views/analyticsView.js`, `app/routing/router.js`)
- keep every top-level **function declaration** at module level (hoisted, as before)
- move every other top-level statement, including variable initialisers, into an exported `init()`
- turn every cross-module reference into an explicit named import or export
- move globals assigned from more than one module (the Firebase handles, the content arrays, the admin
  listeners) to one typed object, `runtime/store.ts` (`S.db`, `S.publicContent`, …)

Because `runtime/legacyRuntime.ts` calls the `init()` functions **in the original document order**,
statements run in the same sequence as they did in the single page. The original scripts ran while
the HTML was still parsing, so `DOMContentLoaded` and `load` fired after all of them.
`runtime/lifecycle.ts` keeps that ordering for listeners that relied on it.

Checks applied to the generated modules:

- no reference is left unresolved (every former global is imported)
- no module relies on sloppy-mode semantics (modules are strict)
- no code read a top-level function through `window.*` implicitly, except one case, which is now an import

### React feature pages

Routes converted to React render into the **same** `#dynamicPage` element, through a portal
(`app/pages/reactPageOutlet.tsx`), so every CSS selector and transition still applies.
`showReactPage()` in `app/routing/surfaces.js` mirrors the original `showPage()` (route-version guard,
scroll restoration, `rud-route-rendered` event). Before any controller writes into `#dynamicPage`, the
active React page is unmounted synchronously (`releaseReactPage()`), so React never holds detached
nodes.

| Converted to React | Files |
| --- | --- |
| Zakat calculator (`#tracker`) | `features/zakat/ZakatPage.tsx`, `zakatCalculator.ts` (pure, typed rules) |
| Sadaqah (`#sadaqah`) | `features/sadaqah/SadaqahPage.tsx`, `sadaqahRequests.ts` |
| Hajj & Umrah guides + Journey Mode (`#umrah`, `#hajj`) | `features/hajj-umrah/HajjUmrahPage.tsx`, `guidesData.ts` (content extracted by evaluating the original data), `journeyProgress.ts` |
| Names of Allah details dialog | `features/names/components/NameModal.tsx`, `nameDetails.ts` |
| Theme toggle | `components/controls/ThemeToggle.tsx`, `services/theme/theme.ts`, `hooks/useDocumentTheme.ts` |
| Back lane + library × | `components/navigation/BackLane.tsx`, `LibraryCloseButton.tsx`, `hooks/useRouteChrome.ts` |
| Zoom lock, page visibility, device performance budget | `hooks/useZoomLock.ts`, `usePageVisibilityClass.ts`, `useDevicePerformanceClass.ts` |
| Daily heart reflections data | `features/heart/dailyHeartReflections.ts` (typed, verified identical) |

### Firebase

- `services/firebase/sdk.ts` is the **only** place the SDK is imported. It uses the npm `firebase`
  package, version 12.16 (the same version the CDN served). The modules are dynamically imported
  chunks that start downloading at boot, exactly as before. If they cannot load, the app continues
  in cached/static mode, as the original did.
- `services/firebase/firebaseInit.js` creates one app with durable Auth persistence, Firestore with
  long-polling auto-detection, and Storage. This is unchanged.
- Collections, document IDs, fields, queries, listeners and writes are unchanged. The test suite
  compared every Firestore operation of the tested flows against the original, one operation at a time.
- `firestore.rules`, `firestore.indexes.json`, the Firebase project and the push scheduler are **untouched**.

### Lazy loading

| Chunk | Loaded when |
| --- | --- |
| React + shell + styles | Page load |
| Feature controllers (`legacyRuntime`) | Right after the first paint |
| Firebase SDK modules | Page load (in parallel, as before) |
| Admin console (≈233 KB minified) | Only when the admin route is opened (`features/admin/adminLoader.ts`) |
| Qur'an text (2.56 MB JSON, ≈668 KB gzip) | Only when the Qur'an reader needs it; precached by the service worker for offline use |
| Firebase Messaging | Only after the visitor enables notifications (unchanged) |

### Service worker

`public/sw.js` is the original worker with one addition. The app is no longer a single HTML file,
so the worker now also precaches this build's hashed files (`/assets/*`, list injected by
`vite.config.ts`). It serves them cache-first. Old shell and asset caches are cleaned up on
activation. **The Qur'an audio cache and the content snapshot cache are kept.** Push handling,
notification clicks and the Firebase Messaging background handler are unchanged.

## Converting a feature to React (recommended next steps)

The pattern used for Zakat, Sadaqah and Hajj & Umrah:

1. Write the component with the **same markup and class names** as the old template. Read
   dynamic values from props or state, and keep inputs uncontrolled if the old markup had no `value`
   attributes.
2. Register the route function the router already calls (for example `window.rudRenderZakat`) with
   `showReactPage(<Page/>, title)`.
3. Remove the old controller from `runtime/legacyRuntime.ts`, along with any delegated
   `document` listeners it owned.
4. Run `npm run test:e2e` and compare screenshots and DOM with the previous build.

Suggested order, from lowest to highest risk: Tasbih (keep the single Firestore write for Deen Friends
challenges), Prayer & Qibla, the Duas/Hadith/Reminders libraries and readers, My Deen, Ask Rise, Qur'an
reader (the audio engine should stay a single native element, as it is now), Deen Friends, and finally the
admin console views.

## V2: Deen Friends as the first fully React feature

Deen Friends (`src/features/deen-friends/`) is the first large controller converted end-to-end. It
is the model for converting further features:

- **Route adapter (`deenFriendsRoute.tsx`).** It keeps the legacy globals that the router and Tasbih
  call, and portals the lazily loaded React page into `#dynamicPage`. The router is unchanged.
- **One external store.** `state/deenFriendsStore.ts`, read via `useSyncExternalStore`. Firestore
  listeners start and stop with the session and the page, and are never duplicated.
- **Typed service modules.** These are the only place Firestore is used. Each write mirrors a rule in
  `firestore.rules`, and the rules are documented next to the code that depends on them.
- **Components** contain no Firestore calls. Full-screen chats render through a portal and hide the
  app chrome (`body.df2-chat-open`).
- **Admin additions** (`features/admin/react/`) mount React views into the existing admin shell
  (`#adminMain`) and unmount them when the admin switches sections.

Details: [DEEN-FRIENDS.md](DEEN-FRIENDS.md). Notifications: [PUSH-NOTIFICATIONS.md](PUSH-NOTIFICATIONS.md).
