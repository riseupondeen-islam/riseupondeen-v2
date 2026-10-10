# Bug-fix report

Only defects that were **reproduced on the original page** are listed. Each fix is the smallest
change that resolves the defect without changing intended behaviour. "Verified" describes the
check that shows the original failing and the new build passing.

## 1. Opening the admin route froze the browser tab when Firebase could not load

- **Symptom:** On a network where the Firebase SDK cannot load (offline, CDN or Google blocked,
  captive portal), opening `#admin` made the tab unresponsive. The page never finished loading.
- **Cause:** `renderAdminRoute()` handled "Firebase not ready yet" by awaiting
  `firebaseInitPromise` and calling itself again. When the SDK fails, that promise resolves without
  Firebase becoming ready. The result was an endless chain of microtasks that never yielded to the
  browser.
- **Fix:** Re-render only if Firebase actually became ready
  (`features/admin/adminRouter.js`). Otherwise the login view stays up, and signing in shows
  "Firebase could not connect…", as already designed.
- **Verified:** The original hangs on `#admin` (navigation timeout, and the tab crashed in the offline
  test). The new build shows the login view, the sign-in error toast works, and leaving the route works.
  With one line patched in a copy of the original, the admin login screen and behaviour are
  pixel- and state-identical to the new build.

## 2. Saved Qur'an ayahs never appeared in "Saved for Later", My Deen or Ask Rise

- **Symptom:**
  - Saving an ayah showed "Ayah saved.", but **Saved for Later** still said "You have not saved any
    content yet."
  - **My Deen › Continue Qur'an** always said "Begin your Qur'an journey" (0%) even after reading.
  - The **Khatam planner** progress stayed at 0%.
  - The collection count ignored Qur'an bookmarks.
  - Opening **Ask Rise** did not tuck away an open full-screen Qur'an player or sheet.
  - **Deen Friends** could not see the current surah/ayah for sharing.
- **Cause:** These features checked `typeof rudQuranBookmarks === "function"` (and similar for
  `rudQuranLast`, `rudQuranMinimizePlayer`, `rudQuranCloseSheet`, `rudQuranCurrentSurah`, …). Those were
  declared inside the Qur'an script's private closure, so the checks were always false and the
  intended code paths never ran.
- **Fix:** The Qur'an module now exports them and the dependent modules import them. The existing,
  previously unreachable markup and logic are used unchanged.
- **Verified:** Save an ayah, then open `#saved`.
  - Original: "You have not saved any content yet."
  - New: a "Qur'an Bookmarks" card listing "Al-Faatiha · Ayah 1", using the existing styles.

  Read Al-Baqarah 2:10, then open My Deen.
  - Original: "Begin your Qur'an journey · 0.0%"
  - New: "Al-Baqara · Ayah 10 · Reading progress 0.3%"; Khatam planner "17 of 6,236 ayahs".

  Both are covered by e2e tests.

## 3. Super-admin "Send password reset" in the Deen Friends console always failed

- **Symptom:** In Admin › Deen Friends › user details, "Send password reset" showed an error
  instead of sending the email.
- **Cause:** The admin view called `rudDfPasswordReset()`, which was declared inside the Deen
  Friends closure and therefore not visible to the admin code (`ReferenceError`).
- **Fix:** The function now lives at module scope in `features/deen-friends/deenFriends.js` and is
  imported by the admin view. The public Deen Friends "Forgot password?" flow uses the same function.
- **Verified:** Static scope analysis showed it as the only unresolved identifier in that admin
  module. The new module graph resolves it.
- **Not verified end to end:** the email itself (this needs the live project).

## 4. Every wide-window resize threw a JavaScript error

- **Symptom:** A `ReferenceError: setMenu is not defined` on every resize event above 980 px. As a
  side effect, the home timeline was never re-measured after a resize.
- **Cause:** The resize handler still called `setMenu(false)` from a removed mobile menu.
- **Fix:** The dead call is removed (`features/home/homeInteractions.js`).
- **Verified:** Scope analysis shows `setMenu` is not defined anywhere. The handler now only schedules
  the timeline update.

