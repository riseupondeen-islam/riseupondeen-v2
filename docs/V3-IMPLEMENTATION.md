# Rise Upon Deen V3 — implementation notes

This file records what V3 changed, why (root causes), how the new server-enforced features work,
which backend changes are needed, and what has **not** been verified. It accompanies the master
prompt "RISEUPONDEEN V2 — MASTER PROMPT" (Sections 2–24).

Verification legend: **PASS** = verified in this environment (Chromium, Pixel 7 emulation and
1440×900 desktop, in-memory Firebase with a rules model); **NOT VERIFIED** = needs a real device,
the Firebase emulator or the live project.

---

## 1. Audit — root causes found before changing anything

| Section | Symptom | Root cause |
| --- | --- | --- |
| 4 Makkah background | Scene stayed on screen while scrolling; jumped when the mobile toolbar hid | `.global-mecca-bg` was `position: fixed; inset: 0` (pinned to the viewport) and sized with `vh`, which changes when the toolbar collapses. |
| 5 Chat scroll | Page behind a full-screen chat still scrolled; closing a nested sheet unlocked the page | Lock was `body { overflow: hidden }` (ignored by iOS Safari for touch scrolling), toggled by a class that the inner sheet removed on close. In addition `01-base.css` pins `body { position: relative !important }`, so an inline `position: fixed` never applied. |
| 6 99 Names | Empty band in cards; page jumped / "shook" | Cards had `min-height: 220px` and an absolutely positioned kicker; the content-refresh handler re-rendered the whole route (scrolling it to the top) whenever cached content was re-confirmed. The "Make available offline" button belonged to the generic reader. |
| 14 Tasbih (Android) | Bounce/ripple never visible on Chromium | Old CSS pinned `transform`/`opacity` with `!important`. In Blink `!important` declarations beat CSS animations (WebKit lets the animation win, so iOS looked fine). |
| 15 Logos | Logo looked cut out / mismatched | The supplied artwork is an opaque square painting; old CSS (`.brand-logo { background: transparent !important; border-radius: 0 !important }`) was written for a transparent PNG. Icons were older derivatives. |
| 16 Chat themes | Theme only changed the wallpaper | Theme variables were set on the chat only; sheets are portalled outside it and buttons used fixed colours. |
| 21 Shared content | Long duas/ayahs arrived cut off | Stored `preview` was capped at 300 chars and Arabic at 1,200; the card showed only the preview. |
| 3 Notifications | Two different toast systems, inconsistent look, could pile up | Legacy `toast()` and the Deen Friends `ToastProvider` rendered separately. |

## 2. What was implemented (by section)

- **2 Instagram / in-app browsers** — `features/pwa/installState.ts` detects Instagram, Facebook,
  Messenger, TikTok, Snapchat, LinkedIn, X, Line, WeChat and generic Android WebViews (UA + capability).
  A card explains that installing and some features need a real browser. On Android it offers an
  `intent://…#Intent;scheme=https;package=com.android.chrome;end` link (opens Chrome); on iOS it
  explains how to open in Safari (••• → *Open in browser*) and offers *Copy link* — JavaScript cannot
  force Safari to open. "Continue in Instagram" is remembered for the session and 3 days.
- **3 Notification cards** — one service `services/ui/notify.ts`; legacy `toast()` and Deen Friends
  toasts both use it. Top-centre, tone (success/info/warning/error) with icon and title, progress
  bar, pause on hover/focus, close button, Escape, max 3 visible, duplicate suppression (1.5 s),
  `role="alert"` for errors, reduced motion respected.
- **4 Makkah scene** — the scene is now `position: absolute` at the top of the document, sized with
  `100lvh` and faded out at the bottom, so it scrolls away with the first screen; the plain sky layer
  stays fixed behind content. No layout jump when the toolbar hides.
- **5 Chat scroll lock** — `services/ui/scrollLock.ts`: reference-counted, pins `<body>` with inline
  `!important` at the current offset, cancels touch moves that would chain to the page, restores the
  exact position on the last release, and tells the history scroll engine not to record the
  temporary position. Used by chats, sheets, dialogs, the 99 Names modal.
