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
  // The header logo is the supplied artwork (256px master derivative), shown on a rounded tile.
  const logo = await page.locator('.rud-minimal-logo img').evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight, r: getComputedStyle(img).borderRadius }));
  expect(logo).toEqual({ w: 256, h: 256, r: '12px' });
  for (const [path, size] of [['/icon-192.png', 192], ['/icon-512.png', 512], ['/icon-maskable-512.png', 512]] as const) {
    const res = await request.get(path);
    expect(res.ok()).toBeTruthy();
    const buf = await res.body();
    expect(buf.readUInt32BE(16)).toBe(size); // PNG IHDR width
  }
  // Explore has the App Guide and theme entries.
  await page.locator('#rudExploreBtn').click();
  await expect(page.locator('#rudExploreGuide')).toBeVisible();
  await expect(page.locator('#rudExploreTheme')).toBeVisible();
});

test('Makkah scene belongs to the first screen and does not follow the page', async ({ page }) => {
  await prepare(page, { theme: 'dark' });
  await goto(page, '#home');
  const first = await page.evaluate(() => {
    const el = document.querySelector('.global-mecca-bg') as HTMLElement;
    return { pos: getComputedStyle(el).position, top: el.getBoundingClientRect().top };
  });
  expect(first).toEqual({ pos: 'absolute', top: 0 });
  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(300);
  const later = await page.evaluate(() => {
    const scene = document.querySelector('.global-mecca-bg') as HTMLElement;
    const sky = document.querySelector('.mecca-bg-lite') as HTMLElement;
    return { sceneBottom: scene.getBoundingClientRect().bottom, skyTop: sky.getBoundingClientRect().top, skyPos: getComputedStyle(sky).position };
  });
  expect(later.sceneBottom).toBeLessThanOrEqual(0); // scrolled away with the hero
  expect(later.skyPos).toBe('fixed');
  expect(later.skyTop).toBe(0);
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
  for (let i = 0; i < 3; i++) await page.locator('.rud-tour-card [data-primary]').click();
  await expect(page.locator('.rud-tour')).toHaveCount(0);
  expect(errors).toEqual([]);
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
  const tx = (await firestoreLog(page)).filter((e) => e.op === 'transaction').pop() as { ops: Array<{ path: string }> };
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
  await ui(page).getByRole('button', { name: 'Create avatar' }).click();
  const sheet = ui(page).locator('.df2-sheet');
  await sheet.getByRole('button', { name: 'Sakinah' }).click();
  await sheet.getByRole('radio', { name: 'night' }).click();
  await sheet.getByRole('button', { name: 'Save avatar' }).click();
  await expect(page.locator('.df2-me-chip .df2-avatar-built svg clipPath')).toHaveCount(1);
  const user = (await fakeDocs(page, 'deens_users/fakeuser101'))[0];
  expect(user.avatarConfig).toMatchObject({ v: 1, figure: 'hijab', background: 'night' });
  // Preview public profile: shows the public card, never email.
  const previewBtn = ui(page).getByRole('button', { name: 'Preview public profile' });
  if (!(await previewBtn.isVisible())) await page.locator('.df2-me-chip').click();
  await previewBtn.click();
  const preview = ui(page).locator('.df2-sheet');
  await expect(preview).toContainText('PREVIEW');
  await expect(preview.locator('.df2-public-card')).toContainText('Aisha Rahman');
  await expect(preview.locator('.df2-public-card')).toContainText('@aisha');
  await expect(preview).not.toContainText(DF_USERS.aisha.email);
  await expect(preview.locator('.df2-public-card .df2-avatar-built')).toHaveCount(1);
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
