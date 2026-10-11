import { expect, test, type Page } from '@playwright/test';
import { goto, prepare, trackPageErrors } from './helpers';

/* Poster export (V3.4): one export system, nothing truncated, multi-page with page numbers.
 * Desktop Chromium has no Web Share for files, so the download path (PNG / PDF) is exercised. */

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const PARA =
  'TEST paragraph: remember Allah often, be patient in hardship and grateful in ease, keep the prayer on time, speak kindly, and help the people around you whenever you are able.';
const LONG_BODY = Array.from({ length: 14 }, (_, i) => `${i + 1}. ${PARA}`).join('\n\n');
const ARABIC_LONG = Array.from({ length: 10 }, () => 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ').join(' ');

const EXTRA = [
  { id: 'test-poster-short', type: 'dua', title: 'TEST Short Dua', arabic: 'رَبِّ زِدْنِي عِلْمًا', meaning: 'TEST: My Lord, increase me in knowledge.', reference: 'TEST Qur’an 20:114' },
  { id: 'test-poster-long', type: 'reminder', title: 'TEST A Very Long Reminder For The Poster Export That Wraps Over Several Lines Of The Title', content: LONG_BODY, reference: 'TEST long reference '.repeat(8).trim() },
  { id: 'test-poster-arabic', type: 'dua', title: 'TEST Long Arabic Dua', arabic: ARABIC_LONG, transliteration: 'Rabbana atina fid-dunya hasanatan wa fil-akhirati hasanatan wa qina adhaban-nar', meaning: 'TEST: Our Lord, give us good in this world and good in the Hereafter, and protect us from the Fire.', reference: 'TEST Qur’an 2:201' },
];

async function open(page: Page, id: string, type: string) {
  await prepare(page);
  await page.addInitScript((extra) => {
    // Published content comes from Firestore (the test double): add the poster samples there.
    const seed = (window as unknown as { __FAKE_FB_SEED__: { collections: { content: Record<string, unknown> } } }).__FAKE_FB_SEED__;
    const ts = { __ts: 1767225600000 };
    for (const { id, ...rest } of extra)
      seed.collections.content[id] = { published: true, featured: false, category: 'General', keywords: 'test', author: 'Rise Upon Deen', createdAt: ts, updatedAt: ts, ...rest };
  }, EXTRA);
  await goto(page, `#${type}/${id}`);
}

async function exportPoster(page: Page) {
  const download = page.waitForEvent('download');
  await page.locator('[data-download]').first().click();
  const d = await download;
  await d.saveAs(`test-results/posters/${d.suggestedFilename()}`);
  const buf = Buffer.from(await (await d.createReadStream()).toArray().then((c) => Buffer.concat(c)));
  const last = await page.evaluate(() => (window as unknown as { __RUD_POSTER_LAST: { pages: number; scale: number; text: string[][]; maxY: number } }).__RUD_POSTER_LAST);
  return { name: d.suggestedFilename(), buf, last };
}

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

test('short content: one premium PNG page at a larger size', async ({ page }) => {
  const errors = trackPageErrors(page);
  await open(page, 'test-poster-short', 'dua');
  const { name, buf, last } = await exportPoster(page);
  expect(name).toBe('TEST-Short-Dua-rise-upon-deen.png');
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([1080, 1350]);
  expect(last.pages).toBe(1);
  expect(last.scale).toBeGreaterThan(1);
  expect(last.text.flat().join(' ')).toContain('رَبِّ زِدْنِي عِلْمًا');
  expect(errors).toEqual([]);
});

test('long English content: every word kept, split across numbered pages, saved as one PDF', async ({ page }) => {
  await open(page, 'test-poster-long', 'reminder');
  const { name, buf, last } = await exportPoster(page);
  expect(name).toMatch(/\.pdf$/);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(last.pages).toBeGreaterThan(2);
  expect((buf.toString('latin1').match(/\/Type \/Page /g) || []).length).toBe(last.pages);
  const out = words(last.text.flat().join(' '));
  const item = EXTRA[1];
  expect(out).toEqual([...words(item.title), ...words(item.content as string), ...words(item.reference as string)]);
  expect(last.maxY).toBeLessThanOrEqual(1170); // nothing runs into the footer
});

test('long Arabic content: RTL text complete (no truncation) across pages', async ({ page }) => {
  await open(page, 'test-poster-arabic', 'dua');
  const { last } = await exportPoster(page);
  const all = last.text.flat().join(' ');
  expect(words(all).filter((w) => /[؀-ۿ]/.test(w))).toEqual(words(ARABIC_LONG));
  expect(all).toContain('protect us from the Fire.');
  expect(last.maxY).toBeLessThanOrEqual(1170);
});
