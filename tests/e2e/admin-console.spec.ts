import { expect, test, type Page } from '@playwright/test';
import { ADMIN_TEST_PASSWORD, DF_USERS } from '../fixtures/firebaseSeed';
import { firestoreLog, goto, prepare, trackPageErrors } from './helpers';

/* Admin Console: authentication gate, layout (fixed sidebar / independent scrolling), themes,
 * table tools, RISE Inbox deletion, RISE Messages, Maintenance Access propagation and the Daily
 * Deen Challenge schedule. All against the in-memory Firebase double (never the live project). */

type Fake = {
  docs: Map<string, Record<string, unknown>>;
  serverWrite: (p: string, d: unknown) => void;
  log: Array<{ op: string; path: string }>;
};

async function extendSeed(page: Page, collections: Record<string, Record<string, unknown>>) {
  await page.addInitScript((extra) => {
    const w = window as unknown as { __FAKE_FB_SEED__: { collections: Record<string, Record<string, unknown>> } };
    for (const [coll, docs] of Object.entries(extra)) w.__FAKE_FB_SEED__.collections[coll] = { ...(w.__FAKE_FB_SEED__.collections[coll] || {}), ...docs };
  }, collections);
}
function docs(page: Page, prefix: string) {
  return page.evaluate((p) => {
    const all = (globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__.docs;
    return [...all.entries()].filter(([k]) => k.startsWith(p)).map(([k, v]) => ({ path: k, ...JSON.parse(JSON.stringify(v)) }));
  }, prefix);
}
async function openAdmin(page: Page) {
  await goto(page, '#admin');
  await expect(page.locator('#adminApp')).toHaveAttribute('data-auth', 'signed-out');
}
async function login(page: Page, email = 'riseupondeen@gmail.com', password = ADMIN_TEST_PASSWORD) {
  await page.locator('#adminEmail').fill(email);
  await page.locator('#adminPassword').fill(password);
  await page.locator('#adminLoginBtn').click();
}
async function adminSession(page: Page) {
  await prepare(page);
  await openAdmin(page);
  await login(page);
  await expect(page.locator('#adminApp')).toHaveAttribute('data-auth', 'authorized');
  await expect(page.locator('#adminUserEmail')).toHaveText('riseupondeen@gmail.com');
}
const nav = (page: Page, view: string) => page.locator(`[data-admin-view="${view}"]`).click();

test.describe('admin console · desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('auth gate: nothing administrative is rendered before a verified sign-in', async ({ page }) => {
    const errors = trackPageErrors(page);
    await prepare(page);
    // Record every auth state and whether any admin content existed before sign-in.
    await page.addInitScript(() => {
      const w = window as unknown as { __gate: string[]; __mainBeforeLogin: number };
      w.__gate = [];
      w.__mainBeforeLogin = 0;
      new MutationObserver(() => {
        const app = document.getElementById('adminApp');
        const state = app?.getAttribute('data-auth') || '';
        if (w.__gate[w.__gate.length - 1] !== state) w.__gate.push(state);
        if (state !== 'authorized') w.__mainBeforeLogin = Math.max(w.__mainBeforeLogin, document.getElementById('adminMain')?.childElementCount || 0);
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-auth', 'hidden'] });
    });
    await openAdmin(page);
    await expect(page).toHaveURL(/#riseupondeen\.admin\.login\.1722$/);
    await expect(page.locator('#adminLoginView')).toBeVisible();
    await expect(page.locator('#adminDashboard')).toBeHidden();
    await expect(page.locator('#adminSidebar')).toBeHidden();
    expect(await page.locator('#adminMain').evaluate((m) => m.childElementCount)).toBe(0);
    // A Deen Friends member account is refused and signed out.
    await login(page, DF_USERS.aisha.email, DF_USERS.aisha.password);
    await expect(page.locator('#adminLoginError')).toContainText('not authorized');
    await expect(page.locator('#adminDashboard')).toBeHidden();
    // Wrong password.
    await login(page, 'riseupondeen@gmail.com', 'wrong');
    await expect(page.locator('#adminLoginError')).toContainText('Incorrect email or password');
    await expect(page.locator('#adminApp')).toHaveAttribute('data-auth', 'signed-out');
    // Correct credentials.
    await login(page);
    await expect(page.locator('#adminApp')).toHaveAttribute('data-auth', 'authorized');
    await expect(page.locator('#adminMain .rad-overview')).toBeVisible();
    const gate = await page.evaluate(() => {
      const w = window as unknown as { __gate: string[]; __mainBeforeLogin: number };
      return { __gate: w.__gate, __mainBeforeLogin: w.__mainBeforeLogin };
    });
    expect(gate.__mainBeforeLogin).toBe(0);
    expect(gate.__gate.indexOf('authorized')).toBe(gate.__gate.length - 1);
    expect(gate.__gate.filter((x) => x === 'authorized')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('sign-out removes every admin screen, listener cache and dataset immediately', async ({ page }) => {
    await adminSession(page);
    await nav(page, 'duas');
    await expect(page.locator('#managerBody tr')).toHaveCount(2);
    expect(await page.evaluate(() => localStorage.getItem('rud_admin_content_cache_v1'))).not.toBeNull();
    await page.locator('#adminLogoutBtn').click();
    await expect(page.locator('#adminApp')).toHaveAttribute('data-auth', 'signed-out');
    await expect(page.locator('#adminLoginView')).toBeVisible();
    expect(await page.locator('#adminMain').evaluate((m) => m.innerHTML)).toBe('');
    await expect(page.locator('#adminUserEmail')).toHaveText('');
    expect(await page.evaluate(() => localStorage.getItem('rud_admin_content_cache_v1'))).toBeNull();
    expect((await firestoreLog(page)).some((e) => e.op === 'auth.signOut')).toBe(true);
  });

  test('dashboard reads once per 15 minutes (not on every visit) and its cache is cleared on sign-out', async ({ page }) => {
    await adminSession(page);
    const sessionReads = async () => (await firestoreLog(page)).filter((e) => e.op === 'getDocs' && e.path === 'visitor_sessions').length;
    await expect.poll(sessionReads).toBe(1);
    await expect.poll(() => page.evaluate(() => !!sessionStorage.getItem('rud_admin_insights_v1'))).toBe(true);
    await nav(page, 'duas');
    await nav(page, 'dashboard');
    await expect(page.locator('#adminMain .rad-react-view[data-view="dashboard"]')).toBeVisible();
    expect(await sessionReads()).toBe(1); // served from the cache
    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect.poll(sessionReads).toBe(2); // Refresh always re-reads
    await page.locator('#adminLogoutBtn').click();
    await expect(page.locator('#adminApp')).toHaveAttribute('data-auth', 'signed-out');
    expect(await page.evaluate(() => sessionStorage.getItem('rud_admin_insights_v1'))).toBeNull();
  });

  test('layout: fixed sidebar, only the content area scrolls, no page or horizontal scroll', async ({ page }) => {
    await adminSession(page);
    await nav(page, 'daily-challenges');
    await page.getByRole('tab', { name: '30-day library' }).click();
    const main = page.locator('#adminMain');
    await expect(main.locator('.rad-datatable tbody tr')).toHaveCount(10);
    const before = await page.locator('#adminSidebar').boundingBox();
    const scrollable = await main.evaluate((m) => m.scrollHeight > m.clientHeight);
    expect(scrollable).toBe(true);
    await main.evaluate((m) => (m.scrollTop = m.scrollHeight));
    await page.mouse.wheel(0, 800);
    const after = await page.locator('#adminSidebar').boundingBox();
    expect(after?.y).toBe(before?.y);
    expect(after?.height).toBe(900);
    const page_ = await page.evaluate(() => ({
      docScroll: document.scrollingElement!.scrollTop,
      docOverflow: document.scrollingElement!.scrollWidth - window.innerWidth,
      mainOverflow: (() => {
        const m = document.getElementById('adminMain')!;
        return m.scrollWidth - m.clientWidth;
      })(),
    }));
    expect(page_.docScroll).toBe(0);
    expect(page_.docOverflow).toBeLessThanOrEqual(0);
    expect(page_.mainOverflow).toBeLessThanOrEqual(0);
    // The sidebar scrolls on its own when it is taller than the viewport.
    await page.setViewportSize({ width: 1280, height: 480 });
    const nav_ = page.locator('.rad-nav');
    expect(await nav_.evaluate((n) => n.scrollHeight > n.clientHeight)).toBe(true);
    await nav_.evaluate((n) => (n.scrollTop = n.scrollHeight));
    await expect(page.locator('[data-admin-view="data-reset"]')).toBeInViewport();
    await expect(page.locator('#adminLogoutBtn')).toBeInViewport();
  });

  test('login page: fits the viewport without scrolling; theme controls before and after sign-in', async ({ page }) => {
    await prepare(page, { theme: 'dark' });
    await openAdmin(page);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 700 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(size);
      const fit = await page.locator('#adminLoginView').evaluate((v) => ({ over: v.scrollHeight - v.clientHeight, wide: v.scrollWidth - v.clientWidth }));
      expect(fit.over, `no vertical scroll at ${size.width}×${size.height}`).toBeLessThanOrEqual(0);
      expect(fit.wide).toBeLessThanOrEqual(0);
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
    }
    const toggle = page.locator('#adminLoginThemeToggle');
    await expect(toggle).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.classList.contains('light-mode'))).toBe(false);
    const darkBg = await page.locator('.rad-login-card').evaluate((c) => getComputedStyle(c).backgroundColor);
    await toggle.click();
    expect(await page.evaluate(() => document.documentElement.classList.contains('light-mode'))).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
    const lightBg = await page.locator('.rad-login-card').evaluate((c) => getComputedStyle(c).backgroundColor);
    expect(lightBg).not.toBe(darkBg);
    expect(lightBg).toBe('rgb(255, 255, 255)');
    await login(page);
    await expect(page.locator('#adminThemeToggle')).toBeVisible();
    await page.locator('#adminThemeToggle').click();
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
    expect(await page.locator('.rad-sidebar').evaluate((s) => getComputedStyle(s).backgroundColor)).toBe('rgb(11, 13, 15)');
  });

  test('tables: columns can be hidden (and stay hidden), headings sort, filters combine with counts', async ({ page }) => {
    await adminSession(page);
    await nav(page, 'names');
    const table = page.locator('#adminMain .table-wrap table');
    await expect(page.locator('#managerBody tr')).toHaveCount(3);
    const bar = page.locator('#adminMain [data-rad-tablebar]');
    await bar.getByRole('button', { name: 'Columns' }).click();
    await expect(bar.getByRole('checkbox', { name: /Title/ })).toBeDisabled(); // identifying column is mandatory
    await bar.getByRole('checkbox', { name: 'Featured' }).uncheck();
    await expect(table.locator('th', { hasText: 'Featured' })).toBeHidden();
    // Re-render (navigate away and back): the preference is kept.
    await nav(page, 'duas');
    await nav(page, 'names');
    await expect(page.locator('#adminMain .table-wrap th', { hasText: 'Featured' })).toBeHidden();
    // Sort by title, descending on the second click.
    const titles = () => page.locator('#managerBody tr td:first-child').allInnerTexts();
    await page.locator('#adminMain th', { hasText: 'Title' }).click();
    const asc = await titles();
    await page.locator('#adminMain th', { hasText: 'Title' }).click();
    expect(await titles()).toEqual([...asc].reverse());

    // React tables (Daily challenges): value filters, chips, counts, reset.
    await nav(page, 'daily-challenges');
    await page.getByRole('tab', { name: 'Published & drafts' }).click();
    const dt = page.locator('.rad-datatable');
    await expect(dt.locator('tbody tr')).toHaveCount(3);
    await dt.getByRole('button', { name: 'Filters' }).click();
    await dt.getByLabel('Status').selectOption('draft');
    await expect(dt.locator('tbody tr')).toHaveCount(1);
    await expect(dt.locator('.rad-tablebar-count')).toHaveText('1 of 3 rows');
    await expect(dt.locator('.rad-chip')).toContainText('Status: draft');
    await dt.getByLabel('Audience').selectOption('Selected users');
    await expect(dt.locator('tbody')).toContainText('No rows match');
    await dt.getByRole('button', { name: 'Clear all' }).click();
    await expect(dt.locator('tbody tr')).toHaveCount(3);
    await dt.getByRole('button', { name: 'Columns' }).click();
    await dt.getByRole('checkbox', { name: 'Category' }).uncheck();
    await expect(dt.locator('th', { hasText: 'Category' })).toHaveCount(0);
    await dt.getByRole('button', { name: 'Reset to default' }).click();
    await expect(dt.locator('th', { hasText: 'Category' })).toHaveCount(1);
  });

  test('Deen Friends console: reopening never duplicates handlers; Refresh re-reads; search keeps focus', async ({ page }) => {
    const errors = trackPageErrors(page);
    await adminSession(page);
    for (let i = 0; i < 3; i++) {
      await nav(page, 'deen-friends');
      await expect(page.locator('#rudDfAdminTopTitle')).toHaveText('Command Center');
      await nav(page, 'duas');
    }
    await nav(page, 'deen-friends');
    await expect(page.locator('.rud-df-admin-stats')).toBeVisible();
    await page.evaluate(() => ((globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__.log.length = 0));
    // Command Center "Refresh" used to re-render from cache without reading anything.
    await page.locator('#rudDfRefresh').click();
    await expect(page.locator('#toastStack')).toContainText('Updated with the latest data');
    const reads = (await firestoreLog(page)).filter((e) => e.op === 'getDocs' && e.path === 'deens_users');
    expect(reads).toHaveLength(1);
    // One click → one navigation (with the old leak, 4 stacked handlers each ran).
    await page.evaluate(() => ((globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__.log.length = 0));
    await page.locator('[data-df-tab="notices"]').click();
    await expect(page.locator('#rudDfAdminTopTitle')).toHaveText('Community Notices');
    await page.waitForTimeout(400);
    expect((await firestoreLog(page)).filter((e) => e.op === 'getDocs' && e.path === 'deens_community_notices')).toHaveLength(1);
    // User Management: tabs survive a search re-render and the input keeps focus.
    await page.locator('[data-df-tab="user-management"]').click();
    const search = page.locator('#rudDfUsersSearch');
    await search.click();
    await search.pressSequentially('bil', { delay: 30 });
    await page.waitForTimeout(500);
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('bil');
    await expect(page.locator('[data-df-user-subtab="firestore"]')).toBeVisible();
    await expect(page.locator('#adminMain .rud-df-admin-table tbody tr')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('RISE Inbox: a deleted conversation is gone for good (after refresh and reload) and nothing else is touched', async ({ page }) => {
    await adminSession(page);
    await nav(page, 'rise-inbox');
    const view = page.locator('.df2-admin');
    await view.locator('.df2-admin-thread').filter({ hasText: 'Bilal Ahmed' }).click();
    await view.getByRole('button', { name: 'Delete conversation' }).click();
    const dialog = page.getByRole('alertdialog');
    const go = dialog.getByRole('button', { name: 'Delete conversation' });
    await expect(go).toBeDisabled();
    await dialog.getByLabel(/Type @bilal to confirm/).fill('@bilal');
    await go.click();
    await expect(page.locator('#toastStack')).toContainText('Conversation deleted');
    await expect(view.locator('.df2-admin-thread')).toHaveCount(0);
    expect(await docs(page, 'deens_rise_threads/')).toEqual([]);
    expect((await docs(page, 'deens_users/fakeuser102')).length).toBe(1); // the member is untouched
    const log = await firestoreLog(page);
    expect(JSON.stringify(log)).toContain('RISE_THREAD_DELETED');
    // Navigating away and back re-reads from Firestore: still gone.
    await nav(page, 'dashboard');
    await nav(page, 'rise-inbox');
    await page.getByRole('button', { name: /^All/ }).click();
    await expect(page.locator('.df2-admin .rad-empty')).toContainText('No conversations');
  });

  test('RISE Messages: one member (delivered once), all members (queued once), cancel before delivery', async ({ page }) => {
    await adminSession(page);
    await nav(page, 'rise-messages');
    // One member with an existing conversation → delivered immediately.
    await page.getByLabel('Recipient').fill('bil');
    await page.getByRole('option', { name: /Bilal Ahmed/ }).click();
    await expect(page.locator('.rad-recipient')).toContainText('delivered instantly');
    await page.locator('#radRiseText').fill('Assalamu alaikum Bilal, the audio issue is fixed.');
    await expect(page.locator('.df2-admin-messages')).toContainText('the audio issue is fixed');
    await page.getByRole('button', { name: 'Review & send' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: 'Delivered to Bilal Ahmed' })).toBeVisible();
    const copies = (await docs(page, 'deens_rise_threads/fakeuser102/messages/')).filter((m) => m.path.includes('/b_'));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ from: 'rise', adminUid: 'fakeadmin001', automated: false, text: 'Assalamu alaikum Bilal, the audio issue is fixed.' });
    const thread = (await docs(page, 'deens_rise_threads/fakeuser102'))[0];
    expect(thread).toMatchObject({ lastFrom: 'rise', status: 'open' });
    // One member without a conversation → queued for the scheduler (which creates it), not lost.
    await page.locator('.rad-recipient').getByRole('button', { name: 'Change' }).click();
    await page.getByLabel('Recipient').fill('aish');
    await page.getByRole('option', { name: /Aisha Rahman/ }).click();
    await expect(page.locator('.rad-recipient')).toContainText('no RISE conversation yet');
    await page.locator('#radRiseText').fill('Salam Aisha!');
    await page.getByRole('button', { name: 'Review & send' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: 'queued' })).toBeVisible();
    // All members: typed confirmation, one request, never twice.
    await page.getByRole('radio', { name: 'All members' }).click();
    await expect(page.locator('.rad-alert-warn', { hasText: 'every Deen Friends member' })).toContainText('about 2');
    await page.locator('#radRiseText').fill('Ramadan Mubarak from the RISE team.');
    await page.getByRole('button', { name: 'Review & send to all' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Send to all members' })).toBeDisabled();
    await dialog.getByLabel(/Type SEND TO ALL/).fill('SEND TO ALL');
    await dialog.getByRole('button', { name: 'Send to all members' }).dblclick();
    await expect(page.locator('#toastStack')).toContainText('queued for all members');
    const requests = await docs(page, 'deens_rise_broadcasts/');
    expect(requests.filter((r) => r.audience === 'all')).toHaveLength(1);
    expect(requests.find((r) => r.audience === 'all')).toMatchObject({ status: 'queued', createdBy: 'fakeadmin001', text: 'Ramadan Mubarak from the RISE team.' });
    expect(requests.find((r) => r.targetUid === 'fakeuser102')?.directDeliveredAtMs).toBeGreaterThan(0);
    // History shows all three; a queued one can be cancelled.
    const history = page.locator('.rad-datatable').last();
    await expect(history.locator('tbody tr')).toHaveCount(3);
    await history.locator('tbody tr').filter({ hasText: 'All members' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(history.locator('tbody tr').filter({ hasText: 'All members' })).toContainText('Cancelled');
  });

  test('Maintenance Access: granted visitors get in immediately, revoked ones are blocked immediately (no reload)', async ({ page }) => {
    // Visitor side: the public app with maintenance active, then the admin's change arrives from the server.
    const end = Date.now() + 3600_000;
    await prepare(page);
    await extendSeed(page, {
      content: {
        rud_maintenance_config: {
          type: 'site',
          siteKey: 'maintenance',
          title: 'Maintenance Configuration',
          published: true,
          maintenanceEnabled: true,
          maintenanceEndTime: { __ts: end },
          maintenanceAllowedVisitorIds: [],
        },
      },
    });
    await goto(page, '#duas');
    await expect(page.locator('#rudMaintenanceApp')).toBeVisible();
    const write = (allowed: string[]) =>
      page.evaluate(
        ([ids, endMs]) =>
          (globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__.serverWrite('content/rud_maintenance_config', {
            type: 'site',
            siteKey: 'maintenance',
            title: 'Maintenance Configuration',
            published: true,
            maintenanceEnabled: true,
            maintenanceEndTime: { __ts: endMs },
            maintenanceAllowedVisitorIds: ids,
          }),
        [allowed, end] as const,
      );
    await write(['v_e2e_test']); // this visitor's id (helpers.prepare)
    await expect(page.locator('#rudMaintenanceApp')).toBeHidden();
    // The page they were on is rendered again, without navigating or reloading.
    await expect(page.locator('#dynamicPage a[href="#dua/test-dua-1"]')).toBeVisible();
    await write([]);
    await expect(page.locator('#rudMaintenanceApp')).toBeVisible();
  });

  test('Maintenance Access (admin): grants and revocations are atomic against the server list', async ({ page }) => {
    await prepare(page);
    await extendSeed(page, {
      visitor_sessions: {
        s1: { visitorId: 'visitor_alpha_001', visitorName: 'Alpha', lastSeenAt: { __ts: Date.now() - 1000 }, startedAt: { __ts: Date.now() - 5000 } },
        s2: { visitorId: 'visitor_beta_0002', visitorName: 'Beta', lastSeenAt: { __ts: Date.now() - 2000 }, startedAt: { __ts: Date.now() - 6000 } },
      },
    });
    await openAdmin(page);
    await login(page);
    await nav(page, 'maintenance');
    await expect(page.locator('#maintenanceAccessUsers tbody tr')).toHaveCount(2);
    // Someone else grants a third visitor meanwhile (another admin tab / device).
    await page.evaluate(() =>
      (globalThis as unknown as { __FAKE_FB__: Fake }).__FAKE_FB__.serverWrite('content/rud_maintenance_config', {
        type: 'site',
        siteKey: 'maintenance',
        published: true,
        maintenanceAllowedVisitorIds: ['visitor_other_999'],
      }),
    );
    await expect(page.locator('#maintenanceAllowedCount')).toHaveText('1 allowed');
    await page.locator('[data-maintenance-visitor="visitor_alpha_001"]').check();
    await page.locator('#grantMaintenanceAccess').click();
    await expect(page.locator('#toastStack')).toContainText('Access granted to 1 visitor');
    const cfg = (await docs(page, 'content/rud_maintenance_config'))[0];
    expect([...cfg.maintenanceAllowedVisitorIds].sort()).toEqual(['visitor_alpha_001', 'visitor_other_999']);
    await expect(page.locator('#maintenanceAllowedCount')).toHaveText('2 allowed');
    await page.locator('[data-maintenance-visitor="visitor_alpha_001"]').check();
    await page.locator('#removeMaintenanceAccess').click();
    await expect(page.locator('#maintenanceAllowedCount')).toHaveText('1 allowed');
    expect((await docs(page, 'content/rud_maintenance_config'))[0].maintenanceAllowedVisitorIds).toEqual(['visitor_other_999']);
  });

  test('Daily challenges: the 30-day library is planned once and publishes today without duplicates', async ({ page }) => {
    await adminSession(page);
    await nav(page, 'daily-challenges');
    await page.getByRole('tab', { name: '30-day library' }).click();
    const lib = page.locator('.rad-datatable');
    await expect(lib.locator('.rad-tablebar-count')).toHaveText('30 rows');
    await page.getByRole('tab', { name: 'Schedule & automation' }).click();
    await page.getByRole('button', { name: 'Plan the 30-day library' }).click();
    const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));
    await page.getByRole('alertdialog').getByLabel('Start date').fill(today);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Plan 30 days' }).click();
    await expect(page.locator('#toastStack')).toContainText('Planned 30 challenges');
    expect(await docs(page, 'deens_challenge_schedule/')).toHaveLength(30);
    // Planning the same start date again creates nothing new.
    await page.getByRole('button', { name: 'Plan the 30-day library' }).click();
    await page.getByRole('alertdialog').getByLabel('Start date').fill(today);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Plan 30 days' }).click();
    await expect(page.locator('#toastStack')).toContainText('already planned');
    expect(await docs(page, 'deens_challenge_schedule/')).toHaveLength(30);
    // Publish today's now (the scheduler does the same on its own), twice → one challenge.
    const publish = page.getByRole('button', { name: 'Publish today’s now' });
    await publish.click();
    await expect(page.locator('#toastStack')).toContainText('Published 1 challenge');
    await publish.click();
    await expect(page.locator('#toastStack')).toContainText('already published');
    const published = (await docs(page, 'deens_daily_challenges/sched_')).filter((d) => d.path.split('/').length === 2);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      challengeType: 'daily_deen',
      status: 'published',
      startDate: today,
      endDate: today,
      requiredDays: 1,
      audience: 'all',
      title: 'Begin with a sincere intention',
    });
    expect(published[0].instructions).toContain('(Sahih al-Bukhari 1; Sahih Muslim 1907)');
    expect(published[0].instructions).toContain('Complete each challenge sincerely for the sake of Allah');
    // Pausing an entry keeps it out of the upcoming list.
    const row = page.locator('.rad-datatable tbody tr').filter({ hasText: 'Reflect on Surah Al-‘Asr' });
    await row.getByRole('button', { name: 'Pause' }).click();
    await expect(row).toContainText('paused');
  });
});

test.describe('admin console · mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('drawer navigation, readable tables and no horizontal scroll on a phone', async ({ page }) => {
    await prepare(page);
    await openAdmin(page);
    const fit = await page.locator('#adminLoginView').evaluate((v) => ({ over: v.scrollHeight - v.clientHeight, wide: v.scrollWidth - v.clientWidth }));
    expect(fit.over).toBeLessThanOrEqual(0);
    expect(fit.wide).toBeLessThanOrEqual(0);
    await login(page);
    await expect(page.locator('#adminApp')).toHaveAttribute('data-auth', 'authorized');
    const sidebar = page.locator('#adminSidebar');
    await expect(sidebar).not.toBeInViewport();
    await page.locator('#adminMenuBtn').click();
    await expect(sidebar).toBeInViewport();
    await expect(page.locator('#adminMenuBtn')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('[data-admin-view="names"]').click();
    await expect(sidebar).not.toBeInViewport();
    await expect(page.locator('#managerBody tr')).toHaveCount(3);
    const overflow = await page.evaluate(() => {
      const m = document.getElementById('adminMain')!;
      return { doc: document.scrollingElement!.scrollWidth - window.innerWidth, main: m.scrollWidth - m.clientWidth };
    });
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.main).toBeLessThanOrEqual(0);
    // Escape closes the drawer.
    await page.locator('#adminMenuBtn').click();
    await page.keyboard.press('Escape');
    await expect(sidebar).not.toBeInViewport();
  });
});
