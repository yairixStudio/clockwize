import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { twoWorkspaces } from './helpers-money.js';

let app;
beforeAll(async () => { ({ app } = await getApp()); });

const expense = (user, body) => user.post('/api/expenses').send({ date: '2026-03-01', ...body });
const category = async (user, name = 'Software', extra = {}) =>
  (await user.post('/api/expenses/categories').send({ name, ...extra })).body;

describe('expenses: auth', () => {
  it('every endpoint requires a login', async () => {
    const id = uuidv4();
    const calls = [
      request(app).get('/api/expenses'),
      request(app).get('/api/expenses/summary'),
      request(app).post('/api/expenses').send({ amount: 1 }),
      request(app).put(`/api/expenses/${id}`).send({}),
      request(app).delete(`/api/expenses/${id}`),
      request(app).get('/api/expenses/categories'),
      request(app).post('/api/expenses/categories').send({ name: 'x' }),
      request(app).put(`/api/expenses/categories/${id}`).send({}),
      request(app).delete(`/api/expenses/categories/${id}`)
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });
});

describe('expense categories', () => {
  it('creates, lists alphabetically, updates and deletes', async () => {
    const user = await createUser();
    expect((await user.post('/api/expenses/categories').send({ color: '#fff' })).status).toBe(400);

    const z = await category(user, 'Zoom', { color: '#00f', icon: 'video' });
    const a = await category(user, 'Ads');
    expect(z).toMatchObject({ name: 'Zoom', color: '#00f', icon: 'video', workspace_id: user.workspaceId });

    const list = await user.get('/api/expenses/categories');
    expect(list.body.map(c => c.name)).toEqual(['Ads', 'Zoom']);

    const upd = await user.put(`/api/expenses/categories/${a.id}`).send({ color: '#f00' });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ name: 'Ads', color: '#f00' });

    expect((await user.delete(`/api/expenses/categories/${z.id}`)).status).toBe(200);
    expect((await user.get('/api/expenses/categories')).body.map(c => c.name)).toEqual(['Ads']);
    expect((await user.delete(`/api/expenses/categories/${z.id}`)).status).toBe(404);
    expect((await user.put(`/api/expenses/categories/${z.id}`).send({ name: 'x' })).status).toBe(404);
  });

  it('deleting a category un-categorises its expenses instead of deleting them', async () => {
    const user = await createUser();
    const cat = await category(user, 'Travel');
    const e = (await expense(user, { amount: 80, category_id: cat.id })).body;
    expect(e.category_name).toBe('Travel');

    await user.delete(`/api/expenses/categories/${cat.id}`);
    const list = await user.get('/api/expenses');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: e.id, category_id: null, category_name: null });
  });
});

