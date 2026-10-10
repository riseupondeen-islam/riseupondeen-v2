# Build and test report

## V3 update

Same sandbox limits (no npm registry, no Google/Firebase network). Details and root causes:
[V3-IMPLEMENTATION.md](V3-IMPLEMENTATION.md).

| Area | Check | Result |
| --- | --- | --- |
| Types | strict `tsc` over all TS/TSX (local React/Firebase stubs) | **PASS**, 0 errors |
| E2E suite | Playwright, Pixel 7 emulation + 1440×900 desktop, in-memory Firebase with rules model | **PASS**: 147 passed, 3 skipped (touch-only tests on desktop), 150 runs — 111 existing + 19 new V3 tests × 2 layouts |
| Scheduler | `maintenance.test.js` (RISE 24 h retention, suggestions) and existing sender test | **PASS** |
| Navigation / logos | order Home · My Deen · Notifications · Deen Friends · theme · Explore; equal icon size; icons are the supplied master at 192/512/maskable | **PASS** |
| Makkah scene | absolute at top, scrolls away; sky layer fixed | **PASS** |
| Notification cards | tone/title, max 3, dismiss | **PASS** |
| Tasbih (Chromium/Android engine) | one tap = +1; bounce and number animations actually run | **PASS** (emulation); real Android **NOT VERIFIED** |
| 99 Names | no offline action in the reader; no empty band in cards | **PASS** |
| App Guide | first-run card once; tour Next/Back/Skip; replay; route-changing feature tour; no page errors | **PASS** |
| Admin App Guide editor | save draft, publish v1 | **PASS** |
| Instagram (Android UA) | card, Chrome intent link, dismissal remembered | **PASS** (UA simulation) |
| iOS Safari walkthrough | steps, Back/Next/"I've done this", close restores page | **PASS** (UA simulation); real iPhone **NOT VERIFIED** |
| Android install | real `prompt()` called once, Installing… → Installed on `appinstalled` | **PASS** (events dispatched by the test) |
| Usernames | spaces/underscore/symbols rejected; `AISHA` taken by `aisha` | **PASS** |
| Streak / points / leaderboard | one transaction writes completion + activity + streak + entry; first place shown; no email in entry | **PASS** |
| Deen circles | 4-person minimum guidance; created with friends; 3-person circle refused by rules model; encouragement | **PASS** |
| Chat scroll lock + themes | body pinned while chat and nested sheet open; position restored; Layl theme reaches sheet and buttons | **PASS** |
| Shared content | full translation (no truncation), RTL Arabic, transliteration, reference | **PASS** |
| Suggestions | mutual first; excludes friends, pending, non-discoverable; no email | **PASS** |
| Avatar + public preview | builder saves validated config; preview shows public card without email | **PASS** |
| RISE Clear Chat | only when solved; typed username; welcome kept; audit log | **PASS** |
| 360 px / no horizontal scroll | all Deen Friends tabs | **PASS** |
| Vite build, rules emulator, real devices, live Firebase | | **NOT VERIFIED** (see V3-IMPLEMENTATION.md §7) |

Two defects were found by the new tests and fixed: the header logo tile and the chat scroll lock
were both silently overridden by `!important` rules in `01-base.css`; and the rules model let
unmodelled top-level collections through before the V3 checks ran.

## V2 update (Deen Friends rebuild, targeted fixes, push notifications)

Same sandbox limits as below. There was no npm registry and no network access to Google, Firebase or
FCM. Results are marked **PASS** (verified here), **FAIL**, **BLOCKED** (could not run here) or
**NOT TESTED**.

