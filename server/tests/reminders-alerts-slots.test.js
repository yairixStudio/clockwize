import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { twoWorkspaces, addMember, insertTimeEntry } from './helpers-money.js';

let app;
beforeAll(async () => { ({ app } = await getApp()); });

describe('reminders', () => {
  const remind = (user, body) => user.post('/api/reminders').send(body);

  it('requires a login', async () => {
    expect((await request(app).get('/api/reminders')).status).toBe(401);
    expect((await request(app).post('/api/reminders').send({ content: 'x' })).status).toBe(401);
    expect((await request(app).put(`/api/reminders/${uuidv4()}`).send({})).status).toBe(401);
    expect((await request(app).delete(`/api/reminders/${uuidv4()}`)).status).toBe(401);
  });

  it('requires content', async () => {
    const user = await createUser();
    expect((await remind(user, { due_date: '2026-01-01' })).status).toBe(400);
  });

  it('creates a general reminder with only content (no due date)', async () => {
    const user = await createUser();
    const res = await remind(user, { content: 'Call the accountant' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      content: 'Call the accountant', due_date: null, association_type: 'general', association_id: null,
      is_read: 0, is_recurring: 0, recurrence_interval: null, project_associations: []
    });
  });

  it('joins the names of the associated client / project / task / lead', async () => {
    const user = await createUser();
    const { client, project, task } = await createClientProjectTask(user);
    const lead = (await user.post('/api/leads').send({ name: 'Hot Lead' })).body;
    await remind(user, { content: 'c', association_type: 'client', association_id: client.id, due_date: '2026-01-01' });
    await remind(user, { content: 'p', association_type: 'project', association_id: project.id, due_date: '2026-01-02' });
    await remind(user, { content: 't', association_type: 'task', association_id: task.id, due_date: '2026-01-03' });
    await remind(user, { content: 'l', association_type: 'lead', association_id: lead.id, due_date: '2026-01-04' });

    const res = await user.get('/api/reminders');
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.map(r => [r.content, r]));
    expect(by.c.client_name).toBe(client.name);
    expect(by.p).toMatchObject({ project_name: project.name, project_client_name: client.name, project_client_id: client.id });
    expect(by.t).toMatchObject({ task_name: task.name, task_project_name: project.name, task_client_name: client.name });
    expect(by.l.lead_name).toBe('Hot Lead');
    expect(res.body.map(r => r.content)).toEqual(['c', 'p', 't', 'l']);

    expect((await user.get('/api/reminders?type=project')).body.map(r => r.content)).toEqual(['p']);
    expect((await user.get(`/api/reminders?id=${task.id}`)).body.map(r => r.content)).toEqual(['t']);
  });

  it('stores multi-project associations and replaces them on update', async () => {
    const user = await createUser();
    const a = await createClientProjectTask(user);
    const b = await createClientProjectTask(user);
    const r = (await remind(user, { content: 'multi', project_ids: [a.project.id, b.project.id] })).body;
    expect(r.project_associations.map(x => x.project_id).sort()).toEqual([a.project.id, b.project.id].sort());
    expect(r.project_associations[0].client_name).toBe(a.client.name);

    const listed = (await user.get('/api/reminders')).body[0];
    expect(listed.project_associations).toHaveLength(2);

    const upd = await user.put(`/api/reminders/${r.id}`).send({ project_ids: [b.project.id] });
    expect(upd.body.project_associations.map(x => x.project_id)).toEqual([b.project.id]);
    const cleared = await user.put(`/api/reminders/${r.id}`).send({ project_ids: [] });
    expect(cleared.body.project_associations).toEqual([]);
  });

  it('updates fields and read/archive flags', async () => {
    const user = await createUser();
    const r = (await remind(user, { content: 'old', due_date: '2026-02-01T09:00:00.000Z' })).body;
    const res = await user.put(`/api/reminders/${r.id}`).send({ content: 'new', notes: 'n', is_read: true, is_archived: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ content: 'new', notes: 'n', is_read: 1, is_archived: 1, due_date: '2026-02-01T09:00:00.000Z' });
    const noop = await user.put(`/api/reminders/${r.id}`).send({});
    expect(noop.body.content).toBe('new');
  });

  it('completing a recurring reminder reschedules it instead of marking it read', async () => {
    const user = await createUser();
    const base = '2026-01-10T09:00:00.000Z';
    const expected = {
      daily: '2026-01-11T09:00:00.000Z',
      weekly: '2026-01-17T09:00:00.000Z',
      monthly: '2026-02-10T09:00:00.000Z',
      yearly: '2027-01-10T09:00:00.000Z'
    };
    for (const [interval, next] of Object.entries(expected)) {
      const r = (await remind(user, { content: interval, due_date: base, is_recurring: true, recurrence_interval: interval })).body;
      expect(r.is_recurring).toBe(1);
      const res = await user.put(`/api/reminders/${r.id}`).send({ is_read: true });
      expect(res.status).toBe(200);
      expect(res.body.due_date).toBe(next);
      expect(res.body.is_read).toBe(0);
    }
  });

  it('a monthly reminder on Jan 31 moves to the end of February, not into March', async () => {
    const user = await createUser();
    const r = (await remind(user, { content: 'm', due_date: '2026-01-31T09:00:00.000Z', is_recurring: true, recurrence_interval: 'monthly' })).body;
    const res = await user.put(`/api/reminders/${r.id}`).send({ is_read: true });
    expect(res.body.due_date.slice(0, 7)).toBe('2026-02');
    expect(res.body.due_date).toBe('2026-02-28T09:00:00.000Z');
  });

  it('a yearly reminder on Feb 29 moves to Feb 28 of the next year, not into March', async () => {
    const user = await createUser();
    const r = (await remind(user, { content: 'y', due_date: '2028-02-29T09:00:00.000Z', is_recurring: true, recurrence_interval: 'yearly' })).body;
    const res = await user.put(`/api/reminders/${r.id}`).send({ is_read: true });
    expect(res.body.due_date).toBe('2029-02-28T09:00:00.000Z');
  });

  describe('monthly / yearly reminders keep their day of the month', () => {
    // Rescheduling works in the server's local time (as the UI does), so compare local calendar dates
    const localDate = (iso) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const localHour = (iso) => new Date(iso).getHours();
    const complete = async (user, id) => {
      const res = await user.put(`/api/reminders/${id}`).send({ is_read: true });
      expect(res.status).toBe(200);
      return res.body;
    };
    const monthly = (user, due_date, extra = {}) =>
      remind(user, { content: 'rent', due_date, is_recurring: true, recurrence_interval: 'monthly', ...extra });

    it('a reminder on the 31st goes 31.1 -> 28.2 -> 31.3 -> 30.4 -> 31.5', async () => {
      const user = await createUser();
      const r = (await monthly(user, '2026-01-31T09:00:00.000Z')).body;
      expect(r.recurrence_day).toBe(new Date('2026-01-31T09:00:00.000Z').getDate());
      const seen = [];
      let current = r;
      for (let i = 0; i < 4; i++) {
        current = await complete(user, r.id);
        seen.push(localDate(current.due_date));
        expect(localHour(current.due_date)).toBe(localHour(r.due_date));
      }
      expect(seen).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
      expect(current.recurrence_day).toBe(31);
    });

    it('a yearly reminder on Feb 29 is on Feb 28 in common years and back on Feb 29 in the next leap year', async () => {
      const user = await createUser();
      const r = (await remind(user, { content: 'y', due_date: '2028-02-29T09:00:00.000Z', is_recurring: true, recurrence_interval: 'yearly' })).body;
      const seen = [];
      for (let i = 0; i < 4; i++) seen.push(localDate((await complete(user, r.id)).due_date));
      expect(seen).toEqual(['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    });

    it('re-saving the form with the same date keeps the anchor; a new date or a non-monthly interval resets it', async () => {
      const user = await createUser();
      const r = (await monthly(user, '2026-01-31T09:00:00.000Z')).body;
      const feb = await complete(user, r.id);
      expect(localDate(feb.due_date)).toBe('2026-02-28');

      // The edit form sends everything back, including the (clamped) due date
      const resaved = await user.put(`/api/reminders/${r.id}`).send({
        content: 'rent (edited)', due_date: feb.due_date, is_recurring: true, recurrence_interval: 'monthly'
      });
      expect(resaved.body).toMatchObject({ content: 'rent (edited)', recurrence_day: 31 });
      expect(localDate((await complete(user, r.id)).due_date)).toBe('2026-03-31');

      // Editing only the text keeps it too
      expect((await user.put(`/api/reminders/${r.id}`).send({ content: 'rent again' })).body.recurrence_day).toBe(31);

      // Picking a new date re-anchors on that day
      const moved = await user.put(`/api/reminders/${r.id}`).send({ due_date: '2026-04-15T09:00:00.000Z' });
      expect(moved.body.recurrence_day).toBe(new Date('2026-04-15T09:00:00.000Z').getDate());
      expect(localDate((await complete(user, r.id)).due_date)).toBe('2026-05-15');

      // Weekly reminders and non-recurring ones have no anchor
      expect((await user.put(`/api/reminders/${r.id}`).send({ recurrence_interval: 'weekly' })).body.recurrence_day).toBeNull();
      const once = (await remind(user, { content: 'once', due_date: '2026-01-31T09:00:00.000Z' })).body;
      expect(once.recurrence_day).toBeNull();
    });

    it('a monthly reminder without an anchor (older data) anchors on its current day', async () => {
      const user = await createUser();
      const lead = (await user.post('/api/leads').send({ name: 'Anchor lead' })).body;
      const created = await user.post(`/api/leads/${lead.id}/reminders`).send({
        content: 'follow up', due_date: '2026-01-31T09:00:00.000Z', is_recurring: true, recurrence_interval: 'monthly'
      });
      expect(created.status).toBe(201);
      // Lead reminders store their anchor now; clear it to simulate a row from before the column existed
      user.db.prepare('UPDATE reminders SET recurrence_day = NULL WHERE id = ?').run(created.body.id);

      const feb = await complete(user, created.body.id);
      expect(localDate(feb.due_date)).toBe('2026-02-28');
      expect(feb.recurrence_day).toBe(31);
      expect(localDate((await complete(user, created.body.id)).due_date)).toBe('2026-03-31');
    });

    it('the startup backfill anchors existing monthly/yearly reminders once and leaves the rest alone', async () => {
      const { backfillReminderRecurrenceDay } = await import('../database.js');
      const user = await createUser();
      const ids = {};
      for (const [key, body] of Object.entries({
        monthly: { content: 'm', due_date: '2026-01-31T09:00:00.000Z', is_recurring: true, recurrence_interval: 'monthly' },
        yearly: { content: 'y', due_date: '2028-02-29T09:00:00.000Z', is_recurring: true, recurrence_interval: 'yearly' },
        weekly: { content: 'w', due_date: '2026-01-31T09:00:00.000Z', is_recurring: true, recurrence_interval: 'weekly' },
        once: { content: 'o', due_date: '2026-01-31T09:00:00.000Z' },
        undated: { content: 'u', is_recurring: true, recurrence_interval: 'monthly' }
      })) {
        ids[key] = (await remind(user, body)).body.id;
      }
      // As they were before the column existed
      const { db } = user;
      const placeholders = Object.values(ids).map(() => '?').join(',');
      db.prepare(`UPDATE reminders SET recurrence_day = NULL WHERE id IN (${placeholders})`).run(...Object.values(ids));
      const anchors = () => Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, db.prepare('SELECT recurrence_day FROM reminders WHERE id = ?').get(id).recurrence_day]));

      expect(backfillReminderRecurrenceDay(db)).toBeGreaterThanOrEqual(2);
      const expected = {
        monthly: new Date('2026-01-31T09:00:00.000Z').getDate(),
        yearly: new Date('2028-02-29T09:00:00.000Z').getDate(),
        weekly: null,
        once: null,
        undated: null
      };
      expect(anchors()).toEqual(expected);
      expect(backfillReminderRecurrenceDay(db)).toBe(0);
      expect(anchors()).toEqual(expected);
    });
  });

  it('a reminder whose associated record was deleted can still be edited with its full payload', async () => {
    const user = await createUser();
    const { client, project } = await createClientProjectTask(user);
    const r = (await remind(user, { content: 'orphan', association_type: 'client', association_id: client.id, project_ids: [project.id] })).body;
    user.db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);
    const res = await user.put(`/api/reminders/${r.id}`).send({ content: 'still editable', association_type: 'client', association_id: client.id, project_ids: [] });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('still editable');
  });

  it('deletes and then 404s', async () => {
    const user = await createUser();
    const r = (await remind(user, { content: 'x' })).body;
    expect((await user.delete(`/api/reminders/${r.id}`)).status).toBe(200);
    expect((await user.delete(`/api/reminders/${r.id}`)).status).toBe(404);
    expect((await user.put(`/api/reminders/${r.id}`).send({ content: 'y' })).status).toBe(404);
  });

  describe('cross-workspace isolation', () => {
    it('another workspace cannot read, edit or delete reminders', async () => {
      const { alice, bob } = await twoWorkspaces();
      const r = (await remind(alice, { content: 'alice todo' })).body;
      expect((await bob.get('/api/reminders')).body).toEqual([]);
      expect((await bob.put(`/api/reminders/${r.id}`).send({ content: 'pwned' })).status).toBe(404);
      expect((await bob.delete(`/api/reminders/${r.id}`)).status).toBe(404);
      expect((await alice.get('/api/reminders')).body[0].content).toBe('alice todo');
    });

    it('cannot associate a reminder with another workspace\'s records (name leak)', async () => {
      const { alice, bob, a } = await twoWorkspaces();
      alice.db.prepare("UPDATE clients SET name = 'Alice Secret Client' WHERE id = ?").run(a.client.id);
      alice.db.prepare("UPDATE projects SET name = 'Alice Secret Project' WHERE id = ?").run(a.project.id);
      alice.db.prepare("UPDATE tasks SET name = 'Alice Secret Task' WHERE id = ?").run(a.task.id);
      const lead = (await alice.post('/api/leads').send({ name: 'Alice Secret Lead' })).body;

      for (const [association_type, association_id] of [['client', a.client.id], ['project', a.project.id], ['task', a.task.id], ['lead', lead.id]]) {
        expect((await remind(bob, { content: 'x', association_type, association_id })).status).toBe(404);
      }
      expect((await remind(bob, { content: 'x', project_ids: [a.project.id] })).status).toBe(404);

      const mine = (await remind(bob, { content: 'mine' })).body;
      expect((await bob.put(`/api/reminders/${mine.id}`).send({ association_type: 'client', association_id: a.client.id })).status).toBe(404);
      expect((await bob.put(`/api/reminders/${mine.id}`).send({ project_ids: [a.project.id] })).status).toBe(404);

      const dump = JSON.stringify((await bob.get('/api/reminders')).body);
      expect(dump).not.toContain('Alice Secret');
    });
  });
});

