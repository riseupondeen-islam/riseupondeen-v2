# Admin Console — audit, repairs and redesign (V3.6)

This release changes the Admin Console only. The public website's markup, behaviour and computed
styles are unchanged (verified — see "Verification"). Two small, deliberate fixes touch shared code
because the requested behaviour lives there; both are listed under "Shared code touched".

## Root causes found

| Reported problem | Root cause | Fix |
| --- | --- | --- |
| Sidebar scrolls away with the page | The sidebar was `position: sticky` inside a page that scrolls on `<html>`, while public CSS sets `body { overflow-x: hidden }` — that turns `<body>` into the sticky element's scroll container, which never scrolls, so the sidebar scrolled away. ~10 layered override blocks fought over it. | The console is now a fixed, viewport-sized app: the sidebar is a fixed column that scrolls on its own, `#adminMain` is the only vertical scroller, the page behind is locked while the console is open (`:has()` rule scoped to the open console). ≤ 900 px the sidebar is a drawer (Esc / backdrop / close button). |
| Deen Friends refresh buttons do nothing / act strangely | (1) **Every visit** to Deen Friends added another click handler to `#adminMain` that was never removed, so after a few visits each click ran several stale handlers. (2) Command Center "Refresh" re-rendered from cache without reading anything. (3) In User Management the local list was named `users`, shadowing the `users()` render function — the search box and Refresh called the array and threw. (4) Trust & Safety Refresh did not re-read restrictions, suspensions or access logs. (5) Re-rendering on search lost focus and the Accounts/Firestore tabs. (6) A failed read was shown as an empty table. (7) The user list started one full read of two collections per row. | View lifecycle (`onViewCleanup`/`viewSignal` in `adminViews.js`) removes every listener when a view is replaced; one `refreshSection()` that invalidates the right collections, re-reads, shows "Refreshing…" and a result toast, and ignores double clicks; search re-renders keep focus and caret; read errors are shown with Retry; reads are de-duplicated and bounded (5 × 1,000 per collection, shown as "5000+"). |
| RISE Inbox deletions come back | The inbox had no way to delete a conversation (only "Clear chat"), and deleting the automated welcome would be re-created by the member's app. | Super Admin can delete one message (not the welcome) or a whole conversation (typed `@username` confirmation). Deletes are confirmed by Firestore before the UI changes; the live listener removes them and they stay gone after refresh/reload. Only that message/conversation is touched. If the member writes to RISE again later, a new conversation starts (by design of the public app). |
| Maintenance Access needs a refresh | (1) When maintenance stopped applying to a visitor, the public app hid the maintenance screen but did not re-render the page behind it — non-home routes stayed blank until the visitor navigated. (2) The router showed maintenance during navigation even for allowed visitors. (3) The admin wrote the whole list from its local copy, so two admins could overwrite each other. (4) Any admin role could change it. | Public: re-render the current route when access is granted; respect the allow-list in the router. Admin: grant/revoke in a transaction against the server's list; the view follows the document live; Firestore rules restrict `content/rud_maintenance_config` to the Super Admin. |
| Live data reset forms and searches | Every content snapshot re-rendered whatever section was open (including RISE Inbox and Deen Friends), resetting typed replies, filters and selections. | Only the content tables and Scheduled re-render on content changes, and they keep search/filters/selection. Publish/feature toggles ignore a second click while the first write is in flight. |
| Admin data could flash / stay on screen | The console rendered from cached data before the session was verified, and stayed in the DOM after sign-out; admin datasets stayed in `localStorage`. | Auth gate (below); sign-out clears the DOM, listeners and cached admin content/visitor analytics. |

## Authentication gate

`#adminApp[data-auth]` is `checking` → `signed-out` → `authorized`. Only one pane is ever visible:
a neutral "Verifying secure session…" screen, the login page, or the console. `authorized` is set only
after the signed-in user's ID token is verified as the administrator account (existing Firebase Auth,
same account). Every asynchronous decision is sequence-guarded, so a slow verification can never
re-open the console after sign-out. Firestore rules remain the authority for all data.

## New capabilities

* **Dashboard** — website visitors, Deen Friends members and activity, challenge check-ins, RISE inbox,
  content library and reports, from bounded reads of existing collections (cached 15 minutes for the browser tab and cleared on sign-out, Refresh
  re-reads). Cards say when a read limit was reached and show an error instead of zeros when a read fails.
  Charts are dependency-free SVG (no chart library or paid API was added).