- **6 99 Names** — offline button removed from the name reader only (other readers keep it); card
  min-height and kicker fixed; route re-render is skipped when content is unchanged and preserves
  scroll when it does change; `scrollbar-gutter: stable` stops width shifts.
- **7 Streaks / 18 challenges and leaderboard** — see §3.
- **8 Official RISE chat** — admin *Clear chat* (solved conversations only, typed `@username`
  confirmation, keeps the automated welcome, audit log without message text) and 24-hour retention
  run by the scheduler (§4).
- **9 Friend suggestions** — mutual-friend suggestions computed server-side by the scheduler, plus
  "active members" from opt-in public cards. Excludes self, friends, pending requests (both ways),
  blocks (both ways), disabled accounts and anyone not discoverable. Only name, username and avatar
  are exposed. Dismiss is remembered.
- **10 Avatar builder** — faceless SVG figures (hijab, kufi, turban, shawl), patterns, motifs,
  shapes and initials, 8 colour palettes; stored as a small validated `avatarConfig` map.
- **11 Android install** — uses the real `beforeinstallprompt`; shown after real engagement (30 s
  or two page changes), not on first paint; states follow real events only: *Install* → *Installing…*
  (while the browser dialog is open) → *Installed* only on `appinstalled` (or "Finishing…" if the
  browser accepted but has not confirmed within 15 s). No fake progress. Snoozed 14 days after a
  dismissal, stops after two. Manual instructions for Samsung Internet, Firefox, desktop.
