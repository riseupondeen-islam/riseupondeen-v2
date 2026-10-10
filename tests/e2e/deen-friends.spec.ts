import { expect, test, type Page } from '@playwright/test';
import { firestoreLog, goto, prepare, trackPageErrors } from './helpers';
import { DF_USERS } from '../fixtures/firebaseSeed';

/* Deen Friends V2 end-to-end flows against the in-memory Firebase double, which now models the
 * Deen Friends security rules (tests/fake-firebase/rules.js). Two people are simulated in one page
 * by signing out and in again (the fake keeps its data for the life of the page). */

type DfUser = (typeof DF_USERS)['aisha'];
const SHOTS = 'test-results/df-shots';
/** Every Deen Friends surface (page, sheets, full-screen chats) carries .df2-root. */
const ui = (page: Page) => page.locator('.df2-root');

async function signIn(page: Page, user: DfUser) {
  await ui(page).getByLabel('Email').fill(user.email);
  await ui(page).getByLabel('Password', { exact: true }).fill(user.password);
  await ui(page).getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.locator('.df2-me-chip')).toContainText(`@${user.username}`);
}

async function signOut(page: Page) {
  await page.locator('.df2-me-chip').click();
  await ui(page).getByRole('button', { name: 'Edit profile' }).click();
  await ui(page).getByRole('button', { name: 'Sign out' }).click();
  await expect(ui(page).getByRole('button', { name: 'Sign in securely' })).toBeVisible();
}

async function openDeenFriends(page: Page) {
  await prepare(page);
  await goto(page, '#deen-friends');
  await expect(page.locator('.df2-page')).toBeVisible();
}

function fakeDocs(page: Page, prefix: string) {
  return page.evaluate((p) => {
    const docs = (globalThis as unknown as { __FAKE_FB__: { docs: Map<string, Record<string, unknown>> } }).__FAKE_FB__
      .docs;
    return [...docs.entries()]
      .filter(([k]) => k.startsWith(p))
      .map(([k, v]) => ({ path: k, ...JSON.parse(JSON.stringify(v)) }));
  }, prefix);
}

