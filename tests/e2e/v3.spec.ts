import { expect, test, type Page } from '@playwright/test';
import { ADMIN_TEST_PASSWORD, DF_USERS } from '../fixtures/firebaseSeed';
import { firestoreLog, goto, prepare, setHash, trackPageErrors } from './helpers';

/* V3 end-to-end checks (one test per requirement area). Real Android/iOS devices are NOT used:
 * mobile tests run in Chromium with Pixel 7 emulation, and iOS / in-app browsers are simulated by
 * user-agent overrides. See docs/V3-IMPLEMENTATION.md for what still needs a real device. */

const ui = (page: Page) => page.locator('.df2-root');

type DfUser = (typeof DF_USERS)['aisha'];

/** Adds documents (and auth users) to the in-memory Firebase seed before any page script runs. */
async function extendSeed(page: Page, collections: Record<string, Record<string, unknown>>, users: Array<Record<string, string>> = []) {
  await page.addInitScript(
    ([extra, extraUsers]) => {
      const w = window as unknown as { __FAKE_FB_SEED__: { collections: Record<string, Record<string, unknown>>; users: unknown[] } };
      for (const [coll, docs] of Object.entries(extra)) w.__FAKE_FB_SEED__.collections[coll] = { ...(w.__FAKE_FB_SEED__.collections[coll] || {}), ...docs };
      w.__FAKE_FB_SEED__.users.push(...extraUsers);
    },
    [collections, users] as const,
  );
}

async function signIn(page: Page, user: DfUser) {
  await ui(page).getByLabel('Email').fill(user.email);
  await ui(page).getByLabel('Password', { exact: true }).fill(user.password);
  await ui(page).getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.locator('.df2-me-chip')).toContainText(`@${user.username}`);
}

function fakeDocs(page: Page, prefix: string) {
  return page.evaluate((p) => {
    const docs = (globalThis as unknown as { __FAKE_FB__: { docs: Map<string, Record<string, unknown>> } }).__FAKE_FB__.docs;
    return [...docs.entries()].filter(([k]) => k.startsWith(p)).map(([k, v]) => ({ path: k, ...JSON.parse(JSON.stringify(v)) }));
  }, prefix);
}

const pair = (a: string, b: string) => [a, b].sort().join('_');
const extraProfile = (uid: string, username: string, name: string) => ({
  uid,
  visitorId: `v_${username}`,
  username,
  usernameKey: username,
  displayName: name,
  email: `${username}@example.com`,
  avatar: 'mosque',
  bio: '',
  createdAt: { __ts: Date.now() - 7200000 },
  updatedAt: { __ts: Date.now() - 7200000 },
  lastActiveAt: Date.now() - 600000,
});

/** Aisha with three Deen Friends (Bilal, Yusuf, Maryam) — enough for a circle of four. */
function circleSeed() {
  const members = (a: string, b: string) => ({ members: [a, b].sort(), createdAt: { __ts: Date.now() - 7200000 }, updatedAt: { __ts: Date.now() - 7200000 }, streakCount: 0 });
  return {
    deens_users: { fakeuser103: extraProfile('fakeuser103', 'yusuf', 'Yusuf Ali'), fakeuser104: extraProfile('fakeuser104', 'maryam', 'Maryam Noor') },
    deens_friendships: {
      [pair('fakeuser101', 'fakeuser102')]: members('fakeuser101', 'fakeuser102'),
      [pair('fakeuser101', 'fakeuser103')]: members('fakeuser101', 'fakeuser103'),
      [pair('fakeuser101', 'fakeuser104')]: members('fakeuser101', 'fakeuser104'),
    },
  };
}

/* ---------------------------------------------------------------------------------------------- */

test('navigation order, icons and the exact supplied logo', async ({ page, request }) => {
  await prepare(page);
  await goto(page, '#home');
  const labels = await page.locator('.rud-topbar-actions > *').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || ''));
  expect(labels.slice(0, 4)).toEqual(['Home', 'My Deen', 'Notifications and reminders', 'Deen Friends']);
  expect(labels[4]).toMatch(/Switch to (Dark|Light) Mode/);
  expect(labels[5]).toBe('Open Explore');
  // All topbar icons share one size (no misaligned icon).
  const sizes = await page.locator('.rud-topbar-actions > .rud-topbar-icon, .rud-topbar-actions > .rud-theme-toggle').evaluateAll((els) =>
    els.map((e) => `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`),
  );
  expect(new Set(sizes).size).toBe(1);
  // The header keeps the original transparent brand logo (no tile) in both themes.
  const logo = await page.locator('.rud-minimal-logo img').evaluate((img: HTMLImageElement) => ({
    w: img.naturalWidth,
    r: getComputedStyle(img).borderRadius,
    bg: getComputedStyle(img).backgroundColor,
  }));
  expect(logo).toEqual({ w: 256, r: '0px', bg: 'rgba(0, 0, 0, 0)' });
  for (const [path, size] of [['/icon-192.png', 192], ['/icon-512.png', 512], ['/icon-maskable-512.png', 512]] as const) {
    const res = await request.get(path);
    expect(res.ok()).toBeTruthy();
    const buf = await res.body();
    expect(buf.readUInt32BE(16)).toBe(size); // PNG IHDR width
  }
  // Explore has the App Guide entry.
  await page.locator('#rudExploreBtn').click();
  await expect(page.locator('#rudExploreGuide')).toBeVisible();
  await expect(page.locator('#rudExploreTheme')).toHaveCount(0); // not duplicated (it is in the top bar)
});

test('Kaaba scene stays behind the whole main page at a stable size', async ({ page }) => {
  await prepare(page, { theme: 'dark' });
  await goto(page, '#home');
  const read = () =>
    page.evaluate(() => {
      const el = document.querySelector('.global-mecca-bg') as HTMLElement;
      const r = el.getBoundingClientRect();
      return { pos: getComputedStyle(el).position, top: r.top, height: Math.round(r.height) };
    });
  const first = await read();
  expect(first.pos).toBe('fixed');
  expect(first.top).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(300);
  expect(await read()).toEqual(first); // still in view, same place and size
});

test('in-app notification cards: tone, dismiss, stacking limit', async ({ page }) => {
  await prepare(page);
  await goto(page, '#home');
  // Trigger real app notifications: saving a dua repeatedly (utils/ui.js toast → services/ui/notify.ts).
  await goto(page, '#duas');
  await page.locator('.dua-library-link').first().click();
  for (let i = 0; i < 5; i++) await page.locator('[data-save]').first().click();
  const cards = page.locator('#toastStack .rud-note');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeLessThanOrEqual(3);
  await expect(cards.first()).toHaveAttribute('role', 'status');
  await expect(cards.first().locator('.rud-note-title')).toHaveText('Done');
  const live = page.locator('#toastStack .rud-note:not(.is-leaving)');
  const shown = await live.count();
  await live.first().locator('.rud-note-close').click();
  await expect(live).toHaveCount(shown - 1);
});

