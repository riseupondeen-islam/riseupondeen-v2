import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { goto, prepare } from './helpers';

/* Desktop-engine checks of the single-element recitation engine. Recitation files are served by
   the test (a short WAV tone) because the real CDN is not used in tests. Real-device behaviour on
   iOS Safari / Android / installed PWAs still needs manual verification. */
const TONE = readFileSync(new URL('../fixtures/tone.wav', import.meta.url));

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

async function tap(page: Page, selector: string) {
  const el = page.locator(selector).first();
  await el.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await el.click();
}
const audioState = (page: Page) =>
  page.evaluate(() => {
    const a = document.getElementById('rudQuranAudio') as HTMLAudioElement | null;
    return {
      count: document.querySelectorAll('audio').length,
      file: (a?.getAttribute('src') || '').split('/').pop(),
      paused: a?.paused ?? null,
    };
  });

test('play, playlist advance, pause/resume, rapid switching — one audio element', async ({ page }) => {
  await prepare(page);
  await page.route(/everyayah\.com\/data\/.*\.mp3$/, (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: TONE }),
  );
  await goto(page, '#quran/1/1');
  await expect(page.locator('#rudAyahList > *')).toHaveCount(7);
  await tap(page, '[data-quran-play="2"]');
  await expect.poll(() => audioState(page)).toMatchObject({ count: 1, file: '001002.mp3', paused: false });
  await tap(page, '[data-quran-play-from-here]');
  await expect.poll(() => audioState(page).then((s) => s.file), { timeout: 5000 }).toBe('001003.mp3');
  await tap(page, '#rudQuranPlayerOverlay [data-quran-player-action="toggle"]');
  await expect.poll(() => audioState(page).then((s) => s.paused)).toBe(true);
  await tap(page, '#rudQuranPlayerOverlay [data-quran-player-action="toggle"]');
  await expect.poll(() => audioState(page).then((s) => s.paused)).toBe(false);
  await tap(page, '#rudQuranPlayerOverlay [data-quran-player-action="minimize"]');
  for (const n of [6, 4, 7]) await tap(page, `[data-quran-play="${n}"]`);
  await expect.poll(() => audioState(page)).toMatchObject({ count: 1, file: '001007.mp3' });
});

test('a failed recitation shows the retry state instead of failing silently', async ({ page }) => {
  await prepare(page);
  await page.route(/everyayah\.com\/data\/.*\.mp3$/, (route) => route.abort());
  await goto(page, '#quran/1/1');
  await tap(page, '[data-quran-play="2"]');
  await expect(page.locator('#rudQuranPlayerStatus [data-quran-player-action="retry"]').first()).toBeAttached();
});