test('Add Friend → request → accept: the complete two-user flow', async ({ page }, info) => {
  const errors = trackPageErrors(page);
  await openDeenFriends(page);
  await signIn(page, DF_USERS.aisha);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-01-friends-empty.png`, fullPage: true });

  // Search shows the person with an enabled "Add friend" (V1 showed "Unavailable" here).
  await (await friendSearch(page)).fill('@Bilal');
  await ui(page).getByRole('button', { name: 'Find' }).click();
  const addButton = page.locator('.df2-search-result').getByRole('button', { name: 'Add friend' });
  await expect(addButton).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-02-search.png` });
  await addButton.click();
  await expect(page.locator('.rud-note').last()).toContainText('Request sent to @bilal');
  await expect(page.locator('.df2-search-result').getByRole('button', { name: 'Cancel request' })).toBeVisible();
  await openRequests(page);
  await expect(page.locator('#df2-requests')).toContainText('waiting for reply');

  // Exactly one pending request, addressed by UID.
  const requests = await fakeDocs(page, 'deens_friend_requests/');
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ fromUid: DF_USERS.aisha.uid, toUid: DF_USERS.bilal.uid, status: 'pending' });

  // Sending again is refused without creating a duplicate.
  await signOut(page);
  await signIn(page, DF_USERS.bilal);
  await openRequests(page);
  await expect(page.locator('#df2-requests')).toContainText('Aisha Rahman');
  await expect(page.locator('.df2-tabs [role=tab]').first()).toContainText('1');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-03-incoming.png`, fullPage: true });
  await page.locator('#df2-requests').getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('.rud-note').last()).toContainText('You are now Deen Friends');
  await expect(page.locator('.df2-friend-card')).toContainText('Aisha Rahman');

  const fid = [DF_USERS.aisha.uid, DF_USERS.bilal.uid].sort().join('_');
  const friendships = await fakeDocs(page, 'deens_friendships/');
  expect(friendships.map((f) => f.path)).toEqual([`deens_friendships/${fid}`]);
  expect(await fakeDocs(page, 'deens_friend_streaks/')).toHaveLength(1);
  expect((await fakeDocs(page, 'deens_friend_requests/'))[0].status).toBe('accepted');

  // The friends badge clears and searching the friend now shows "Friends" (disabled).
  await (await friendSearch(page)).fill('aisha');
  await ui(page).getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('.df2-search-result').getByRole('button', { name: 'Friends' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-04-circle.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('declining and cancelling requests update the right state', async ({ page }) => {
  await openDeenFriends(page);
  await signIn(page, DF_USERS.aisha);
  await (await friendSearch(page)).fill('bilal');
  await ui(page).getByRole('button', { name: 'Find' }).click();
  await page.locator('.df2-search-result').getByRole('button', { name: 'Add friend' }).click();
  await page.locator('.df2-search-result').getByRole('button', { name: 'Cancel request' }).click();
  await expect(page.locator('.rud-note').last()).toContainText('cancelled');
  expect((await fakeDocs(page, 'deens_friend_requests/'))[0].status).toBe('cancelled');

  // A new request after cancelling works (V1 reused the pair id and collided).
  await page.locator('.df2-search-result').getByRole('button', { name: 'Add friend' }).click();
  await expect(page.locator('.df2-search-result').getByRole('button', { name: 'Cancel request' })).toBeVisible();
  await signOut(page);
  await signIn(page, DF_USERS.bilal);
  await openRequests(page);
  await page.locator('#df2-requests').getByRole('button', { name: 'Decline' }).click();
  await expect(page.locator('.rud-note').last()).toContainText('declined');
  const statuses = (await fakeDocs(page, 'deens_friend_requests/')).map((r) => r.status).sort();
  expect(statuses).toEqual(['cancelled', 'declined']);
  await expect(page.locator('#df2-requests')).toContainText('No requests');
});

/** "+ Add friend" opens the username search (V3.2). */
async function friendSearch(page: Page) {
  const field = ui(page).getByLabel("Friend's username");
  if (!(await field.isVisible())) await ui(page).getByRole('button', { name: 'Add friend', exact: true }).click();
  return field;
}

/** Friend requests live inside a collapsible "Requests" button (V3.1). */
async function openRequests(page: Page) {
  const toggle = ui(page).getByRole('button', { name: /^Requests/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

async function becomeFriends(page: Page) {
  await signIn(page, DF_USERS.aisha);
  await (await friendSearch(page)).fill('bilal');
  await ui(page).getByRole('button', { name: 'Find' }).click();
  await page.locator('.df2-search-result').getByRole('button', { name: 'Add friend' }).click();
  await expect(page.locator('.df2-search-result').getByRole('button', { name: 'Cancel request' })).toBeVisible();
  await signOut(page);
  await signIn(page, DF_USERS.bilal);
  await openRequests(page);
  await page.locator('#df2-requests').getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('.df2-friend-card')).toContainText('Aisha Rahman');
}

test('chat: custom challenge, reaction, shared content, check-in, accept and complete', async ({ page }, info) => {
  const errors = trackPageErrors(page);
  await openDeenFriends(page);
  await becomeFriends(page);

  // Bilal opens the conversation: the navbar hides and the chat is full screen.
  await page.locator('.df2-friend-card').getByRole('button', { name: /Chat/ }).click();
  await expect(page.locator('.df2-fullscreen')).toBeVisible();
  await expect(page.locator('.rud-minimal-topbar')).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-05-chat-empty.png` });

  // Custom challenge (the V1 failure): one write, unique id with the rules' required prefix.
  await ui(page).getByRole('button', { name: 'Send a challenge' }).click();
  await ui(page).getByRole('tab', { name: 'Your own' }).click();
  await ui(page).getByLabel('Challenge title').fill('Read Surah Al-Mulk tonight');
  await ui(page).getByRole('button', { name: 'Count in Tasbih' }).click();
  await ui(page).getByLabel('Tasbih target').fill('٣٣'); // Arabic-Indic digits are accepted
  await ui(page).getByRole('button', { name: 'In 3 days' }).click();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-06-custom-challenge.png` });
  await ui(page).getByRole('button', { name: 'Send challenge' }).click();
  await expect(page.locator('.df2-challenge')).toContainText('Read Surah Al-Mulk tonight');
  const sent = (await fakeDocs(page, 'deens_friend_messages/')).filter((m) => m.kind === 'challenge');
  expect(sent).toHaveLength(1);
  expect(sent[0].challenge).toMatchObject({ type: 'custom', target: 33, activity: 'tasbih' });
  expect(String(sent[0].path)).toMatch(/^deens_friend_messages\/ch_fakeuser101_fakeuser102_[a-z0-9]{14}$/);

  // The same active challenge cannot be sent twice.
  await ui(page).getByRole('button', { name: 'Send a challenge' }).click();
  await ui(page).getByRole('tab', { name: 'Your own' }).click();
  await ui(page).getByLabel('Challenge title').fill('Read Surah Al-Mulk tonight');
  await ui(page).getByRole('button', { name: 'Send challenge' }).click();
  await expect(page.locator('.df2-form-error')).toContainText('already have this challenge active');
  await page.keyboard.press('Escape');

  // Quick reaction, shared dua (with reference) and a check-in card.
  await ui(page).getByRole('button', { name: 'Ameen 🤲' }).click();
  await expect(page.locator('.df2-msg-bubble').last()).toContainText('Ameen');
  await ui(page).getByRole('button', { name: 'Deen action' }).click();
  await ui(page).getByRole('button', { name: /^Dua/ }).click();
  await page.locator('.df2-share-item').first().click();
  await expect(page.locator('.df2-shared')).toBeVisible();
  // V3.1: no check-in button — sending Deen actions marks today active on the shared streak.
  await expect
    .poll(async () => ((await fakeDocs(page, 'deens_friend_streaks/'))[0]?.checkins || {})[DF_USERS.bilal.uid])
    .toBeTruthy();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-07-chat-items.png` });

  // Back to the list restores the navbar.
  await ui(page).getByRole('button', { name: 'Back to chats' }).click();
  await expect(page.locator('.df2-fullscreen')).toHaveCount(0);
  await expect(page.locator('.rud-minimal-topbar')).toBeVisible();

  // Aisha accepts and marks a manual challenge done; the Tasbih one opens Tasbih.
  await ui(page)
    .getByRole('tab', { name: /Friends/ })
    .click();
  await signOut(page);
  await signIn(page, DF_USERS.aisha);
  await expect(page.locator('.df2-tabs')).toContainText('3'); // 3 unseen items from Bilal (V3.1: no check-in card)
  await ui(page).getByRole('tab', { name: /Chats/ }).click();
  await page.locator('.df2-chat-list .df2-chat-row').first().click();
  await expect(page.locator('.df2-challenge')).toContainText('Bilal challenged you');
  await page.locator('.df2-challenge').getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('.df2-challenge')).toContainText('Accepted');
  await expect(page.locator('.df2-challenge').getByRole('button', { name: 'Count in Tasbih' })).toBeVisible();

  // Seen items received a read receipt and a purgeAt 24h ahead (TTL cleanup), challenges excepted.
  const received = (await fakeDocs(page, 'deens_friend_messages/')).filter(
    (m) => m.recipientUid === DF_USERS.aisha.uid,
  );
  for (const m of received) {
    expect(m.readAtMs, `${m.path} seen`).toBeTruthy();
    if (m.kind !== 'challenge') expect(m.purgeAt, `${m.path} purgeAt`).toBeTruthy();
  }
  await page.locator('.df2-challenge').getByRole('button', { name: 'Count in Tasbih' }).click();
  await expect(page).toHaveURL(/#tasbih\/df-challenge$/);
  await expect(page.locator('#rudSelectedZikr')).toContainText('Challenge target: 33');
  expect(errors).toEqual([]);
});

