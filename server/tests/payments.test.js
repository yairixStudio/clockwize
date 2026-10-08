import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { twoWorkspaces } from './helpers-money.js';

let app;
beforeAll(async () => { ({ app } = await getApp()); });

const paidAmount = (user, projectId) =>
  user.db.prepare('SELECT paid_amount FROM projects WHERE id = ?').get(projectId).paid_amount;

const pay = (user, body) => user.post('/api/payments').send({ date: '2026-03-10', ...body });

describe('payments: auth', () => {
  it('every endpoint requires a login', async () => {
    const id = uuidv4();
    const calls = [
      request(app).get('/api/payments'),
      request(app).get('/api/payments/summary'),
      request(app).get('/api/payments/pending'),
      request(app).get('/api/payments/overdue'),
      request(app).get(`/api/payments/${id}`),
      request(app).post('/api/payments').send({ amount: 1, date: '2026-01-01' }),
      request(app).put(`/api/payments/${id}`).send({ amount: 1 }),
      request(app).put(`/api/payments/${id}/status`).send({ status: 'paid' }),
      request(app).delete(`/api/payments/${id}`)
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });
});

describe('payments: create', () => {
  it('requires amount and date', async () => {
    const user = await createUser();
    expect((await user.post('/api/payments').send({ date: '2026-01-01' })).status).toBe(400);
    expect((await user.post('/api/payments').send({ amount: 100 })).status).toBe(400);
    expect((await user.post('/api/payments').send({ amount: 0, date: '2026-01-01' })).status).toBe(400);
  });

  it('creates a paid income payment, sets paid_date and the project paid amount', async () => {
    const user = await createUser();
    const { client, project } = await createClientProjectTask(user);
    const res = await pay(user, { project_id: project.id, amount: 1200.5, notes: 'first', payment_method: 'transfer' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amount: 1200.5,
      date: '2026-03-10',
      status: 'paid',
      type: 'income',
      paid_date: '2026-03-10',
      payment_method: 'transfer',
      project_name: project.name,
      client_name: client.name,
      workspace_id: user.workspaceId,
      additional_associations: []
    });
    expect(paidAmount(user, project.id)).toBe(1200.5);

    await pay(user, { project_id: project.id, amount: 799.5 });
    expect(paidAmount(user, project.id)).toBe(2000);
  });

  it('a pending payment has no paid_date and does not count as paid', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    const res = await pay(user, { project_id: project.id, amount: 500, status: 'pending', due_date: '2026-04-01' });
    expect(res.status).toBe(201);
    expect(res.body.paid_date).toBeNull();
    expect(res.body.due_date).toBe('2026-04-01');
    expect(paidAmount(user, project.id)).toBe(0);
  });

  it('a payment without a project is allowed', async () => {
    const user = await createUser();
    const res = await pay(user, { amount: 50 });
    expect(res.status).toBe(201);
    expect(res.body.project_id).toBeNull();
    expect(res.body.project_name).toBeNull();
  });

  it('404s for an unknown project', async () => {
    const user = await createUser();
    expect((await pay(user, { project_id: uuidv4(), amount: 10 })).status).toBe(404);
  });

  it('stores additional project/task associations', async () => {
    const user = await createUser();
    const main = await createClientProjectTask(user);
    const extra = await createClientProjectTask(user);
    const res = await pay(user, {
      project_id: main.project.id,
      amount: 300,
      additional_associations: [{ project_id: extra.project.id, task_id: extra.task.id }, {}]
    });
    expect(res.status).toBe(201);
    expect(res.body.additional_associations).toHaveLength(1);
    expect(res.body.additional_associations[0]).toMatchObject({ project_id: extra.project.id, task_id: extra.task.id, task_name: extra.task.name });

    // Filtering by the extra project finds it through the association
    const list = await user.get(`/api/payments?project_id=${extra.project.id}`);
    expect(list.body.map(p => p.id)).toEqual([res.body.id]);
  });
});

