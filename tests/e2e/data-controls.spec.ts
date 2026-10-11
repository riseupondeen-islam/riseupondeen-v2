import { expect, test, type Page } from '@playwright/test';
import { ADMIN_TEST_PASSWORD, DF_USERS } from '../fixtures/firebaseSeed';
import { goto, prepare, trackPageErrors } from './helpers';

/* V3.5 data controls: Full Admin Data Reset (logs & analytics), Deen Friends member deletion requests,
 * and the per-page "Your data on this page" control. Test data only (in-memory Firebase double). */

type Fake = {
  docs: Map<string, Record<string, unknown>>;
  serverWrite: (p: string, d: unknown) => void;
  currentUser: { uid: string; email: string } | null;
  rules: { allowed: (op: string, path: string, before: unknown, after: unknown) => boolean };
};
const fake = (page: Page) => page.evaluate.bind(page);
const paths = (page: Page, prefix: string) =>
  page.evaluate((p) => [...(globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__.docs.keys()].filter((k) => k.startsWith(p)), prefix);

async function adminLogin(page: Page) {
  await prepare(page);
  await goto(page, '#admin');
  await page.locator('#adminEmail').fill('riseupondeen@gmail.com');
  await page.locator('#adminPassword').fill(ADMIN_TEST_PASSWORD);
  await page.locator('#adminLoginBtn').click();
  await expect(page.locator('#adminUserEmail')).toHaveText('riseupondeen@gmail.com');
}

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

test('Full Admin Data Reset: clears only logs & analytics, needs the typed phrase, audited', async ({ page }) => {
  const errors = trackPageErrors(page);
  await adminLogin(page);
  await fake(page)(() => {
    const fb = (globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__;
    const ts = { __ts: Date.now() };
    for (let i = 0; i < 3; i++) {
      fb.serverWrite(`deens_activity_logs/a${i}`, { uid: 'fakeuser101', eventType: 'X', createdAt: ts });
      fb.serverWrite(`visitor_sessions/s${i}`, { visitorId: 'v', route: '#home' });
    }
    fb.serverWrite('deens_analytics/d1', { day: 1 });
    fb.serverWrite('deens_risk_signals/r1', { uid: 'fakeuser102' });
    fb.serverWrite('deens_private_chat_access_logs/p1', { adminUid: 'x' });
    fb.serverWrite('deens_admin_audit_logs/earlier', { action: 'EARLIER', timestamp: ts });
    fb.serverWrite('deens_reports/rep1', { reportedUid: 'fakeuser102' });
  });
  await page.locator('[data-admin-view="data-reset"]').click();
  const card = page.locator('.rud-reset-card');
  await expect(card).toContainText('Full Admin Data Reset');
  await expect(card.locator('[data-collection="deens_activity_logs"] b')).toHaveText('3');
  await expect(card.locator('[data-collection="visitor_sessions"] b')).toHaveText('3');
  const go = card.getByRole('button', { name: 'Reset logs & analytics' });
  await expect(go).toBeDisabled();
  await card.getByLabel('Confirmation phrase').fill('reset logs'); // must match exactly
  await expect(go).toBeDisabled();
  await card.getByLabel('Confirmation phrase').fill('RESET LOGS');
  await go.click();
  await expect(card.getByRole('status')).toContainText('Done — 9 records removed');
  for (const c of ['deens_activity_logs/', 'visitor_sessions/', 'deens_analytics/', 'deens_risk_signals/', 'deens_private_chat_access_logs/'])
    expect(await paths(page, c), c).toEqual([]);
  // Everything else is untouched.
  for (const keep of ['deens_users/fakeuser101', 'deens_users/fakeuser102', 'content/test-dua-1', 'deens_reports/rep1', 'deens_admin_audit_logs/earlier'])
    expect(await paths(page, keep), keep).toEqual([keep]);
  const audit = await page.evaluate(() =>
    [...(globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__.docs.entries()]
      .filter(([k]) => k.startsWith('deens_admin_audit_logs/'))
      .map(([, v]) => String(v.action)),
  );
  expect(audit).toEqual(expect.arrayContaining(['EARLIER', 'ADMIN_DATA_RESET_STARTED', 'ADMIN_DATA_RESET_COMPLETED']));
  expect(errors).toEqual([]);
});

test('rules: only the Super Admin can reset logs or queue a deletion; jobs can never be edited', async ({ page }) => {
  await prepare(page);
  await goto(page, '#deen-friends');
  const ui = page.locator('.df2-root');
  await ui.getByLabel('Email').fill(DF_USERS.aisha.email);
  await ui.getByLabel('Password', { exact: true }).fill(DF_USERS.aisha.password);
  await ui.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.locator('.df2-me-chip')).toBeVisible();
  const check = () =>
    page.evaluate(() => {
      const fb = (globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__;
      const me = fb.currentUser!;
      const job = (target: string) => ({ type: 'deleteDeenUser', targetUid: target, requestedBy: me.uid, requestedByEmail: me.email, status: 'queued', createdAt: { toMillis: () => Date.now(), seconds: 0, nanoseconds: 0, __isTs: true }, createdAtMs: Date.now() });
      return {
        deleteLogs: fb.rules.allowed('delete', 'deens_activity_logs/a1', { uid: 'x' }, null),
        deleteSessions: fb.rules.allowed('delete', 'visitor_sessions/s1', { route: '#' }, null),
        createJob: fb.rules.allowed('create', 'deens_admin_jobs/j1', null, job('fakeuser102')),
        editJob: fb.rules.allowed('update', 'deens_admin_jobs/j1', job('fakeuser102'), { ...job('fakeuser102'), status: 'done' }),
      };
    });
  expect(await check()).toEqual({ deleteLogs: false, deleteSessions: false, createJob: false, editJob: false });
  // Control: the same checks as the Super Admin allow resetting and queueing, but still never editing a job.
  await page.evaluate(() => {
    const fb = (globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__;
    (fb as unknown as { __saved: unknown }).__saved = fb.currentUser;
    fb.currentUser = { uid: 'fakeadmin001', email: 'riseupondeen@gmail.com' };
  });
  expect(await check()).toEqual({ deleteLogs: true, deleteSessions: true, createJob: true, editJob: false });
  await page.evaluate(() => {
    const fb = (globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__;
    fb.currentUser = (fb as unknown as { __saved: Fake['currentUser'] }).__saved;
  });
});

test('Deen Friends member deletion: clear consequences, typed confirmation, queued once, access off at once', async ({ page }) => {
  await adminLogin(page);
  await page.locator('[data-admin-view="deen-friends"]').click();
  await expect(page.locator('#rudDfAdminBody')).toBeVisible();
  await page.locator('[data-df-tab="user-management"]').click();
  await page.locator('[data-df-action="userDelete"][data-id="fakeuser102"]').click();
  const drawer = page.locator('.rud-df-admin-delete');
  await expect(drawer).toContainText('@bilal');
  await expect(drawer).toContainText('Their login account');
  await expect(drawer).toContainText('Reports, moderation cases');
  const go = page.locator('#rudDfDeleteConfirmGo');
  await expect(go).toBeDisabled();
  await page.locator('#rudDfDeleteConfirmInput').fill('bilal');
  await go.click();
  await expect(page.locator('#toastStack')).toContainText('Deletion queued');
  const docs = await page.evaluate(() => {
    const m = (globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__.docs;
    const jobs = [...m.entries()].filter(([k]) => k.startsWith('deens_admin_jobs/')).map(([, v]) => JSON.parse(JSON.stringify(v)));
    const audit = [...m.values()].filter((v) => v.action === 'USER_DELETION_REQUESTED').length;
    return { jobs, profile: JSON.parse(JSON.stringify(m.get('deens_users/fakeuser102'))), audit };
  });
  expect(docs.jobs).toHaveLength(1);
  expect(docs.jobs[0]).toMatchObject({ type: 'deleteDeenUser', targetUid: 'fakeuser102', requestedBy: 'fakeadmin001', status: 'queued' });
  expect(docs.profile.deenFriendsAccessDisabled).toBe(true); // access is off immediately
  expect(docs.audit).toBe(1);
  // A second request for the same member is refused while the first is pending.
  await page.locator('[data-df-tab="user-management"]').click();
  await page.locator('[data-df-action="userDelete"][data-id="fakeuser102"]').click();
  await expect(page.locator('#toastStack')).toContainText('already in progress');
  expect(await paths(page, 'deens_admin_jobs/')).toHaveLength(1);
});

test('"Your data on this page": each page clears only its own local data, after a second confirmation', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__pd_seeded')) return;
    sessionStorage.setItem('__pd_seeded', '1');
    localStorage.setItem('rud_favorites', JSON.stringify(['test-dua-1']));
    localStorage.setItem('rud_quran_bookmarks_v1', JSON.stringify(['1:1']));
    localStorage.setItem('rud_quran_ayah_notes_v2', JSON.stringify({ '1:1': 'TEST note' }));
    localStorage.setItem('rud_tasbih_count_v1', '33');
    localStorage.setItem('rud_deen_history_v2', JSON.stringify({ days: 3 }));
    localStorage.setItem('rud_reading_preferences_v2', JSON.stringify({ arabicSize: 'large' }));
  });
  const keys = () =>
    page.evaluate(() =>
      Object.fromEntries(
        ['rud_favorites', 'rud_quran_bookmarks_v1', 'rud_quran_ayah_notes_v2', 'rud_tasbih_count_v1', 'rud_deen_history_v2', 'rud_reading_preferences_v2', 'theme'].map((k) => [k, localStorage.getItem(k) !== null]),
      ),
    );
  // Saved: lists the data, offers a download, and needs a second confirmation.
  await goto(page, '#saved');
  await page.locator('[data-page-data="saved"]').click();
  const dialog = page.locator('.rud-dialog');
  await expect(dialog).toContainText('Saved duas, hadith, reminders and names');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download a copy' }).click();
  expect((await download).suggestedFilename()).toBe('rise-upon-deen-saved-data.json');
  await dialog.getByRole('button', { name: 'Clear this data…' }).click();
  await dialog.getByRole('button', { name: 'Yes, clear Saved data' }).click();
  await expect(page.locator('#toastStack')).toContainText('Saved data cleared from this device.');
  expect(await keys()).toEqual({
    rud_favorites: false,
    rud_quran_bookmarks_v1: true,
    rud_quran_ayah_notes_v2: true,
    rud_tasbih_count_v1: true,
    rud_deen_history_v2: true,
    rud_reading_preferences_v2: true,
    theme: true,
  });
  // Qur'an: only its own data; Cancel keeps everything.
  await goto(page, '#quran');
  await page.locator('[data-page-data="quran"]').click();
  await expect(dialog).toContainText('Bookmarks');
  await expect(dialog).toContainText('Ayah notes');
  await dialog.getByRole('button', { name: 'Clear this data…' }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await keys()).rud_quran_bookmarks_v1).toBe(true);
  await dialog.getByRole('button', { name: 'Clear this data…' }).click();
  await dialog.getByRole('button', { name: /Yes, clear Qur/ }).click();
  expect(await keys()).toMatchObject({ rud_quran_bookmarks_v1: false, rud_quran_ayah_notes_v2: false, rud_tasbih_count_v1: true, rud_deen_history_v2: true, rud_reading_preferences_v2: true });
  // The control exists on My Deen and Tasbih, and is not offered where clearing is unsupported or unsafe.
  await goto(page, '#my-deen');
  await expect(page.locator('[data-page-data="my-deen"]')).toHaveCount(1);
  await goto(page, '#tasbih');
  await expect(page.locator('[data-page-data="tasbih"]')).toHaveCount(1);
  await goto(page, '#prayer');
  await expect(page.locator('[data-page-data]')).toHaveCount(0);
  await goto(page, '#deen-friends');
  await expect(page.locator('[data-page-data]')).toHaveCount(0);
});