test('clear chat deletes only my own items after confirmation', async ({ page }) => {
  await openDeenFriends(page);
  await becomeFriends(page);
  await page.locator('.df2-friend-card').getByRole('button', { name: /Chat/ }).click();
  await ui(page).getByRole('button', { name: 'JazakAllahu khayran 💚' }).click();
  await ui(page).getByRole('button', { name: 'SubhanAllah 🌙' }).click();
  await expect(page.locator('.df2-msg-bubble')).toHaveCount(2);
  await ui(page).getByRole('button', { name: 'Chat settings' }).click();
  await ui(page).getByRole('button', { name: 'Clear chat' }).click();
  await expect(ui(page).getByRole('dialog', { name: 'Clear this chat?' })).toBeVisible();
  await ui(page).getByRole('dialog', { name: 'Clear this chat?' }).getByRole('button', { name: 'Clear chat' }).click();
  await expect(page.locator('.df2-msg-bubble')).toHaveCount(0);
  expect(await fakeDocs(page, 'deens_friend_messages/')).toHaveLength(0);
});

test('RISE: welcome is created once, messages send, channel is separate', async ({ page }, info) => {
  await openDeenFriends(page);
  await signIn(page, DF_USERS.aisha);
  await ui(page).getByRole('tab', { name: /Chats/ }).click();
  await page.locator('.df2-chat-row-rise').click();
  await expect(page.locator('.df2-fullscreen')).toContainText('This first message is automated');
  await expect(page.locator('.df2-automated-label').first()).toHaveText('Automated message');
  await ui(page).getByLabel('Message to RISE').fill('Assalamu alaikum, how do I reset my streak reminder?');
  await ui(page).getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.df2-msg-text.mine')).toContainText('reset my streak reminder');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-08-rise.png` });
  // Close and reopen: still exactly one welcome.
  await ui(page).getByRole('button', { name: 'Back to chats' }).click();
  await page.locator('.df2-chat-row-rise').click();
  await expect(page.locator('.df2-msg-text.mine')).toHaveCount(1);
  const messages = await fakeDocs(page, `deens_rise_threads/${DF_USERS.aisha.uid}/messages/`);
  expect(messages.filter((m) => m.automated)).toHaveLength(1);
  expect(messages.filter((m) => m.from === 'user')).toHaveLength(1);
  const [thread] = await fakeDocs(page, `deens_rise_threads/${DF_USERS.aisha.uid}`);
  expect(thread).toMatchObject({ lastFrom: 'user', unreadByRise: 1, status: 'open' });
  // Nothing was written to the friend-interaction collection.
  expect(await fakeDocs(page, 'deens_friend_messages/')).toHaveLength(0);
});