* **Tables** — every table has *Columns* (hide/show, mandatory identifying/action columns, Select all,
  Reset to default; remembered per table on this device, column names only), *Filters* built from the
  table's real values (value filters, date ranges, combinable, chips, counts), sortable headings and
  paging. HTML tables: `adminTableKit.js` (replaces `adminPager.js`); React tables: `DataTable` in `react/ui.tsx`.
* **Daily Deen Challenges** — tabs *Schedule & automation*, *Published & drafts* (all previous tools),
  *30-day library*. Plan the 30-day library from a start date, add one-off or repeating challenges
  (daily / chosen weekdays, optional end), pause / edit / reschedule / remove, preview the next 30 days,
  turn automation on/off and publish today's challenges now.
* **30-day library** — `src/features/admin/challenges/challengeLibrary.ts`. Qur'an and hadith lines are
  translations of meaning with references (sūrah:āyah or collection and number); "Motivation" lines are
  original wording; every challenge ends with the sincerity reminder; nothing requires showing private worship.
* **RISE Messages** — message one member (search by username; delivered instantly when they already have
  a RISE conversation, otherwise delivered by the scheduler, which creates it) or all members (typed
  `SEND TO ALL` confirmation, reach estimate, delivered in pages by the scheduler). Preview, live history
  with progress, cancel while queued. Idempotent: one request id per composed message, one fixed message
  id per member (`b_<requestId>`).
* **Design** — isolated stylesheet `src/features/admin/styles/admin-console.css`, loaded only with the
  admin chunk and scoped to `#adminApp`. Tokens are the public site's own V3 light/dark palette; the
  light/dark switch (login page and top bar) uses the public mechanism (`html.light-mode` + stored `theme`).

## Backend (free tier, no new services)

* `firestore.rules`: new `deens_challenge_schedule` (community admins) and `deens_rise_broadcasts`
  (Super Admin; create once, cancel or record direct delivery while queued; no deletes);
  `content/rud_maintenance_config` writable by the Super Admin only. **Deploy with
  `firebase deploy --only firestore:rules`.** No new indexes are needed.
* `push-scheduler/challengeScheduler.js` and `push-scheduler/riseBroadcasts.js` run in the existing free
  GitHub Actions scheduler (`index.js`, every ~5 minutes) — no workflow change.
  - Challenges: today in `Asia/Kolkata` (configurable in `deens_admin_settings/challenge_automation.timeZone`);
    create-if-absent transactions on `sched_<entry>_<yyyymmdd>`; finished scheduler challenges are archived
    (yesterday kept for late time zones; manual challenges never touched). A day missed entirely by the
    scheduler is not published late (a daily challenge can only be completed on its day).
  - RISE outreach: verifies the requester is the Super Admin, skips disabled members, 45 s budget per run,
    resumes from a saved cursor, retries failed members up to 3 times, writes an audit entry.
  Push notifications for these use the existing Deen Friends notifier (new daily challenge, "RISE replied").

## Shared code touched (and why)

* `src/features/maintenance/maintenance.js`, `src/app/routing/router.js` — Maintenance Access propagation (above).
* `src/styles/*.css` — **only removals** of rules that can only match admin elements (~124 KB the public
  site no longer downloads). Selectors were removed mechanically (PostCSS) only when they reference a
  class/id that exists only in admin code; mixed selector lists keep their public parts.
* `src/features/admin/components/*` are rendered by the public shell but are admin markup.

## Verification performed

* `tsc -b` clean. Scheduler tests: `npm run test:scheduler` (incl. new `adminAutomation.test.js`).
* Playwright e2e suite against the in-memory Firebase double, mobile and desktop, including the new
  `tests/e2e/admin-console.spec.ts` (auth gate, sign-out, layout/scrolling, login fit, themes, tables,
  Deen Friends handlers/refresh/search, RISE deletion persistence, RISE messages, Maintenance Access
  propagation and atomicity, challenge library/scheduling without duplicates, mobile drawer).
* Public regression: computed styles of every element on 17 public routes × light/dark × desktop/mobile
  compared with the original build — identical apart from run-to-run noise (animated decorations) and the
  hidden admin delete dialog.

## Not verifiable here

* The live Firebase project, real Firestore rules engine and real FCM/GitHub Actions runs (no
  credentials/emulator in this environment). The rules were reviewed by hand and the e2e double models
  the Deen Friends rules only; deploy the rules and watch the first scheduler runs.
* Real multi-device propagation: tested by server-side writes into an open visitor page.
