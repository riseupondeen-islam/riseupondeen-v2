import { expect, test } from '@playwright/test';
import { firestoreLog, goto, prepare } from './helpers';
import { ADMIN_TEST_PASSWORD } from '../fixtures/firebaseSeed';

/* Firebase-backed flows, against the in-memory test double (never the live project). */
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

test('admin: sign in, publish a dua, move it to the Recycle Bin', async ({ page }) => {
  await prepare(page);
  await goto(page, '#admin');
  await expect(page).toHaveURL(/#riseupondeen\.admin\.login\.1722$/);
  await page.locator('#adminEmail').fill('riseupondeen@gmail.com');
  await page.locator('#adminPassword').fill(ADMIN_TEST_PASSWORD);
  await page.locator('#adminLoginBtn').click();
  await expect(page.locator('#adminDashboard')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#adminUserEmail')).toHaveText('riseupondeen@gmail.com');
  await page.locator('[data-admin-view="duas"]').click();
  await expect(page.locator('#managerBody tr')).toHaveCount(2);
  await page.locator('#managerBody [data-delete]').first().click();
  await page.locator('#confirmDelete').click();
  await expect(page.locator('#managerBody tr')).toHaveCount(1);
  const writes = (await firestoreLog(page)).filter((e) => ['add', 'delete'].includes(e.op));
  expect(writes.map((e) => `${e.op} ${e.path}`)).toEqual(['add trash', 'delete content/test-dua-1']);
  await page.locator('[data-admin-view="trash"]').click();
  await expect(page.locator('#adminMain')).toContainText('TEST Dua One');
});

test('admin: wrong password is rejected', async ({ page }) => {
  await prepare(page);
  await goto(page, '#admin');
  await page.locator('#adminEmail').fill('riseupondeen@gmail.com');
  await page.locator('#adminPassword').fill('wrong');
  await page.locator('#adminLoginBtn').click();
  await expect(page.locator('#toastStack')).toContainText('Incorrect email or password.');
  await expect(page.locator('#adminLoginView')).toBeVisible();
  // The dashboard keeps its `hidden` attribute (its stylesheet sets display:grid, so assert the attribute).
  await expect(page.locator('#adminDashboard')).toHaveAttribute('hidden', '');
});

test('Deen Friends: create an account', async ({ page }) => {
  await prepare(page);
  await goto(page, '#deen-friends');
  const df = page.locator('.df2-page');
  await df.getByRole('tab', { name: 'Create account' }).click();
  await df.getByLabel('Your name').fill('Test Friend');
  await df.getByLabel('Unique username').fill('testfriend');
  await df.getByLabel('Email').fill('new.friend@example.com');
  await df.getByLabel('Password').fill('pass-12345678');
  await df.getByRole('button', { name: 'Create secure account' }).click();
  await expect(page.locator('.df2-me-chip')).toContainText('@testfriend');
  const tx = (await firestoreLog(page)).find((e) => e.op === 'transaction') as unknown as {
    ops: Array<{ path: string }>;
  };
  expect(tx.ops.map((o) => o.path).sort()).toEqual(['deens_users/fakeuid004', 'visitor_usernames/testfriend']);
});

test('admin: create and publish a Daily Deen Challenge, track progress', async ({ page }) => {
  await prepare(page);
  await goto(page, '#admin');
  await page.locator('#adminEmail').fill('riseupondeen@gmail.com');
  await page.locator('#adminPassword').fill(ADMIN_TEST_PASSWORD);
  await page.locator('#adminLoginBtn').click();
  await page.locator('[data-admin-view="daily-challenges"]').click();
  const view = page.locator('.df2-admin');
  await expect(view.locator('.df2-admin-row')).toHaveCount(3);
  await view.getByRole('button', { name: '+ New challenge' }).click();
  await view.getByLabel('Title').fill('Admin test: 100 Istighfar daily');
  await view.getByLabel('Completion').selectOption('tasbih');
  await view.getByLabel('Tasbih target per day').fill('100');
  await view.getByLabel('Days required to complete').fill('5');
  await view.getByRole('button', { name: 'Selected users' }).click();
  await view.getByLabel('Usernames').fill('@aisha, @nobody_here');
  await view.getByRole('button', { name: 'Save & publish' }).click();
  await expect(view.locator('.df2-form-error')).toContainText('@nobody_here');
  await view.getByLabel('Usernames').fill('@aisha');
  await view.getByRole('button', { name: 'Save & publish' }).click();
  await expect(view.locator('.df2-admin-row')).toHaveCount(4);
  const created = await page.evaluate(() =>
    [
      ...(
        globalThis as unknown as { __FAKE_FB__: { docs: Map<string, Record<string, unknown>> } }
      ).__FAKE_FB__.docs.entries(),
    ]
      .filter(
        ([k, v]) =>
          k.startsWith('deens_daily_challenges/') &&
          k.split('/').length === 2 &&
          v.title === 'Admin test: 100 Istighfar daily',
      )
      .map(([, v]) => JSON.parse(JSON.stringify(v))),
  );
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    challengeType: 'daily_deen',
    status: 'published',
    audience: 'selected',
    assignedUids: ['fakeuser101'],
    activity: 'tasbih',
    target: 100,
    requiredDays: 5,
  });
  await view
    .locator('.df2-admin-row')
    .filter({ hasText: 'TEST Daily: draft' })
    .getByRole('button', { name: 'Publish' })
    .click();
  await expect(
    view.locator('.df2-admin-row').filter({ hasText: 'TEST Daily: draft' }).locator('.df2-status'),
  ).toHaveText('published');
});