test('Tasbih: one tap = +1 and the bounce animates the counter (Chromium/Android engine)', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'touch device only');
  await prepare(page);
  await goto(page, '#tasbih');
  const device = page.locator('#rudTasbihTap');
  const box = (await device.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(110);
  const state = await page.evaluate(() => {
    const d = document.querySelector('#rudTasbihTap') as HTMLElement;
    const s = document.querySelector('#rudTasbihCount') as HTMLElement;
    return {
      count: s.textContent,
      deviceAnims: d.getAnimations().map((a) => (a as CSSAnimation).animationName),
      scale: getComputedStyle(d).scale,
      numberAnims: s.getAnimations().map((a) => (a as CSSAnimation).animationName),
    };
  });
  expect(state.count).toBe('1');
  expect(state.deviceAnims).toContain('rudTasbihBounceV3');
  expect(state.numberAnims).toContain('rudTasbihNumberV3');
  expect(state.scale).not.toBe('none'); // the bounce is actually applied (it was pinned before)
});

test('99 Names: detail has no offline action and cards have no empty band', async ({ page }) => {
  await prepare(page);
  await goto(page, '#names');
  const gaps = await page.locator('.names-route-grid .name-library-card').evaluateAll((cards) =>
    cards.map((c) => {
      const r = c.getBoundingClientRect();
      const inner = [...c.querySelectorAll('.name-library-arabic, h3, p, .name-library-kicker')].map((e) => e.getBoundingClientRect());
      const bottom = Math.max(...inner.map((x) => x.bottom));
      return Math.round(r.bottom - bottom);
    }),
  );
  expect(gaps.length).toBeGreaterThan(0);
  for (const gap of gaps) expect(gap).toBeLessThanOrEqual(24);
  await page.locator('.name-library-link').first().click();
  await expect(page.locator('.name-reader')).toBeVisible();
  await expect(page.locator('.name-reader')).not.toContainText(/available offline/i);
  await expect(page.locator('.name-reader [data-offline]')).toHaveCount(0);
});

test('first-run App Guide: offered once, tour highlights real controls, never traps', async ({ page }) => {
  const errors = trackPageErrors(page);
  await prepare(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__v3_fresh')) return;
    sessionStorage.setItem('__v3_fresh', '1');
    localStorage.removeItem('rud_onboarding_v1');
  });
  await goto(page, '#home');
  const card = page.locator('.rud-gx-welcome');
  await expect(card).toBeVisible({ timeout: 8000 });
  await card.getByRole('button', { name: 'Start tour' }).click();
  const tour = page.locator('.rud-tour-card');
  await expect(tour).toContainText('welcome');
  // The page stays usable underneath (the shade never captures clicks).
  expect(await page.locator('.rud-tour-shade').evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.rud-tour-ring')).toBeVisible();
  await tour.getByRole('button', { name: 'Back' }).click();
  await expect(tour).toContainText('welcome');
  await tour.getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('.rud-tour')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains('rud-gx-open'))).toBe(false);
  const progress = JSON.parse((await page.evaluate(() => localStorage.getItem('rud_onboarding_v1'))) || '{}');
  expect(progress.firstRunDone).toBe(true);
  expect(progress.resume?.tourId).toBe('start');
  await page.reload();
  await page.waitForTimeout(3500);
  await expect(page.locator('.rud-gx-welcome')).toHaveCount(0); // not shown again
  // Replay from Explore → App Guide, including a feature tour that changes route.
  await page.locator('#rudExploreBtn').click();
  await page.locator('#rudExploreGuide').click();
  await page.getByRole('button', { name: /Tasbih/ }).click();
  await expect(page).toHaveURL(/#tasbih$/);
  await expect(page.locator('.rud-tour-card')).toContainText('Tap to count');
  // Advance step by step (each click waits for the step to change, as a person would).
  for (let i = 0; i < 6 && (await page.locator('.rud-tour').count()); i++) {
    const before = await page.locator('.rud-tour-card').textContent().catch(() => '');
    await page.locator('.rud-tour-card [data-primary]').click().catch(() => undefined);
    await expect.poll(async () => (await page.locator('.rud-tour').count()) === 0 || (await page.locator('.rud-tour-card').textContent().catch(() => '')) !== before).toBe(true);
  }
  await expect(page.locator('.rud-tour')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('page guide opens by itself on the first visit to a page, once', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__v3_pages')) return;
    sessionStorage.setItem('__v3_pages', '1');
    localStorage.setItem('rud_onboarding_v1', JSON.stringify({ firstRunDone: true, firstRunVersion: 1 }));
  });
  await goto(page, '#tasbih');
  const card = page.locator('.rud-tour-card');
  await expect(card).toContainText('quick guide');
  await expect(card).toContainText('Tap to count');
  await expect(page.locator('.rud-tour-ring')).toBeVisible();
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('Choose a Zikr');
  await expect(page).toHaveURL(/#tasbih$/); // a page guide never leaves the page
  await card.getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('.rud-tour')).toHaveCount(0);
  await setHash(page, '#home');
  await setHash(page, '#tasbih');
  await page.waitForTimeout(1500);
  await expect(page.locator('.rud-tour')).toHaveCount(0); // only once per page
  // Another page gets its own guide; leaving that page ends it.
  await setHash(page, '#prayer');
  await expect(page.locator('.rud-tour-card')).toContainText('Prayer');
  await setHash(page, '#home');
  await expect(page.locator('.rud-tour')).toHaveCount(0);
});

test('in-app browser card (Instagram, Android): Chrome hand-off, dismiss is remembered', async ({ browser }) => {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Instagram 349.0.0.39.106 Android',
    viewport: { width: 412, height: 839 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await prepare(page);
  await goto(page, '#home');
  const dialog = page.locator('.rud-dialog');
  await expect(dialog).toContainText('Open in Chrome for the full app', { timeout: 8000 });
  await expect(dialog.getByRole('link', { name: 'Open in Chrome' })).toHaveAttribute('href', /^intent:\/\/.*package=com\.android\.chrome/);
  await dialog.getByRole('button', { name: /Continue in Instagram/ }).click();
  await expect(page.locator('.rud-dialog')).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.locator('.rud-dialog')).toHaveCount(0);
  await context.close();
});

test('iOS Safari: Add-to-Home-Screen walkthrough with Back / Next / Skip', async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await prepare(page);
  await goto(page, '#home');
  await page.locator('#rudExploreBtn').click();
  await page.locator('#rudExploreInstall').click();
  const dialog = page.locator('.rud-dialog');
  await expect(dialog).toContainText('Step 1 of 5');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog).toContainText('Tap the Share button');
  await expect(dialog.locator('.rud-ix-target')).toBeVisible();
  await dialog.getByRole('button', { name: /done this/ }).click();
  await expect(dialog).toContainText('Add to Home Screen');
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog).toContainText('Tap the Share button');
  await dialog.getByRole('button', { name: 'Close the guide' }).click();
  await expect(page.locator('.rud-dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.position)).toBe('');
  await context.close();
});

test('Android install card: real prompt, honest states, appinstalled → Installed', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Android emulation only');
  await prepare(page);
  await goto(page, '#home');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>;
    (window as unknown as { __promptCalls: number }).__promptCalls = 0;
    event.prompt = async () => {
      (window as unknown as { __promptCalls: number }).__promptCalls++;
    };
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(event);
  });
  // Opened from Explore (the automatic card waits for engagement).
  await page.locator('#rudExploreBtn').click();
  await page.locator('#rudExploreInstall').click();
  const card = page.locator('.rud-ix-card');
  await expect(card).toContainText('Install the app');
  await card.getByRole('button', { name: 'Install App' }).click();
  await expect(card).toContainText('Installing…');
  expect(await page.evaluate(() => (window as unknown as { __promptCalls: number }).__promptCalls)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(card).toContainText('Installed');
});