## 5. Names of Allah dialog: focus handling

- **Symptoms:**
  - (a) Closing the dialog left keyboard focus nowhere, instead of returning it to the name card.
  - (b) Moving focus into the dialog when it opened failed intermittently.
- **Cause:**
  - Two implementations were bound to the same dialog. The one that saved and restored focus was
    bound at start-up to name cards that did not exist yet (they are rendered after content loads),
    so it never ran.
  - Focus was moved once, 30 ms after opening. If the fade-in had not started yet, the button was
    still `visibility: hidden` and could not take focus.
- **Fix:** One React component (`features/names/components/NameModal.tsx`). It keeps all the original
  behaviour: open by click or Enter/Space, close with ×, the backdrop or Escape, scroll lock, Tab
  trap and the fallback copy. It also restores focus to the opening card and retries the focus on
  the next frames until it succeeds.
- **Verified:** The e2e test asserts focus moves into the dialog and back to the card.
  - Run 20 times against the original, it failed all 20 runs: 15 on (a) and 5 already on (b).
  - Against the new build it passed 60 of 60 runs.

## 6. Theme toggle announced the wrong state after the intro

- **Symptom:** A first-time visitor with Dark mode saved saw the dark theme, but the toggle's
  accessible label said "Switch to Dark Mode" and `aria-pressed="true"`.
- **Cause:** The label was computed once at start-up, while the intro preloader temporarily forces
  light mode. It was never updated when the intro switched to the saved theme.
- **Fix:** `ThemeToggle.tsx` derives its label from the theme actually on screen
  (`useDocumentTheme`).
- **Verified:** First visit, dark theme. Original: "Switch to Dark Mode", pressed=true. New:
  "Switch to Light Mode", pressed=false.

## 7. Admin table pager watched every DOM change for every visitor (performance)

- **Symptom:** A `MutationObserver` on the whole `<body>` subtree ran a function on every DOM change
  for all visitors, including Qur'an player updates and Tasbih taps, although it only paginates
  admin tables.
- **Fix:** The admin console, including the pager, is now loaded only on the admin route. Its
  behaviour inside the console is unchanged.
- **Verified:** The public page no longer registers the observer. The admin flows (login, all 13
  views, content create/feature/delete) produce identical UI and identical Firestore writes.

## 8. Dead code that would have crashed

`dashboard()` in the admin script referenced an undefined variable `featured`. It was never called
from anywhere (verified by reference search), so it was removed rather than fixed.

---

## Investigated and deliberately left unchanged

These are pre-existing behaviours. Changing them would alter UI or semantics, or could not be
verified here. They are documented for a later decision.

| Observation | Why it was not changed |
| --- | --- |
| A failed recitation download shows "This recitation source is not supported by this browser." Browsers report most load failures as `MEDIA_ERR_SRC_NOT_SUPPORTED`, so the message can mislead mobile users on a poor connection. | User-facing wording; the Retry button works. Suggested wording: "This recitation could not be loaded. Check your connection and tap Retry." |
| The service worker comment says previously played ayahs work offline. Media requests use `Range` headers, so the worker deliberately passes them to the network, and cached audio is rarely used in practice. | Serving ranged responses from a cache needs CORS-readable responses from the recitation CDN, which could not be checked from here. |
| The admin dashboard section keeps `hidden` but its stylesheet sets `display:grid`, so the empty dashboard shell sits below the login card. | Visual and layout change in the admin UI; no data is loaded without authentication. |
| After choosing a Zikr in Tasbih, the selector closes visually but keeps `aria-hidden="false"`. | It is `visibility:hidden`, so assistive technology already ignores it. Left as is to keep the change set minimal. |

---

# V2 fixes

Each entry gives the root cause found in the code and the regression test that covers it
(`tests/e2e/deen-friends.spec.ts`, `tests/e2e/fixes.spec.ts`, `tests/e2e/firebase.spec.ts`).