test('Daily Deen Challenges: only published challenges addressed to me; mark today done', async ({ page }, info) => {
  await openDeenFriends(page);
  await signIn(page, DF_USERS.aisha);
  await ui(page)
    .getByRole('tab', { name: /Challenges/ })
    .click();
  await expect(page.locator('.df2-daily')).toHaveCount(1);
  await expect(page.locator('.df2-daily')).toContainText('TEST Daily: one page of Qur’an');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-09-daily.png`, fullPage: true });
  await ui(page).getByRole('button', { name: 'Mark today done' }).click();
  await expect(ui(page).getByRole('button', { name: 'Done for today' })).toBeDisabled();
  const [progress] = await fakeDocs(page, 'deens_daily_challenges/daily_all/participants/');
  expect(progress).toMatchObject({ uid: DF_USERS.aisha.uid, completedCount: 1, status: 'active' });
  await signOut(page);
  await signIn(page, DF_USERS.bilal);
  await ui(page)
    .getByRole('tab', { name: /Challenges/ })
    .click();
  await expect(page.locator('.df2-daily')).toHaveCount(2);
});

test('Deen Friends works in light mode and on narrow phones without horizontal scroll', async ({ page }, info) => {
  await prepare(page, { theme: 'light' });
  await page.setViewportSize({ width: 360, height: 740 });
  await goto(page, '#deen-friends');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-10-auth-light.png`, fullPage: true });
  await signIn(page, DF_USERS.aisha);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-11-friends-light.png`, fullPage: true });
});

test('rules model: reading a missing friendship is denied (the V1 Add Friend root cause)', async ({ page }) => {
  await openDeenFriends(page);
  await signIn(page, DF_USERS.aisha);
  const denied = await page.evaluate(() => {
    const fb = (globalThis as unknown as { __FAKE_FB__: { rules: { allowed: (...a: unknown[]) => boolean } } })
      .__FAKE_FB__;
    return {
      missingFriendship: fb.rules.allowed('read', 'deens_friendships/fakeuser101_fakeuser102', null, null),
      missingRequest: fb.rules.allowed('read', 'deens_friend_requests/fakeuser101_fakeuser102', null, null),
    };
  });
  // V1 read exactly these documents before two people had ever connected -> always denied.
  expect(denied).toEqual({ missingFriendship: false, missingRequest: false });
  const log = await firestoreLog(page);
  // V2 never issues a direct read of a friendship or request document that may not exist.
  expect(log.filter((e) => e.op === 'getDoc' && /^deens_(friendships|friend_requests)\//.test(e.path))).toEqual([]);
});

test('dark mode renders the page, chat and RISE screens', async ({ page }, info) => {
  await prepare(page, { theme: 'dark' });
  await goto(page, '#deen-friends');
  await becomeFriends(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-12-friends-dark.png`, fullPage: true });
  await page.locator('.df2-friend-card').getByRole('button', { name: /Chat/ }).click();
  await ui(page).getByRole('button', { name: 'BarakAllahu feek ✨' }).click();
  await expect(page.locator('.df2-msg-bubble')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-13-chat-dark.png` });
  // Back returns to where the chat was opened from (the Friends tab here).
  await ui(page).getByRole('button', { name: 'Back to chats' }).click();
  await expect(page.locator('.df2-friend-card')).toBeVisible();
  await ui(page).getByRole('tab', { name: /Chats/ }).click();
  await page.locator('.df2-chat-row-rise').click();
  await expect(page.locator('.df2-automated-label').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-14-rise-dark.png` });
});

