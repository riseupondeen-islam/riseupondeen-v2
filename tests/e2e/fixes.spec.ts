import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { goto, prepare, setHash } from './helpers';

/* Regression tests for the targeted V2 fixes (99 Names, Nearby Masjids, Qur'an mini player,
   Tasbih stability, maintenance background, layout stability). */
const TONE = readFileSync(new URL('../fixtures/tone.wav', import.meta.url));

function serverWrite(page: Page, path: string, data: unknown) {
  return page.evaluate(
    ([p, d]) =>
      (
        globalThis as unknown as { __FAKE_FB__: { serverWrite: (p: string, d: unknown) => void } }
      ).__FAKE_FB__.serverWrite(p as string, d),
    [path, data] as const,
  );
}

const nameDoc = (number: number, title: string, arabic: string) => ({
  type: 'name',
  published: true,
  number,
  title,
  arabic,
  meaning: `${title} meaning`,
  createdAt: { __ts: Date.now() - number * 1000 },
  updatedAt: { __ts: Date.now() },
});

test('99 Names: shown 1 → 99 by number, duplicates skipped, long Arabic never overflows', async ({ page }) => {
  await prepare(page, { cachedContent: false });
  // Extra published names (out of order, plus a duplicate number) added to the Firestore seed.
  await page.addInitScript(
    ([a, b]) => {
      const seed = (window as unknown as { __FAKE_FB_SEED__: { collections: Record<string, Record<string, unknown>> } })
        .__FAKE_FB_SEED__;
      seed.collections.content['test-name-99'] = a;
      seed.collections.content['test-name-2-duplicate'] = b;
    },
    [
      nameDoc(99, 'TEST-Name-NinetyNine', 'ذُو الْجَلَالِ وَالْإِكْرَامِ مَالِكُ الْمُلْكِ'),
      nameDoc(2, 'TEST-Name-Two-Duplicate', 'الاسم المكرر'),
    ] as const,
  );
  await goto(page, '#names');
  const kickers = page.locator('#routeGrid .name-library-kicker');
  await expect(kickers).toHaveCount(4);
  await expect(kickers).toHaveText(['01 · NAME', '02 · NAME', '03 · NAME', '99 · NAME']);
  await expect(page.locator('#routeGrid')).not.toContainText('Duplicate');
  const overflow = await page
    .locator('#routeGrid .name-library-card')
    .last()
    .evaluate((card) => {
      const ar = card.querySelector('.name-library-arabic') as HTMLElement;
      return {
        arabic: ar.scrollWidth - ar.clientWidth,
        card: card.scrollWidth - card.clientWidth,
        dir: getComputedStyle(ar).direction,
      };
    });
  expect(overflow.arabic).toBeLessThanOrEqual(1);
  expect(overflow.card).toBeLessThanOrEqual(1);
  expect(overflow.dir).toBe('rtl');
});

const OVERPASS = {
  elements: [
    { type: 'node', id: 2, lat: 12.9725, lon: 77.5951, tags: { name: 'Far Masjid' } },
    { type: 'node', id: 1, lat: 12.9717, lon: 77.5947, tags: { name: 'Masjid Al-Noor', 'addr:street': 'Test Road' } },
    { type: 'way', id: 3, center: { lat: 12.975, lon: 77.6 }, tags: { 'name:en': 'Jamia Masjid' } },
  ],
};

test('Nearby Masjids opens the in-app finder (nearest first, directions), not a redirect', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 12.9716, longitude: 77.5946 });
  await prepare(page);
  await page.route(/overpass/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OVERPASS) }),
  );
  await goto(page, '#prayer');
  const startUrl = page.url();
  await page.locator('#rudNearbyMasjidBtn').click();
  const overlay = page.locator('#rudRiseMapOverlay.open');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.rud-masjid-item strong')).toHaveText(['Masjid Al-Noor', 'Far Masjid', 'Jamia Masjid']);
  await expect(overlay.locator('.rud-masjid-item').first()).toContainText('Test Road');
  expect(page.url()).toBe(startUrl);
  await page.evaluate(() => {
    (window as unknown as { open: (u: string) => unknown }).open = (u: string) => {
      (window as unknown as { __opened: string }).__opened = u;
      return {};
    };
  });
  await overlay.locator('.rud-masjid-item').first().getByRole('button', { name: 'Directions' }).click();
  expect(await page.evaluate(() => (window as unknown as { __opened: string }).__opened)).toMatch(/maps.*12\.9717/);
  expect(page.url()).toBe(startUrl);
  await overlay.getByRole('button', { name: 'Close nearby masjids' }).click();
  await expect(page.locator('#rudRiseMapOverlay')).toHaveCount(0);
});