describe('expenses', () => {
  it('validates the amount', async () => {
    const user = await createUser();
    for (const amount of [undefined, 0, -5]) {
      expect((await expense(user, { amount })).status).toBe(400);
    }
  });

  it('creates an expense (type expense, status paid) with joined names', async () => {
    const user = await createUser();
    const { client, project } = await createClientProjectTask(user);
    const cat = await category(user, 'Hosting', { color: '#123' });
    const res = await expense(user, { project_id: project.id, amount: 49.9, category_id: cat.id, notes: 'VPS', payment_method: 'card' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'expense', status: 'paid', amount: 49.9, date: '2026-03-01', notes: 'VPS', payment_method: 'card',
      project_name: project.name, client_name: client.name, category_name: 'Hosting', category_color: '#123'
    });
  });

  it('defaults the date to now', async () => {
    const user = await createUser();
    const res = await user.post('/api/expenses').send({ amount: 10 });
    expect(res.status).toBe(201);
    expect(Math.abs(new Date(res.body.date) - Date.now())).toBeLessThan(60_000);
  });

  it('expenses never appear as income and never change a project\'s paid amount', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    await expense(user, { project_id: project.id, amount: 300 });
    expect((await user.get('/api/payments')).body).toEqual([]);
    expect((await user.get('/api/payments/summary')).body.income).toBe(0);
    expect(user.db.prepare('SELECT paid_amount FROM projects WHERE id = ?').get(project.id).paid_amount).toBe(0);
  });

  it('filters by project, client, category and date range', async () => {
    const user = await createUser();
    const a = await createClientProjectTask(user);
    const b = await createClientProjectTask(user);
    const cat = await category(user, 'Tools');
    const e1 = (await expense(user, { project_id: a.project.id, amount: 1, date: '2026-01-10' })).body.id;
    const e2 = (await expense(user, { project_id: b.project.id, amount: 2, date: '2026-02-10', category_id: cat.id })).body.id;
    const e3 = (await expense(user, { amount: 3, date: '2026-03-10' })).body.id;
    const ids = async (qs) => (await user.get(`/api/expenses?${qs}`)).body.map(e => e.id);

    expect(await ids('')).toEqual([e3, e2, e1]);
    expect(await ids(`project_id=${a.project.id}`)).toEqual([e1]);
    expect(await ids(`client_id=${b.client.id}`)).toEqual([e2]);
    expect(await ids(`category_id=${cat.id}`)).toEqual([e2]);
    expect(await ids('start_date=2026-02-01&end_date=2026-02-28')).toEqual([e2]);
    expect(await ids('start_date=2026-02-01')).toEqual([e3, e2]);
  });

  it('updates only the fields given', async () => {
    const user = await createUser();
    const cat = await category(user, 'Ads');
    const e = (await expense(user, { amount: 100, notes: 'keep', category_id: cat.id })).body;
    const res = await user.put(`/api/expenses/${e.id}`).send({ amount: 150 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: 150, notes: 'keep', category_name: 'Ads', type: 'expense' });

    const cleared = await user.put(`/api/expenses/${e.id}`).send({ category_id: null });
    expect(cleared.body.category_id).toBeNull();
  });

  it('rejects a non-positive amount on update too', async () => {
    const user = await createUser();
    const e = (await expense(user, { amount: 100 })).body;
    expect((await user.put(`/api/expenses/${e.id}`).send({ amount: -100 })).status).toBe(400);
    expect((await user.put(`/api/expenses/${e.id}`).send({ amount: 0 })).status).toBe(400);
    expect((await user.put(`/api/expenses/${e.id}`).send({ amount: null })).status).toBe(400);
    expect(user.db.prepare('SELECT amount FROM payments WHERE id = ?').get(e.id).amount).toBe(100);
  });

  it('an expense pointing at a category that no longer belongs to the workspace can still be edited', async () => {
    const user = await createUser();
    const e = (await expense(user, { amount: 100 })).body;
    const stale = uuidv4();
    user.db.prepare('UPDATE payments SET category_id = ? WHERE id = ?').run(stale, e.id);
    const res = await user.put(`/api/expenses/${e.id}`).send({ amount: 120, category_id: stale });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(120);
  });

  it('the expense endpoints cannot touch income payments', async () => {
    const user = await createUser();
    const income = (await user.post('/api/payments').send({ amount: 500, date: '2026-01-01' })).body;
    expect((await user.put(`/api/expenses/${income.id}`).send({ amount: 1 })).status).toBe(404);
    expect((await user.delete(`/api/expenses/${income.id}`)).status).toBe(404);
    expect((await user.get(`/api/payments/${income.id}`)).body.amount).toBe(500);
  });

  it('deletes and then 404s', async () => {
    const user = await createUser();
    const e = (await expense(user, { amount: 5 })).body;
    expect((await user.delete(`/api/expenses/${e.id}`)).status).toBe(200);
    expect((await user.delete(`/api/expenses/${e.id}`)).status).toBe(404);
    expect((await user.get('/api/expenses')).body).toEqual([]);
  });

  it('summarises totals by category and uncategorised, with a date range', async () => {
    const user = await createUser();
    const tools = await category(user, 'Tools');
    const ads = await category(user, 'Ads');
    await category(user, 'Unused');
    await expense(user, { amount: 100, category_id: tools.id, date: '2026-01-05' });
    await expense(user, { amount: 50, category_id: tools.id, date: '2026-02-05' });
    await expense(user, { amount: 300, category_id: ads.id, date: '2026-02-06' });
    await expense(user, { amount: 7, date: '2026-02-07' });
    // income must not leak into expense totals
    await user.post('/api/payments').send({ amount: 10000, date: '2026-02-01' });

    const all = await user.get('/api/expenses/summary');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(457);
    expect(all.body.uncategorized).toBe(7);
    const byName = Object.fromEntries(all.body.byCategory.map(c => [c.name, c.total]));
    expect(byName).toEqual({ Ads: 300, Tools: 150, Unused: 0 });
    expect(all.body.byCategory[0].name).toBe('Ads');

    const feb = await user.get('/api/expenses/summary?start_date=2026-02-01&end_date=2026-02-28');
    expect(feb.body.total).toBe(357);
    expect(Object.fromEntries(feb.body.byCategory.map(c => [c.name, c.total]))).toEqual({ Ads: 300, Tools: 50, Unused: 0 });
  });
});

