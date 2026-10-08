// End-to-end tests for the macOS desktop app (Electron). Run from the repo root:
//   npx playwright test -c desktop/playwright.config.mjs
// Needs a built client (client/dist) and `npm ci` in desktop/.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: { trace: 'retain-on-failure' }
});