describe('payments: listing and filters', () => {
  let user, a, b, ids;
  beforeAll(async () => {
    user = await createUser();
    a = await createClientProjectTask(user);
    b = await createClientProjectTask(user);
    ids = {};
    ids.a1 = (await pay(user, { project_id: a.project.id, task_id: a.task.id, amount: 100, date: '2026-01-05' })).body.id;
    ids.a2 = (await pay(user, { project_id: a.project.id, amount: 200, date: '2026-02-05', status: 'pending' })).body.id;
    ids.b1 = (await pay(user, { project_id: b.project.id, amount: 400, date: '2026-03-05', status: 'sent' })).body.id;
    // Expenses live in the same table but must never show up as payments
    await user.post('/api/expenses').send({ project_id: a.project.id, amount: 999, date: '2026-01-10' });
  });

  it('lists income only, newest first, with names', async () => {
    const res = await user.get('/api/payments');
    expect(res.status).toBe(200);
    expect(res.body.map(p => p.id)).toEqual([ids.b1, ids.a2, ids.a1]);
    expect(res.body.every(p => p.type === 'income')).toBe(true);
    const a1 = res.body.find(p => p.id === ids.a1);
    expect(a1).toMatchObject({ task_name: a.task.name, client_id: a.client.id, client_name: a.client.name });
  });

  it('filters by project, client, status and date range', async () => {
    const ids_ = async (qs) => (await user.get(`/api/payments?${qs}`)).body.map(p => p.id).sort();
    expect(await ids_(`project_id=${a.project.id}`)).toEqual([ids.a1, ids.a2].sort());
    expect(await ids_(`client_id=${b.client.id}`)).toEqual([ids.b1]);
    expect(await ids_('status=pending')).toEqual([ids.a2]);
    expect(await ids_('start_date=2026-02-01&end_date=2026-02-28')).toEqual([ids.a2]);
    expect(await ids_('start_date=2026-02-01')).toEqual([ids.a2, ids.b1].sort());
    expect(await ids_('end_date=2026-01-31')).toEqual([ids.a1]);
  });

  it('gets a single payment', async () => {
    const res = await user.get(`/api/payments/${ids.a1}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ids.a1, amount: 100, project_name: a.project.name, task_name: a.task.name });
    expect((await user.get(`/api/payments/${uuidv4()}`)).status).toBe(404);
  });

  it('pending lists draft/sent/pending ordered by due date, nulls last', async () => {
    const u = await createUser();
    const late = (await pay(u, { amount: 1, status: 'pending', due_date: '2026-09-01' })).body.id;
    const none = (await pay(u, { amount: 2, status: 'draft' })).body.id;
    const early = (await pay(u, { amount: 3, status: 'sent', due_date: '2026-01-01' })).body.id;
    await pay(u, { amount: 4, status: 'paid' });
    await pay(u, { amount: 5, status: 'cancelled' });
    const res = await u.get('/api/payments/pending');
    expect(res.body.map(p => p.id)).toEqual([early, late, none]);
  });
});

describe('payments: summary and overdue', () => {
  it('totals paid, pending and overdue income per workspace and per client', async () => {
    const user = await createUser();
    const a = await createClientProjectTask(user);
    const b = await createClientProjectTask(user);
    await pay(user, { project_id: a.project.id, amount: 1000, date: '2026-01-10' });
    await pay(user, { project_id: a.project.id, amount: 250, date: '2026-01-20', status: 'pending', due_date: '2000-01-01' });
    await pay(user, { project_id: b.project.id, amount: 300, date: '2026-02-10', status: 'draft' });
    await pay(user, { project_id: b.project.id, amount: 70, date: '2026-02-11', status: 'cancelled' });
    await user.post('/api/expenses').send({ project_id: a.project.id, amount: 5000, date: '2026-01-15' });

    const res = await user.get('/api/payments/summary');
    expect(res.status).toBe(200);
    expect(res.body.income).toBe(1000);
    expect(res.body.pending).toBe(550);
    expect(res.body.overdue).toBe(250);
    const byClient = Object.fromEntries(res.body.byClient.map(c => [c.id, c]));
    expect(byClient[a.client.id]).toMatchObject({ paid: 1000, pending: 250 });
    expect(byClient[b.client.id]).toMatchObject({ paid: 0, pending: 300 });

    const jan = await user.get('/api/payments/summary?start_date=2026-01-01&end_date=2026-01-31');
    expect(jan.body.income).toBe(1000);
    expect(jan.body.pending).toBe(250);
    expect(jan.body.byClient.map(c => c.id)).toEqual([a.client.id]);
  });

  it('overdue lists only unpaid (pending/sent) income past its due date', async () => {
    const user = await createUser();
    const overdue = (await pay(user, { amount: 10, status: 'pending', due_date: '2001-01-01' })).body.id;
    const overdueSent = (await pay(user, { amount: 11, status: 'sent', due_date: '2002-01-01' })).body.id;
    await pay(user, { amount: 12, status: 'paid', due_date: '2001-01-01' });
    await pay(user, { amount: 13, status: 'pending', due_date: '2999-01-01' });
    await pay(user, { amount: 14, status: 'draft', due_date: '2001-01-01' });
    await pay(user, { amount: 15, status: 'pending' });

    const res = await user.get('/api/payments/overdue');
    expect(res.body.map(p => p.id)).toEqual([overdue, overdueSent]);
    expect(res.body[0].days_overdue).toBeGreaterThan(365 * 20);
  });

  it('an empty workspace has zero totals', async () => {
    const user = await createUser();
    const res = await user.get('/api/payments/summary');
    expect(res.body).toEqual({ income: 0, pending: 0, overdue: 0, byClient: [] });
  });
});

describe('payments: update, status and delete', () => {
  it('editing the amount recalculates the project paid amount', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    const p = (await pay(user, { project_id: project.id, amount: 100 })).body;
    const res = await user.put(`/api/payments/${p.id}`).send({ amount: 175 });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(175);
    expect(res.body.notes).toBe(p.notes);
    expect(paidAmount(user, project.id)).toBe(175);
  });

  it('paid -> pending clears paid_date and the paid amount; pending -> paid sets them again', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    const p = (await pay(user, { project_id: project.id, amount: 100, date: '2026-05-01' })).body;

    const pending = await user.put(`/api/payments/${p.id}`).send({ status: 'pending' });
    expect(pending.body.paid_date).toBeNull();
    expect(paidAmount(user, project.id)).toBe(0);

    const paid = await user.put(`/api/payments/${p.id}`).send({ status: 'paid' });
    expect(paid.body.paid_date).toBe('2026-05-01');
    expect(paidAmount(user, project.id)).toBe(100);
  });

  it('moving a payment between projects recalculates both', async () => {
    const user = await createUser();
    const a = await createClientProjectTask(user);
    const b = await createClientProjectTask(user);
    const p = (await pay(user, { project_id: a.project.id, amount: 400 })).body;
    const res = await user.put(`/api/payments/${p.id}`).send({ project_id: b.project.id });
    expect(res.status).toBe(200);
    expect(res.body.project_name).toBe(b.project.name);
    expect(paidAmount(user, a.project.id)).toBe(0);
    expect(paidAmount(user, b.project.id)).toBe(400);
  });

  it('replaces additional associations when given, keeps them when omitted', async () => {
    const user = await createUser();
    const a = await createClientProjectTask(user);
    const b = await createClientProjectTask(user);
    const p = (await pay(user, { project_id: a.project.id, amount: 1, additional_associations: [{ project_id: b.project.id }] })).body;

    const kept = await user.put(`/api/payments/${p.id}`).send({ notes: 'x' });
    expect(kept.body.additional_associations).toHaveLength(1);

    const cleared = await user.put(`/api/payments/${p.id}`).send({ additional_associations: [] });
    expect(cleared.body.additional_associations).toEqual([]);
  });

  it('a payment whose task was deleted can still be edited with its full payload', async () => {
    const user = await createUser();
    const a = await createClientProjectTask(user);
    const b = await createClientProjectTask(user);
    const p = (await pay(user, { project_id: a.project.id, task_id: a.task.id, amount: 10, additional_associations: [{ project_id: b.project.id }] })).body;
    user.db.prepare('DELETE FROM tasks WHERE id = ?').run(a.task.id);
    const res = await user.put(`/api/payments/${p.id}`).send({
      amount: 20, project_id: a.project.id, task_id: a.task.id, additional_associations: [{ project_id: b.project.id }]
    });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(20);
  });

  it('quick status change validates the status and updates paid amount', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    const p = (await pay(user, { project_id: project.id, amount: 90, status: 'sent' })).body;

    expect((await user.put(`/api/payments/${p.id}/status`).send({ status: 'bogus' })).status).toBe(400);
    expect((await user.put(`/api/payments/${p.id}/status`).send({})).status).toBe(400);
    expect((await user.put(`/api/payments/${uuidv4()}/status`).send({ status: 'paid' })).status).toBe(404);

    const res = await user.put(`/api/payments/${p.id}/status`).send({ status: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(res.body.paid_date).toBeTruthy();
    expect(paidAmount(user, project.id)).toBe(90);

    await user.put(`/api/payments/${p.id}/status`).send({ status: 'cancelled' });
    expect(paidAmount(user, project.id)).toBe(0);
  });

  // Bug: PUT /:id/status uses COALESCE(?, paid_date), so un-paying a payment keeps its old
  // paid_date, while the full PUT /:id clears it.
  it.fails('quick status change away from paid clears paid_date', async () => {
    const user = await createUser();
    const p = (await pay(user, { amount: 90 })).body;
    const res = await user.put(`/api/payments/${p.id}/status`).send({ status: 'pending' });
    expect(res.body.paid_date).toBeNull();
  });

  it('delete removes the payment and its associations and recalculates', async () => {
    const user = await createUser();
    const a = await createClientProjectTask(user);
    const b = await createClientProjectTask(user);
    const keep = (await pay(user, { project_id: a.project.id, amount: 10 })).body;
    const p = (await pay(user, { project_id: a.project.id, amount: 90, additional_associations: [{ project_id: b.project.id }] })).body;
    expect(paidAmount(user, a.project.id)).toBe(100);

    expect((await user.delete(`/api/payments/${p.id}`)).status).toBe(200);
    expect(paidAmount(user, a.project.id)).toBe(10);
    expect(user.db.prepare('SELECT COUNT(*) as n FROM payment_associations WHERE payment_id = ?').get(p.id).n).toBe(0);
    expect((await user.delete(`/api/payments/${p.id}`)).status).toBe(404);
    expect((await user.get(`/api/payments/${keep.id}`)).status).toBe(200);
  });
});

describe('payments: cross-workspace isolation', () => {
  it('another workspace cannot read, edit, re-status or delete a payment', async () => {
    const { alice, bob, a } = await twoWorkspaces();
    const p = (await pay(alice, { project_id: a.project.id, amount: 1000 })).body;

    expect((await bob.get('/api/payments')).body).toEqual([]);
    expect((await bob.get('/api/payments/summary')).body.income).toBe(0);
    expect((await bob.get(`/api/payments/${p.id}`)).status).toBe(404);
    expect((await bob.put(`/api/payments/${p.id}`).send({ amount: 1 })).status).toBe(404);
    expect((await bob.put(`/api/payments/${p.id}/status`).send({ status: 'cancelled' })).status).toBe(404);
    expect((await bob.delete(`/api/payments/${p.id}`)).status).toBe(404);
    expect((await bob.get(`/api/payments?project_id=${a.project.id}`)).body).toEqual([]);

    const mine = await alice.get(`/api/payments/${p.id}`);
    expect(mine.body).toMatchObject({ amount: 1000, status: 'paid' });
    expect(paidAmount(alice, a.project.id)).toBe(1000);
  });

  it('cannot create a payment on another workspace\'s project', async () => {
    const { alice, bob, a } = await twoWorkspaces();
    expect((await pay(bob, { project_id: a.project.id, amount: 5 })).status).toBe(404);
    expect(paidAmount(alice, a.project.id)).toBe(0);
  });

  it('cannot move a payment onto another workspace\'s project (or bump its paid amount)', async () => {
    const { alice, bob, a, b } = await twoWorkspaces();
    const p = (await pay(bob, { project_id: b.project.id, amount: 777 })).body;
    const res = await bob.put(`/api/payments/${p.id}`).send({ project_id: a.project.id });
    expect(res.status).toBe(404);
    expect(paidAmount(alice, a.project.id)).toBe(0);
    expect(paidAmount(bob, b.project.id)).toBe(777);
  });

  it('cannot reference another workspace\'s task or associate its projects (name leak)', async () => {
    const { alice, bob, a } = await twoWorkspaces();
    alice.db.prepare("UPDATE tasks SET name = 'Alice Secret Task' WHERE id = ?").run(a.task.id);
    alice.db.prepare("UPDATE projects SET name = 'Alice Secret Project' WHERE id = ?").run(a.project.id);

    expect((await pay(bob, { amount: 5, task_id: a.task.id })).status).toBe(404);
    expect((await pay(bob, { amount: 5, additional_associations: [{ project_id: a.project.id }] })).status).toBe(404);
    expect((await pay(bob, { amount: 5, additional_associations: [{ task_id: a.task.id }] })).status).toBe(404);

    const p = (await pay(bob, { amount: 5 })).body;
    expect((await bob.put(`/api/payments/${p.id}`).send({ task_id: a.task.id })).status).toBe(404);
    expect((await bob.put(`/api/payments/${p.id}`).send({ additional_associations: [{ project_id: a.project.id }] })).status).toBe(404);

    const list = JSON.stringify((await bob.get('/api/payments')).body);
    expect(list).not.toContain('Alice Secret');
  });

  it('an outsider sending another workspace id gets 403', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    await pay(owner, { amount: 5 });
    expect((await outsider.get('/api/payments', owner.workspaceId)).status).toBe(403);
  });
});
