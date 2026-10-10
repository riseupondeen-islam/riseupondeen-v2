import { expect, test } from '@playwright/test';
import { goto, prepare, setHash, trackPageErrors } from './helpers';

test.beforeEach(async ({ page }) => {
  await prepare(page);
});

test('Names of Allah: card opens the details dialog; Escape closes it and returns focus', async ({ page }) => {
  await goto(page, '#home');
  const card = page.locator('#namesGrid .name-card').first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  const modal = page.locator('#nameModal');
  await expect(modal).toHaveClass(/\bopen\b/);
  await expect(page.locator('#modalTitle')).toHaveText('TEST-Name-One');
  await expect(page.locator('#modalReflection')).toHaveText('TEST name reflection one');
  await expect(page.locator('#modalClose')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/\bopen\b/);
  await expect(card).toBeFocused();
});

test('Names of Allah: missing reflection uses the fallback copy', async ({ page }) => {
  await goto(page, '#home');
  await page.locator('#namesGrid .name-card').nth(2).click();
  await expect(page.locator('#modalReflection')).toHaveText('A reflection for this Name will be added here.');
  await page.locator('#modalClose').click();
  await expect(page.locator('#nameModal')).toHaveAttribute('aria-hidden', 'true');
});

test('Zakat calculator', async ({ page }) => {
  await goto(page, '#tracker');
  await expect(page.locator('#rudZakatStatus')).toHaveText('Enter the current Nisab value');
  await page.locator('#rudZakatCash').fill('100000');
  await page.locator('#rudZakatGold').fill('25000');
  await page.locator('#rudZakatLiabilities').fill('5000');
  await page.locator('#rudZakatNisab').fill('50000');
  await expect(page.locator('#rudZakatTotal')).toHaveText('₹1,20,000.00');
  await expect(page.locator('#rudZakatDue')).toHaveText('₹3,000.00');
  await expect(page.locator('#rudZakatStatus')).toHaveText('Nisab reached');
  await page.locator('#rudZakatNisab').fill('500000');
  await expect(page.locator('#rudZakatStatus')).toHaveText('Below the entered Nisab');
  await expect(page.locator('#rudZakatDue')).toHaveText('₹0.00');
});

test('Hajj & Umrah: journey mode steps, remembers progress, exits', async ({ page }) => {
  await goto(page, '#umrah');
  await page.locator('[data-rud-guide-start="umrah"]').click();
  const steps = page.locator('#rudUmrahTimeline .rud-guide-step');
  await expect(steps).toHaveCount(6);
  await expect(page.locator('.rud-guide-journey-controls strong')).toHaveText('Umrah · Step 1 / 6');
  await expect(page.locator('[data-rud-guide-nav="umrah:-1"]')).toBeDisabled();
  await page.locator('[data-rud-guide-nav="umrah:1"]').click();
  await expect(page.locator('.rud-guide-journey-controls strong')).toHaveText('Umrah · Step 2 / 6');
  expect(await page.evaluate(() => localStorage.getItem('rud_umrah_journey_v2'))).toBe('1');
  await page.locator('[data-rud-guide-exit="umrah"]').click();
  await expect(page.locator('.rud-guide-journey-controls')).toHaveCount(0);
  await expect(page.locator('#rudUmrahTimeline [hidden]')).toHaveCount(0);
  await page.locator('[data-rud-guide-start="umrah"]').click();
  await expect(page.locator('.rud-guide-journey-controls strong')).toHaveText('Umrah · Step 2 / 6');
});

test('Sadaqah lists active requests', async ({ page }) => {
  await goto(page, '#sadaqah');
  await expect(page.locator('.rud-sadaqah-card h3')).toHaveText(['TEST Family Request']);
  await expect(page.locator('[data-copy-upi]')).toHaveAttribute('data-copy-upi', 'test@upi');
});

test('Theme toggle switches and persists the theme', async ({ page }) => {
  await goto(page, '#home');
  const toggle = page.locator('#rudThemeToggle');
  await expect(toggle).toHaveAttribute('aria-label', 'Switch to Dark Mode');
  await toggle.click();
  await expect(page.locator('html')).not.toHaveClass(/light-mode/);
  await expect(toggle).toHaveAttribute('aria-label', 'Switch to Light Mode');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
});

test('Duas: open, save, appears in Saved; Back lane on detail', async ({ page }) => {
  await goto(page, '#duas');
  await expect(page.locator('#rudLibraryClose')).toBeVisible();
  await page.locator('#dynamicPage a[href="#dua/test-dua-1"]').first().click();
  await expect(page).toHaveTitle('TEST Dua One | Rise Upon Deen');
  await expect(page.locator('#rudBackLane')).toHaveClass(/rud-visible/);
  await page.locator('#dynamicPage [data-save]').first().click();
  await setHash(page, '#saved');
  await expect(page.locator('#dynamicPage')).toContainText('TEST Dua One');
});

test("Qur'an: open a surah, save an ayah, it appears in Saved", async ({ page }) => {
  const errors = trackPageErrors(page);
  await goto(page, '#quran');
  await page.locator('[data-quran-surah="1"]').click();
  await expect(page.locator('#rudAyahList > *')).toHaveCount(7);
  const menu = page.locator('[data-quran-ayah-menu="2"]');
  await menu.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await menu.click();
  await page.locator('[data-quran-ayah-action="save"]').click();
  await setHash(page, '#saved');
  await expect(page.locator('#dynamicPage')).toContainText("Qur'an Bookmarks");
  await expect(page.locator('#dynamicPage')).toContainText('Al-Faatiha · Ayah 2');
  expect(errors).toEqual([]);
});

test("Qur'an deep link opens the requested ayah", async ({ page }) => {
  await goto(page, '#quran/2/255');
  await expect(page.locator('#rudAyahList > *')).toHaveCount(286);
  await expect(page.locator('.rud-quran-page')).toHaveClass(/reading/);
});

test('Tasbih counts, persists and resets', async ({ page }) => {
  await goto(page, '#tasbih');
  for (let i = 0; i < 3; i++) await page.locator('#rudTasbihTap').click();
  await expect(page.locator('#rudTasbihCount')).toHaveText('3');
  expect(await page.evaluate(() => localStorage.getItem('rud_tasbih_count_v1'))).toBe('3');
  await page.locator('#rudTasbihReset').click();
  await expect(page.locator('#rudTasbihCount')).toHaveText('0');
});

test('Ask Rise answers from published content', async ({ page }) => {
  await goto(page, '#home');
  await page.locator('#heroMoodSearch').click();
  await expect(page.locator('#searchOverlay')).toHaveClass(/\bopen\b/);
  await page.locator('#askRiseInput').fill('patience');
  await page.locator('#askRiseInput').press('Enter');
  await expect(page.locator('#askRiseChat')).toContainText('TEST Dua One');
  await page.locator('#searchClose').click();
  await expect(page.locator('#searchOverlay')).not.toHaveClass(/\bopen\b/);
});

test('Explore drawer navigates', async ({ page }) => {
  await goto(page, '#home');
  await page.locator('#rudExploreBtn').click();
  await expect(page.locator('#rudExploreDrawer')).toHaveClass(/\bopen\b/);
  await page.locator('#rudExploreDrawer [data-rud-explore-route="duas"]').first().click();
  await expect(page).toHaveURL(/#duas$/);
});
