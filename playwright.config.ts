// Browser tests of the dashboard in its preview modes (simulated bridge, no TV).
// The TV's web runtime is Chromium, so Chromium at TV resolutions is what we test.
// `pnpm test:e2e` builds first; the server below only serves build/app.
import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Fixed clock zone and locale: CI runners and developer machines render alike
    timezoneId: 'Europe/Berlin',
    locale: 'en-GB',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'tv-1080p',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: 'tv-720p',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: {
    command: `node build/node/tools/preview.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !CI,
  },
});
