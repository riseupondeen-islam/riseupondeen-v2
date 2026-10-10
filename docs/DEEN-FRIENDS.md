# Deen Friends V2

Deen Friends was rebuilt as typed React code under `src/features/deen-friends/`. It replaces the
3,500-line V1 closure (`deenFriends.js`) and its stylesheet (`08-deen-friends-ui.css`). Firestore
collection names, existing documents and the existing security model are kept. V2 reads V1 data as
it is, and nothing needs migrating.

Screenshots (from the automated tests): [circle](screenshots/deen-friends/mobile-04-circle.png) ·
[chat](screenshots/deen-friends/mobile-07-chat-items.png) ·
[chat, dark](screenshots/deen-friends/mobile-13-chat-dark.png) ·
[RISE](screenshots/deen-friends/mobile-08-rise.png) ·
[daily challenges](screenshots/deen-friends/mobile-09-daily.png) ·
[desktop](screenshots/deen-friends/desktop-04-circle.png)

## Structure

| Layer | Files | Responsibility |
| --- | --- | --- |
| Route | `deenFriendsRoute.tsx` | Registers the legacy hooks the router and Tasbih call (`rudRenderDeenFriends`, `RUD_DEEN_FRIENDS`). It parses the sub-routes `#deen-friends`, `/streaks`, `/chats`, `/challenges`, `/rise` and `/chat/<id>`, and lazy-loads the page. |
| State | `state/deenFriendsStore.ts` | One external store (`useSyncExternalStore`). Badge listeners (incoming/outgoing requests, unread, RISE) run while signed in. Page listeners (friendships, streaks) run only while the page is open. |
| Services | `services/*.ts` | All Firestore access, one module per concern: account, friends, streaks, interactions, daily challenges, RISE chat and push devices. Errors pass through `errors.ts`, so users never see raw Firebase messages such as "Quota exceeded". |
| UI | `DeenFriendsPage.tsx`, `components/*.tsx` | Four tabs (Friends, Streaks, Chats, Challenges), the full-screen friend chat and RISE chat, profile sheets, Deen action sheets and notification settings. |
| Styles | `src/styles/08-deen-friends.css` | `df2-` prefixed tokens and components: cream/emerald/gold, light and dark, 6 chat themes. |
| Admin | `src/features/admin/react/DailyChallengesAdmin.tsx`, `RiseInboxAdmin.tsx` | Two new admin console sections. |

## Data contracts

| Collection | Written by | Notes |
| --- | --- | --- |
| `deens_users/{uid}` | owner | unchanged. V2 adds an optional `privacy.shareCheckinCards` field. |
| `deens_friend_requests/{id}` | sender / recipient | `{fromUid,toUid,status: pending/accepted/declined/cancelled, createdAtMs, updatedAtMs}`. Ids are now unique per request, so a removed friend can be re-added. |
| `deens_friendships/{a_b}` | via accept batch | `members` (sorted pair) |
| `deens_friend_streaks/{a_b}` | members | supportive streak. The UI talks about "days together", not loss. |
| `deens_friend_messages/{id}` | members | Deen actions only (challenge, encouragement from an allow-list, shared content with references, check-in card). There is no free text. Seen non-challenge items get `purgeAt = seen + 24h`. |
| `deens_daily_challenges/{id}` | community admins | **new.** `{title, description, category, target, audience: all/selected, assignedUids[], status: draft/published/unpublished/archived, startDate, endDate, …}` |
| `deens_daily_challenges/{id}/participants/{uid}` | the user | **new.** `{completedDates[], lastCompletedDate, status}` |
| `deens_rise_threads/{uid}` (+ `/messages/{id}`) | user / support admins | **new.** A private thread with the RISE team. `welcome` is a fixed, rules-validated automated message, created once. |
| `deens_push_devices/{uid}/devices/{deviceId}` | the user | **new.** The FCM token and per-category preferences for that user's device. Owner-only. Read by the trusted scheduler. |

## Root causes fixed

**Add Friend showed "Unavailable" with a disabled button.** V1 checked whether two people were
already connected with `getDoc` on `deens_friendships/{pair}` and `deens_friend_requests/{pair}`.
Both rules dereference `resource.data`. For a document that does not exist yet, `resource` is null,
so the read is denied. That is the normal case for two people who have never connected. V1 caught
the error, set the status to `unknown`, and rendered "Unavailable".

The super-admin override in the rules hid the bug from the owner's account. Two smaller defects sat
on the same path:

- Decline wrote `status: 'rejected'`, which the rules deny (they allow `declined`).
- A deterministic request id meant an old accepted request blocked re-adding someone after they were
  removed.

V2 derives the connection status from queries the rules allow (pending requests in both directions,
plus the live friendship list), writes `declined`, and uses unique request ids. The fake-Firebase rules
model reproduces the original denial (test: *"rules model: reading a missing friendship is denied"*).

**Custom challenges failed to create.** This could not be reproduced against production, so the
findings come from analysing the code against the rules:

- The id was deterministic per friendship and day, so a second challenge turned `set` into an update.
  The rules deny that update.
- Arabic-Indic digits in the target failed `is int` validation.
- The error was swallowed.

V2 uses `ch_<friendship>_<random>` ids, converts digits to ASCII, checks for duplicate active
challenges, and shows a friendly error.

## 24-hour cleanup (server-side; no client timers)

Seen items get a `purgeAt` timestamp, which the rules allow to be at most 25 hours ahead. Active
challenges never get one. Deletion is done by a Firestore **TTL policy**, which is free and runs
server-side. Enable it once:

```bash
gcloud firestore fields ttls update purgeAt \
  --collection-group=deens_friend_messages --enable-ttl --project=<your-project-id>
```

TTL deletion usually happens within 24 hours after `purgeAt`. Until then, the UI hides seen items
older than 24 hours. "Clear chat" removes your own items now (keeping active challenges) and hides
the rest on that device.

## RISE (official) chat

- It is a separate collection from friend chats and challenges, and is pinned at the top of Chats.
- The welcome message is labelled "Automated message". Team replies are labelled "RISE team" and are
  never presented as coming from a friend.
- Admin access requires `SUPPORT_ADMIN`, `COMMUNITY_ADMIN` or `TRUST_SAFETY_ADMIN` (or the super
  admin). Opening a thread writes an entry to `deens_admin_audit_logs`.

## Daily Deen Challenges (admin) vs custom challenges (friends)

- **Daily challenges** are created in Admin → *Daily Deen Challenges*, which requires
  `COMMUNITY_ADMIN` or higher. Admins can save drafts, publish, unpublish and archive, assign to all
  users or to named usernames, and view the progress table.
  - Users see only published challenges addressed to them (enforced by the rules).
  - Users mark each day done; Tasbih-type challenges open the Tasbih counter.
- **Custom challenges** are created between two friends in the chat (Recommended, RISE templates, or
  "Your own"). Each side's progress is shown on the card.

## Testing against the emulator (recommended before deploying rules)

```bash
firebase emulators:start --only firestore,auth
# in another terminal, point a dev build at the emulator, or run the e2e suite (fake Firebase):
npm run test:e2e
```

The e2e suite uses an in-memory Firebase with a JavaScript model of the Deen Friends rules
(`tests/fake-firebase/rules.js`). That model is not the real rules engine. Run the emulator against
`firestore.rules` before deploying.