- **12 iOS** — step-by-step Add-to-Home-Screen walkthrough with drawn illustrations for Safari
  (including Safari 26's ••• menu), Chrome/Edge/Firefox on iOS and "open in Safari" for others. Back,
  Next, Skip, "I've done this". The app cannot press the Share button for the user and says so.
- **13 Onboarding / App Guide** — admin-editable tours (`rud_app_guides/published`, draft/preview/
  publish in the admin console under *App Guide*), first-run welcome card once per version, resume,
  per-feature tours that navigate and spotlight real controls, missing-target fallback, keyboard
  support. Replay from Explore → *App Guide*.
- **14 Tasbih** — animations use the individual `scale`/`translate` properties and a registered
  `@property` for the ripple, which `!important` transforms don't block. One tap = +1 (verified),
  vibration only where supported.
- **15 Logos** — every icon regenerated from the supplied 1254×1254 master (identical in all three
  supplied files) with Lanczos resampling only — no recolouring or redrawing. New maskable icons
  place the artwork at 80% on its own background colour. The header logo is shown on a rounded tile.
- **16 Chat themes** — complete token sets per theme (surfaces, text, accents, primary buttons,
  sheets opened from the chat, composer).
- **17 Usernames** — `A–Z a–z 0–9`, 3–20 characters, case-insensitive uniqueness (lower-case key in
  `visitor_usernames` reserved in the same transaction), enforced in the app, admin console and
  `firestore.rules`. Existing usernames that predate the rule are not renamed; run
  `node push-scheduler/scripts/auditUsernames.js` (read-only) to list them.
- **19 Deen circles (group chats)** — at least 4 participants including the creator (enforced by
  rules), only existing friends can be added, Deen actions only (no free text), admin can rename /
  add / remove, members can leave.
- **20 Navigation** — Home, My Deen, Notifications, Deen Friends, Light/Dark, Explore; equal icon
  size; Explore has *App Guide* and theme entries.
- **21 Shared content** — full Arabic (RTL), transliteration, translation, reference and source
  are stored and rendered; old truncated messages are completed from the published source when
  possible; *Copy* and *Read in full screen*.
- **22 Public profile preview** — "Preview public profile" renders the same component other people
  see; streak/achievements appear only if the owner made them public; never email.
- **23 App Guide in the sidebar** — Explore → App Guide.
- **24 Responsiveness** — no horizontal overflow at 360 px on all Deen Friends tabs (tested), reduced
  motion respected, no new dependencies.

## 3. Streaks, points and the monthly leaderboard (transparent rules)

- **Timezone:** calendar days and months are **India Standard Time (UTC+05:30)** for everyone, so a
  day and a month end at the same moment for all members and nobody can gain by changing the
  device clock. Firestore rules compute the day from `request.time`, not from the device.
- **What counts:** marking a Daily Deen Challenge, a friend challenge or a circle challenge done for
  today. Creating, sharing or inviting earns nothing.
- **Points:** +1 per counted completion, **at most 3 points per day**; the same challenge counts once
  per day.
- **Streak:** consecutive IST days with at least one counted completion. Missing a day resets the
  current streak; the longest streak is kept.
- **Ranking:** points (high → low), then active days; equal points and active days share the rank
  (joint first is shown as such). The board resets on the 1st of each month at 00:00 IST; last
  month stays viewable.
- **Integrity:** the completion, the day's activity counter, the streak and the leaderboard entry
  are written in **one transaction**; `firestore.rules` accepts a point only if the activity counter
  increases by exactly one in the same write and a matching completion happened, so points cannot
  be added by hand. Members can hide themselves from the board and hide their streak.

## 4. Official RISE chat retention (24 hours)

`push-scheduler/maintenance.js` (runs with the existing scheduler, Admin SDK):

1. A message becomes eligible only when the conversation is **solved**, **both** the member and the
   RISE team have seen it after the message was written, and it is not the welcome message.
2. The first run that sees eligibility stamps `purgeAt = now + 24h` (the 24 hours start then).
3. A later run deletes messages whose `purgeAt` has passed, re-checking every condition. A Firestore
   TTL policy on `messages.purgeAt` does the same independently.
4. Re-opening a conversation removes pending stamps; nothing is deleted from open conversations.
5. Bounded (≤ 400 docs per query), idempotent, and the audit log never contains message text.

The TTL policy is on the `messages` collection group, but it only deletes documents that carry
`purgeAt`. Only the scheduler sets `purgeAt` there, and only on RISE messages; the rules do not let
clients add it to Deen circle messages.

Tested offline in `push-scheduler/test/maintenance.test.js` (PASS).

## 5. Backend changes (and why each is needed)

`firestore.rules` — **nothing existing was loosened except one justified case**:

| Change | Why |
| --- | --- |
| `validSharedContent` accepts `translation`, `transliteration`, `source` and larger sizes | Section 21 requires complete content; previous caps truncated it. |
| `deens_users` create: username regex + lower-case key + reservation check; `avatarConfig` validated | Section 17 and 10, enforced server-side. |
| RISE threads: `userSeenAtMs`, `riseSeenAtMs`, `clearedAtMs`, `statusChangedAtMs` with owner/support constraints | Section 8 (seen markers drive retention). |
| **RISE messages delete: Support admins (not only the super admin), only when the conversation is solved, never the welcome** | Section 8 Clear Chat. This is the one widened permission; it is limited to solved conversations. |
| New: `deens_public_profiles`, `deens_suggestions` (read own, write server only), `deens_activity`, `deens_streaks`, `deens_leaderboard/{month}/entries`, `deens_user_challenges` (+participants), `deens_groups` (+messages), `rud_app_guides` | Sections 7, 9, 13, 18, 19. |

`firestore.indexes.json` — leaderboard (`visible`, `points` desc, `activeDays` desc), public cards
(`discoverable`, `lastActiveDay` desc), single-field override for `messages.purgeAt`
(collection-group, for the retention query and TTL).

`push-scheduler/` — `maintenance.js` wired into `index.js` (failures are caught and never stop
notifications); `scripts/auditUsernames.js` (read-only).

No paid services, no new npm dependencies.

## 6. Deployment steps

```bash
npm ci
npm run typecheck && npm run build        # Vite build was not run in this environment (no npm registry)
npm run test:scheduler
npm run test:e2e                          # in-memory Firebase, never production

# Rules: test in the emulator first
firebase emulators:start --only firestore,auth
firebase deploy --only firestore:rules,firestore:indexes
gcloud firestore fields ttls update purgeAt --collection-group=messages --enable-ttl
firebase deploy --only hosting

# Scheduler: commit push-scheduler/ (GitHub Actions secret FIREBASE_SERVICE_ACCOUNT_JSON as before)
node push-scheduler/scripts/auditUsernames.js   # optional, read-only report of legacy usernames
```

Installed PWAs pick up new icons when the OS refreshes the manifest (Android usually within a day or
two; iOS only after removing and re-adding the Home Screen icon).

## 7. Limitations and items NOT verified here

- **No real devices.** Android behaviour was tested with Chromium + Pixel 7 emulation, iOS and
  in-app browsers with user-agent overrides. Needs manual checks on a real iPhone (Safari 17 and 26,
  Chrome iOS), a real Android phone (Chrome, Samsung Internet) and inside Instagram.
- **Real install prompt.** `beforeinstallprompt` / `appinstalled` were dispatched by the test; the
  real Chrome install dialog was not exercised.
- **Firestore rules were not run on the real rules engine or emulator** (firebase-tools unavailable
  offline). The JS model in `tests/fake-firebase/rules.js` mirrors them (and does not model
  `getAfter`). In particular, confirm the completion transaction stays within Firestore's limit of
  document reads per request (rules use `get`/`getAfter` on the activity, streak and user docs).
- **Vite production build not run** — sources were bundled with esbuild for the tests and pass a
  strict `tsc` check with local type stubs. Run `npm ci && npm run build`.
- **Scheduler** tested only against an in-memory Firestore; the TTL policy must be enabled with the
  `gcloud` command above.
- Pre-existing (unchanged): `deens_users` documents (including email) are readable by signed-in
  members as in V2; content rules allow any admin role to edit content. V3 does not widen either; the
  public cards and suggestions introduced in V3 never contain email.

---

## 8. V3.1 refinements (after review)

- **Streaks tab:** the personal streak is one compact card (count, "Today" state, best and active
  days, one button); the explanatory paragraphs and footnotes were removed. The old card had no
  padding because `.df2-card` adds none.
- **Premium accent:** the Deen Friends accent and every green button now use the site's gold
  (gradient on primary buttons, gold for chips, toggles, selected states, success notifications and
  the RISE badge). Chat themes a member chooses (e.g. Madinah Green) keep their own colours.
- **Logos:** the header and admin show the original brand logo again, identical in light and dark.
  The supplied artwork is used for the app icons and the Qur’an player (`src/assets/images/app-logo.png`).
- **Page guides:** the first time someone opens a page that has guide steps, that page's short guide
  opens by itself, once. It never leaves the page; leaving the page ends it; it can be switched off
  in App Guide ("Show a short guide the first time I open a page") and by admins (App Guide →
  automatic page guides). Tours are faster (shorter waits, scroll-end detection) and smoother (the
  highlight glides between controls instead of flashing; text cross-fades).
- **Navigation icons:** My Deen is a lantern; Deen Friends is two companions joined by a heart.
- **Duplicates removed:** Explore no longer repeats Deen Friends and the Light/Dark switch, which are
  in the top bar; it keeps the App Guide.

---

## 9. V3.2 (after second review)

| # | Change |
| --- | --- |
| Install | Browser visitors on phones get the install guide automatically ~4 s after the page settles (iOS: Add-to-Home-Screen guide; Android: one-tap install when Chrome offers it, otherwise the manual steps). Never in the installed app or in in-app browsers; once per session; "Not now" snoozes it 3 days. It waits for the intro, the name card and any guide. |
| App Guide speed | The spotlight moves with a compositor transform (no React render per scroll frame), the pulse animates a pseudo-element's opacity/scale instead of a full-screen box-shadow, the target is found with a light observer + 120 ms poll (was rAF + attribute observer), the progress bar uses `scaleX`. |
| Kaaba | The Kaaba scene is fixed behind the whole main page again, sized once at `100lvh` so it never jumps with the mobile toolbar. |
| Sheets on phones | Nothing in a sheet can be wider than the sheet (iOS date inputs), the sheet body is the only scroller, and the scroll lock now hands a gesture to the sheet when an inner list reaches its edge (this is what made "New circle challenge" move/freeze). |
| Deen Friends | Requests sit inside one small "Requests" button. **People** lists every Deen Friends member in small rows (mutual friends first; people who turned discovery off are hidden); a tap opens the profile. Tab texts trimmed. Challenges tab order: monthly winner → leaderboard → daily → with friends → circle. Challenge data is cached and prefetched (instant tab). |
| Streaks | No check-in button. A day counts for a friendship when you send a Deen action or answer/complete a challenge; when both of you did, the shared streak grows. |
| Sharing | The 99 Names of Allah can be shared in chats (rules accept type `name`). |
| Monthly winner | Admin → **Monthly Winner**: choose the month, pick up to three winners from its leaderboard, write the announcement, publish (or remove). Members see a gold card at the top of Challenges; winners' visiting cards become the gold edition with a "Winner · Month" badge. Collection `deens_monthly_winners/{YYYY-MM}` (read: members, write: community admins) + index. |
| Profile | Visiting card: rectangular card, light sweep, avatar ring, name, @username and a script **signature** (4 styles; text editable in Edit profile; stored as `signature {text, style}`, validated by rules). Own profile: card + four actions (Edit, Avatar, Preview, Invite); notifications fold away; editor shortened (details and account fold away). |
| Avatars | Gradient backdrops with glow, shaded clothing, metallic frame + hairline, gloss; new options: Niqab, Ghutra figures; Mashrabiya and Light-rays patterns; Kaaba and Star motifs; Pearl, Saffron, Midnight, Dusk backgrounds; Olive, Black clothing; Bronze, Pearl accents; 3 new presets. Builder: big floating preview + Style / Shape / Colours tabs. |
| Look | Dark Deen Friends surfaces are neutral charcoal (were green-tinted); notifications are compact glass "island" cards (swipe up to dismiss); My Deen nav icon is a dashboard with a crescent tile; Qur'an player artwork fills its square; the ••• button fits its box. |
| Friday / Ramadan | Both use a dedicated occasion card (the Friday card had been squeezed into the two-column Dua/Hadith grid). Ramadan mode shows Record fast · Continue Qur'an · Prayer times. |
| Launch speed | Installed app: the intro plays at most every 12 h and lasts 1.15 s (browser: once per session, 1.7 s). The service worker answers a Home-Screen launch from the cached shell if the network takes more than 2.5 s, and refreshes the cache in the background. |
| Intro | New night-sky intro with the app mark in a gold ring and a gold "Assalamu Alaikum"; the first-visit name card now follows the intro (never on top of it) in the same style. |

New/changed backend: `deens_monthly_winners` rules + index; `validSignature`; `validSharedContent` accepts `name`; `validAvatarConfig` accepts the new avatar values. Deploy rules and indexes again (§6).

Not verified here (in addition to §7): the signature fonts (Google Fonts are blocked in the test sandbox, so screenshots show the fallback serif; real devices load the script fonts) and the service-worker timeout on a real slow network.

---

## 10. V3.3 (third review)

| # | Change |
| --- | --- |
| Intro | Stays 4 s, follows the visitor's light/dark mode, a single mihrab arch (no star). Installed app: at most every 12 h. |
| Name card | Appears after the intro (never on top), styled for both themes (the light theme had painted dark-card text grey on grey), scrollable so the keyboard never hides the button. The install guide now waits for a calm moment after it. |
| RISE chat | Sending after RISE had read the thread could be refused (a stale unread counter broke the "+1" rule) — the counter is now read before writing. The welcome message always sorts first. In light mode all chat bubbles were painted white by a legacy `article` rule — fixed. |
| Keyboard / shaking | Chats follow the visual viewport with a composited transform and only write real changes; the page behind is held at the top; the newest message stays in view when the keyboard opens; text fields are 16 px on touch screens (no iOS zoom); `interactive-widget=resizes-content` for Android. |
| Avatars | Brothers' figures (Kufi, Ghutra, Imamah) have a simple beard silhouette; sisters' figures are Hijab, Niqab and a new long Khimar; the builder groups them as Brothers / Sisters. |
| Friends | "+ Add friend" and "Requests" are two small buttons; each opens its panel (search field focused). |
| Home | The hero's entrance animation replayed every time Home was shown again (display none → block), which made Home jump — it now plays once. Home sections no longer scroll inside themselves (`.shell` had `overflow-x:hidden`, which forces `overflow-y:auto`; now `clip`). |
| Guide | Only the highlight's position animates; its size changes in one step (animating size repainted the full-screen shade each frame). |
| Masjids | New launcher card and full-screen finder (skeleton loading, distance + walking time, Directions, search). The Google Maps button searches "masjids near me". |
