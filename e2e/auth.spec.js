import { test, expect } from '@playwright/test';
import {
  PASSWORD,
  acknowledge,
  apiAs,
  appDialog,
  loginInBrowser,
  loginUser,
  registerUser,
  uniqueEmail,
  uniqueName
} from './helpers.js';

const loginForm = (page) => ({
  email: page.getByPlaceholder('admin או your@email.com'),
  password: page.getByPlaceholder('••••••••'),
  submit: page.getByRole('button', { name: 'התחבר', exact: true })
});

async function logout(page, userName) {
  await page.getByRole('complementary').getByRole('button', { name: userName }).click();
  await page.getByRole('button', { name: 'התנתק' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe('auth', () => {
  test('register through the UI, log out and log back in', async ({ page }) => {
    const name = uniqueName('משתמש');
    const email = uniqueEmail('register');

    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'הרשמה' })).toBeVisible();
    await page.getByPlaceholder('השם שלך').fill(name);
    await page.getByPlaceholder('your@email.com').fill(email);
    await page.getByPlaceholder('לפחות 6 תווים').fill(PASSWORD);
    await page.getByPlaceholder('הקלד שוב את הסיסמה').fill(PASSWORD);
    await page.getByRole('button', { name: 'הירשם', exact: true }).click();

    // Lands on the dashboard
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: `שלום, ${name}!` })).toBeVisible();

    await logout(page, name);
    await expect(page.getByRole('heading', { name: 'התחברות' })).toBeVisible();

    // The session is really gone: a protected page bounces back to /login
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login$/);

    const form = loginForm(page);
    await form.email.fill(email);
    await form.password.fill(PASSWORD);
    await form.submit.click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: `שלום, ${name}!` })).toBeVisible();
  });

  test('registration rejects mismatched passwords', async ({ page }) => {
    await page.goto('/register');
    await page.getByPlaceholder('השם שלך').fill(uniqueName('משתמש'));
    await page.getByPlaceholder('your@email.com').fill(uniqueEmail('mismatch'));
    await page.getByPlaceholder('לפחות 6 תווים').fill(PASSWORD);
    await page.getByPlaceholder('הקלד שוב את הסיסמה').fill(`${PASSWORD}-other`);
    await page.getByRole('button', { name: 'הירשם', exact: true }).click();

    await expect(page.getByText('הסיסמאות לא תואמות')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('wrong password shows an error and stays on /login', async ({ page, request }) => {
    const user = await registerUser(request);

    await page.goto('/login');
    const form = loginForm(page);
    await form.email.fill(user.email);
    await form.password.fill('definitely-not-the-password');
    await form.submit.click();

    await expect(page.getByText('אימייל או סיסמה שגויים')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('a user flagged for a forced password reset must set a new password before entering', async ({ page, request }) => {
    const user = await registerUser(request);
    const admin = await loginUser(request, 'admin', 'admin');

    // Flagging ends the session the user already has
    await loginInBrowser(page, user);
    await expect(page.getByRole('heading', { name: `שלום, ${user.name}!` })).toBeVisible();
    await apiAs(request, admin).post(`/api/admin/users/${user.user.id}/force-password-reset`);
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();

    const form = loginForm(page);
    const dialog = appDialog(page);
    const resetHeading = dialog.getByRole('heading', { name: 'נדרש איפוס סיסמה' });
    const newPasswordInput = dialog.getByLabel('הזן סיסמה חדשה (לפחות 4 תווים):');
    const signIn = async () => {
      await form.email.fill(user.email);
      await form.password.fill(PASSWORD);
      await form.submit.click();
      await expect(resetHeading).toBeVisible();
    };

    // Cancelling the reset leaves the user logged out, also after a reload
    await page.goto('/login');
    await signIn();
    await expect(newPasswordInput).toHaveAttribute('type', 'password');
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
    await dialog.getByRole('button', { name: 'ביטול', exact: true }).click();
    await expect(page.getByText('חובה לשנות סיסמה כדי להמשיך')).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);

    // Setting the new password signs the user in
    const newPassword = `${PASSWORD}-new`;
    await signIn();
    await newPasswordInput.fill(newPassword);
    await dialog.getByRole('button', { name: 'אישור', exact: true }).click();
    await acknowledge(page, 'סיסמה שונתה בהצלחה!');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: `שלום, ${user.name}!` })).toBeVisible();

    // The session survives a reload, and the new password is the one that works from now on
    await page.reload();
    await expect(page.getByRole('heading', { name: `שלום, ${user.name}!` })).toBeVisible();
    const oldLogin = await request.post('/api/auth/login', { data: { email: user.email, password: PASSWORD } });
    expect(oldLogin.status()).toBe(401);
    const newLogin = await request.post('/api/auth/login', { data: { email: user.email, password: newPassword } });
    expect(newLogin.status()).toBe(200);
    expect((await newLogin.json()).requiresPasswordReset).toBe(false);
  });

  test('protected routes redirect to /login when logged out', async ({ page }) => {
    for (const path of ['/', '/projects', '/tasks', '/time-entries', '/settings']) {
      await page.goto(path);
      await expect(page, `${path} should redirect`).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { name: 'התחברות' })).toBeVisible();
    }
  });
});
