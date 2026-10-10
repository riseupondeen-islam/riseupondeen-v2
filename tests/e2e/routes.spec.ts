import { expect, test } from '@playwright/test';
import { goto, prepare, setHash, trackPageErrors } from './helpers';

/* Every public route renders its page without uncaught errors. */
const ROUTES: Array<[string, string]> = [
  ['#home', '.hero-title-simple'],
  ['#quran', '[data-quran-surah="114"]'],
  ['#prayer', '.rud-prayer-page'],
  ['#tasbih', '#rudTasbihTap'],
  ['#tracker', '#rudZakatTotal'],
  ['#sadaqah', '#rudSadaqahList'],
  ['#umrah', '#rudUmrahTimeline'],
  ['#my-deen', '#dynamicPage'],
  ['#duas', '#dynamicPage a[href="#dua/test-dua-1"]'],
  ['#hadith', '#dynamicPage a[href="#hadith/test-hadith-1"]'],
  ['#reminders', '#dynamicPage a[href="#reminder/test-reminder-1"]'],
  ['#names', '#dynamicPage'],
  ['#saved', '#dynamicPage'],
  ['#heart', '#dynamicPage'],
];

for (const [hash, selector] of ROUTES) {
  test(`route ${hash} renders`, async ({ page }) => {
    const errors = trackPageErrors(page);
    await prepare(page);
    await goto(page, hash);
    await expect(page.locator(selector).first()).toBeAttached();
    expect(errors).toEqual([]);
  });
}

test('navigating between routes does not multiply listeners or audio elements', async ({ page }) => {
  await prepare(page);
  await goto(page, '#home');
  const cycle = async () => {
    for (const [hash] of ROUTES) {
      await setHash(page, hash);
      await page.waitForTimeout(150);
    }
  };
  await cycle();
  const before = await page.evaluate(() => ({
    audio: document.querySelectorAll('audio').length,
    body: document.body.children.length,
    fs: (globalThis as unknown as { __FAKE_FB__?: { listeners: Set<unknown> } }).__FAKE_FB__?.listeners.size,
  }));
  await cycle();
  await cycle();
  const after = await page.evaluate(() => ({
    audio: document.querySelectorAll('audio').length,
    body: document.body.children.length,
    fs: (globalThis as unknown as { __FAKE_FB__?: { listeners: Set<unknown> } }).__FAKE_FB__?.listeners.size,
  }));
  expect(after).toEqual(before);
});
