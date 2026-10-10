import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a production build made with `--mode e2e`, in which the Firebase
 * SDK is replaced by the in-memory test double (tests/fake-firebase). They therefore never touch
 * the live riseupondeen project. Set E2E_BASE_URL to test an already running server instead.
 */
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4174';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build:e2e && npm run preview:e2e',
        url: baseURL,
        timeout: 180_000,
        reuseExistingServer: true,
      },
});