describe('expenses: cross-workspace isolation', () => {
  it('another workspace cannot list, edit or delete expenses or categories', async () => {
    const { alice, bob } = await twoWorkspaces();
    const cat = await category(alice, 'Alice Cat');
    const e = (await expense(alice, { amount: 900, category_id: cat.id })).body;

    expect((await bob.get('/api/expenses')).body).toEqual([]);
    expect((await bob.get('/api/expenses/categories')).body).toEqual([]);
    expect((await bob.get('/api/expenses/summary')).body).toMatchObject({ total: 0, byCategory: [], uncategorized: 0 });
    expect((await bob.put(`/api/expenses/${e.id}`).send({ amount: 1 })).status).toBe(404);
    expect((await bob.delete(`/api/expenses/${e.id}`)).status).toBe(404);
    expect((await bob.put(`/api/expenses/categories/${cat.id}`).send({ name: 'pwned' })).status).toBe(404);
    expect((await bob.delete(`/api/expenses/categories/${cat.id}`)).status).toBe(404);

    expect((await alice.get('/api/expenses')).body[0]).toMatchObject({ amount: 900, category_name: 'Alice Cat' });
  });

  it('cannot file an expense under another workspace\'s project or category (name leak)', async () => {
    const { alice, bob, a } = await twoWorkspaces();
    alice.db.prepare("UPDATE projects SET name = 'Alice Secret Project' WHERE id = ?").run(a.project.id);
    const cat = await category(alice, 'Alice Secret Category');

    expect((await expense(bob, { amount: 5, project_id: a.project.id })).status).toBe(404);
    expect((await expense(bob, { amount: 5, category_id: cat.id })).status).toBe(404);

    const mine = (await expense(bob, { amount: 5 })).body;
    expect((await bob.put(`/api/expenses/${mine.id}`).send({ project_id: a.project.id })).status).toBe(404);
    expect((await bob.put(`/api/expenses/${mine.id}`).send({ category_id: cat.id })).status).toBe(404);

    const dump = JSON.stringify((await bob.get('/api/expenses')).body);
    expect(dump).not.toContain('Alice Secret');
    // ...and Alice's category totals stay clean
    const summary = await alice.get('/api/expenses/summary');
    expect(summary.body.byCategory.find(c => c.id === cat.id).total).toBe(0);
  });
});

