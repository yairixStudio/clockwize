// Navigation smoke: every main route renders without uncaught page errors, console errors or
// failing API calls. Each route is its own test so one broken page doesn't hide the others.
import { test, expect } from '@playwright/test';
import {
  apiAs,
  collectPageProblems,
  formatProblems,
  loginInBrowser,
  loginUser,
  registerUser,
  seedClient,
  seedProject,
  seedTask,
  setBrowserSession,
  trackApiRequests
} from './helpers.js';

const ERROR_BOUNDARY_TEXT = 'אירעה שגיאה בטעינת המסך';
const ALL_ADDONS = ['credentials', 'files', 'notes', 'leads_management', 'reminders', 'schedule', 'catalog'];

// A user with every page-level addon enabled and a little data, so pages render real rows
async function seedUser(request) {
  const user = await registerUser(request);
  const api = apiAs(request, user);
  await api.put('/api/addons', { addons: ALL_ADDONS.map((id) => ({ id, isEnabled: true })) });
  const client = await seedClient(api);
  const project = await seedProject(api, client.id);
  const task = await seedTask(api, project.id);
  const end = new Date();
  const start = new Date(end.getTime() - 90 * 60 * 1000);
  await api.post('/api/timer/entries', {
    project_id: project.id,
    task_id: task.id,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    notes: 'רשומת זמן לבדיקה'
  });
  return { user, client, project, task };
}

const heading = (name) => (page) => page.getByRole('heading', { name, exact: true });
const breadcrumb = (key) => (page, data) =>
  page.locator('.breadcrumb .current-page-name').filter({ hasText: data[key].name });

const ROUTES = [
  { path: '/', ready: (page, { user }) => page.getByRole('heading', { name: `שלום, ${user.name}!` }) },
  { path: '/schedule', ready: heading('לו״ז עבודה') },
  { path: '/leads', ready: heading('ניהול לידים') },
  { path: '/reminders', ready: heading('תזכורות') },
  { path: '/credentials', ready: heading('סיסמאות ופרטי גישה') },
  { path: '/catalog', ready: heading('קטלוג מוצרים ושירותים') },
  { path: '/settings', ready: heading('הגדרות') },
  { path: '/settings/workspace', ready: heading('הגדרות Workspace') },
  { path: '/profile', ready: heading('הגדרות פרופיל') },
  { path: '/projects', ready: heading('פרויקטים') },
  { path: '/tasks', ready: heading('משימות') },
  { path: '/time-entries', ready: heading('יומן שעות') },
  { path: '/payments', ready: (page) => page.getByText('רווח נקי', { exact: true }) },
  { path: '/shared-with-me', ready: heading('שותף איתי') },
  { path: '/clients/:client', ready: breadcrumb('client') },
  { path: '/projects/:project', ready: breadcrumb('project') },
  { path: '/tasks/:task', ready: breadcrumb('task') }
];

// The sidebar links a user with every addon enabled should see (admin link excluded)
const SIDEBAR_LINKS = ['/', '/schedule', '/leads', '/reminders', '/credentials', '/catalog', '/settings'];

async function expectPageHealthy(page, problems, api, label) {
  await api.waitForIdle();
  await expect(page.getByText(ERROR_BOUNDARY_TEXT), `${label}: error boundary shown`).toHaveCount(0);
  expect(problems, `${label}: page/console/API errors:${formatProblems(problems)}`).toEqual([]);
}

test.describe('navigation smoke', () => {
  for (const route of ROUTES) {
    test(`${route.path} loads cleanly`, async ({ page, request }) => {
      const data = await seedUser(request);
      const path = route.path.replace(/:(\w+)/, (_, key) => data[key].id);

      await setBrowserSession(page, data.user);
      const problems = collectPageProblems(page);
      const api = trackApiRequests(page);
      await page.goto(path);

      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}$`));
      await expect(route.ready(page, data)).toBeVisible();
      await expectPageHealthy(page, problems, api, path);
    });
  }

  test('every sidebar link navigates without errors', async ({ page, request }) => {
    const data = await seedUser(request);
    await loginInBrowser(page, data.user);
    await expect(page.getByRole('heading', { name: `שלום, ${data.user.name}!` })).toBeVisible();

    const nav = page.getByRole('complementary').getByRole('navigation');
    const hrefs = await nav.getByRole('link').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs.sort()).toEqual([...SIDEBAR_LINKS].sort());

    const problems = collectPageProblems(page);
    const api = trackApiRequests(page);
    for (const href of SIDEBAR_LINKS) {
      const route = ROUTES.find((r) => r.path === href);
      await nav.locator(`a[href="${href}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, '\\/')}$`));
      await expect(route.ready(page, data), `${href} rendered`).toBeVisible();
      await expectPageHealthy(page, problems, api, `sidebar → ${href}`);
    }
  });

  test('/admin loads cleanly for the seeded admin', async ({ page, request }) => {
    // On a fresh database the seeded admin gets a personal workspace right away (database.js),
    // so the workspace-scoped calls the layout makes as admin all succeed.

    const admin = await loginUser(request, 'admin', 'admin');

    await setBrowserSession(page, admin);
    const problems = collectPageProblems(page);
    const api = trackApiRequests(page);
    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'פאנל ניהול' })).toBeVisible();
    await expectPageHealthy(page, problems, api, '/admin');
  });
});
