import { test, expect } from '@playwright/test';
import {
  acknowledge,
  apiAs,
  confirmDialog,
  loginInBrowser,
  modal,
  registerUser,
  seedClient,
  seedProject,
  seedTask,
  uniqueName
} from './helpers.js';

const currentPageName = (page) => page.locator('.breadcrumb .current-page-name');

test.describe('core flow', () => {
  test('client → project → task → timer → time entry', async ({ page, request }) => {
    const user = await registerUser(request);
    const clientName = uniqueName('לקוח');
    const projectName = uniqueName('פרויקט');
    const taskName = uniqueName('משימה');
    const notes = uniqueName('עבודה על');

    await loginInBrowser(page, user);
    await expect(page.getByRole('heading', { name: `שלום, ${user.name}!` })).toBeVisible();

    // --- Client (dashboard) ---
    await page.getByRole('button', { name: 'לקוח חדש', exact: true }).click();
    const clientModal = modal(page, 'לקוח חדש');
    await clientModal.getByLabel('שם לקוח *', { exact: true }).fill(clientName);
    await clientModal.getByRole('button', { name: 'שמור', exact: true }).click();
    await acknowledge(page, 'הלקוח נוסף בהצלחה');
    await expect(clientModal).toBeHidden();

    await page.getByRole('link', { name: clientName }).click();
    await expect(page).toHaveURL(/\/clients\/[\w-]+$/);
    await expect(currentPageName(page)).toHaveText(clientName);

    // --- Project (client page) ---
    await page.getByRole('button', { name: 'צור פרויקט חדש' }).click();
    const projectModal = modal(page, 'פרויקט חדש');
    // Opened from a client page, the client is preselected
    await expect(projectModal.getByLabel('לקוח *', { exact: true })).toHaveValue(/[\w-]{8,}/);
    await projectModal.getByLabel('שם הפרויקט *', { exact: true }).fill(projectName);
    await projectModal.getByRole('button', { name: 'שמור', exact: true }).click();
    await expect(projectModal).toBeHidden();

    await page.locator('.tab-content').getByRole('link', { name: projectName }).click();
    await expect(page).toHaveURL(/\/projects\/[\w-]+$/);
    await expect(currentPageName(page)).toHaveText(projectName);

    // --- Task (project page) ---
    await page.getByRole('button', { name: 'צור משימה חדשה' }).click();
    const taskModal = modal(page, 'משימה חדשה');
    await taskModal.getByLabel('שם המשימה *', { exact: true }).fill(taskName);
    await taskModal.getByRole('button', { name: 'שמור', exact: true }).click();
    await expect(taskModal).toBeHidden();

    const taskRow = page.locator('.task-item').filter({ hasText: taskName });
    await expect(taskRow).toBeVisible();

    // --- Timer ---
    await taskRow.getByTitle('התחל טיימר').click();
    await acknowledge(page, 'הטיימר הופעל!');
    await expect(taskRow.getByTitle('השהה')).toBeVisible();

    await taskRow.getByTitle('עצור ושמור').click();
    const stopModal = modal(page, 'שמירת זמן עבודה');
    await expect(stopModal).toContainText(projectName);
    await expect(stopModal).toContainText(taskName);
    await stopModal.getByPlaceholder('מה עשית בזמן הזה?').fill(notes);
    await stopModal.getByRole('button', { name: 'שמור', exact: true }).click();
    await acknowledge(page, 'הזמן נשמר בהצלחה!');
    await expect(taskRow.getByTitle('התחל טיימר')).toBeVisible();

    // --- The entry shows up on the project page ... ---
    await page.getByRole('button', { name: 'רשומות זמן (1)' }).click();
    const projectEntry = page.locator('.time-entry-item').filter({ hasText: notes });
    await expect(projectEntry).toBeVisible();
    await expect(projectEntry).toContainText(taskName);

    // --- ... and in the time log ---
    await page.goto('/time-entries');
    await expect(page.getByRole('heading', { name: 'יומן שעות' })).toBeVisible();
    const logEntry = page.getByRole('row').filter({ hasText: notes });
    await expect(logEntry).toBeVisible();
    await expect(logEntry.getByRole('link', { name: projectName })).toBeVisible();
  });

  test('edit and delete entities', async ({ page, request }) => {
    const user = await registerUser(request);
    const api = apiAs(request, user);
    const client = await seedClient(api);
    const project = await seedProject(api, client.id);
    const task = await seedTask(api, project.id);

    // --- Edit the client from its page ---
    await loginInBrowser(page, user, `/clients/${client.id}`);
    await expect(currentPageName(page)).toHaveText(client.name);

    await page.getByRole('button', { name: 'עריכה', exact: true }).click();
    const clientModal = modal(page, 'עריכת לקוח');
    const clientNameInput = clientModal.getByLabel('שם לקוח *', { exact: true });
    await expect(clientNameInput).toHaveValue(client.name);
    const renamedClient = uniqueName('לקוח מעודכן');
    await clientNameInput.fill(renamedClient);
    await clientModal.getByRole('button', { name: 'שמור', exact: true }).click();
    await acknowledge(page, 'פרטי הלקוח עודכנו בהצלחה');
    await expect(currentPageName(page)).toHaveText(renamedClient);

    // --- Edit the project from the client page ---
    const projectRow = page.locator('.tab-content .list-item').filter({ hasText: project.name });
    await projectRow.getByTitle('ערוך').click();
    const projectModal = modal(page, 'עריכת פרויקט');
    const projectNameInput = projectModal.getByLabel('שם הפרויקט *', { exact: true });
    await expect(projectNameInput).toHaveValue(project.name);
    const renamedProject = uniqueName('פרויקט מעודכן');
    await projectNameInput.fill(renamedProject);
    await projectModal.getByRole('button', { name: 'שמור', exact: true }).click();
    await expect(projectModal).toBeHidden();
    await expect(page.locator('.tab-content').getByRole('link', { name: renamedProject })).toBeVisible();
    await expect(page.locator('.tab-content').getByRole('link', { name: project.name })).toHaveCount(0);

    // --- Delete the task from the project page ---
    await page.goto(`/projects/${project.id}`);
    const taskRow = page.locator('.task-item').filter({ hasText: task.name });
    await expect(taskRow).toBeVisible();
    // Keyboard activation: with the mouse this button can be covered by the notes tab - see the
    // known-bug test below
    await taskRow.getByTitle('מחק').focus();
    await page.keyboard.press('Enter');
    await confirmDialog(page, 'מחק', 'האם אתה בטוח שברצונך למחוק את המשימה?');
    await acknowledge(page, 'המשימה נמחקה בהצלחה');
    await expect(taskRow).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'משימות (0)' })).toBeVisible();

    // --- Delete the client (cascades) ---
    await page.goto(`/clients/${client.id}`);
    await page.getByRole('button', { name: 'עריכה', exact: true }).click();
    await modal(page, 'עריכת לקוח').getByRole('button', { name: 'מחק לקוח' }).click();
    await confirmDialog(page, 'מחק לצמיתות', renamedClient);
    await acknowledge(page, 'הלקוח נמחק בהצלחה');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'הלקוחות שלך (0)' })).toBeVisible();

    const clients = await api.get('/api/clients');
    expect(clients.map((c) => c.id)).not.toContain(client.id);
    const projects = await api.get('/api/projects');
    expect(projects.map((p) => p.id)).not.toContain(project.id);
  });

  test('task row actions are not covered by the floating notes tab', async ({ page, request }) => {
    // The fixed "הערות שלי" tab sits on the left edge (the row's end side in RTL); the content
    // keeps a gutter for it (Layout.css), so a mouse click on a row's edit/delete lands on the button.

    await page.setViewportSize({ width: 1280, height: 720 });
    const user = await registerUser(request);
    const api = apiAs(request, user);
    const client = await seedClient(api);
    const project = await seedProject(api, client.id);
    const tasks = [];
    // Enough rows below the target that it can be scrolled to the middle of the screen
    for (let i = 0; i < 14; i++) tasks.push(await seedTask(api, project.id));
    const target = tasks[5];

    await loginInBrowser(page, user, `/projects/${project.id}`);
    const taskRow = page.locator('.task-item').filter({ hasText: target.name });
    await expect(taskRow).toBeVisible();
    // Mid-screen is where the tab sits (top: 50%)
    await taskRow.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await taskRow.hover();

    const deleteButton = taskRow.getByTitle('מחק');
    await expect(deleteButton).toBeVisible();
    const coveredBy = await deleteButton.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el.contains(top) ? null : `${top?.tagName}.${top?.className} "${top?.getAttribute('title') ?? ''}"`;
    });
    expect(coveredBy, 'element drawn on top of the task delete button').toBeNull();
  });
});
