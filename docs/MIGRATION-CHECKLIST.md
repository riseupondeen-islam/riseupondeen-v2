# Feature-by-feature migration checklist

**Implementation:**

- **React** — rewritten as React components or hooks; the old controller was removed.
- **Shell** — markup is a React component; behaviour comes from the migrated controller.
- **Module** — the original controller logic, now an ES module with explicit imports, started by the runtime.

**Verification methods** (see [TEST-REPORT.md](TEST-REPORT.md)):

| Code | Method |
| --- | --- |
| **PX** | Pixel comparison against the original (2 viewports × 2 themes) |
| **DOM** | Full normalised DOM comparison against the original |
| **BEH** | Scripted interaction parity against the original (identical results) |
| **FB** | Same flow against the original and the new build with the in-memory Firebase; identical UI **and** identical Firestore operations |
| **E2E** | Automated Playwright test in `tests/e2e` (68 tests, all passing) |
| **SW** | Service-worker offline / upgrade test |
| **–** | Could not be tested in this environment (see the limitation noted) |

## Public site

| Feature | Where | Impl. | Verified | Status |
| --- | --- | --- | --- | --- |
| App header (logo, Home, reminders, My Deen, Deen Friends, Explore, theme) | `components/layout/AppHeader.tsx` | Shell | PX DOM BEH | ✅ |
| Theme toggle (light/dark, persistence, cross-tab sync) | `components/controls/ThemeToggle.tsx`, `services/theme` | React | PX BEH E2E | ✅ (label bug fixed) |
| Theme pre-paint (no flash) | `index.html` (unchanged script) | – | PX | ✅ |
| Intro preloader (once per session) | `components/layout/Preloader.tsx` + `features/home/homeInteractions.js` | Shell | PX | ✅ |
| First-visit name prompt + unique name reservation | `features/visitor/*` | Shell + Module | PX (returning) / BEH (first visit screen) | ✅ (reservation transaction: FB path not exercised) |
| Home: hero, quick actions, Ask Rise launcher, smart-home shortcuts | `features/home/sections/HeroSection.tsx`, `features/my-deen/myDeen.js` | Shell | PX DOM BEH | ✅ |
| Home: daily reflection, guidance, Names preview, final reflection, footer | `features/home/*` | Shell + Module | PX DOM FB | ✅ |
| Live home content (cache-first, refresh from Firestore) | `services/content/*`, `features/home/homeContent.js` | Module | FB E2E | ✅ |
| Names of Allah dialog | `features/names/components/NameModal.tsx` | React | BEH E2E | ✅ (focus bugs fixed) |
| All Names (View all) / `#names` library / `#name/<id>` | `features/library/readers.js`, `AllNamesModal.tsx` | Shell + Module | BEH E2E | ✅ |
| Duas / Hadith / Reminders libraries and readers, Save, Share, Poster, Offline | `features/library/readers.js` | Module | BEH E2E | ✅ (poster/share/download not exercised) |
| Saved for Later (`#saved`) | `features/library/readers.js` | Module | BEH E2E | ✅ (Qur'an bookmarks bug fixed) |
| For Your Heart (`#heart`, `#heart/<n>`) | `features/library/readers.js`, `features/heart/*` | Module | BEH | ✅ (data verified identical) |
| Back lane / library × / detail navbar | `components/navigation/BackLane.tsx`, `LibraryCloseButton.tsx`, `hooks/useRouteChrome.ts` | React | DOM BEH E2E | ✅ |
| Explore drawer | `components/navigation/ExploreDrawer.tsx`, `features/navigation/exploreDrawer.js` | Shell + Module | BEH E2E | ✅ |
| Ask Rise (search, intents, Qur'anic names, voice, read-aloud) | `features/ask-rise/*` | Shell + Module | PX BEH E2E | ✅ (speech recognition/synthesis not exercised headless) |
| Qur'an: library, search, reader, deep links, study, memorisation, notes, reciters, Urdu | `features/quran/*` | Module | PX BEH E2E SW | ✅ (Urdu text/audio API blocked here: –) |
| Qur'an recitation engine (single native audio element) | `features/quran/quran.js` | Module | BEH (desktop, success + failure) E2E | ✅ desktop; **mobile/iOS/PWA: –** |
| Qur'an text dataset (2.5 MB) | `features/quran/data/*.json` | Lazy JSON | Byte-for-byte equality check; SW offline | ✅ |
| Prayer times (API + on-device fallback), live clock, Qibla compass, nearby masjids | `features/prayer/prayerQibla.js` | Module | PX BEH (on-device times; compass start) | ✅ (prayer API, device sensors: –) |
| Tasbih (counter, Zikr selection, Deen Friends challenges) | `features/tasbih/tasbih.js` | Module | PX BEH E2E FB (Zikr list) | ✅ (challenge completion write: –) |
| Zakat calculator (`#tracker`) | `features/zakat/*` | React | PX DOM BEH E2E | ✅ |
| Sadaqah (`#sadaqah`) | `features/sadaqah/*` | React | PX DOM BEH E2E | ✅ |
| Hajj & Umrah guides + Journey Mode | `features/hajj-umrah/*` | React | PX DOM BEH E2E | ✅ |
| My Deen (journey, adhkar, khatam, goals, daily plan, Ramadan, backup/restore, reading settings) | `features/my-deen/myDeen.js` | Module | PX BEH | ✅ (backup file download/restore: –) |
| Reminder Center / push notifications (opt-in, categories, prayer reminders, FCM) | `features/notifications/pushNotifications.js`, `public/sw.js` | Module | BEH (UI) | ⚠️ UI verified; **real push delivery: –** |
| Admin broadcasts (public overlay, audience, receipts) | `features/broadcast/*` | Shell + Module | FB (listener) | ✅ (display of a live broadcast: –) |
| Maintenance mode (public screen, countdown, allow-list) | `features/maintenance/maintenance.js` | Module | FB (listener) | ⚠️ activation not exercised |
| Visitor analytics (sessions, install detection) | `features/analytics/visitorAnalytics.js` | Module | FB (identical write payloads) | ✅ |
| Deen Friends: sign in/up, profile, friends, requests, streaks, interactions, challenges | `features/deen-friends/deenFriends.js` | Module | FB (auth gate, create account, add friend) | ✅ for tested flows; multi-user flows (requests, chat, challenges): **–** |
| Zoom lock, page-visibility pause, device performance budget | `hooks/*` | React | BEH (listener counts) | ✅ |
| Scroll restoration / history Back | `app/scrollEngine.js` | Module | BEH | ✅ |
| PWA install prompt (Android) / iOS tutorial | `features/pwa/pwaInstall.js` | Module | – | ⚠️ needs a real device |
| Offline use after first visit | `public/sw.js` | Module | SW E2E | ✅ |
| Service-worker upgrade from the old single-file app | `public/sw.js` | – | SW | ✅ (old shell cache removed, audio + content caches kept) |
| Notification click → route | `public/sw.js` (unchanged handler) | – | – | ⚠️ needs real push |

## Admin console (`#admin`)

| Feature | Where | Impl. | Verified | Status |
| --- | --- | --- | --- | --- |
| Login / logout, admin-only gate | `features/admin/adminAuth.js`, `services/firebase/authListener.js` | Shell + Module | FB E2E | ✅ (freeze bug fixed) |
| Lazy loading of the console | `features/admin/adminLoader.ts`, `adminConsole.ts` | TS | FB E2E SW | ✅ |
| Names / Duas / Hadith / Reminders / Zikr / Sadaqah managers (search, filters, publish, feature, fulfil, bulk delete) | `features/admin/views/contentManager.js` | Module | FB E2E | ✅ |
| Content editor (create/edit, drafts, scheduling, media upload) | `features/admin/views/contentEditor.js` | Module | FB (editor opens; publish path) | ⚠️ upload to Storage not exercised |
| Recycle Bin (move, restore, delete forever) | `features/admin/contentTrash.js`, `views/trashView.js` | Module | FB E2E | ✅ (restore/delete-forever not exercised) |
| Bulk upload (Excel/CSV via SheetJS CDN) | `features/admin/views/bulkUpload.js` | Module | – | ⚠️ SheetJS CDN blocked here |
| Scheduled publishing | `features/admin/views/scheduledView.js` | Module | FB | ✅ |
| Analytics (sessions, online/offline, deletion) | `features/admin/views/analyticsView.js` | Module | FB | ✅ |
| Broadcast composer | `features/admin/views/broadcastView.js` | Module | FB (view) | ✅ |
| Send Notification (push queue) | `features/admin/views/notificationsView.js` | Module | FB (view) | ✅ |
| Maintenance mode settings | `features/admin/views/maintenanceView.js` | Module | FB (view) | ✅ |
| Deen Friends Trust & Safety console (all tabs) | `features/admin/views/deenFriendsAdminView.js` | Module | FB (opens, loads all collections) | ✅ (password-reset bug fixed) |
| Site Content / Settings | `features/admin/views/siteContent.js` | Module | – | ⚠️ not exercised |
| Content preview window | `features/admin/views/contentPreview.js` | Module | – | ⚠️ not exercised |
| Rows-per-page pager | `features/admin/adminPager.js` | Module | FB | ✅ |

## Platform and backend

| Item | Status |
| --- | --- |
| `firestore.rules` | **Unchanged** (byte-identical) |
| `firestore.indexes.json` | **Unchanged** |
| Firebase project / collections / fields / queries | Unchanged; tested flows compared operation by operation |
| `push-scheduler/` + GitHub workflow | **Unchanged** |
| `manifest.webmanifest`, icons | **Unchanged** |
| `public/sw.js` | Minimal documented addition (precache of hashed build files) — see CONFIG-CHANGES |
| `firebase.json` | Hosting serves `dist/`, cache header for hashed assets, predeploy build — see CONFIG-CHANGES |