test('admin: RISE inbox shows conversations and replies are sent as RISE', async ({ page }) => {
  await prepare(page);
  await goto(page, '#admin');
  await page.locator('#adminEmail').fill('riseupondeen@gmail.com');
  await page.locator('#adminPassword').fill(ADMIN_TEST_PASSWORD);
  await page.locator('#adminLoginBtn').click();
  await page.locator('[data-admin-view="rise-inbox"]').click();
  const view = page.locator('.df2-admin');
  await view.locator('.df2-admin-thread').filter({ hasText: 'Bilal Ahmed' }).click();
  await expect(view.locator('.df2-admin-messages')).toContainText('audio stops');
  await view.getByLabel('Reply').fill('Thank you, Bilal. Please try clearing the offline audio cache.');
  await view.getByRole('button', { name: 'Send reply' }).click();
  await expect(view.locator('.df2-admin-messages .mine')).toContainText('offline audio cache');
  const log = await firestoreLog(page);
  expect(log.some((e) => e.op === 'batch' && JSON.stringify(e).includes('RISE_THREAD_OPENED'))).toBe(true);
});

async function openDeenFriendsConsole(page: import('@playwright/test').Page) {
  await prepare(page);
  await goto(page, '#admin');
  await page.locator('#adminEmail').fill('riseupondeen@gmail.com');
  await page.locator('#adminPassword').fill(ADMIN_TEST_PASSWORD);
  await page.locator('#adminLoginBtn').click();
  await page.locator('[data-admin-view="deen-friends"]').click();
  await expect(page.locator('#rudDfAdminBody')).toBeVisible();
}

test('admin Deen Friends console: Messages tab, profile edit, accepting a request creates the connection', async ({
  page,
}) => {
  page.on('dialog', (d) => d.accept());
  await openDeenFriendsConsole(page);
  // Messages tab opens the messages view (it used to fall back to the Command Center).
  await page.locator('[data-df-tab="messages"]').click();
  await expect(page.locator('#rudDfAdminBody')).toContainText('PRIVATE CONVERSATIONS');

  // Edit profile, including a username change (writes the username registry for another user).
  await page.locator('[data-df-tab="user-management"]').click();
  await page.locator('[data-df-action="user360"]').first().click();
  await page.locator('#rudDfAdminDrawerClose').click();
  await page.locator('#rudDfEditUser').click();
  await page.locator('#rudDfEditName').fill('Aisha R.');
  await page.locator('#rudDfEditUsername').fill('aisha_r');
  await page.locator('#rudDfEditUserSave').click();
  await expect(page.locator('#toastStack')).toContainText('User profile updated.');

  // A pending request accepted by the admin also creates the friendship and the streak.
  await page.evaluate(() =>
    (
      globalThis as unknown as { __FAKE_FB__: { serverWrite: (p: string, d: unknown) => void } }
    ).__FAKE_FB__.serverWrite('deens_friend_requests/req_admin_test', {
      fromUid: 'fakeuser101',
      toUid: 'fakeuser102',
      status: 'pending',
      createdAtMs: Date.now(),
    }),
  );
  await page.locator('[data-df-tab="requests"]').click();
  await page.locator('#rudDfRequestsRefresh').click();
  await page.locator('[data-df-action="requestAccept"][data-id="req_admin_test"]').click();
  await expect(page.locator('#toastStack')).toContainText('Request accepted.');
  const writes = (await firestoreLog(page)).map((e) => `${e.op} ${e.path}`);
  expect(writes).toContain('set deens_friendships/fakeuser101_fakeuser102');
  expect(writes).toContain('set deens_friend_streaks/fakeuser101_fakeuser102');

  // A second click reports why instead of a bare "Action failed."
  await page.locator('#rudDfRequestsRefresh').click();
  await expect(page.locator('#toastStack')).not.toContainText('Action failed');
});
