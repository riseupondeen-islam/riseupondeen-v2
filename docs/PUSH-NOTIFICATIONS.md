# Push notifications (free, FCM)

The app already had one push pipeline: the Firebase Cloud Messaging web SDK, the single service
worker `public/sw.js`, tokens in `push_subscriptions`, and a free GitHub Actions scheduler in
`push-scheduler/`. V2 extends it to Deen Friends. It adds no second service worker, no second
Firebase app and no paid service.

## How it fits together

```
User taps "Turn on notifications" (Deen Friends → my profile → Notifications)
  → browser permission prompt (only after that tap)
  → FCM token (existing pushNotifications.js, VAPID key from <meta name="rud-web-push-vapid-key">)
  → event "rud-push-token-changed"
  → deens_push_devices/{uid}/devices/{visitorId}  {fcmToken, categories, platform, active}
                                   (owner-only rules; removed on sign-out)

GitHub Actions, every 5 min (push-scheduler/index.js → deenFriends.js, Admin SDK)
  → reads changes since checkpoint push_scheduler_state/deen_friends
  → claims a deterministic event id in push_deliveries_df (create-if-absent = exactly once)
  → FCM data-only message {title, body, category: df-*, route, dedupeId} to that user's devices
  → deletes device records whose token FCM reports as invalid

Service worker onBackgroundMessage → one notification (tag = dedupeId) → click opens the route
Page onMessage (foreground) → in-app toast instead, skipped if already on that screen
```

## Admin switches (Admin Console › Notification Settings)

Every sender in `push-scheduler/` obeys one settings document, `deens_admin_settings/notifications`
(Super Admin only in `firestore.rules`), through `push-scheduler/notificationPolicy.js`:

| Switch | Default | Covers |
| --- | --- | --- |
| All user notifications (master) | On | Everything. While off nothing is sent; no category can bypass it. |
| Daily Deen Challenge | On | "New Daily Deen Challenge" (deenFriends.js step 6) |
| Five daily prayer reminders | Off | Fajr, Dhuhr, Asr, Maghrib, Isha (index.js prayer pipeline) |
| All other notifications | Off | Queued `push_jobs` from Send Notification (announcements, Qur'an, Friday, new Dua/Hadith, tests), friend requests/activity, challenge replies, "RISE replied" |

* A missing document means these defaults. A document that cannot be read means **nothing** is sent
  (queued jobs and the Deen Friends checkpoint are kept for a run that can verify the settings).
* The document is read once per run and re-checked immediately before every send (re-read when the
  cached copy is older than 30 s), so a switch turned off stops a running delivery within ~30 s.
* A due `push_jobs` entry that is not allowed is marked `status: 'blocked'` and never sent later;
  Deen Friends events that occur while their switch is off are skipped for good. Turning a switch on
  therefore never releases a backlog, and changing a switch never sends anything by itself.
* While prayer reminders are off the prayer pipeline does no Firestore work at all. When they are
  turned on again only prayers inside the normal 30-minute window are sent.
* Members' own category choices and their browser permission are still respected; the switches can
  only restrict delivery, never add a recipient.
* Prayer reminders are delivered only by the scheduler. The page no longer shows its own local copy
  at the prayer minute (it duplicated the push and could not be switched off by the admin).

## Events

| Event | Recipient | Category (user can switch off) | Text |
| --- | --- | --- | --- |
| New friend request | recipient | Friend requests | "Aisha would like to connect with you." |
| Request accepted | requester | Friend requests | "Bilal accepted your Deen Friend request." |
| New Deen interaction(s) | recipient | Friend activity | "shared something with you" / "sent you a Deen challenge" (grouped per friend, per run) |
| Challenge accepted/declined | challenger | Friend activity | "Aisha accepted your challenge." |
| Reply from RISE team | user | Replies from RISE | "Open Deen Friends to read the reply…" (the automated welcome never notifies) |
| Daily Deen Challenge published | assigned users, or all registered devices | Daily Deen Challenges | the challenge title |
| Reminders | (existing) | existing Reminder Center categories | unchanged |

Notifications **never contain conversation content**. Only the RISE reply message itself is trusted,
not the summary field on the thread that the user can edit, so a user cannot trigger fake
"RISE replied" alerts.

## Setup (one time)

1. **VAPID key.** Already present in `index.html`
   (`<meta name="rud-web-push-vapid-key" content="B…">`). This is the public key from Firebase
   Console → Project settings → Cloud Messaging → Web Push certificates. It is safe to ship. Never
   put the private key in the app.
2. **Service-account secret.** In Firebase Console → Project settings → Service accounts → *Generate
   new private key*, download the JSON. Store its entire content as the GitHub repository secret
   `FIREBASE_SERVICE_ACCOUNT_JSON` (Settings → Secrets and variables → Actions). Never commit it. It
   exists only in GitHub's encrypted secrets and is used only by the workflow.
3. **Workflow.** `.github/workflows/free-push-scheduler.yml` runs `push-scheduler/index.js` every 5
   minutes and on demand (*Run workflow*).
4. **Rules and indexes.** Run `firebase deploy --only firestore:rules,firestore:indexes`.
5. **Optional TTL** for the delivery claims:
   `gcloud firestore fields ttls update expireAt --collection-group=push_deliveries_df --enable-ttl`.

## Cost

- **FCM:** free, with no per-message charge.
- **GitHub Actions:** free for public repositories. For private repositories, the free plan includes
  2,000 minutes/month. A 5-minute cron uses about 8,640 runs/month at roughly 1 billed minute each,
  which **exceeds the free private quota**. Options:
  - make the scheduler repository public (it contains no secrets);
  - change the cron to `*/15`;
  - accept the cost.
- **Firestore reads per run:** 1 settings read; then only the pipelines that are switched on query
  anything (about 6 small range queries for Deen Friends, 3+ for prayers), plus one device lookup per
  recipient. With the defaults (only the Daily Deen Challenge on) the prayer queries and five of the six
  Deen Friends queries are not run.
  This fits easily in the Spark free tier for a small community.
- **No Cloud Functions** (they need the Blaze plan) and no paid push service are used.

## Platform requirements

| Platform | Works? | Notes |
| --- | --- | --- |
| Android Chrome / Edge / Firefox | Yes | The browser can be closed; notifications arrive through the service worker. |
| Desktop Chrome / Edge / Firefox | Yes | Works while the browser is running. |
| iPhone / iPad (iOS 16.4+) | Only as an installed Home Screen app | In Safari the app shows "Add to Home Screen first". In the installed app, the permission prompt must follow a tap, which is how the button works. |
| Safari macOS 16+ | Yes | |
| Browsers without Push API / private modes | No | The settings show "This browser cannot receive notifications". |

## Permission states handled

`unsupported`, `install-required` (iOS browser), `denied` (with instructions; we never ask again
automatically), `off` (explanation and button), and `on` (per-category switches).

## Testing

- `npm run test:scheduler` runs the sender logic offline with an in-memory Firestore and FCM.
  It checks:
  - the recipients;
  - that no content leaks into notifications;
  - that category preferences are respected;
  - that the automated welcome is ignored;
  - that invalid tokens are deleted;
  - that a re-run sends zero duplicates.
- `npm run test:e2e` (Deen Friends tests "notifications: …") covers:
  - device registration under the signed-in UID;
  - preference changes written to the device record;
  - device removal on sign-out;
  - the unsupported-browser state.
- **Not tested here: real delivery.** The sandbox cannot reach FCM or Google, so no notification
  was sent to a real device. To verify on a phone:
  1. Sign in on the phone, turn notifications on, and close the app.
  2. From another account, send a friend request.
  3. Run the workflow manually.
  4. The notification should arrive within one run. The workflow log prints
     `deenFriends: {sent: n}`.
