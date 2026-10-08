// Share links: created through the UI by the owner, opened by an anonymous visitor in a fresh
// browser context (no token, no cookies).
import { test, expect } from '@playwright/test';
import {
  acknowledge,
  apiAs,
  collectPageProblems,
  formatProblems,
  loginInBrowser,
  modal,
  registerUser,
  seedClient,
  seedProject,
  seedTask,
  uniqueName
} from './helpers.js';

// Creates a link from the open ShareModal and returns its absolute /s/<token> URL
async function createShareLink(page, shareModal, { linkName, password } = {}) {
  if (linkName) await shareModal.getByPlaceholder('שם לזיהוי הלינק').fill(linkName);
  if (password) {
    // The radio itself is visually hidden behind a styled card - click the card like a user does
    await shareModal.getByText('מוגן סיסמא', { exact: true }).click();
    await expect(shareModal.getByLabel('מוגן סיסמא')).toBeChecked();
    await shareModal.getByPlaceholder('הזן סיסמא').fill(password);
  }
  await shareModal.getByRole('button', { name: 'צור לינק', exact: true }).click();
  await acknowledge(page, 'לינק השיתוף נוצר בהצלחה');

  const linkUrl = shareModal.locator('.link-url');
  await expect(linkUrl).toHaveCount(1);
  const url = (await linkUrl.textContent()).trim();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4317\/s\/[\w-]+$/);
  return url;
}

async function openAnonymously(browser, url) {
  const context = await browser.newContext({ locale: 'he-IL' });
  const page = await context.newPage();
  const problems = collectPageProblems(page);
  await page.goto(url);
  return { context, page, problems };
}

test.describe('sharing', () => {
  test('public client link renders for a logged-out visitor', async ({ page, browser, request }) => {
    const user = await registerUser(request);
    const api = apiAs(request, user);
    const client = await seedClient(api);
    const project = await seedProject(api, client.id, { description: 'תיאור גלוי ללקוח' });

    await loginInBrowser(page, user, `/clients/${client.id}`);
    await page.getByRole('button', { name: 'שיתוף', exact: true }).click();
    const shareModal = modal(page, 'שיתוף לקוח');
    await expect(shareModal).toContainText(client.name);
    const linkName = uniqueName('לינק');
    const url = await createShareLink(page, shareModal, { linkName });
    await expect(shareModal).toContainText(linkName);
    await expect(shareModal.locator('.link-badge')).toHaveText('ציבורי');

    const visitor = await openAnonymously(browser, url);
    try {
      const v = visitor.page;
      await expect(v.getByRole('heading', { level: 1, name: client.name })).toBeVisible();
      await expect(v.getByText('סקירת פרויקטים ומשימות')).toBeVisible();
      await expect(v.getByRole('heading', { level: 3, name: project.name })).toBeVisible();
      await expect(v.getByText('תיאור גלוי ללקוח')).toBeVisible();
      // Nothing of the owner's app leaks into the public view
      await expect(v.getByRole('complementary')).toHaveCount(0);
      expect(await v.evaluate(() => localStorage.getItem('token'))).toBeNull();
      expect(visitor.problems, `shared view errors:${formatProblems(visitor.problems)}`).toEqual([]);
    } finally {
      await visitor.context.close();
    }
  });

  test('password-protected project link asks for the password first', async ({ page, browser, request }) => {
    const user = await registerUser(request);
    const api = apiAs(request, user);
    const client = await seedClient(api);
    const project = await seedProject(api, client.id);
    const task = await seedTask(api, project.id);
    const sharePassword = 'shared-secret-123';

    await loginInBrowser(page, user, `/projects/${project.id}`);
    await page.getByRole('button', { name: 'שיתוף', exact: true }).click();
    const shareModal = modal(page, 'שיתוף פרויקט');
    const url = await createShareLink(page, shareModal, { password: sharePassword });
    await expect(shareModal.locator('.link-badge')).toHaveText('מוגן סיסמא');

    const visitor = await openAnonymously(browser, url);
    try {
      const v = visitor.page;
      await expect(v.getByRole('heading', { name: 'תוכן מוגן' })).toBeVisible();
      await expect(v.getByText(project.name)).toBeVisible();
      await expect(v.getByText(task.name)).toHaveCount(0);

      // The data endpoint itself refuses an unverified visitor
      // (a client-side "verified" flag must not be trusted either)
      const token = url.split('/s/')[1];
      const direct = await v.request.get(new URL(`/api/share/access/${token}?password_verified=true`, url).href);
      expect(direct.status()).toBe(401);

      await v.getByPlaceholder('הזן סיסמא').fill('wrong-password');
      await v.getByRole('button', { name: 'כניסה' }).click();
      await expect(v.getByText('סיסמא שגויה')).toBeVisible();

      await v.getByPlaceholder('הזן סיסמא').fill(sharePassword);
      await v.getByRole('button', { name: 'כניסה' }).click();
      await expect(v.getByRole('heading', { level: 1, name: project.name })).toBeVisible();
      await expect(v.getByText(`לקוח: ${client.name}`)).toBeVisible();
      await expect(v.getByRole('heading', { level: 3, name: task.name })).toBeVisible();

      // The deliberate wrong-password attempt is the only call allowed to fail
      const unexpected = visitor.problems.filter((p) => !p.includes('/api/share/verify-password/'));
      expect(unexpected, `shared view errors:${formatProblems(unexpected)}`).toEqual([]);
    } finally {
      await visitor.context.close();
    }
  });
});