test('Nearby Masjids explains what to do when location is denied', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) => fail({ code: 1, PERMISSION_DENIED: 1 }),
        watchPosition: (_ok: unknown, fail: (e: unknown) => void) => (fail({ code: 1, PERMISSION_DENIED: 1 }), 1),
        clearWatch: () => undefined,
      },
    });
  });
  await goto(page, '#prayer');
  await page.locator('#rudNearbyMasjidBtn').click();
  await expect(page.locator('#rudRiseMapOverlay')).toContainText('Location access is off');
  await expect(page.locator('#rudRiseMapOverlay').getByRole('button', { name: 'Open map search' })).toBeVisible();
  await expect(page.locator('.rud-prayer-page')).toBeVisible();
});

test('Qur’an mini player minimizes and restores without touching playback', async ({ page }) => {
  await prepare(page);
  await page.route(/everyayah\.com\/data\/.*\.mp3$/, (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: TONE }),
  );
  await goto(page, '#quran/1/1');
  await page
    .locator('[data-quran-play="2"]')
    .first()
    .evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await page.locator('[data-quran-play="2"]').first().click();
  const mini = page.locator('#rudQuranMiniPlayer');
  await expect(mini).toBeVisible();
  const before = await page.evaluate(() => {
    const a = document.getElementById('rudQuranAudio') as HTMLAudioElement;
    return { src: a.getAttribute('src'), paused: a.paused };
  });
  await mini.getByRole('button', { name: 'Minimize player' }).click();
  await expect(mini).toHaveClass(/is-collapsed/);
  const box = await mini.boundingBox();
  expect(box!.width).toBeLessThan(140);
  await expect(mini.getByRole('button', { name: 'Restore player' })).toBeVisible();
  const during = await page.evaluate(() => {
    const a = document.getElementById('rudQuranAudio') as HTMLAudioElement;
    return { src: a.getAttribute('src'), paused: a.paused };
  });
  expect(during).toEqual(before);
  // The state survives navigation.
  await setHash(page, '#home');
  await page.waitForTimeout(300);
  await expect(mini).toHaveClass(/is-collapsed/);
  await mini.getByRole('button', { name: 'Restore player' }).click();
  await expect(mini).not.toHaveClass(/is-collapsed/);
  await expect(mini.locator('.rud-quran-mini-main')).toBeVisible();
});

test('Tasbih: touches that drift on the counter do not scroll the page', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'touch emulation');
  await prepare(page, { theme: 'dark' });
  await goto(page, '#tasbih');
  const tap = page.locator('#rudTasbihTap');
  const box = (await tap.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const startTop = box.y;
  for (let i = 0; i < 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 14 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await tap.boundingBox())!.y).toBeCloseTo(startTop, 0);
  await expect(page.locator('#rudTasbihCount')).toHaveText('12');
});

test('maintenance page shows the Makkah scene behind the card', async ({ page }) => {
  await prepare(page, { theme: 'dark' });
  await goto(page, '#home');
  await serverWrite(page, 'content/rud_maintenance_config', {
    type: 'site',
    siteKey: 'maintenance',
    published: true,
    maintenanceEnabled: true,
    maintenanceEndTime: { __ts: Date.now() + 3600000 },
  });
  const scene = page.locator('#rudMaintenanceApp > .rud-maintenance-mecca');
  await expect(scene).toBeVisible();
  const kaaba = await page.locator('#rudMaintenanceApp .gmb-kaaba').boundingBox();
  expect(kaaba && kaaba.width).toBeGreaterThan(20);
  await expect(page.locator('#rudMaintenanceApp .rud-maintenance-card')).toBeVisible();
});

test('route changes cause no layout shift (Prayer status reserved)', async ({ page }) => {
  page.on('console', (m) => m.text().startsWith('layout-shift') && console.log(m.text()));
  await prepare(page);
  await goto(page, '#home');
  await page.evaluate(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{ value: number; sources: Array<{ node?: Element }> }>) {
        w.__cls += e.value;
        console.log(
          'layout-shift',
          location.hash,
          e.value.toFixed(4),
          e.sources.map((s) => (s.node as Element)?.className || s.node?.nodeName).join(' | '),
        );
      }
    }).observe({ type: 'layout-shift' });
  });
  for (const h of ['#prayer', '#quran', '#tasbih', '#names', '#deen-friends', '#duas', '#home']) {
    await setHash(page, h);
    await page.waitForTimeout(700);
  }
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.01);
});