describe('project alerts', () => {
  const alert = (user, body) => user.post('/api/alerts').send(body);

  it('requires a login', async () => {
    expect((await request(app).get('/api/alerts')).status).toBe(401);
    expect((await request(app).get(`/api/alerts/check/${uuidv4()}`)).status).toBe(401);
    expect((await request(app).post('/api/alerts').send({})).status).toBe(401);
  });

  it('validates input', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    expect((await alert(user, { alert_type: 'hours' })).status).toBe(400);
    expect((await alert(user, { project_id: project.id })).status).toBe(400);
    expect((await alert(user, { project_id: uuidv4(), alert_type: 'hours' })).status).toBe(404);
  });

  it('creates, lists with names, updates and deletes', async () => {
    const user = await createUser();
    const a = await createClientProjectTask(user);
    const b = await createClientProjectTask(user);
    const created = await alert(user, { project_id: a.project.id, alert_type: 'hours', threshold_value: 10, message: 'Ten hours' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ alert_type: 'hours', threshold_value: 10, is_triggered: 0, is_dismissed: 0, workspace_id: user.workspaceId });
    await alert(user, { project_id: b.project.id, alert_type: 'budget', threshold_value: 1 });

    const list = await user.get('/api/alerts');
    expect(list.body).toHaveLength(2);
    expect((await user.get(`/api/alerts?project_id=${a.project.id}`)).body[0]).toMatchObject({ project_name: a.project.name, client_name: a.client.name });

    const upd = await user.put(`/api/alerts/${created.body.id}`).send({ threshold_value: 12, is_dismissed: true });
    expect(upd.body).toMatchObject({ threshold_value: 12, is_dismissed: 1, message: 'Ten hours' });

    expect((await user.delete(`/api/alerts/${created.body.id}`)).status).toBe(200);
    expect((await user.delete(`/api/alerts/${created.body.id}`)).status).toBe(404);
    expect((await user.put(`/api/alerts/${created.body.id}`).send({})).status).toBe(404);
  });

  it('check computes hours, earnings and payments and triggers alerts', async () => {
    const user = await createUser();
    const { project, task } = await createClientProjectTask(user, { hourlyRate: 200 });
    insertTimeEntry(user, { project_id: project.id, task_id: task.id, duration: 2 * 3600 });
    insertTimeEntry(user, { project_id: project.id, duration: 1800 });
    await user.post('/api/payments').send({ project_id: project.id, amount: 300, date: '2026-01-01' });
    await user.post('/api/payments').send({ project_id: project.id, amount: 999, date: '2026-01-02', status: 'pending' });

    const hoursHit = (await alert(user, { project_id: project.id, alert_type: 'hours', threshold_value: 2 })).body;
    const hoursMiss = (await alert(user, { project_id: project.id, alert_type: 'hours', threshold_value: 3 })).body;
    const budgetHit = (await alert(user, { project_id: project.id, alert_type: 'budget', threshold_value: 500 })).body;
    const paymentHit = (await alert(user, { project_id: project.id, alert_type: 'payment', threshold_value: 300 })).body;
    const paymentMiss = (await alert(user, { project_id: project.id, alert_type: 'payment', threshold_value: 301 })).body;
    const dismissed = (await alert(user, { project_id: project.id, alert_type: 'hours', threshold_value: 1 })).body;
    await user.put(`/api/alerts/${dismissed.id}`).send({ is_dismissed: true });

    const res = await user.get(`/api/alerts/check/${project.id}`);
    expect(res.status).toBe(200);
    expect(res.body.metrics).toEqual({ totalHours: 2.5, totalEarnings: 500, totalPayments: 300 });
    const triggered = res.body.triggered.map(t => t.id).sort();
    expect(triggered).toEqual([hoursHit.id, budgetHit.id, paymentHit.id].sort());
    expect(res.body.triggered.find(t => t.id === hoursHit.id).current_value).toBe(2.5);
    expect(res.body.alerts).toHaveLength(6);

    const rows = Object.fromEntries(user.db.prepare('SELECT id, is_triggered FROM project_alerts WHERE project_id = ?').all(project.id).map(r => [r.id, r.is_triggered]));
    expect(rows[hoursHit.id]).toBe(1);
    expect(rows[hoursMiss.id]).toBe(0);
    expect(rows[paymentMiss.id]).toBe(0);
    expect(rows[dismissed.id]).toBe(0);
  });

  it('budget uses the fixed price for fixed-price projects', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'Fixed Co' })).body;
    const project = (await user.post('/api/projects').send({ client_id: client.id, name: 'Fixed', pricing_type: 'fixed', fixed_price: 8000 })).body;
    insertTimeEntry(user, { project_id: project.id, duration: 36000 });
    await alert(user, { project_id: project.id, alert_type: 'budget', threshold_value: 8000 });
    const res = await user.get(`/api/alerts/check/${project.id}`);
    expect(res.body.metrics.totalEarnings).toBe(8000);
    expect(res.body.triggered).toHaveLength(1);
  });

  it('budget falls back to the client hourly rate', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'Rate Co', hourly_rate: 150 })).body;
    const project = (await user.post('/api/projects').send({ client_id: client.id, name: 'NoRate', pricing_type: 'hourly' })).body;
    insertTimeEntry(user, { project_id: project.id, duration: 7200 });
    const res = await user.get(`/api/alerts/check/${project.id}`);
    expect(res.body.metrics.totalEarnings).toBe(300);
  });

  it('project expenses do not count as payments received', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    await user.post('/api/payments').send({ project_id: project.id, amount: 100, date: '2026-01-01' });
    await user.post('/api/expenses').send({ project_id: project.id, amount: 5000, date: '2026-01-01' });
    await alert(user, { project_id: project.id, alert_type: 'payment', threshold_value: 1000 });
    const res = await user.get(`/api/alerts/check/${project.id}`);
    expect(res.body.metrics.totalPayments).toBe(100);
    expect(res.body.triggered).toEqual([]);
  });

  it('deadline alerts trigger N days before the target date', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    const inThreeDays = Date.now() + 3 * 24 * 3600 * 1000 - 60_000;
    const soon = (await alert(user, { project_id: project.id, alert_type: 'deadline', threshold_value: inThreeDays, threshold_days: 5 })).body;
    const notYet = (await alert(user, { project_id: project.id, alert_type: 'deadline', threshold_value: inThreeDays, threshold_days: 1 })).body;
    const res = await user.get(`/api/alerts/check/${project.id}`);
    const hit = res.body.triggered.find(t => t.id === soon.id);
    expect(hit.current_value).toBe(3);
    expect(res.body.triggered.find(t => t.id === notYet.id)).toBeUndefined();
  });

  it('cross-workspace: cannot create on, check, list, edit or delete another workspace\'s alerts', async () => {
    const { alice, bob, a } = await twoWorkspaces();
    const al = (await alert(alice, { project_id: a.project.id, alert_type: 'hours', threshold_value: 1 })).body;
    expect((await alert(bob, { project_id: a.project.id, alert_type: 'hours' })).status).toBe(404);
    expect((await bob.get('/api/alerts')).body).toEqual([]);
    expect((await bob.get(`/api/alerts/check/${a.project.id}`)).status).toBe(404);
    expect((await bob.put(`/api/alerts/${al.id}`).send({ is_dismissed: true })).status).toBe(404);
    expect((await bob.delete(`/api/alerts/${al.id}`)).status).toBe(404);
    expect((await alice.get('/api/alerts')).body[0].is_dismissed).toBe(0);
  });
});