test('username rules: letters and digits only, case-insensitive uniqueness', async ({ page }) => {
  await prepare(page);
  await goto(page, '#deen-friends');
  await ui(page).getByRole('tab', { name: 'Create account' }).click();
  const field = ui(page).getByLabel('Unique username');
  await field.fill('Ameen Khan');
  await expect(ui(page).locator('#df2-username-help')).toContainText('spaces');
  await field.fill('Ameen_Khan');
  await expect(ui(page).locator('#df2-username-help')).toContainText('English letters');
  await field.fill('Ameen@123');
  await expect(ui(page).locator('#df2-username-help')).toContainText('English letters');
  await field.fill('Ameen123');
  await expect(ui(page).locator('#df2-username-help')).toContainText('capitals');
  // "AISHA" is the same name as the existing "aisha".
  await ui(page).getByLabel('Your name').fill('Another Aisha');
  await field.fill('AISHA');
  await ui(page).getByLabel('Email').fill('another.aisha@example.com');
  await ui(page).locator('input[type="password"]').fill('another-password-1');
  await ui(page).getByRole('button', { name: 'Create secure account' }).click();
  await expect(ui(page).locator('.df2-form-error, [role="alert"]').first()).toContainText(/already taken/i);
});

test('Deen Friends: challenge streak, monthly points and first place, without double counting', async ({ page }) => {
  await prepare(page);
  await goto(page, '#deen-friends');
  await signIn(page, DF_USERS.aisha);
  await expect(page.locator('.df2-streak-chip')).toContainText('0');
  await ui(page).getByRole('tab', { name: /Challenges/ }).click();
  const daily = ui(page).locator('.df2-daily').filter({ hasText: 'TEST Daily: one page' });
  await daily.getByRole('button', { name: 'Mark today done' }).click();
  await expect(daily.getByRole('button', { name: 'Done for today' })).toBeVisible();
  await expect(page.locator('.df2-streak-chip')).toContainText('1');
  const streak = (await fakeDocs(page, 'deens_streaks/fakeuser101'))[0];
  expect(streak).toMatchObject({ current: 1, longest: 1, totalDays: 1, visible: true });
  const activity = await fakeDocs(page, 'deens_activity/fakeuser101_');
  expect(activity).toHaveLength(1);
  expect(activity[0]).toMatchObject({ count: 1, sources: ['daily:daily_all'] });
  const entries = await fakeDocs(page, 'deens_leaderboard/');
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ uid: 'fakeuser101', points: 1, activeDays: 1, completions: 1, displayName: 'Aisha Rahman', visible: true });
  expect(JSON.stringify(entries[0])).not.toContain('@example.com');
  // The completion written in the same transaction as the streak/points.
  const tx = (await firestoreLog(page)).filter((e) => e.op === 'transaction').pop() as unknown as { ops: Array<{ path: string }> };
  expect(tx.ops.map((o) => o.path.split('/')[0]).sort()).toEqual(['deens_activity', 'deens_daily_challenges', 'deens_leaderboard', 'deens_streaks']);
  // Leaderboard shows the first-place presentation.
  await expect(ui(page).locator('.df2-lb-first')).toContainText('Aisha Rahman');
  await expect(ui(page).locator('.df2-lb-first')).toContainText('1 pts');
  // Streak tab shows the personal streak card.
  await ui(page).getByRole('tab', { name: /Streaks/ }).click();
  await expect(ui(page).locator('.df2-my-streak')).toContainText('1 day');
});

test('Deen circles: 4-person minimum explained, created with friends, Deen actions only', async ({ page }) => {
  await prepare(page);
  await extendSeed(page, circleSeed());
  await goto(page, '#deen-friends');
  await signIn(page, DF_USERS.aisha);
  await ui(page).getByRole('tab', { name: /Chats/ }).click();
  await ui(page).getByRole('button', { name: 'New circle' }).click();
  const sheet = ui(page).locator('.df2-sheet');
  await sheet.getByLabel('Circle name').fill('Fajr Friends');
  const count = sheet.getByTestId('group-count');
  await expect(count).toContainText('add 3 more friends');
  await sheet.locator('.df2-pick').filter({ hasText: 'Bilal' }).click();
  await expect(count).toContainText('add 2 more friends');
  await sheet.locator('.df2-pick').filter({ hasText: 'Yusuf' }).click();
  await expect(count).toContainText('add 1 more friend');
  await expect(sheet.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await sheet.locator('.df2-pick').filter({ hasText: 'Maryam' }).click();
  await expect(count).toContainText('4 participants including you');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('button', { name: 'Create circle' }).click();
  await expect(page.locator('.df2-fullscreen')).toContainText('Fajr Friends');
  const groups = await fakeDocs(page, 'deens_groups/');
  expect(groups).toHaveLength(1);
  expect(groups[0].members).toHaveLength(4);
  // Rules model: a circle of three is refused even if the app were bypassed.
  const refused = await page.evaluate(() =>
    (globalThis as unknown as { __FAKE_FB__: { rules: { allowed: (...a: unknown[]) => boolean } } }).__FAKE_FB__.rules.allowed(
      'create',
      'deens_groups/g_manualtest1',
      null,
      { ownerUid: 'fakeuser101', members: ['fakeuser101', 'fakeuser102', 'fakeuser103'], admins: ['fakeuser101'], memberCount: 3, name: 'Too small' },
    ),
  );
  expect(refused).toBe(false);
  // Share encouragement in the circle.
  await page.locator('.df2-fullscreen .df2-reaction').first().click();
  await expect(page.locator('.df2-fullscreen .df2-msg').first()).toContainText('Ameen');
});

test('chat: page scroll is locked (and restored), chat themes reach sheets and controls', async ({ page }) => {
  await prepare(page);
  await extendSeed(page, circleSeed());
  await goto(page, '#deen-friends');
  await signIn(page, DF_USERS.aisha);
  await ui(page).getByRole('tab', { name: /Chats/ }).click();
  await page.evaluate(() => window.scrollTo(0, 260));
  await page.waitForTimeout(700); // a reader pauses before opening a chat (the history engine records the position)
  const before = await page.evaluate(() => window.scrollY);
  await ui(page).locator('.df2-chat-list .df2-chat-row').filter({ hasText: 'Bilal' }).click();
  const chat = page.locator('.df2-fullscreen');
  await expect(chat).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed');
  // Open settings (a nested overlay), choose Layl Night, close it: the page must stay locked.
  await chat.getByRole('button', { name: 'Chat settings' }).click();
  const sheetRoot = page.locator('.df2-sheet-backdrop');
  await expect(sheetRoot).toHaveAttribute('data-chat-theme', 'ivory');
  await sheetRoot.getByRole('button', { name: /Layl Night/ }).click();
  await expect(chat).toHaveAttribute('data-chat-theme', 'layl');
  await expect(sheetRoot).toHaveAttribute('data-chat-theme', 'layl');
  // The theme's accent, not the app's emerald (polled: the button transitions its colour).
  await expect
    .poll(() => chat.locator('.df2-composer .df2-btn-primary').evaluate((e) => getComputedStyle(e).backgroundColor))
    .toBe('rgb(143, 162, 240)');
  await sheetRoot.getByRole('button', { name: 'Close' }).click();
  expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed');
  await chat.getByRole('button', { name: 'Back to chats' }).click();
  await expect(page.locator('.df2-fullscreen')).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).position)).not.toBe('fixed');
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);
});

