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

test('the next Ayah is buffered while the current one plays, and lock-screen metadata is set', async ({ page }) => {
  await prepare(page);
  const requested: string[] = [];
  await page.route(/everyayah\.com\/data\/.*\.mp3$/, (route) => {
    requested.push(route.request().url().split('/').pop() || '');
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: TONE });
  });
  await goto(page, '#quran/1/3');
  await expect(page.locator('#rudAyahList > *')).toHaveCount(7);
  // Hold Ayah 3 (pause as soon as it starts) so the only way Ayah 4 can be requested is the preload.
  await page.evaluate(() => {
    document.addEventListener(
      'playing',
      (e) => (e.target as HTMLAudioElement).pause(),
      { capture: true, once: true },
    );
  });
  await tap(page, '[data-quran-play-from-here]');
  await expect.poll(() => requested.includes('001004.mp3'), { timeout: 5000 }).toBe(true);
  expect(await audioState(page)).toMatchObject({ count: 1, file: '001003.mp3', paused: true });
  const session = await page.evaluate(() => ({
    title: navigator.mediaSession?.metadata?.title || '',
    state: navigator.mediaSession?.playbackState || '',
  }));
  expect(session.title).toContain('Ayah 3');
  expect(session.state).toBe('paused');
  // Continuing advances to Ayah 4 on the same single element, and the lock-screen title follows.
  // (Reuse of the buffered file cannot be asserted here: request interception disables the browser
  // cache. It was measured separately against an un-intercepted local CDN.)
  await tap(page, '#rudQuranPlayerOverlay [data-quran-player-action="toggle"]');
  await expect.poll(() => audioState(page), { timeout: 5000 }).toMatchObject({ count: 1, file: '001004.mp3' });
  await expect.poll(() => page.evaluate(() => navigator.mediaSession?.metadata?.title || '')).toContain('Ayah 4');
});

test('a failed recitation shows the retry state instead of failing silently', async ({ page }) => {
  await prepare(page);
  await page.route(/everyayah\.com\/data\/.*\.mp3$/, (route) => route.abort());
  await goto(page, '#quran/1/1');
  await tap(page, '[data-quran-play="2"]');
  await expect(page.locator('#rudQuranPlayerStatus [data-quran-player-action="retry"]').first()).toBeAttached();
});

test('the lock-screen session stays "playing" across Ayah changes (no pause between files)', async ({ page }) => {
  await prepare(page);
  // Record every playbackState the page reports to the OS media session.
  await page.addInitScript(() => {
    const w = window as unknown as { __msStates: string[] };
    w.__msStates = [];
    const ms = navigator.mediaSession;
    if (!ms) return;
    let value = ms.playbackState;
    Object.defineProperty(ms, 'playbackState', {
      configurable: true,
      get: () => value,
      set: (v: MediaSessionPlaybackState) => {
        if (w.__msStates[w.__msStates.length - 1] !== v) w.__msStates.push(v);
        value = v;
      },
    });
  });
  await page.route(/everyayah\.com\/data\/.*\.mp3$/, async (route) => {
    await new Promise((r) => setTimeout(r, 150)); // a little network latency between files
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: TONE });
  });
  await goto(page, '#quran/1/2');
  await expect(page.locator('#rudAyahList > *')).toHaveCount(7);
  await tap(page, '[data-quran-play-from-here]');
  await expect.poll(() => audioState(page).then((s) => s.file), { timeout: 8000 }).toBe('001004.mp3');
  const states = await page.evaluate(() => (window as unknown as { __msStates: string[] }).__msStates);
  // Once playing, the session never flips to 'paused' while the playlist moves to the next Ayah.
  expect(states.slice(states.indexOf('playing'))).toEqual(['playing']);
  expect(await audioState(page)).toMatchObject({ count: 1 });
});

test('a dropped connection recovers by itself (one automatic reload, same element)', async ({ page }) => {
  await prepare(page);
  // Data Saver off-switches the next-Ayah preload, so the failing request is the playing element's own.
  await page.addInitScript(() => localStorage.setItem('rud_reading_preferences_v2', JSON.stringify({ dataSaver: true })));
  let failed = 0;
  await page.route(/everyayah\.com\/data\/.*\.mp3$/, (route) => {
    // The first request for Ayah 3 fails, as when a locked phone switches from Wi-Fi to mobile data.
    if (route.request().url().endsWith('001003.mp3') && failed++ === 0) return route.abort('internetdisconnected');
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: TONE });
  });
  await goto(page, '#quran/1/2');
  await expect(page.locator('#rudAyahList > *')).toHaveCount(7);
  await tap(page, '[data-quran-play-from-here]');
  // The playlist continues past the failed file to the end of the surah.
  await expect.poll(() => audioState(page).then((s) => s.file), { timeout: 8000 }).toBe('001007.mp3');
  expect(failed).toBeGreaterThanOrEqual(2); // the failed request, then the automatic reload
  expect(await audioState(page)).toMatchObject({ count: 1 });
  await expect(page.locator('#rudQuranPlayerStatus')).toBeHidden();
});

test('returning to the reciting surah keeps the playing Ayah (the playlist is not rewound)', async ({ page }) => {
  await prepare(page);
  await page.route(/everyayah\.com\/data\/.*\.mp3$/, (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: TONE }),
  );
  await goto(page, '#quran/1/5');
  await expect(page.locator('#rudAyahList > *')).toHaveCount(7);
  // Hold Ayah 5 as soon as it starts (as an interruption would), with the playlist still active.
  await page.evaluate(() =>
    document.addEventListener('playing', (e) => (e.target as HTMLAudioElement).pause(), { capture: true, once: true }),
  );
  await tap(page, '[data-quran-play-from-here]');
  await expect.poll(() => audioState(page)).toMatchObject({ file: '001005.mp3', paused: true });
  await tap(page, '#rudQuranPlayerOverlay [data-quran-player-action="minimize"]');
  // Leave the Qur'an and come back through an older address that points at Ayah 2.
  await page.evaluate(() => (location.hash = '#home'));
  await page.waitForTimeout(300);
  await page.evaluate(() => (location.hash = '#quran/1/2'));
  await expect(page.locator('#rudAyahList > *')).toHaveCount(7);
  await expect(page.locator('#rudQuranMiniPlayer [data-quran-ui="ayah"]')).toHaveText('Ayah 5 of 7');
  await tap(page, '#rudQuranMiniPlayer [data-quran-player-action="toggle"]');
  await expect.poll(() => audioState(page).then((s) => s.file), { timeout: 5000 }).toBe('001006.mp3');
  expect(await audioState(page)).toMatchObject({ count: 1 });
});
