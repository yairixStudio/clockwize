// End-to-end tests for Clockwize.
//
// Prerequisite: a built client. The e2e server serves client/dist from the same origin as the API,
// so run `cd client && npm run build` before `npm run test:e2e` (CI builds it first).
//
// The server is started by e2e/start-server.mjs on 127.0.0.1:4317 with every data path pointed at a
// throwaway temp dir - it never touches server/clockwize.db, uploads, backups or the session files.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4317;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  // Locally a failure is a failure (makes flakiness visible); CI retries once and reports it as flaky
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.js$/
    },
    {
      // Chromium-based phone profile (CI installs chromium only)
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile\.spec\.js$/
    }
  ],

  webServer: {
    command: 'node e2e/start-server.mjs',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    env: { E2E_PORT: String(PORT) }
  }
});