test('shared content arrives complete (Arabic RTL, translation, reference)', async ({ page }) => {
  const longTranslation = 'TEST long dua translation sentence. '.repeat(30).trim();
  await prepare(page);
  await extendSeed(page, {
    content: {
      'test-dua-long': {
        published: true,
        type: 'dua',
        title: 'TEST Long Dua',
        arabic: 'اللَّهُمَّ '.repeat(150).trim(),
        transliteration: 'Allahumma '.repeat(40).trim(),
        translation: longTranslation,
        reference: 'TEST Hisn al-Muslim 1',
        category: 'General',
        createdAt: { __ts: Date.now() - 3600000 },
        updatedAt: { __ts: Date.now() - 3600000 },
      },
    },
    ...circleSeed(),
  });
  await goto(page, '#deen-friends');
  await signIn(page, DF_USERS.aisha);
  await ui(page).getByRole('tab', { name: /Chats/ }).click();
  await ui(page).locator('.df2-chat-list .df2-chat-row').filter({ hasText: 'Bilal' }).click();
  await page.locator('.df2-fullscreen').getByRole('button', { name: 'Deen action' }).click();
  await ui(page).locator('.df2-action-tile').filter({ hasText: /^Dua/ }).click();
  const sheet = ui(page).locator('.df2-sheet').last();
  await sheet.getByRole('searchbox').fill('Long Dua');
  await sheet.locator('.df2-share-item').filter({ hasText: 'TEST Long Dua' }).click();
  const card = page.locator('.df2-fullscreen .df2-shared').last();
  await expect(card).toBeVisible();
  const text = await card.locator('.df2-shared-translation').innerText();
  expect(text.replace(/\s+/g, ' ').trim()).toBe(longTranslation);
  await expect(card.locator('.df2-shared-arabic')).toHaveAttribute('dir', 'rtl');
  await expect(card.locator('.df2-shared-translit')).toContainText('Allahumma');
  await expect(card.locator('.df2-reference')).toContainText('Hisn al-Muslim');
  const stored = (await fakeDocs(page, 'deens_friend_messages/')).find((m) => m.kind === 'content');
  expect(stored.sharedContent.translation.length).toBe(longTranslation.length);
  expect(stored.sharedContent.preview.length).toBeLessThanOrEqual(300);
});

test('friend suggestions: mutual first, excludes friends and pending, no private data', async ({ page }) => {
  await prepare(page);
  await extendSeed(page, {
    deens_users: { fakeuser105: extraProfile('fakeuser105', 'hamza', 'Hamza Idris'), fakeuser106: extraProfile('fakeuser106', 'zainab', 'Zainab Omar') },
    deens_suggestions: {
      fakeuser101: {
        generatedAtMs: Date.now(),
        items: [
          { uid: 'fakeuser105', displayName: 'Hamza Idris', username: 'hamza', avatar: 'mosque', mutualCount: 2 },
          { uid: 'fakeuser102', displayName: 'Bilal Ahmed', username: 'bilal', avatar: 'lantern', mutualCount: 1 },
        ],
      },
    },
    deens_public_profiles: {
      fakeuser106: { uid: 'fakeuser106', username: 'zainab', usernameKey: 'zainab', displayName: 'Zainab Omar', avatar: 'quran', discoverable: true, lastActiveDay: 20000 },
      fakeuser107: { uid: 'fakeuser107', username: 'hidden', usernameKey: 'hidden', displayName: 'Hidden Person', avatar: 'quran', discoverable: false, lastActiveDay: 20001 },
    },
    deens_friendships: { [pair('fakeuser101', 'fakeuser102')]: { members: ['fakeuser101', 'fakeuser102'], createdAt: { __ts: Date.now() }, updatedAt: { __ts: Date.now() }, streakCount: 0 } },
  });
  await goto(page, '#deen-friends');
  await signIn(page, DF_USERS.aisha);
  const section = ui(page).locator('.df2-suggestions');
  await expect(section).toContainText('Hamza Idris');
  await expect(section).toContainText('2 mutual friends');
  await expect(section).toContainText('Zainab Omar');
  await expect(section).not.toContainText('Bilal'); // already a friend
  await expect(section).not.toContainText('Hidden Person'); // not discoverable
  await expect(section).not.toContainText('@example.com');
  await section.locator('.df2-suggest').filter({ hasText: 'Hamza' }).getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.rud-note').last()).toContainText('Request sent to @hamza');
  await expect(section).not.toContainText('Hamza Idris'); // pending requests are no longer suggested
});

test('avatar builder and public profile preview (same card others see, privacy respected)', async ({ page }) => {
  await prepare(page);
  await goto(page, '#deen-friends');
  await signIn(page, DF_USERS.aisha);
  await page.locator('.df2-me-chip').click();
  await ui(page).getByRole('button', { name: 'Avatar', exact: true }).click();
  const sheet = ui(page).locator('.df2-sheet');
  await sheet.getByRole('button', { name: 'Sakinah' }).click();
  await sheet.getByRole('tab', { name: 'Colours' }).click();
  await sheet.getByRole('radio', { name: 'night', exact: true }).click();
  await sheet.getByRole('button', { name: 'Save avatar' }).click();
  await expect(page.locator('.df2-me-chip .df2-avatar-built svg clipPath')).toHaveCount(1);
  const user = (await fakeDocs(page, 'deens_users/fakeuser101'))[0];
  expect(user.avatarConfig).toMatchObject({ v: 1, figure: 'hijab', background: 'night' });
  // Preview public profile: shows the public card, never email.
  const previewBtn = ui(page).getByRole('button', { name: 'Preview', exact: true });
  if (!(await previewBtn.isVisible())) await page.locator('.df2-me-chip').click();
  await previewBtn.click();
  const preview = ui(page).locator('.df2-sheet');
  await expect(preview).toContainText('PREVIEW');
  await expect(preview.locator('.df2-public-card')).toContainText('Aisha Rahman');
  await expect(preview.locator('.df2-public-card')).toContainText('@aisha');
  await expect(preview).not.toContainText(DF_USERS.aisha.email);
  await expect(preview.locator('.df2-public-card .df2-avatar-built')).toHaveCount(1);
  // Signature: the original script font first; if it cannot load (Google Fonts are blocked in these
  // tests, like an offline app), an elegant installed script face — never the bare generic cursive.
  const sig = preview.locator('.df2-public-card .df2-signature');
  await expect(sig).toHaveClass(/is-ready/, { timeout: 7000 });
  const family = await sig.evaluate((e) => getComputedStyle(e).fontFamily);
  expect(family.startsWith('"Great Vibes"')).toBe(true);
  expect(family).toContain('Snell Roundhand');
  expect(family).toContain('Segoe Script');
});