| # | Symptom | Root cause | Fix | Test |
| --- | --- | --- | --- | --- |
| V2-1 | Add Friend showed "Unavailable" with a disabled button | `getDoc` on a not-yet-existing friendship/request doc is denied by rules that read `resource.data` (null). This was masked for the super admin. Decline wrote `rejected` (denied). A deterministic request id blocked re-adding. | Status comes from allowed queries, decline writes `declined`, unique request ids. See DEEN-FRIENDS.md. | two-user flow; decline/cancel; rules model |
| V2-2 | Custom challenge creation failed | Deterministic id per day turned the 2nd create into a denied update; Arabic-Indic digits failed `is int`; the error was hidden | random id, digit normalisation, duplicate-active check, friendly errors | custom challenge test |
| V2-3 | Raw "Quota exceeded" / Firebase errors shown | errors were passed through to the UI | `errors.ts` classifies them into friendly messages | — |
| V2-4 | Nearby Masjid went straight to Google Maps | `rudOpenRiseUponDeenMap` was referenced but never defined, so the fallback redirect always ran | In-app finder using free OpenStreetMap Overpass data (two endpoints, 3 km → 10 km), nearest first; Directions opens only on request; location-denied and error states | 2 tests |
| V2-5 | 99 Names out of order; Arabic overflowed | Rendered in Firestore order; duplicates kept; a broad `[class*="name"]` CSS rule plus a fixed 58px Arabic column | `orderNamesForDisplay` (by number, earliest duplicate kept); scoped CSS; wrapping RTL column | 1 test |
| V2-6 | Qur'an mini player could not be minimized | feature missing | collapse/restore buttons with state kept across routes; the audio engine is untouched | 1 test |
| V2-7 | Tasbih page "bounced" on Android | `touch-action: manipulation` let finger drift pan the page; overscroll not contained | `touch-action:none` on the counter, `overscroll-behavior-y:none` on the Tasbih page, long-press menu prevented | 1 test (mobile emulation) |
| V2-8 | Maintenance page lacked the Makkah background (light mode showed a misplaced gradient Kaaba) | the page hides all body children, including the global scene; a gradient hack in the light theme | the scene is cloned inside the maintenance app; hack removed | 1 test |
| V2-9 | Page-to-page shaking | the Prayer status block had no reserved height (CLS 0.045). A `min-height:0!important` overrode earlier attempts. | a reserved height with higher specificity | CLS < 0.01 over 7 routes |
| V2-10 | Admin → Deen Friends: **Create user**, **Edit profile** and **Approve username** always failed | These actions reserve the username in `visitor_usernames` for *another* user. The rules only let the owner write that record, and unlike the other Deen Friends collections it had no Super Admin allowance. | A narrowly scoped rule: only the Super Admin may create or update a well-formed username record keyed by its own name | admin console test (edit with a username change) |
| V2-11 | Admin console showed a bare "Action failed." | One generic catch hid every reason. Drawer buttons (notes, suspend, restrict, notices, settings, …) had no error handling at all, so failures were silent. | Every console handler now reports a specific reason: permission/rules not deployed, missing index, offline, quota, not found, or the console's own validation message | admin console test |
| V2-12 | Admin → Messages opened the Command Center | the tab map used the key `adminMessages` instead of `messages` | key fixed | admin console test |
| V2-13 | Admin → Friend Requests had no Accept/Decline buttons; accepting never connected the two users | The first render used an "Open-only" table. The status was changed, but no friendship or streak was created. | the full table is rendered from the start; admin accept creates the friendship and the streak (same shape as a user accept) and refuses already-answered requests | admin console test |
| V2-14 | Deen Friends tabs wrapped ("Challenge / s") on phones | the labels could wrap when the phone uses larger text | labels never wrap; the font scales down with the screen width | tabs test at 360 px with 16 px and 19 px system text |
| V2-15 | RISE chat showed only "That action isn't allowed…" | The RISE collections exist only in the **new** `firestore.rules`. Until those rules are deployed, Firebase refuses them. | **Deploy the rules** (see README). The screen now explains the situation and offers *Try again* instead of a dead end. | RISE tests (fake rules model) |