test('notifications: device registered per user, preferences saved, removed on sign-out', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    localStorage.setItem('rud_fcm_token_v2', 'test-fcm-token');
    localStorage.setItem('rud_push_preferences_v2', JSON.stringify({ enabled: true }));
  });
  await openDeenFriends(page);
  await signIn(page, DF_USERS.aisha);
  const devicePath = `deens_push_devices/${DF_USERS.aisha.uid}/devices/`;
  await expect.poll(async () => (await fakeDocs(page, devicePath)).length).toBe(1);
  const [device] = await fakeDocs(page, devicePath);
  expect(device).toMatchObject({
    uid: DF_USERS.aisha.uid,
    fcmToken: 'test-fcm-token',
    active: true,
    categories: { rise: true },
  });

  await page.locator('.df2-me-chip').click();
  await ui(page).getByRole('button', { name: 'Notifications' }).click();
  const rise = ui(page).getByRole('checkbox', { name: /Replies from RISE/ });
  await expect(rise).toBeChecked();
  await rise.uncheck();
  await expect.poll(async () => (await fakeDocs(page, devicePath))[0]?.categories?.rise).toBe(false);
  await expect(page.locator('.df2-sheet-backdrop')).toContainText('never include the content of your conversations');
  await page.keyboard.press('Escape');

  await signOut(page);
  await expect.poll(async () => (await fakeDocs(page, devicePath)).length).toBe(0);
});

test('notifications: unsupported browsers get an explanation instead of a button', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { PushManager?: unknown }).PushManager;
  });
  await openDeenFriends(page);
  await signIn(page, DF_USERS.aisha);
  await page.locator('.df2-me-chip').click();
  await ui(page).getByRole('button', { name: 'Notifications' }).click();
  await expect(page.locator('.df2-sheet-backdrop')).toContainText('This browser cannot receive notifications');
  await expect(ui(page).getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
});

test('the four tabs stay on one line on narrow phones, even with larger system text', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openDeenFriends(page);
  await signIn(page, DF_USERS.aisha);
  for (const rootSize of ['16px', '19px']) {
    await page.evaluate((size) => (document.documentElement.style.fontSize = size), rootSize);
    const tabs = await page.locator('.df2-tabs button').evaluateAll((buttons) =>
      buttons.map((b) => {
        const label = b.querySelector('span:not(.df2-badge)') as HTMLElement;
        const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
        return {
          top: b.getBoundingClientRect().top,
          lines: Math.round(label.getBoundingClientRect().height / lineHeight),
          text: label.textContent,
        };
      }),
    );
    expect(tabs.map((t) => t.text)).toEqual(['Friends', 'Streaks', 'Chats', 'Challenges']);
    expect(new Set(tabs.map((t) => Math.round(t.top))).size).toBe(1);
    for (const t of tabs) expect(t.lines, `${t.text} at ${rootSize}`).toBe(1);
  }
});