describe('planned slots', () => {
  const slot = (user, body) => user.post('/api/planned-slots').send(body);

  it('requires a login', async () => {
    expect((await request(app).get('/api/planned-slots')).status).toBe(401);
    expect((await request(app).post('/api/planned-slots').send({})).status).toBe(401);
    expect((await request(app).delete(`/api/planned-slots/group/${uuidv4()}`)).status).toBe(401);
  });

  it('validates date, duration and client/lead', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    expect((await slot(user, { client_id: client.id, duration: 60 })).status).toBe(400);
    expect((await slot(user, { client_id: client.id, date: '2026-05-01' })).status).toBe(400);
    expect((await slot(user, { date: '2026-05-01', duration: 60 })).status).toBe(400);
    expect((await slot(user, { client_id: client.id, date: '2026-05-01', duration: 60, is_recurring: true, recurrence_type: 'weekly' })).status).toBe(400);
  });

  it('creates a single slot with names and lists them by date', async () => {
    const user = await createUser();
    const { client, project } = await createClientProjectTask(user);
    const lead = (await user.post('/api/leads').send({ name: 'Slot Lead' })).body;
    const later = (await slot(user, { client_id: client.id, project_id: project.id, date: '2026-05-03', duration: 120, notes: 'design' })).body;
    const earlier = (await slot(user, { lead_id: lead.id, date: '2026-05-01', duration: 30 })).body;
    expect(later).toMatchObject({ client_name: client.name, project_name: project.name, duration: 120, notes: 'design', recurrence_group_id: null });
    expect(earlier.lead_name).toBe('Slot Lead');

    const list = await user.get('/api/planned-slots');
    expect(list.body.map(s => s.id)).toEqual([earlier.id, later.id]);
  });

  it('creates a recurring series with a shared group id', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    const weekly = await slot(user, { client_id: client.id, date: '2026-06-01', duration: 60, is_recurring: true, recurrence_type: 'weekly', recurrence_end_date: '2026-06-29' });
    expect(weekly.status).toBe(201);
    expect(weekly.body.map(s => s.date)).toEqual(['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
    expect(new Set(weekly.body.map(s => s.recurrence_group_id)).size).toBe(1);
    expect(weekly.body[0]).toMatchObject({ recurrence_type: 'weekly', recurrence_interval: 1, recurrence_end_date: '2026-06-29' });

    const everyOtherDay = await slot(user, { client_id: client.id, date: '2026-06-01', duration: 60, is_recurring: true, recurrence_type: 'daily', recurrence_interval: 2, recurrence_end_date: '2026-06-07' });
    expect(everyOtherDay.body.map(s => s.date)).toEqual(['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-07']);

    const biweekly = await slot(user, { client_id: client.id, date: '2026-06-01', duration: 60, is_recurring: true, recurrence_type: 'biweekly', recurrence_end_date: '2026-07-15' });
    expect(biweekly.body.map(s => s.date)).toEqual(['2026-06-01', '2026-06-15', '2026-06-29', '2026-07-13']);

    const monthly = await slot(user, { client_id: client.id, date: '2026-01-15', duration: 60, is_recurring: true, recurrence_type: 'monthly', recurrence_end_date: '2026-04-30' });
    expect(monthly.body.map(s => s.date)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('caps a runaway series at 365 occurrences', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    const res = await slot(user, { client_id: client.id, date: '2026-01-01', duration: 15, is_recurring: true, recurrence_type: 'daily', recurrence_end_date: '2030-01-01' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(365);
  });

  it('rejects a series whose end date is before its start', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    const res = await slot(user, { client_id: client.id, date: '2026-06-10', duration: 60, is_recurring: true, recurrence_type: 'weekly', recurrence_end_date: '2026-06-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect((await user.get('/api/planned-slots')).body).toEqual([]);

    // Ending on the start day is a valid one-slot series
    const sameDay = await slot(user, { client_id: client.id, date: '2026-06-10', duration: 60, is_recurring: true, recurrence_type: 'weekly', recurrence_end_date: '2026-06-10' });
    expect(sameDay.status).toBe(201);
    expect(sameDay.body.map(s => s.date)).toEqual(['2026-06-10']);
  });

  it('a monthly series starting on the 31st has at most one slot per month', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    const res = await slot(user, { client_id: client.id, date: '2026-01-31', duration: 60, is_recurring: true, recurrence_type: 'monthly', recurrence_end_date: '2026-06-30' });
    const months = res.body.map(s => s.date.slice(0, 7));
    expect(new Set(months).size).toBe(months.length);
    // Clamped to the end of short months, back to the 31st whenever the month has one
    expect(res.body.map(s => s.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);

    const everyOther = await slot(user, { client_id: client.id, date: '2027-12-31', duration: 60, is_recurring: true, recurrence_type: 'monthly', recurrence_interval: 2, recurrence_end_date: '2028-06-30' });
    expect(everyOther.body.map(s => s.date)).toEqual(['2027-12-31', '2028-02-29', '2028-04-30', '2028-06-30']);

    const yearly = await slot(user, { client_id: client.id, date: '2028-02-29', duration: 60, is_recurring: true, recurrence_type: 'yearly', recurrence_end_date: '2032-03-01' });
    expect(yearly.body.map(s => s.date)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  it('updates fields, deletes one slot or a whole series', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    const s = (await slot(user, { client_id: client.id, date: '2026-05-01', duration: 60, notes: 'a' })).body;
    const upd = await user.put(`/api/planned-slots/${s.id}`).send({ duration: 90, sort_order: 3 });
    expect(upd.body).toMatchObject({ duration: 90, sort_order: 3, notes: 'a', date: '2026-05-01', client_name: client.name });

    const series = (await slot(user, { client_id: client.id, date: '2026-05-04', duration: 60, is_recurring: true, recurrence_type: 'weekly', recurrence_end_date: '2026-05-25' })).body;
    const groupId = series[0].recurrence_group_id;
    const del = await user.delete(`/api/planned-slots/group/${groupId}`);
    expect(del.status).toBe(200);
    expect(del.body.deletedIds.sort()).toEqual(series.map(x => x.id).sort());
    expect((await user.delete(`/api/planned-slots/group/${groupId}`)).status).toBe(404);

    expect((await user.delete(`/api/planned-slots/${s.id}`)).status).toBe(200);
    expect((await user.delete(`/api/planned-slots/${s.id}`)).status).toBe(404);
    expect((await user.put(`/api/planned-slots/${s.id}`).send({ duration: 1 })).status).toBe(404);
    expect((await user.get('/api/planned-slots')).body).toEqual([]);
  });

  it('a slot whose lead was deleted can still be edited with its full payload', async () => {
    const user = await createUser();
    const lead = (await user.post('/api/leads').send({ name: 'Gone soon' })).body;
    const s = (await slot(user, { lead_id: lead.id, date: '2026-05-01', duration: 60 })).body;
    await user.delete(`/api/leads/${lead.id}`);
    const res = await user.put(`/api/planned-slots/${s.id}`).send({ lead_id: lead.id, client_id: null, project_id: null, duration: 45 });
    expect(res.status).toBe(200);
    expect(res.body.duration).toBe(45);
  });

  it('slots are personal: a colleague in the same workspace cannot see or change them', async () => {
    const owner = await createUser();
    const colleague = await createUser();
    addMember(owner, colleague);
    const { client } = await createClientProjectTask(owner);
    const s = (await slot(owner, { client_id: client.id, date: '2026-05-01', duration: 60 })).body;

    expect((await colleague.get('/api/planned-slots', owner.workspaceId)).body).toEqual([]);
    expect((await colleague.put(`/api/planned-slots/${s.id}`, owner.workspaceId).send({ duration: 1 })).status).toBe(404);
    expect((await colleague.delete(`/api/planned-slots/${s.id}`, owner.workspaceId)).status).toBe(404);
  });

  describe('cross-workspace isolation', () => {
    it('another workspace cannot see, edit or delete slots', async () => {
      const { alice, bob, a } = await twoWorkspaces();
      const s = (await slot(alice, { client_id: a.client.id, date: '2026-05-01', duration: 60, is_recurring: true, recurrence_type: 'weekly', recurrence_end_date: '2026-05-08' })).body;
      expect((await bob.get('/api/planned-slots')).body).toEqual([]);
      expect((await bob.put(`/api/planned-slots/${s[0].id}`).send({ duration: 1 })).status).toBe(404);
      expect((await bob.delete(`/api/planned-slots/${s[0].id}`)).status).toBe(404);
      expect((await bob.delete(`/api/planned-slots/group/${s[0].recurrence_group_id}`)).status).toBe(404);
      expect((await alice.get('/api/planned-slots')).body).toHaveLength(2);
    });

    it('cannot plan against another workspace\'s client, project or lead (name leak)', async () => {
      const { alice, bob, a, b } = await twoWorkspaces();
      alice.db.prepare("UPDATE clients SET name = 'Alice Secret Client' WHERE id = ?").run(a.client.id);
      alice.db.prepare("UPDATE projects SET name = 'Alice Secret Project' WHERE id = ?").run(a.project.id);
      const lead = (await alice.post('/api/leads').send({ name: 'Alice Secret Lead' })).body;

      const base = { date: '2026-05-01', duration: 60 };
      expect((await slot(bob, { ...base, client_id: a.client.id })).status).toBe(404);
      expect((await slot(bob, { ...base, client_id: b.client.id, project_id: a.project.id })).status).toBe(404);
      expect((await slot(bob, { ...base, lead_id: lead.id })).status).toBe(404);
      expect((await slot(bob, { ...base, client_id: a.client.id, is_recurring: true, recurrence_type: 'weekly', recurrence_end_date: '2026-05-15' })).status).toBe(404);

      const mine = (await slot(bob, { ...base, client_id: b.client.id })).body;
      expect((await bob.put(`/api/planned-slots/${mine.id}`).send({ client_id: a.client.id })).status).toBe(404);
      expect((await bob.put(`/api/planned-slots/${mine.id}`).send({ project_id: a.project.id })).status).toBe(404);
      expect((await bob.put(`/api/planned-slots/${mine.id}`).send({ lead_id: lead.id })).status).toBe(404);

      const dump = JSON.stringify((await bob.get('/api/planned-slots')).body);
      expect(dump).not.toContain('Alice Secret');
    });
  });
});