| Area | Check | Result |
| --- | --- | --- |
| Build | `vite build` (production) | **BLOCKED**: no npm registry. The same sources were bundled with esbuild into the e2e build, which passed. Run `npm ci && npm run build`. |
| Types | `tsc` strict over all TS/TSX (with local React/Firebase type stubs) | **PASS**, 0 errors |
| E2E suite | Playwright, mobile and desktop, in-memory Firebase with a rules model | **PASS**: 111 passed, 1 skipped (the Tasbih touch test is mobile-only), 112 runs |
| Add Friend | search → request → second user accepts → both see each other; decline; cancel; re-add | **PASS** (two users in the fake) |
| Add Friend root cause | the rules model denies `get` on a missing friendship (V1 behaviour) | **PASS** |
| Custom challenge | create "Your own" with Arabic digits, accept, complete, both sides' progress | **PASS** |
| Reactions / sharing / check-in card | quick reactions, Dua share with reference, check-in | **PASS** |
| Clear chat | confirmation; deletes only own items; keeps active challenges | **PASS** |
| RISE chat | welcome created once; user messages; separate from friend chats; labels | **PASS** |
| Admin: Daily Deen Challenges | create → publish → user sees it → mark done → progress table | **PASS** |
| Admin: RISE inbox | list, open (audit log), reply as RISE | **PASS** |
| Daily challenge visibility | only published challenges addressed to the user | **PASS** |
| Light / dark / 360px width | no horizontal scroll; screenshots | **PASS** |
| Admin Deen Friends console | Messages tab; edit profile with a username change; Accept on a pending request creates the friendship and streak; clear error messages | **PASS** |
| Tabs on one line | 360 px wide, 16 px and 19 px system text | **PASS** |
| Notifications client | device registered per UID, preference saved, removed on sign-out, unsupported state | **PASS** |
| Notifications sender | `npm run test:scheduler`: recipients, preferences, no content, invalid-token cleanup, no duplicates on re-run, welcome ignored | **PASS** (in-memory Firestore and FCM) |
| Real push delivery to a phone | | **BLOCKED**: no FCM access. See PUSH-NOTIFICATIONS.md for the manual test. |
| Firestore rules on the real engine / emulator | | **NOT TESTED**: firebase-tools and the emulator download were unavailable offline. The JS model mirrors the new rules; run the emulator before deploying. |
| 99 Names | ordered 1 → 99; duplicates skipped; long Arabic does not overflow; RTL | **PASS** |
| Nearby Masjids | in-app list, nearest first, directions, no redirect; location-denied state | **PASS** (Overpass mocked) |
| Qur'an mini player | minimize/restore, playback untouched, survives navigation | **PASS** |
| Tasbih (Android bounce) | drifting touches do not scroll; count correct | **PASS** (Chromium touch emulation); real Android **NOT TESTED** |
| Maintenance | Makkah scene behind the card | **PASS** |
| Page-to-page shaking | CLS across 7 routes < 0.01 | **PASS** |
| Real devices (iOS/Android), live Firebase | | **NOT TESTED** |

Known limitations are listed in the final section of this file and in
[DEEN-FRIENDS.md](DEEN-FRIENDS.md) and [PUSH-NOTIFICATIONS.md](PUSH-NOTIFICATIONS.md).

---

## Original migration report

## Environment limits (please read)

The migration ran in a sandbox with **no npm registry access** and **no access to Google/Firebase
hosts**. Local copies of React 19.2, TypeScript 6.0, esbuild 0.28, Playwright 1.56 and Chromium were
available. As a result:

| Not possible here | What was done instead | What you need to do |
| --- | --- | --- |
| `npm install`, `vite build`, a `package-lock.json` | Compiled and bundled the exact sources with esbuild (same JSX transform, code splitting, CSS bundling, asset hashing, JSON and `?url` imports). Emulated the Vite service-worker precache step. Type-checked with `tsc` against minimal local React/Firebase type stubs. | Run `npm install && npm run build` once and commit the lockfile. Then run `npm run test:e2e`. |
| Real Firebase (Auth, Firestore, Storage, FCM) | Built an in-memory Firebase test double (`tests/fake-firebase`) and served it to **both** the original page (in place of the gstatic CDN modules) and the React build. Compared UI **and** every Firestore operation. | Smoke-test sign-in, admin publishing and Deen Friends against the live project after deploying to a preview channel (`firebase hosting:channel:deploy preview`). |
| Real phones / installed PWAs (iOS Safari, Android Chrome) | Mobile-emulation viewports (390×844, Pixel 7) in Chromium, and desktop Chromium audio tests with real user-gesture clicks | Test Qur'an recitation, install prompt, notifications and offline mode on at least one iPhone and one Android phone. |
| External APIs (prayer times, Urdu text/audio, recitation CDN, SheetJS CDN, Google Fonts) | Blocked in all tests. The recitation CDN was replaced by a locally served audio file. | — |