test.describe('admin console (desktop layout)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

test('admin: Clear Chat only for a solved RISE conversation, typed confirmation, welcome kept', async ({ page }) => {
  await prepare(page);
  await extendSeed(page, {
    'deens_rise_threads/fakeuser102/messages': {
      welcome: { from: 'rise', senderUid: 'fakeuser102', text: 'W', automated: true, createdAt: { __ts: Date.now() - 7200000 }, createdAtMs: Date.now() - 7200000 },
    },
  });
  await goto(page, '#admin');
  await page.locator('#adminEmail').fill('riseupondeen@gmail.com');
  await page.locator('#adminPassword').fill(ADMIN_TEST_PASSWORD);
  await page.locator('#adminLoginBtn').click();
  await page.locator('[data-admin-view="rise-inbox"]').click();
  const view = page.locator('.df2-admin');
  await view.locator('.df2-admin-thread').filter({ hasText: 'Bilal Ahmed' }).click();
  await expect(view.getByRole('button', { name: 'Clear chat' })).toHaveCount(0); // not solved yet
  await view.getByRole('button', { name: 'Mark resolved' }).click();
  await view.getByRole('button', { name: 'Clear chat' }).click();
  const confirm = view.getByRole('alertdialog');
  await expect(confirm).toContainText('@bilal');
  const doIt = confirm.getByRole('button', { name: 'Clear chat' });
  await expect(doIt).toBeDisabled();
  await confirm.getByLabel('Type the username to confirm').fill('@aisha');
  await expect(doIt).toBeDisabled(); // wrong user
  await confirm.getByLabel('Type the username to confirm').fill('@bilal');
  await doIt.click();
  await expect(page.locator('#toastStack')).toContainText('Cleared 1 message');
  const left = await fakeDocs(page, 'deens_rise_threads/fakeuser102/messages/');
  expect(left.map((m) => m.path.split('/').pop())).toEqual(['welcome']);
  const thread = (await fakeDocs(page, 'deens_rise_threads/fakeuser102'))[0];
  expect(thread.clearedAtMs).toBeGreaterThan(0);
  expect(thread.riseSeenAtMs).toBeGreaterThan(0);
  const log = await firestoreLog(page);
  expect(log.some((e) => JSON.stringify(e).includes('RISE_THREAD_CLEARED'))).toBe(true);
  expect(JSON.stringify(log.filter((e) => JSON.stringify(e).includes('RISE_THREAD_CLEARED')))).not.toContain('audio stops');
});

test('admin: App Guide editor saves a draft and publishes a version', async ({ page }) => {
  await prepare(page);
  await goto(page, '#admin');
  await page.locator('#adminEmail').fill('riseupondeen@gmail.com');
  await page.locator('#adminPassword').fill(ADMIN_TEST_PASSWORD);
  await page.locator('#adminLoginBtn').click();
  await page.locator('[data-admin-view="app-guide"]').click();
  const view = page.locator('.rud-guide-admin');
  await expect(view).toContainText('App Guide');
  await view.locator('.rud-guide-admin-tour-head').filter({ hasText: 'Tasbih' }).getByRole('button').first().click();
  await view.locator('.rud-guide-admin-step').first().getByLabel('Title').fill('Tap anywhere to count');
  await view.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('#toastStack')).toContainText('Draft saved');
  await view.getByRole('button', { name: 'Publish' }).click();
  await expect(page.locator('#toastStack')).toContainText('App Guide v1 published');
  const published = (await fakeDocs(page, 'rud_app_guides/published'))[0];
  expect(published.version).toBe(1);
  expect(JSON.stringify(published)).toContain('Tap anywhere to count');
});

test('admin: announce the monthly winner; members see it first in Challenges with a premium card', async ({ page: adminPage, browser }) => {
  let page = adminPage;
  const now = new Date(Date.now() + 5.5 * 3600000);
  const cur = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  await prepare(page);
  await extendSeed(page, {
    [`deens_leaderboard/${cur}/entries`]: {
      fakeuser101: { uid: 'fakeuser101', monthId: cur, points: 7, activeDays: 3, completions: 7, lastAtMs: 1, displayName: 'Aisha Rahman', username: 'aisha', avatar: 'quran', visible: true },
      fakeuser102: { uid: 'fakeuser102', monthId: cur, points: 4, activeDays: 2, completions: 4, lastAtMs: 2, displayName: 'Bilal Ahmed', username: 'bilal', avatar: 'lantern', visible: true },
    },
  });
  await goto(page, '#admin');
  await page.locator('#adminEmail').fill('riseupondeen@gmail.com');
  await page.locator('#adminPassword').fill(ADMIN_TEST_PASSWORD);
  await page.locator('#adminLoginBtn').click();
  await page.locator('[data-admin-view="monthly-winner"]').click();
  const view = page.locator('.rud-winner-admin');
  await view.getByLabel('Month').selectOption(cur);
  await expect(view.locator('.df2-pick.on')).toContainText('Aisha Rahman'); // first place pre-selected
  await view.getByLabel('Announcement message').fill('MashaAllah, steady every day.');
  await view.getByRole('button', { name: 'Announce winner' }).click();
  await expect(page.locator('#toastStack')).toContainText('announced');
  const doc = (await fakeDocs(page, `deens_monthly_winners/${cur}`))[0];
  expect(doc).toMatchObject({ monthId: cur, uids: ['fakeuser101'], published: true, message: 'MashaAllah, steady every day.' });
  // A member sees the announcement at the top of Challenges, before the leaderboard. (The fake
  // database lives per page, so the member's page starts from the document the admin wrote.)
  const member = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await prepare(member);
  await extendSeed(member, { deens_monthly_winners: { [cur]: { ...doc, path: undefined } } });
  await goto(member, '#deen-friends');
  await ui(member).getByLabel('Email').fill(DF_USERS.bilal.email);
  await ui(member).getByLabel('Password', { exact: true }).fill(DF_USERS.bilal.password);
  await ui(member).getByRole('button', { name: 'Sign in securely' }).click();
  await ui(member).getByRole('tab', { name: /Challenges/ }).click();
  page = member;
  const banner = page.locator('.df2-winner');
  await expect(banner).toContainText('Aisha Rahman');
  await expect(banner).toContainText('steady every day');
  const order = await page.locator('.df2-winner, .df2-leaderboard, [aria-labelledby="df2-daily-title"]').evaluateAll((els) => els.map((e) => e.className));
  expect(order[0]).toContain('df2-winner');
  expect(order[1]).toContain('df2-leaderboard');
  // The winner's visiting card is the gold edition.
  await banner.getByRole('button', { name: /Aisha Rahman/ }).click();
  await expect(page.locator('.df2-vcard.is-winner')).toBeVisible();
  await expect(page.locator('.df2-vcard-badge')).toContainText('Winner');
});
});

