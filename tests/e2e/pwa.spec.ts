import { expect, test } from '@playwright/test';
import { goto, prepare, setHash } from './helpers';

test.use({ serviceWorkers: 'allow' });

test('works offline after the first visit (app shell, code chunks and Qur’an text are precached)', async ({
  page,
  context,
}) => {
  await prepare(page);
  await goto(page, '#home');
  await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 })
    .catch(() => undefined);
  await page.reload();
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('rud-v2-assets-')), null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(2000);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.hero-title-simple')).toBeVisible();
  await setHash(page, '#quran/1/1');
  await expect(page.locator('#rudAyahList > *')).toHaveCount(7);
  await context.setOffline(false);
});

test('manifest and icons are served', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).name).toBe('Rise Upon Deen V2');
  for (const icon of ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'])
    expect((await request.get(icon)).ok()).toBeTruthy();
});