Nothing in this report claims mobile audio playback is fixed on real devices. The recitation engine
behaves identically to the original in desktop Chromium, in both success and failure modes. Real-device
verification is still outstanding.

## Results

### Static checks

| Check | Result |
| --- | --- |
| TypeScript (`strict`, `noUnusedLocals`, …) over all `.ts`/`.tsx`, including tests and config | ✅ 0 errors (with local type stubs for React/Firebase/Vite) |
| Every migrated module parses as a strict ES module; no former global is left unresolved | ✅ 0 problems (ESLint scope analysis) |
| No reliance on sloppy-mode semantics or implicit `window.*` globals | ✅ (one implicit use found and replaced by an import) |
| **Content preservation:** every one of the 17,742 string literals in the original scripts (wording, Arabic, references, URLs) still exists in the new source | ✅ The 69 not found verbatim are all accounted for: templates rewritten as JSX (verified by DOM equality), the replaced CDN URLs and `body >` selectors, the removed dead `dashboard()`, and one object key Prettier unquoted |
| Qur'an data (114-surah index + full text) equals the original embedded dataset | ✅ identical |
| Daily heart reflections data and day-rotation function | ✅ identical (checked on four dates, including a leap day) |

### Visual and structural parity (original page vs React build, same conditions)

Side-by-side samples: [mobile, light theme](screenshots/mobile-light-original-vs-react.jpg) ·
[desktop, dark theme](screenshots/desktop-dark-original-vs-react.jpg).

| Check | Scope | Result |
| --- | --- | --- |
| Screenshots | 16 routes × 2 viewports (390×844 mobile, 1440×900 desktop) × 2 themes = **64** | ✅ 56 pixel-identical. 8 differ only in known non-functional ways: (a) randomly positioned twinkling stars on Home (≤0.016% of pixels); (b) Ask Rise's composer height and focus ring at the moment of capture. The original measured the textarea before its last stylesheet had loaded, a parsing race; the settled state is identical. |
| Same, minified production bundle | 64 | ✅ same result |
| Normalised DOM (tags, attributes, text) | 16 routes | ✅ identical except: the logo is now a hashed PNG URL instead of base64; inline `style` attributes are serialised by React; star positions; and one admin attribute (`data-bound`) is absent on public pages because the admin console is lazy-loaded |

### Behaviour parity (scripted interactions run on both)

26 scenarios and 69 steps. Each step compares a state snapshot (DOM text, classes, localStorage, focus) and a screenshot.

| Area | Result |
| --- | --- |
| Names dialog (click, keyboard, Escape, ×, backdrop, Tab trap, fallback copy) | ✅ identical (plus the focus fix) |
| Duas library → detail → Save → Saved | ✅ identical |
| Hadith / Reminders detail, back lane, library × | ✅ identical |
| Ask Rise (open, query, results, close; from Explore) | ✅ identical |
| Tasbih (count, persist, reset, choose Zikr) | ✅ identical (end state checked with real time) |
| Zakat (inputs, totals, Nisab status, currency formatting) | ✅ identical |
| Sadaqah (cards, UPI copy) | ✅ identical, including the full page `innerHTML` |
| Hajj & Umrah Journey Mode (start, next, previous, two journeys at once, exit, resume, scroll) | ✅ identical, including the full page `innerHTML` and the settled scroll positions |
| Qur'an (114 surahs, open surah, ayah menu, deep link 2:255) | ✅ identical. **Intended difference:** saved ayah now appears in Saved (bug fix 2) |
| Theme toggle, Explore drawer, My Deen (incl. morning/evening adhkar), Reminder Center, Prayer (on-device times, compass start), For Your Heart, Names library and detail, home section links | ✅ identical (end states checked with real time where animations differ) |
| Admin route | Original: **tab freezes** (bug fix 1). New: login view, matching an original patched with that one-line fix |