test('Deen Friends page with all V3 sections renders without errors on both layouts', async ({ page }) => {
  const errors = trackPageErrors(page);
  await prepare(page);
  await extendSeed(page, circleSeed());
  await goto(page, '#deen-friends');
  await signIn(page, DF_USERS.aisha);
  for (const tab of ['Friends', 'Streaks', 'Chats', 'Challenges']) {
    await ui(page).getByRole('tab', { name: new RegExp(tab) }).click();
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
  await setHash(page, '#home');
  expect(errors).toEqual([]);
});

test('People lists every Deen Friends member in small rows; profile opens on tap', async ({ page }) => {
  await prepare(page);
  await extendSeed(page, { deens_users: { fakeuser107: extraProfile('fakeuser107', 'omar', 'Omar Farooq') } });
  await goto(page, '#deen-friends');
  await signIn(page, DF_USERS.aisha);
  const people = ui(page).locator('.df2-people');
  await expect(people).toContainText('Omar Farooq'); // has no public card: listed from accounts
  await expect(people).toContainText('Bilal Ahmed');
  await expect(people).not.toContainText('Aisha Rahman'); // never yourself
  await people.locator('.df2-person-open').filter({ hasText: 'Omar' }).click();
  await expect(page.locator('.df2-sheet .df2-vcard')).toContainText('@omar');
  // Requests are inside one small button: closed until tapped.
  await page.keyboard.press('Escape');
  await expect(page.locator('#df2-requests')).toHaveCount(0);
  await ui(page).getByRole('button', { name: /^Requests/ }).click();
  await expect(page.locator('#df2-requests')).toContainText('No requests');
});

test('99 Names can be shared in a chat; the shared streak follows activity (no check-in button)', async ({ page }) => {
  await prepare(page);
  await extendSeed(page, {
    content: {
      'test-name-1': { published: true, type: 'name', name: 'Ar-Rahman', arabic: 'الرَّحْمَٰنُ', meaning: 'The Most Merciful', number: '1', createdAt: { __ts: Date.now() - 3600000 }, updatedAt: { __ts: Date.now() - 3600000 } },
    },
    ...circleSeed(),
    deens_friend_streaks: {
      [pair('fakeuser101', 'fakeuser102')]: { members: ['fakeuser101', 'fakeuser102'], checkins: {}, count: 0, bothDates: [], lastBothDate: '' },
    },
  });
  await goto(page, '#deen-friends');
  await signIn(page, DF_USERS.aisha);
  await ui(page).getByRole('tab', { name: /Chats/ }).click();
  await ui(page).locator('.df2-chat-list .df2-chat-row').filter({ hasText: 'Bilal' }).click();
  await page.locator('.df2-fullscreen').getByRole('button', { name: 'Deen action' }).click();
  await expect(ui(page).locator('.df2-action-tile').filter({ hasText: /Check in/ })).toHaveCount(0);
  await ui(page).locator('.df2-action-tile').filter({ hasText: 'Names of Allah' }).click();
  await ui(page).locator('.df2-sheet').last().locator('.df2-share-item').filter({ hasText: 'Ar-Rahman' }).click();
  const card = page.locator('.df2-fullscreen .df2-shared').last();
  await expect(card).toContainText('The Most Merciful');
  await expect(card.locator('.df2-shared-arabic')).toHaveAttribute('dir', 'rtl');
  const stored = (await fakeDocs(page, 'deens_friend_messages/')).find((m) => m.kind === 'content');
  expect(stored.sharedContent).toMatchObject({ type: 'name', title: 'Ar-Rahman' });
  await expect
    .poll(async () => ((await fakeDocs(page, 'deens_friend_streaks/'))[0]?.checkins || {})[DF_USERS.aisha.uid])
    .toBeTruthy();
});

test('install guide is offered automatically to browser visitors on phones, never in the installed app', async ({ browser }) => {
  const iosUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const context = await browser.newContext({ userAgent: iosUA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await prepare(page);
  await page.addInitScript(() => sessionStorage.removeItem('rud_install_card_session'));
  await goto(page, '#home');
  await expect(page.locator('.rud-ix-card')).toContainText('Add Rise Upon Deen to your Home Screen', { timeout: 9000 });
  await page.locator('.rud-ix-card').getByRole('button', { name: 'Show me how' }).click();
  await expect(page.locator('.rud-dialog')).toContainText('Step 1 of');
  await context.close();
  // Installed (standalone): no install card.
  const installed = await browser.newContext({ userAgent: iosUA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const app = await installed.newPage();
  await prepare(app);
  await app.addInitScript(() => {
    sessionStorage.removeItem('rud_install_card_session');
    Object.defineProperty(navigator, 'standalone', { get: () => true });
  });
  await goto(app, '#home');
  await app.waitForTimeout(5500);
  await expect(app.locator('.rud-ix-card')).toHaveCount(0);
  await installed.close();
});

test('Friday and Ramadan modes use their own card layout', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-02-19T10:00:00+05:30')); // a Friday in Ramadan 1448
  await prepare(page);
  await goto(page, '#home');
  for (const id of ['#rudRamadanMode', '#rudFridayMode']) {
    const card = page.locator(`${id} .rud-occasion-card`);
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    const actions = (await card.locator('.rud-occasion-actions').boundingBox())!;
    expect(actions.x).toBeGreaterThanOrEqual(box.x);
    expect(actions.x + actions.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  await expect(page.locator('#rudFridayMode')).toContainText('Read Al-Kahf');
  await expect(page.locator('#rudRamadanMode')).toContainText('Ramadan Mubarak');
});

test('Nearby Masjids: Google Maps searches "masjids near me"', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) => fail({ code: 1, PERMISSION_DENIED: 1 }),
        watchPosition: () => 1,
        clearWatch: () => undefined,
      },
    });
  });
  await goto(page, '#prayer');
  await page.locator('#rudNearbyMasjidBtn').click();
  await page.evaluate(() => {
    (window as unknown as { open: (u: string) => unknown }).open = (u: string) => {
      (window as unknown as { __opened: string }).__opened = u;
      return {};
    };
  });
  await page.locator('#rudRiseMapOverlay').getByRole('button', { name: /Google Maps/ }).click();
  expect(await page.evaluate(() => (window as unknown as { __opened: string }).__opened)).toContain('query=masjids%20near%20me');
});

test('returning Home does not replay the hero entrance (no jump)', async ({ page }) => {
  await prepare(page);
  await goto(page, '#home');
  await setHash(page, '#quran');
  await page.waitForTimeout(400);
  await setHash(page, '#home');
  await page.waitForTimeout(60);
  const anims = await page.evaluate(() =>
    [...document.querySelectorAll('.hero .hero-kicker, .hero .hero-tagline, .hero .hero-actions')].flatMap((e) => e.getAnimations().map((a) => (a as CSSAnimation).animationName)),
  );
  expect(anims).toEqual([]);
  // Home sections never scroll inside themselves.
  const inner = await page.evaluate(() =>
    [...document.querySelectorAll('.shell')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY)).length,
  );
  expect(inner).toBe(0);
});

