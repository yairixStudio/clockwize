// Shared helpers for the Clockwize e2e specs.
// Every test creates its own user (unique email), so specs are independent and can run in parallel.
import { expect } from '@playwright/test';

export const PASSWORD = 'E2e-Passw0rd!';

let seq = 0;
export const uniqueId = (prefix = 'e2e') =>
  `${prefix}-${Date.now().toString(36)}-${process.pid}-${++seq}-${Math.random().toString(36).slice(2, 7)}`;
export const uniqueEmail = (prefix = 'user') => `${uniqueId(prefix)}@e2e.test`;
export const uniqueName = (prefix) => `${prefix} ${uniqueId('n').slice(-10)}`;

// ---------- API seeding ----------

// Registers a user through the API and returns its session (token + personal workspace)
export async function registerUser(request, overrides = {}) {
  const body = {
    name: uniqueName('בודק'),
    email: uniqueEmail(),
    password: PASSWORD,
    ...overrides
  };
  const res = await request.post('/api/auth/register', { data: body });
  expect(res.status(), `register failed: ${await res.text()}`).toBe(201);
  const json = await res.json();
  return { ...body, token: json.token, user: json.user, workspaceId: json.currentWorkspace.id };
}

// Logs in through the API (used for the seeded admin user)
export async function loginUser(request, email, password) {
  const res = await request.post('/api/auth/login', { data: { email, password } });
  expect(res.status(), `login failed: ${await res.text()}`).toBe(200);
  const json = await res.json();
  return { email, password, name: json.user.name, token: json.token, user: json.user, workspaceId: json.currentWorkspace?.id ?? null };
}

// Small authenticated JSON client bound to a session
export function apiAs(request, session) {
  const headers = { Authorization: `Bearer ${session.token}` };
  if (session.workspaceId) headers['X-Workspace-Id'] = session.workspaceId;
  const call = async (method, url, data) => {
    const res = await request.fetch(url, { method, headers, data });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} ${url} -> ${res.status()} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  return {
    get: (url) => call('GET', url),
    post: (url, data) => call('POST', url, data),
    put: (url, data) => call('PUT', url, data),
    delete: (url) => call('DELETE', url)
  };
}

export const seedClient = (api, data = {}) =>
  api.post('/api/clients', { name: uniqueName('לקוח'), status: 'active', ...data });

export const seedProject = (api, clientId, data = {}) =>
  api.post('/api/projects', { client_id: clientId, name: uniqueName('פרויקט'), ...data });

export const seedTask = (api, projectId, data = {}) =>
  api.post('/api/tasks', { project_id: projectId, name: uniqueName('משימה'), ...data });

// ---------- Browser session ----------

// Puts an API session into the app's localStorage (from the /login page, without reloading).
// Done once - not via an init script - so that logging out inside a test really logs out.
export async function setBrowserSession(page, session) {
  await page.goto('/login');
  await page.evaluate(({ token, workspaceId }) => {
    localStorage.setItem('token', token);
    if (workspaceId) localStorage.setItem('currentWorkspaceId', workspaceId);
  }, { token: session.token, workspaceId: session.workspaceId });
}

// setBrowserSession + open `path` as the logged-in user
export async function loginInBrowser(page, session, path = '/') {
  await setBrowserSession(page, session);
  await page.goto(path);
}

// ---------- UI helpers ----------

// The app's form labels are tied to their controls (<label htmlFor> + id), so look fields up with
// Playwright's getByLabel, scoped to the form or modal: modal.getByLabel('שם לקוח *', { exact: true }).
// field() is kept for older specs; it matches the label text as a substring like it used to.
export function field(scope, labelText) {
  return scope.getByLabel(labelText).first();
}

// Form modals (ClientModal / ProjectModal / TaskModal / stop-timer) have no role="dialog";
// identify them by their title
export function modal(page, title) {
  return page
    .locator('.modal')
    .filter({ has: page.locator('.modal-title', { hasText: title }) });
}

// The app's alert/confirm dialog (components/Modal/CustomModal.jsx)
export function appDialog(page) {
  return page.locator('.custom-modal');
}

// Waits for a success/info alert with `message` and closes it with its "אישור" button
export async function acknowledge(page, message) {
  const dialog = appDialog(page);
  await expect(dialog).toBeVisible();
  if (message) await expect(dialog.locator('.custom-modal__message')).toContainText(message);
  await dialog.getByRole('button', { name: 'אישור', exact: true }).click();
  await expect(dialog).toBeHidden();
}

// Answers a confirm dialog by clicking `confirmText`
export async function confirmDialog(page, confirmText, message) {
  const dialog = appDialog(page);
  await expect(dialog).toBeVisible();
  if (message) await expect(dialog.locator('.custom-modal__message')).toContainText(message);
  await dialog.getByRole('button', { name: confirmText, exact: true }).click();
}

// Collects uncaught page errors and console errors so a spec can fail with a readable list
export function collectPageProblems(page) {
  const problems = [];
  page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const loc = msg.location();
      const where = loc?.url ? ` (${loc.url.replace(/^https?:\/\/[^/]+/, '')}:${loc.lineNumber})` : '';
      problems.push(`[console.error] ${msg.text()}${where}`);
    }
  });
  page.on('response', (res) => {
    const { pathname } = new URL(res.url());
    if (pathname.startsWith('/api/') && res.status() >= 400) {
      problems.push(`[http ${res.status()}] ${res.request().method()} ${pathname}`);
    }
  });
  return problems;
}

export const formatProblems = (problems) =>
  problems.length ? `\n  - ${problems.join('\n  - ')}` : '(none)';

// Tracks the page's in-flight /api requests from now on. waitForIdle() resolves once none has
// been in flight for `quietMs` (the app polls timers, so 'networkidle' is not a reliable signal).
// Start it before navigating so requests fired during page load are counted.
export function trackApiRequests(page) {
  const inFlight = new Set();
  const isApi = (req) => new URL(req.url()).pathname.startsWith('/api/');
  page.on('request', (req) => isApi(req) && inFlight.add(req));
  page.on('requestfinished', (req) => inFlight.delete(req));
  page.on('requestfailed', (req) => inFlight.delete(req));
  // Requests of a document that was navigated away from never report back - forget them
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) inFlight.clear();
  });

  return {
    async waitForIdle({ quietMs = 500, timeout = 10_000 } = {}) {
      const deadline = Date.now() + timeout;
      let quietSince = Date.now();
      while (Date.now() < deadline) {
        if (inFlight.size > 0) quietSince = Date.now();
        else if (Date.now() - quietSince >= quietMs) return;
        await page.waitForTimeout(50);
      }
      throw new Error(`API still busy after ${timeout}ms: ${[...inFlight].map((r) => r.url()).join(', ')}`);
    }
  };
}