### Firebase-backed parity (in-memory Firebase served to both builds)

| Flow | Steps | UI state | Firestore operations |
| --- | --- | --- | --- |
| Public live sync (home, libraries, Tasbih Zikr list) | 3 | ✅ identical | ✅ identical |
| Admin: sign in → Duas → editor → publish → feature toggle → delete to Recycle Bin → Trash, Names, Zikr, Sadaqah, Scheduled, Analytics, Broadcast, Notifications, Maintenance, Deen Friends console → sign out | 19 | ✅ identical | ✅ identical (every read, listener and write, including payloads) |
| Deen Friends: auth gate → create account → add friend | 4 | ✅ identical | ✅ identical (incl. the account-creation transaction payloads) |

Analytics session heartbeats differ only in how many happened during the test (timing).

### Automated end-to-end suite (`tests/e2e`, Playwright, against the e2e build)

**68 tests (34 × mobile + desktop): 68 passed**, on several consecutive runs. Coverage:

- every public route renders without errors
- no listener, audio-element or Firestore-listener growth across repeated navigation
- Names dialog, Zakat, Hajj & Umrah, Sadaqah, theme, Duas/Saved, Qur'an save→Saved, deep links
- Tasbih, Ask Rise, Explore
- admin sign-in / delete to Recycle Bin / wrong password
- Deen Friends sign-up
- offline after first visit
- manifest and icons
- recitation engine: play, playlist, pause/resume, rapid switching, failure state

### Other runtime checks

| Check | Result |
| --- | --- |
| Listener leaks: 4 cycles through 18 routes | ✅ window 31 / document 26 listeners, 1 audio element, 2 Firestore listeners: identical after 1 and after 4 cycles (the original was also stable) |
| Qur'an recitation, desktop Chromium, real clicks | ✅ 9/9 steps identical to the original in success mode and in failure mode (same requests, same single `<audio>` element, playlist advance, pause/resume, rapid switching → only the last ayah plays, survives navigation) |
| Offline after first visit (service worker) | ✅ Home, Qur'an Al-Baqarah (286 ayahs from the precached text), Zakat and Admin login all work offline (same as the original) |
| Service-worker upgrade from the original single-file app | ✅ the React app is served on the next load; the old shell cache is deleted; the **Qur'an audio cache and content snapshot cache are kept** |
| React StrictMode (development) | ✅ The verification builds ran with StrictMode double effects; the controllers start once |

## Known limitations and open items

1. **Vite build not executed here** (see above). The configuration is standard Vite 7. The only
   custom plugin (SW precache) fails loudly if anything is off.
2. **No real-device testing**: iOS/Android audio, installed-PWA behaviour, install prompt, device
   compass and geolocation accuracy.
3. **Live Firebase not exercised.** Not covered by the test double at all: Storage uploads, FCM push
   delivery, multi-user Deen Friends flows (requests, interactions, challenges), maintenance activation
   and the bulk Excel import (SheetJS loads from a CDN).
4. **Architecture.** Several large features still run their original controller logic as modules
   rather than React components. *(V2: the Deen Friends user module is now React, see
   DEEN-FRIENDS.md. The Deen Friends admin view, 83 KB, is still one closure.)*
5. **Pre-existing behaviours left unchanged** are listed at the end of [BUG-FIXES.md](BUG-FIXES.md).

### V2 limitations

6. **Privacy (pre-existing, not changed):** `deens_users/{uid}` contains the user's email and is
   readable by every signed-in user. Fixing this means moving the email to a private sub-document
   and changing the admin tools that read it. That is a data migration, so it was left for an explicit
   decision.
7. **24h cleanup** depends on enabling the free Firestore TTL policy on `purgeAt` (one command in
   DEEN-FRIENDS.md). Until then, seen items are hidden in the UI but remain stored.
8. **GitHub Actions minutes:** a 5-minute cron exceeds the free quota for *private* repositories
   (see PUSH-NOTIFICATIONS.md).
9. **Custom challenge root cause** was established by analysing the code against the rules. The
   production failure was not reproduced live.