test('first visit: 4-second intro in the visitor theme, then the name card; entering a name works', async ({ page }) => {
  await prepare(page, { theme: 'light', returningVisitor: false });
  await page.goto('/#home');
  await page.waitForTimeout(1500);
  const intro = await page.evaluate(() => {
    const el = document.getElementById('preloader')!;
    return { hidden: el.classList.contains('hide'), bg: getComputedStyle(el).backgroundColor, card: !document.getElementById('rudWelcomeIntro')?.hidden };
  });
  expect(intro).toEqual({ hidden: false, bg: 'rgb(251, 248, 241)', card: false }); // light intro, name card waits
  const card = page.locator('#rudWelcomeIntro .rud-welcome-card');
  await expect(card).toBeVisible({ timeout: 6000 });
  expect(await card.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 253, 248)');
  await page.locator('#rudVisitorName').fill('Ameen');
  await page.locator('#rudWelcomeContinue').click();
  await expect(page.locator('#rudWelcomeIntro')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('rud_visitor_name'))).toBe('Ameen');
});

test('intro: static markup paints before any script, plays ~4 s on every launch, never blinks on a slow start', async ({ page, request }) => {
  // 1) It is in the HTML itself, so it shows with the first frame (no wait for the JS bundle).
  const html = await (await request.get('/')).text();
  expect(html).toContain('id="preloader"');
  expect(html).toContain('rud-intro-mosque');
  // 2) Slow phone: hold the app bundle back 5 s. The intro must stay on screen until the app is ready and
  //    leave only once the app is ready (the old version vanished almost at once in this case).
  await prepare(page, { theme: 'dark', returningVisitor: false });
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 5000));
    await route.fallback();
  });
  await page.goto('/#home', { waitUntil: 'commit' });
  await expect(page.locator('#preloader')).toBeVisible();
  const visibleAt = await page.evaluate(() => performance.now());
  await page.waitForFunction(() => (window as unknown as { __rudIntro?: { state: string } }).__rudIntro?.state !== 'playing', null, { timeout: 15000, polling: 50 });
  const leftAt = await page.evaluate(() => performance.now());
  expect(leftAt - visibleAt).toBeGreaterThan(4800); // a full intro that waits for the app, not a blink
  await expect(page.locator('#preloader')).toHaveClass(/hide/);
  // 3) Every launch plays it: a second load (same tab, same session) shows the full intro again.
  await page.unroute(/\/assets\/index-[^/]+\.js$/);
  await page.reload({ waitUntil: 'commit' });
  await expect(page.locator('#preloader')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.intro)).toBe('play');
  const again = await page.evaluate(async () => {
    const t0 = performance.now();
    const w = window as unknown as { __rudIntro?: { state: string } };
    while (!w.__rudIntro || w.__rudIntro.state === 'playing') await new Promise((r) => setTimeout(r, 20));
    return performance.now() - t0;
  });
  expect(again).toBeGreaterThan(3000);
  // 4) In-app navigation never replays it.
  await page.evaluate(() => (location.hash = '#duas'));
  await page.waitForTimeout(300);
  await page.evaluate(() => (location.hash = '#home'));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => [(window as unknown as { __rudIntro: { state: string } }).__rudIntro.state, document.getElementById('preloader')!.classList.contains('hide')])).toEqual(['done', true]);
});

test('intro: normal start leaves at about 4 s; reduced motion is short and still', async ({ browser }) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    const context = await browser.newContext({ reducedMotion });
    const page = await context.newPage();
    await prepare(page, { theme: 'light', returningVisitor: false });
    await page.goto('/#home');
    const t = await page.evaluate(async () => {
      const w = window as unknown as { __rudIntro: { state: string; duration: number } };
      while (w.__rudIntro.state === 'playing') await new Promise((r) => setTimeout(r, 20));
      return { at: performance.now(), duration: w.__rudIntro.duration, anims: document.querySelectorAll('.rud-intro-min').length && getComputedStyle(document.querySelector('.rud-intro-min')!).animationName };
    });
    if (reducedMotion === 'reduce') {
      expect(t.duration).toBeLessThan(2000);
      expect(t.anims).toBe('none');
    } else {
      expect(t.duration).toBe(4000);
      expect(t.at).toBeGreaterThan(3500);
      expect(t.at).toBeLessThan(6000);
    }
    await context.close();
  }
});

test('Home stays still: back/forward and rapid taps keep the position, layout shift stays under 0.1', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    (window as unknown as { __cls: number[] }).__cls = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>)
        if (!e.hadRecentInput) (window as unknown as { __cls: number[] }).__cls.push(e.value);
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await goto(page, '#home');
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(500);
  const y0 = await page.evaluate(() => Math.round(scrollY));
  const watch = (ms: number) =>
    page.evaluate(async (ms) => {
      const ys = new Set<number>();
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        ys.add(Math.round(scrollY));
        await new Promise((r) => requestAnimationFrame(r));
      }
      return [...ys];
    }, ms);
  await setHash(page, '#quran');
  await page.waitForTimeout(800);
  await page.goBack();
  expect(await watch(1000)).toEqual([y0]); // restored once, no jump on the way
  await page.goForward();
  await page.waitForTimeout(120);
  await page.goBack();
  expect(await watch(1000)).toEqual([y0]);
  for (const h of ['#my-deen', '#home', '#deen-friends', '#home', '#quran', '#home']) {
    await page.evaluate((h) => (location.hash = h), h);
    await page.waitForTimeout(80);
  }
  // Rapid taps pass through Home twice on the way, so where Home lands depends on timing; what
  // matters is that it settles on one position and never jumps between positions.
  expect(await watch(1000)).toHaveLength(1);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number[] }).__cls.reduce((a, b) => a + b, 0));
  expect(cls).toBeLessThan(0.1);
});

test('install guide is a centred modal in portrait and landscape; page scroll is locked, then restored', async ({ browser }) => {
  const iosUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ userAgent: iosUA, viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await prepare(page);
    await goto(page, '#home');
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    const y = await page.evaluate(() => Math.round(scrollY));
    await page.locator('#rudExploreBtn').click();
    await page.locator('#rudExploreInstall').click();
    await page.locator('.rud-dialog').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = (await page.locator('.rud-dialog').boundingBox())!;
    // Fully on screen and centred (not stuck to the bottom edge).
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
    expect(await page.evaluate(() => document.body.style.position)).toBe('fixed');
    await page.keyboard.press('Escape');
    await expect(page.locator('.rud-dialog')).toHaveCount(0);
    expect(await page.evaluate(() => [document.body.style.position, Math.round(scrollY)])).toEqual(['', y]);
    await context.close();
  }
});

