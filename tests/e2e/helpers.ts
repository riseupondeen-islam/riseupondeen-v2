import type { Page } from '@playwright/test';
import { publicCacheSnapshot } from '../fixtures/publicContent';
import { firebaseSeed } from '../fixtures/firebaseSeed';

export interface PrepareOptions {
  theme?: 'light' | 'dark';
  /** Seed the offline content cache (what a returning visitor has). */
  cachedContent?: boolean;
  /** Skip the once-per-session intro and the first-visit name prompt. */
  returningVisitor?: boolean;
}

/** Runs before any page script: seeds the Firebase test double and local storage. */
export async function prepare(
  page: Page,
  { theme = 'light', cachedContent = true, returningVisitor = true }: PrepareOptions = {},
) {
  const snapshot = cachedContent ? publicCacheSnapshot() : null;
  // Tests are hermetic: only the app's own origin is reachable (fonts, prayer/Qur'an APIs and
  // recitation CDNs are blocked unless a test routes them itself, after calling prepare()).
  await page.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === 'localhost' || hostname === '127.0.0.1' ? route.fallback() : route.abort();
  });
  await page.addInitScript(
    ([seed, snap, t, returning]) => {
      (window as unknown as { __FAKE_FB_SEED__: unknown }).__FAKE_FB_SEED__ = seed;
      try {
        if (sessionStorage.getItem('__e2e_seeded')) return;
        sessionStorage.setItem('__e2e_seeded', '1');
        localStorage.setItem('theme', t as string);
        if (returning) {
          localStorage.setItem('rud_visitor_name', 'Tester');
          localStorage.setItem('rud_visitor_id', 'v_e2e_test');
          sessionStorage.setItem('rud_intro_seen_session_v1', '1');
          // V3: returning visitors have already seen the first-run App Guide offer (page guides off in tests).
          localStorage.setItem('rud_onboarding_v1', JSON.stringify({ firstRunDone: true, firstRunVersion: 1, pageToursOff: true }));
        }
        if (snap) localStorage.setItem('rud_public_firestore_v2', snap as string);
      } catch {
        /* storage unavailable */
      }
    },
    [firebaseSeed(), snapshot, theme, returningVisitor] as const,
  );
}

/** Collects uncaught page errors so a test can assert there were none. */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export async function goto(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  // The feature controllers attach after React's first commit; wait for the router.
  await page.waitForFunction(
    () => typeof (window as unknown as { rudRenderQuran?: unknown }).rudRenderQuran === 'function',
  );
  // Let the published-content refresh (cache first, then Firestore) settle before interacting.
  // (The admin route never starts the public content sync, so this wait is capped.)
  await page.evaluate(() =>
    Promise.race([
      (window as unknown as { RUD_whenPublicReady?: () => Promise<unknown> }).RUD_whenPublicReady?.(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]),
  );
  await page.waitForTimeout(500);
}

export async function setHash(page: Page, hash: string) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
}

/** Firestore operations recorded by the test double since the page loaded. */
export async function firestoreLog(
  page: Page,
): Promise<Array<{ op: string; path: string; data?: Record<string, unknown> }>> {
  return page.evaluate(() => ((globalThis as unknown as { __FAKE_FB__?: { log: [] } }).__FAKE_FB__?.log ?? []).slice());
}