describe('recurring payments', () => {
  const recurring = (user, body) => user.post('/api/recurring').send(body);

  it('every endpoint requires a login', async () => {
    const id = uuidv4();
    const calls = [
      request(app).get('/api/recurring'),
      request(app).get(`/api/recurring/${id}`),
      request(app).get('/api/recurring/upcoming/reminders'),
      request(app).post('/api/recurring').send({ amount: 1 }),
      request(app).put(`/api/recurring/${id}`).send({}),
      request(app).patch(`/api/recurring/${id}/toggle`),
      request(app).post(`/api/recurring/${id}/generate`),
      request(app).delete(`/api/recurring/${id}`)
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });

  it('validates amount and requires a client or project', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    expect((await recurring(user, { client_id: client.id })).status).toBe(400);
    expect((await recurring(user, { client_id: client.id, amount: 0 })).status).toBe(400);
    expect((await recurring(user, { client_id: client.id, amount: -10 })).status).toBe(400);
    expect((await recurring(user, { amount: 100 })).status).toBe(400);
  });

  it('creates with sensible defaults and joined names', async () => {
    const user = await createUser();
    const { client, project } = await createClientProjectTask(user);
    const res = await recurring(user, { client_id: client.id, project_id: project.id, amount: 1500, notes: 'Retainer' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amount: 1500, type: 'income', interval: 'monthly', day_of_month: 1, is_active: 1,
      client_name: client.name, project_name: project.name, notes: 'Retainer', user_id: user.user.id
    });
  });

  it('lists with filters, ordered by day of month', async () => {
    const user = await createUser();
    const a = await createClientProjectTask(user);
    const b = await createClientProjectTask(user);
    const r20 = (await recurring(user, { client_id: a.client.id, amount: 1, day_of_month: 20 })).body;
    const r5 = (await recurring(user, { project_id: b.project.id, amount: 2, day_of_month: 5 })).body;
    await user.patch(`/api/recurring/${r20.id}/toggle`);

    const ids = async (qs) => (await user.get(`/api/recurring?${qs}`)).body.map(r => r.id);
    expect(await ids('')).toEqual([r5.id, r20.id]);
    expect(await ids(`client_id=${a.client.id}`)).toEqual([r20.id]);
    expect(await ids(`project_id=${b.project.id}`)).toEqual([r5.id]);
    expect(await ids('is_active=true')).toEqual([r5.id]);
    expect(await ids('is_active=false')).toEqual([r20.id]);
  });

  it('gets, partially updates, toggles and deletes', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    const r = (await recurring(user, { client_id: client.id, amount: 100, day_of_month: 10, notes: 'n' })).body;

    expect((await user.get(`/api/recurring/${r.id}`)).body).toMatchObject({ amount: 100, client_name: client.name });
    expect((await user.get(`/api/recurring/${uuidv4()}`)).status).toBe(404);

    const upd = await user.put(`/api/recurring/${r.id}`).send({ amount: 120, is_active: false });
    expect(upd.body).toMatchObject({ amount: 120, day_of_month: 10, notes: 'n', is_active: 0 });

    const on = await user.patch(`/api/recurring/${r.id}/toggle`);
    expect(on.body.is_active).toBe(1);
    const off = await user.patch(`/api/recurring/${r.id}/toggle`);
    expect(off.body.is_active).toBe(0);

    expect((await user.delete(`/api/recurring/${r.id}`)).status).toBe(200);
    expect((await user.get(`/api/recurring/${r.id}`)).status).toBe(404);
    expect((await user.delete(`/api/recurring/${r.id}`)).status).toBe(404);
    expect((await user.patch(`/api/recurring/${r.id}/toggle`)).status).toBe(404);
    expect((await user.put(`/api/recurring/${r.id}`).send({ amount: 1 })).status).toBe(404);
  });

  it('generates a pending payment linked to the recurring template', async () => {
    const user = await createUser();
    const { client, project } = await createClientProjectTask(user);
    const r = (await recurring(user, { client_id: client.id, project_id: project.id, amount: 2500, notes: 'Monthly retainer' })).body;

    const res = await user.post(`/api/recurring/${r.id}/generate`).send({ date: '2026-07-01' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amount: 2500, date: '2026-07-01', status: 'pending', type: 'income', recurring_id: r.id,
      project_id: project.id, project_name: project.name, client_name: client.name, notes: 'Monthly retainer'
    });

    // It is a real pending payment now; generating twice makes two
    await user.post(`/api/recurring/${r.id}/generate`).send({});
    const pending = await user.get('/api/payments/pending');
    expect(pending.body.filter(p => p.recurring_id === r.id)).toHaveLength(2);
    expect((await user.get('/api/payments/summary')).body.pending).toBe(5000);
    // Pending - so it does not count towards the project's paid amount
    expect(user.db.prepare('SELECT paid_amount FROM projects WHERE id = ?').get(project.id).paid_amount).toBe(0);
  });

  it('an expense template generates an expense', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    const r = (await recurring(user, { project_id: project.id, amount: 99, type: 'expense' })).body;
    await user.post(`/api/recurring/${r.id}/generate`).send({ date: '2026-07-01' });
    expect((await user.get('/api/expenses')).body.map(e => e.amount)).toEqual([99]);
    expect((await user.get('/api/payments')).body).toEqual([]);
  });

  describe('upcoming reminders', () => {
    afterEach(() => vi.useRealTimers());

    // Local calendar day of a Date, the way due_date is reported
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    it('returns active templates due within N days, wrapping into next month', async () => {
      // Pin "today" to the 25th of the current month (local time) - only Date is faked
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), 25, 12, 0, 0);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(today);
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

      const user = await createUser();
      const { client } = await createClientProjectTask(user);
      const mk = async (body) => (await recurring(user, { client_id: client.id, amount: 10, ...body })).body;

      const due25 = await mk({ day_of_month: 25 });
      const due28 = await mk({ day_of_month: 28 });
      const due2 = await mk({ day_of_month: 2 });
      const due20 = await mk({ day_of_month: 20 });
      const inactive = await mk({ day_of_month: 26 });
      await user.patch(`/api/recurring/${inactive.id}/toggle`);
      await mk({ day_of_month: 26, end_date: '2000-01-01' });
      await mk({ day_of_month: 26, start_date: '2999-01-01' });

      const res = await user.get('/api/recurring/upcoming/reminders?days=7');
      expect(res.status).toBe(200);
      const byId = Object.fromEntries(res.body.map(r => [r.id, r]));
      const expected2 = daysInMonth - 25 + 2;

      expect(byId[due25.id].days_until_due).toBe(0);
      expect(byId[due28.id].days_until_due).toBe(3);
      expect(byId[due28.id].due_date).toBe(ymd(new Date(today.getFullYear(), today.getMonth(), 28)));
      expect(Boolean(byId[due2.id])).toBe(expected2 <= 7);
      expect(byId[inactive.id]).toBeUndefined();
      expect(res.body).toHaveLength(expected2 <= 7 ? 3 : 2);

      const wide = await user.get('/api/recurring/upcoming/reminders?days=31');
      const wideById = Object.fromEntries(wide.body.map(r => [r.id, r]));
      expect(wideById[due2.id].days_until_due).toBe(expected2);
      expect(wideById[due2.id].due_date).toBe(ymd(new Date(today.getFullYear(), today.getMonth() + 1, 2)));
      expect(wideById[due20.id].days_until_due).toBe(daysInMonth - 25 + 20);
    });

    it('reports due_date as the intended local calendar day east of UTC (Israel)', async () => {
      // Local midnight in Israel is 21:00/22:00 UTC of the previous day, so toISOString() used to
      // report the 14th for a payment due on the 15th
      const originalTZ = process.env.TZ;
      process.env.TZ = 'Asia/Jerusalem';
      try {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-08T09:00:00.000Z')); // Oct 8, 12:00 in Israel
        const user = await createUser();
        const { client } = await createClientProjectTask(user);
        const mk = async (day) => (await recurring(user, { client_id: client.id, amount: 10, day_of_month: day })).body;
        const due8 = await mk(8);
        const due15 = await mk(15);
        const due2 = await mk(2);

        const byId = Object.fromEntries((await user.get('/api/recurring/upcoming/reminders?days=31')).body.map(r => [r.id, r]));
        expect(byId[due8.id].due_date).toBe('2026-10-08');
        expect(byId[due15.id].due_date).toBe('2026-10-15');
        expect(byId[due2.id].due_date).toBe('2026-11-02');
        expect(byId[due15.id].days_until_due).toBe(7);

        // Wrapping into January of the next year (a fresh login - the old token is not valid in December)
        vi.setSystemTime(new Date('2026-12-25T09:00:00.000Z'));
        const later = await createUser();
        const laterClient = (await createClientProjectTask(later)).client;
        const jan2 = (await recurring(later, { client_id: laterClient.id, amount: 10, day_of_month: 2 })).body;
        const jan = (await later.get('/api/recurring/upcoming/reminders?days=31')).body.find(r => r.id === jan2.id);
        expect(jan.due_date).toBe('2027-01-02');
      } finally {
        if (originalTZ === undefined) delete process.env.TZ;
        else process.env.TZ = originalTZ;
      }
    });

    it('clamps day 29-31 to the end of short months and counts local calendar days', async () => {
      const originalTZ = process.env.TZ;
      process.env.TZ = 'Asia/Jerusalem';
      vi.useFakeTimers({ toFake: ['Date'] });
      // Templates due on the 28th-31st, seen at a pinned "now" (a fresh login for every date)
      const upcomingAt = async (iso, days) => {
        vi.setSystemTime(new Date(iso));
        const user = await createUser();
        const { client } = await createClientProjectTask(user);
        const ids = {};
        for (const day of [28, 29, 30, 31]) {
          ids[day] = (await recurring(user, { client_id: client.id, amount: 10, day_of_month: day })).body.id;
        }
        const list = (await user.get(`/api/recurring/upcoming/reminders?days=${days}`)).body;
        return (day) => {
          const r = list.find(x => x.id === ids[day]);
          return r && [r.due_date, r.days_until_due];
        };
      };
      try {
        // Feb 25 2026 (28 days): 29/30/31 fall due on Feb 28 in 3 days, not on Mar 1-3
        let at = await upcomingAt('2026-02-25T10:00:00.000Z', 7);
        expect(at(28)).toEqual(['2026-02-28', 3]);
        expect(at(29)).toEqual(['2026-02-28', 3]);
        expect(at(30)).toEqual(['2026-02-28', 3]);
        expect(at(31)).toEqual(['2026-02-28', 3]);

        // On Feb 28 itself the "31st" is due today
        at = await upcomingAt('2026-02-28T10:00:00.000Z', 0);
        expect(at(31)).toEqual(['2026-02-28', 0]);
        expect(at(28)).toEqual(['2026-02-28', 0]);

        // Leap year: the 29th exists, the 30th/31st clamp to it
        at = await upcomingAt('2028-02-27T10:00:00.000Z', 7);
        expect(at(29)).toEqual(['2028-02-29', 2]);
        expect(at(31)).toEqual(['2028-02-29', 2]);

        // Jan 31: the 31st is today; the 29th/30th have passed and are next due on Feb 28
        at = await upcomingAt('2026-01-31T10:00:00.000Z', 31);
        expect(at(31)).toEqual(['2026-01-31', 0]);
        expect(at(30)).toEqual(['2026-02-28', 28]);
        expect(at(29)).toEqual(['2026-02-28', 28]);

        // April has 30 days: the 31st is due on Apr 30
        at = await upcomingAt('2026-04-29T09:00:00.000Z', 7);
        expect(at(31)).toEqual(['2026-04-30', 1]);
        expect(at(30)).toEqual(['2026-04-30', 1]);

        // Across the DST switch (Fri Mar 27, a 23-hour day) days are still whole calendar days
        at = await upcomingAt('2026-03-25T10:00:00.000Z', 7);
        expect(at(29)).toEqual(['2026-03-29', 4]);
        expect(at(31)).toEqual(['2026-03-31', 6]);
      } finally {
        if (originalTZ === undefined) delete process.env.TZ;
        else process.env.TZ = originalTZ;
      }
    });

    it('defaults to 7 days and treats a non-numeric window as none', async () => {
      const user = await createUser();
      const { client } = await createClientProjectTask(user);
      await recurring(user, { client_id: client.id, amount: 10, day_of_month: new Date().getDate() });
      expect((await user.get('/api/recurring/upcoming/reminders')).body).toHaveLength(1);
      expect((await user.get('/api/recurring/upcoming/reminders?days=abc')).body).toEqual([]);
    });
  });

  describe('cross-workspace isolation', () => {
    it('another workspace cannot read, edit, toggle, generate from or delete a template', async () => {
      const { alice, bob, a } = await twoWorkspaces();
      const r = (await recurring(alice, { client_id: a.client.id, amount: 100, day_of_month: new Date().getDate() })).body;

      expect((await bob.get('/api/recurring')).body).toEqual([]);
      expect((await bob.get('/api/recurring/upcoming/reminders?days=31')).body).toEqual([]);
      expect((await bob.get(`/api/recurring/${r.id}`)).status).toBe(404);
      expect((await bob.put(`/api/recurring/${r.id}`).send({ amount: 1 })).status).toBe(404);
      expect((await bob.patch(`/api/recurring/${r.id}/toggle`)).status).toBe(404);
      expect((await bob.post(`/api/recurring/${r.id}/generate`).send({})).status).toBe(404);
      expect((await bob.delete(`/api/recurring/${r.id}`)).status).toBe(404);
      expect((await bob.get('/api/payments')).body).toEqual([]);
      expect((await alice.get(`/api/recurring/${r.id}`)).body).toMatchObject({ amount: 100, is_active: 1 });
    });

    it('cannot point a template at another workspace\'s client or project (name leak)', async () => {
      const { alice, bob, a, b } = await twoWorkspaces();
      alice.db.prepare("UPDATE clients SET name = 'Alice Secret Client' WHERE id = ?").run(a.client.id);
      alice.db.prepare("UPDATE projects SET name = 'Alice Secret Project' WHERE id = ?").run(a.project.id);

      expect((await recurring(bob, { amount: 5, client_id: a.client.id })).status).toBe(404);
      expect((await recurring(bob, { amount: 5, project_id: a.project.id })).status).toBe(404);

      const mine = (await recurring(bob, { amount: 5, client_id: b.client.id })).body;
      expect((await bob.put(`/api/recurring/${mine.id}`).send({ client_id: a.client.id })).status).toBe(404);
      expect((await bob.put(`/api/recurring/${mine.id}`).send({ project_id: a.project.id })).status).toBe(404);

      const dump = JSON.stringify((await bob.get('/api/recurring')).body);
      expect(dump).not.toContain('Alice Secret');
    });
  });
});