test('intro: an installed Home Screen app plays it on every launch (no 12-hour skip)', async ({ browser }) => {
  const iosUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const context = await browser.newContext({ userAgent: iosUA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  for (let launch = 1; launch <= 2; launch++) {
    const page = await context.newPage(); // each launch is a fresh page load in the same installed app
    await prepare(page, { returningVisitor: false });
    await page.addInitScript(() => localStorage.setItem('rud_visitor_name', 'Tester'));
    await page.goto('/#home', { waitUntil: 'commit' });
    await expect(page.locator('#preloader')).toBeVisible();
    const held = await page.evaluate(async () => {
      const t0 = performance.now();
      const w = window as unknown as { __rudIntro?: { state: string } };
      while (!w.__rudIntro || w.__rudIntro.state === 'playing') await new Promise((r) => setTimeout(r, 20));
      return performance.now() - t0;
    });
    expect(held, `launch ${launch}`).toBeGreaterThan(3000);
    await page.close();
  }
  await context.close();
});

test('Prophetic Guidance cards: opaque in dark, white with readable labels and no heavy shadow in light', async ({ browser }) => {
  for (const theme of ['dark', 'light'] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await prepare(page, { theme });
    await goto(page, '#hadith');
    const card = page.locator('.hadith-preview-card').first();
    await expect(card).toBeVisible();
    const s = await card.evaluate((el) => {
      const c = getComputedStyle(el);
      const open = getComputedStyle(el.querySelector('.compact-guidance-open')!);
      return { bg: c.backgroundColor, shadow: c.boxShadow, open: open.color };
    });
    if (theme === 'dark') expect(s.bg).toBe('rgb(15, 17, 20)'); // fully opaque: the Kaaba scene never shows through
    else {
      expect(s).toMatchObject({ bg: 'rgb(255, 255, 255)', shadow: 'none' });
      expect(s.open).toBe('rgb(61, 58, 51)'); // "Read Hadith" readable on white
    }
    await context.close();
  }
});

test('Duas, Hadith and Names: opening and closing a card swaps in one frame and returns to the exact spot', async ({ page }, info) => {
  await prepare(page);
  await page.addInitScript(() => {
    const seed = (window as unknown as { __FAKE_FB_SEED__: { collections: { content: Record<string, unknown> } } }).__FAKE_FB_SEED__;
    const ts = { __ts: 1767225600000 };
    for (let i = 0; i < 8; i++) {
      seed.collections.content[`s-dua-${i}`] = { type: 'dua', title: `TEST Stable Dua ${i}`, arabic: 'اختبار', meaning: 'TEST meaning', reference: 'TEST', published: true, category: 'General', createdAt: ts, updatedAt: ts };
      seed.collections.content[`s-hadith-${i}`] = { type: 'hadith', title: `TEST Stable Hadith ${i}`, translation: 'TEST', source: 'TEST', reference: 'TEST', published: true, category: 'General', createdAt: ts, updatedAt: ts };
      seed.collections.content[`s-name-${i}`] = { type: 'name', number: 20 + i, title: `TEST-Stable-${i}`, name: `TEST Stable ${i}`, arabic: 'الاسم', meaning: 'TEST', published: true, category: 'General', createdAt: ts, updatedAt: ts };
    }
  });
  for (const [route, link] of [['#duas', '.dua-library-link'], ['#hadith', '.compact-guidance-link'], ['#names', '.name-library-link']] as const) {
    await goto(page, route);
    await page.locator(link).nth(6).scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 80);
    await page.waitForTimeout(300);
    const run = (what: 'open' | 'close') =>
      page.evaluate(async ([what, link]) => {
        const states = new Set<string>();
        const rec = () => states.add(`${Math.round(scrollY)}|${(document.querySelector('#dynamicPage > *') as HTMLElement | null)?.className.split(' ')[0]}`);
        const el = (what === 'open' ? document.querySelectorAll(link)[6] : document.querySelector('#dynamicPage .rud-detail-close')) as HTMLElement;
        rec();
        el.click();
        const end = performance.now() + 700;
        while (performance.now() < end) {
          await new Promise((r) => requestAnimationFrame(r));
          rec();
        }
        return [...states];
      }, [what, link] as const);
    const y0 = await page.evaluate(() => Math.round(scrollY));
    const opened = await run('open');
    expect(opened, `${route} open`).toHaveLength(2); // list at its position → detail at the top, nothing in between
    expect(opened[1]).toMatch(/^0\|/);
    const closed = await run('close');
    expect(closed, `${route} close`).toHaveLength(2); // detail → list exactly where the reader left it
    expect(closed[1]).toBe(`${y0}|route-hero`);
  }
  // The Names dialog on Home: the page behind it never moves while it opens or closes.
  await goto(page, '#home');
  const card = page.locator('#namesGrid .name-card').nth(1);
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const top0 = (await card.boundingBox())!.y;
  await card.click();
  await expect(page.locator('#nameModal')).toBeVisible();
  expect((await card.boundingBox())!.y).toBeCloseTo(top0, 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  expect((await card.boundingBox())!.y).toBeCloseTo(top0, 0);
  // Tap feedback never lifts a card on touch screens; desktop keeps its hover lift.
  await goto(page, '#duas');
  const dua = page.locator('.dua-library-card').first();
  await dua.hover().catch(() => undefined);
  await page.waitForTimeout(450); // the lift transition
  const lift = await dua.evaluate((e) => getComputedStyle(e).transform);
  expect(lift).toBe(info.project.name === 'mobile' ? 'none' : 'matrix(1, 0, 0, 1, 0, -5)');
});

test('avatars: every brothers’/sisters’ style renders a faceless bust in both themes; a previously saved avatar still renders', async ({ browser }) => {
  for (const theme of ['light', 'dark'] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = trackPageErrors(page);
    await prepare(page, { theme });
    // Bilal keeps a V3.2-era saved avatar; a second, tampered value must fall back safely.
    await page.addInitScript(() => {
      const seed = (window as unknown as { __FAKE_FB_SEED__: { collections: Record<string, Record<string, Record<string, unknown>>> } }).__FAKE_FB_SEED__;
      seed.collections.deens_users.fakeuser102.avatarConfig = { v: 1, shape: 'octagon', background: 'sand', pattern: 'girih', figure: 'turban', outfit: 'navy', accent: 'ivory', motif: 'none', initials: false };
    });
    await goto(page, '#deen-friends');
    await signIn(page, DF_USERS.aisha);
    await page.locator('.df2-me-chip').click();
    await ui(page).getByRole('button', { name: 'Avatar', exact: true }).click();
    const sheet = ui(page).locator('.df2-sheet');
    for (const name of ['Kufi', 'Ghutra', 'Imamah', 'Hijab', 'Niqab', 'Khimar']) {
      await sheet.getByRole('radio', { name, exact: true }).click();
      const art = sheet.locator('.df2-av-stage-art svg');
      // A head (skin-tone ellipse) is drawn; no eyes/mouth or any other facial feature exist in the art.
      expect(await art.locator('ellipse, path[fill^="url(#hd-"]').count(), `${theme} ${name}`).toBeGreaterThan(0);
      expect(await art.locator('[class*="eye"],[class*="mouth"]').count()).toBe(0);
      const beard = await art.locator('path[fill^="url(#bd-"]').count();
      expect(beard > 0, `${name} beard`).toBe(['Kufi', 'Ghutra', 'Imamah'].includes(name));
    }
    // Small sizes (chips, lists) render the same figure without the fine detail layers.
    expect(await sheet.locator('.df2-av-preview-small svg').count()).toBe(2);
    for (let i = 0; i < 3 && (await sheet.count()); i++) await sheet.last().getByRole('button', { name: /^Close/ }).first().click();
    await expect(sheet).toHaveCount(0);
    // Bilal's V3.2-era saved avatar still renders (Imamah: a figure with a beard) in the People list.
    const bilal = ui(page).locator('.df2-people .df2-person-open').filter({ hasText: 'Bilal' }).first();
    await expect(bilal.locator('svg path[fill^="url(#bd-"]')).toHaveCount(1);
    expect(errors).toEqual([]);
    await context.close();
  }
});
