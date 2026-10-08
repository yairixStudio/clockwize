// Launches the real desktop app against a throwaway data directory and checks the things
// that broke before: a visible Dock icon, a window that loads the app, and close != quit.
import { test, expect, _electron as electron } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const DESKTOP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(DESKTOP_DIR, 'package.json'));
const PORT = 4391;
const WIDGET_PORT = 47398;
const WIDGET_SECRET = crypto.randomBytes(16).toString('hex');

test.skip(process.platform !== 'darwin', 'the desktop app is macOS only');

let app;
let tmp;

test.beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clockwize-desktop-e2e-'));
  app = await electron.launch({
    executablePath: require('electron'),
    args: [DESKTOP_DIR],
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      ENCRYPTION_SECRET: crypto.randomBytes(32).toString('hex'),
      // Never load server/.env or touch the real data
      DOTENV_CONFIG_PATH: path.join(tmp, 'no.env'),
      CLOCKWIZE_DB_PATH: path.join(tmp, 'clockwize.db'),
      CLOCKWIZE_UPLOADS_DIR: path.join(tmp, 'uploads'),
      CLOCKWIZE_BACKUP_DIR: path.join(tmp, 'backups'),
      CLOCKWIZE_PORT_FILE: path.join(tmp, '.server-port'),
      CLOCKWIZE_SESSION_FILE: path.join(tmp, '.local-session'),
      CLOCKWIZE_WIDGET_PORT: String(WIDGET_PORT),
      CLOCKWIZE_WIDGET_SECRET: WIDGET_SECRET,
      // Don't flash windows on the developer's screen while the suite runs
      CLOCKWIZE_E2E_INVISIBLE: '1'
    }
  });
});

test.afterEach(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

// The popover window is created at the same time, so pick the window showing the app
const mainWindow = async () => {
  const appWindow = () => app.windows().find((w) => w.url().includes(`localhost:${PORT}`));
  await expect.poll(() => Boolean(appWindow())).toBe(true);
  return appWindow();
};

test('shows a Dock icon and loads the app in its window', async () => {
  const window = await mainWindow();
  await expect(window.getByRole('button', { name: 'התחבר', exact: true })).toBeVisible();

  const state = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
    dockVisible: electronApp.dock ? electronApp.dock.isVisible() : true,
    windows: BrowserWindow.getAllWindows().length
  }));
  expect(state.dockVisible).toBe(true);
  // main window + the (hidden) menu-bar popover
  expect(state.windows).toBe(2);

  // The page knows it runs in the desktop app (hidden title bar layout)
  await expect(window.locator('html')).toHaveClass(/is-desktop/);
});

test('opening the menu-bar popover keeps the Dock icon', async () => {
  await mainWindow();
  const dockVisible = await app.evaluate(async ({ app: electronApp, BrowserWindow }) => {
    const popover = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('popover.html'));
    popover.show();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const visible = electronApp.dock.isVisible();
    popover.hide();
    return visible;
  });
  expect(dockVisible).toBe(true);
});

test('closing the window keeps the app running and the Dock icon brings it back', async () => {
  const window = await mainWindow();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('popover.html')).close();
  });
  const hidden = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((w) => w.isVisible() && !w.webContents.getURL().endsWith('popover.html')).length);
  expect(hidden).toBe(0);

  // What a click on the Dock icon does
  await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.isVisible() && !w.webContents.getURL().endsWith('popover.html')))).toBe(true);
  await expect(window.getByRole('button', { name: 'התחבר', exact: true })).toBeVisible();
});

test('the API server runs inside the app on the chosen data directory', async () => {
  await mainWindow();
  const health = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.json());
  expect(health.status).toBe('ok');
  expect(fs.existsSync(path.join(tmp, 'clockwize.db'))).toBe(true);
});

test('the widget feed answers only with the per-install secret', async () => {
  await mainWindow();
  const feed = `http://127.0.0.1:${WIDGET_PORT}`;
  expect((await fetch(`${feed}/widget-state`)).status).toBe(403);
  expect((await fetch(`${feed}/widget-state`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(403);

  const res = await fetch(`${feed}/widget-state`, { headers: { Authorization: `Bearer ${WIDGET_SECRET}` } });
  expect(res.status).toBe(200);
  const state = await res.json();
  expect(state).toMatchObject({ version: 1, api: null, signedIn: false, timer: null });

  const action = await fetch(`${feed}/widget-action`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WIDGET_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'nonsense' })
  });
  expect(action.status).toBe(400);
});
