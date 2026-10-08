// Mobile smoke - runs only in the "mobile" project (Pixel 7 viewport, touch)
import { test, expect } from '@playwright/test';
import { apiAs, collectPageProblems, formatProblems, registerUser, seedClient, seedProject, seedTask, setBrowserSession } from './helpers.js';

test.describe('mobile smoke', () => {
  test('login, dashboard and the navigation menu', async ({ page, request }) => {
    const user = await registerUser(request);
    const problems = collectPageProblems(page);

    await page.goto('/login');
    await page.getByPlaceholder('admin או your@email.com').fill(user.email);
    await page.getByPlaceholder('••••••••').fill(user.password);
    await page.getByRole('button', { name: 'התחבר', exact: true }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: `שלום, ${user.name}!` })).toBeVisible();

    // The page fits the phone: no horizontal scrolling
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(1);

    // Off-canvas sidebar: present in the DOM but out of view until the menu button opens it
    const sidebar = page.getByRole('complementary');
    const settingsLink = sidebar.getByRole('link', { name: 'הגדרות' });
    await expect(sidebar).not.toHaveClass(/sidebar-open/);
    await expect(settingsLink).not.toBeInViewport();

    await page.getByRole('button', { name: 'תפריט', exact: true }).click();
    await expect(sidebar).toHaveClass(/sidebar-open/);
    await expect(settingsLink).toBeInViewport();
    await expect(sidebar.getByRole('link', { name: 'דף הבית' })).toBeInViewport();

    // Following a link navigates and closes the menu
    await settingsLink.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'הגדרות', exact: true })).toBeVisible();
    await expect(sidebar).not.toHaveClass(/sidebar-open/);
    await expect(settingsLink).not.toBeInViewport();

    // The close button inside the menu works too
    await page.getByRole('button', { name: 'תפריט', exact: true }).click();
    await expect(sidebar).toHaveClass(/sidebar-open/);
    await sidebar.getByRole('button', { name: 'סגור תפריט' }).click();
    await expect(sidebar).not.toHaveClass(/sidebar-open/);

    expect(problems, `page/console/API errors:${formatProblems(problems)}`).toEqual([]);
  });
});

// Every main screen must fit a 390px-wide phone - no sideways scrolling of the whole page
// (tables and carousels may scroll inside their own containers)
test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('no screen scrolls horizontally', async ({ page, request }) => {
    const user = await registerUser(request);
    const api = apiAs(request, user);
    const client = await seedClient(api);
    const project = await seedProject(api, client.id);
    const task = await seedTask(api, project.id);
    await setBrowserSession(page, user);

    const routes = ['/', '/projects', '/tasks', '/time-entries', '/payments', '/settings', '/profile',
      `/clients/${client.id}`, `/projects/${project.id}`, `/tasks/${task.id}`];
    const overflowing = [];
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) overflowing.push(`${route}: ${overflow}px`);
    }
    expect(overflowing, `pages wider than the screen:\n  ${overflowing.join('\n  ')}`).toEqual([]);
  });
});
