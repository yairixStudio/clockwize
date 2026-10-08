import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { addEntry } from './helpers-core.js';

const newClient = async (user, body = {}) => (await user.post('/api/clients').send({ name: 'Client', ...body })).body;

describe('projects - create', () => {
  it('requires a login', async () => {
    const { app } = await getApp();
    expect((await request(app).get('/api/projects')).status).toBe(401);
  });

  it('requires client_id and name', async () => {
    const user = await createUser();
    const client = await newClient(user);
    expect((await user.post('/api/projects').send({ name: 'No client' })).status).toBe(400);
    expect((await user.post('/api/projects').send({ client_id: client.id })).status).toBe(400);
  });

  it('returns 404 for an unknown client', async () => {
    const user = await createUser();
    expect((await user.post('/api/projects').send({ client_id: 'nope', name: 'P' })).status).toBe(404);
  });

  it('creates a project with defaults', async () => {
    const user = await createUser();
    const client = await newClient(user);
    const res = await user.post('/api/projects').send({ client_id: client.id, name: 'Site' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      client_id: client.id,
      name: 'Site',
      pricing_type: 'hourly',
      status: 'active',
      priority: 'normal',
      paid_amount: 0,
      hourly_rate: null,
      fixed_price: null,
      is_favorite: 0,
      workspace_id: user.workspaceId
    });
  });

  it('stores pricing, estimates and communication platforms', async () => {
    const user = await createUser();
    const client = await newClient(user);
    const res = await user.post('/api/projects').send({
      client_id: client.id,
      name: 'Fixed',
      pricing_type: 'fixed',
      fixed_price: 5000,
      estimated_hours: 20,
      priority: 'high',
      paid_amount: 1000,
      communication_platforms: ['whatsapp', 'email']
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ pricing_type: 'fixed', fixed_price: 5000, estimated_hours: 20, priority: 'high', paid_amount: 1000 });
    expect(JSON.parse(res.body.communication_platforms)).toEqual(['whatsapp', 'email']);
  });
});

describe('projects - read', () => {
  it('lists projects with counts and totals, filters by client, hides internal ones', async () => {
    const user = await createUser();
    const c1 = await newClient(user, { name: 'C1' });
    const c2 = await newClient(user, { name: 'C2' });
    const p1 = (await user.post('/api/projects').send({ client_id: c1.id, name: 'P1' })).body;
    const p2 = (await user.post('/api/projects').send({ client_id: c2.id, name: 'P2' })).body;
    const hidden = (await user.post('/api/projects').send({ client_id: c1.id, name: 'Hidden' })).body;
    user.db.prepare('UPDATE projects SET is_internal = 1 WHERE id = ?').run(hidden.id);
    const freeTask = (await user.post('/api/tasks').send({ project_id: p1.id, name: 'Free', pricing_type: 'no_charge' })).body;
    await user.post('/api/tasks').send({ project_id: p1.id, name: 'Paid' });
    await addEntry(user, { project_id: p1.id, start: '2025-01-01T10:00:00.000Z', seconds: 1000 });
    await addEntry(user, { project_id: p1.id, task_id: freeTask.id, start: '2025-01-01T12:00:00.000Z', seconds: 500 });

    const all = (await user.get('/api/projects')).body;
    expect(all.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
    const row = all.find((p) => p.id === p1.id);
    expect(row).toMatchObject({ client_name: 'C1', task_count: 2, total_time: 1500, billable_time: 1000 });

    const filtered = (await user.get(`/api/projects?client_id=${c2.id}`)).body;
    expect(filtered.map((p) => p.id)).toEqual([p2.id]);
  });

  it('returns a single project with its client rate, or 404', async () => {
    const user = await createUser();
    const client = await newClient(user, { name: 'Rated', hourly_rate: 333 });
    const project = (await user.post('/api/projects').send({ client_id: client.id, name: 'P' })).body;
    const res = await user.get(`/api/projects/${project.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ client_name: 'Rated', client_hourly_rate: 333, task_count: 0, total_time: 0 });
    expect((await user.get('/api/projects/nope')).status).toBe(404);
  });
});

describe('projects - update', () => {
  it('returns 404 for an unknown project', async () => {
    const user = await createUser();
    expect((await user.put('/api/projects/nope').send({ name: 'x' })).status).toBe(404);
    expect((await user.patch('/api/projects/nope/favorite').send({ is_favorite: true })).status).toBe(404);
  });

  it('applies partial updates and keeps the rest', async () => {
    const user = await createUser();
    const client = await newClient(user);
    const project = (
      await user.post('/api/projects').send({
        client_id: client.id,
        name: 'Keep',
        description: 'desc',
        hourly_rate: 250,
        estimated_hours: 10,
        priority: 'high',
        communication_platforms: ['slack']
      })
    ).body;
    const res = await user.put(`/api/projects/${project.id}`).send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Keep',
      description: 'desc',
      hourly_rate: 250,
      estimated_hours: 10,
      priority: 'high',
      status: 'completed',
      client_id: client.id
    });
    expect(JSON.parse(res.body.communication_platforms)).toEqual(['slack']);

    const cleared = await user.put(`/api/projects/${project.id}`).send({ description: '', communication_platforms: null, priority: '' });
    expect(cleared.body.description).toBeNull();
    expect(cleared.body.communication_platforms).toBeNull();
    expect(cleared.body.priority).toBe('normal');
  });

  it('moves a project to another client only while it has no time entries', async () => {
    const user = await createUser();
    const from = await newClient(user, { name: 'From' });
    const to = await newClient(user, { name: 'To' });
    const project = (await user.post('/api/projects').send({ client_id: from.id, name: 'Mover' })).body;

    expect((await user.put(`/api/projects/${project.id}`).send({ client_id: 'nope' })).status).toBe(404);

    const moved = await user.put(`/api/projects/${project.id}`).send({ client_id: to.id });
    expect(moved.status).toBe(200);
    expect(moved.body.client_id).toBe(to.id);

    await addEntry(user, { project_id: project.id, start: '2025-01-01T10:00:00.000Z', seconds: 60 });
    const blocked = await user.put(`/api/projects/${project.id}`).send({ client_id: from.id });
    expect(blocked.status).toBe(409);
    expect((await user.get(`/api/projects/${project.id}`)).body.client_id).toBe(to.id);

    // Sending the same client id is not a move
    expect((await user.put(`/api/projects/${project.id}`).send({ client_id: to.id, name: 'Renamed' })).status).toBe(200);
  });

  it('toggles favourite', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    expect((await user.patch(`/api/projects/${project.id}/favorite`).send({ is_favorite: 1 })).body.is_favorite).toBe(1);
    expect((await user.patch(`/api/projects/${project.id}/favorite`).send({})).body.is_favorite).toBe(0);
  });
});

describe('projects - delete', () => {
  it('deletes the project and cascades to tasks, subtasks and entries, but keeps the client', async () => {
    const user = await createUser();
    const { client, project, task } = await createClientProjectTask(user);
    const sub = (await user.post(`/api/tasks/${task.id}/subtasks`).send({ title: 'S' })).body;
    const entry = await addEntry(user, { project_id: project.id, start: '2025-01-01T10:00:00.000Z', seconds: 60 });

    expect((await user.delete(`/api/projects/${project.id}`)).status).toBe(200);
    const { db } = user;
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE id = ?').get(task.id).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM subtasks WHERE id = ?').get(sub.id).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE id = ?').get(entry.id).n).toBe(0);
    expect((await user.get(`/api/clients/${client.id}`)).status).toBe(200);
    expect((await user.delete(`/api/projects/${project.id}`)).status).toBe(404);
  });
});

describe('projects - share links', () => {
  it('exposes a public view with task totals and can be revoked', async () => {
    const user = await createUser();
    const { app } = await getApp();
    const { project, task } = await createClientProjectTask(user);
    await addEntry(user, { project_id: project.id, task_id: task.id, start: '2025-01-01T10:00:00.000Z', seconds: 900 });

    const share = await user.post(`/api/projects/${project.id}/share`).send({ permissions: 'comment' });
    expect(share.status).toBe(200);
    expect(share.body.permissions).toBe('comment');

    const pub = await request(app).get(`/api/projects/shared/${share.body.share_token}`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ name: 'Website', client_name: 'Acme Ltd', total_time: 900, share_permissions: 'comment' });
    expect(pub.body.tasks).toEqual([expect.objectContaining({ id: task.id, total_time: 900 })]);

    expect((await user.delete(`/api/projects/${project.id}/share`)).status).toBe(200);
    expect((await request(app).get(`/api/projects/shared/${share.body.share_token}`)).status).toBe(404);
    expect((await user.post('/api/projects/nope/share').send({})).status).toBe(404);
    expect((await user.delete('/api/projects/nope/share')).status).toBe(404);
  });
});

describe('tasks - create and read', () => {
  it('requires project_id and name, and an existing project', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    expect((await user.post('/api/tasks').send({ name: 'x' })).status).toBe(400);
    expect((await user.post('/api/tasks').send({ project_id: project.id })).status).toBe(400);
    expect((await user.post('/api/tasks').send({ project_id: 'nope', name: 'x' })).status).toBe(404);
  });

  it('creates a task with defaults (pricing inherits from the project when null)', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    const res = await user.post('/api/tasks').send({ project_id: project.id, name: 'T' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      project_id: project.id,
      name: 'T',
      status: 'pending',
      priority: 'normal',
      pricing_type: null,
      hourly_rate: null,
      paid_amount: 0,
      workspace_id: user.workspaceId
    });
  });

  it('returns a task with the project and client rates for the pricing fallback', async () => {
    const user = await createUser();
    const client = await newClient(user, { name: 'Rate client', hourly_rate: 180 });
    const project = (await user.post('/api/projects').send({ client_id: client.id, name: 'Rate project', hourly_rate: 220, pricing_type: 'hourly' })).body;
    const task = (await user.post('/api/tasks').send({ project_id: project.id, name: 'Rate task', hourly_rate: 260 })).body;
    await addEntry(user, { project_id: project.id, task_id: task.id, start: '2025-01-01T10:00:00.000Z', seconds: 120 });

    const res = await user.get(`/api/tasks/${task.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      hourly_rate: 260,
      project_hourly_rate: 220,
      project_pricing_type: 'hourly',
      client_hourly_rate: 180,
      client_id: client.id,
      client_name: 'Rate client',
      project_name: 'Rate project',
      total_time: 120,
      subtasks: []
    });
    expect((await user.get('/api/tasks/nope')).status).toBe(404);
  });

  it('lists tasks, filters by project and optionally includes subtasks', async () => {
    const user = await createUser();
    const { project, task } = await createClientProjectTask(user);
    const other = (await user.post('/api/projects').send({ client_id: project.client_id, name: 'Other' })).body;
    const otherTask = (await user.post('/api/tasks').send({ project_id: other.id, name: 'Other task' })).body;
    await user.post(`/api/tasks/${task.id}/subtasks`).send({ title: 'Sub 1' });

    const all = (await user.get('/api/tasks')).body;
    expect(all.map((t) => t.id).sort()).toEqual([task.id, otherTask.id].sort());
    expect(all[0].subtasks).toBeUndefined();

    const filtered = (await user.get(`/api/tasks?project_id=${project.id}`)).body;
    expect(filtered.map((t) => t.id)).toEqual([task.id]);
    expect(filtered[0]).toMatchObject({ project_name: 'Website', client_name: 'Acme Ltd' });

    const withSubs = (await user.get(`/api/tasks?project_id=${project.id}&include_subtasks=true`)).body;
    expect(withSubs[0].subtasks.map((s) => s.title)).toEqual(['Sub 1']);
  });
});

describe('tasks - update and delete', () => {
  it('applies partial updates and keeps the rest', async () => {
    const user = await createUser();
    const { project } = await createClientProjectTask(user);
    const task = (await user.post('/api/tasks').send({ project_id: project.id, name: 'T', description: 'd', hourly_rate: 99, priority: 'low' })).body;
    const res = await user.put(`/api/tasks/${task.id}`).send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'T', description: 'd', hourly_rate: 99, priority: 'low', status: 'completed' });

    const priced = await user.put(`/api/tasks/${task.id}`).send({ pricing_type: 'no_charge' });
    expect(priced.body.pricing_type).toBe('no_charge');
    const inherit = await user.put(`/api/tasks/${task.id}`).send({ pricing_type: '' });
    expect(inherit.body.pricing_type).toBeNull();

    expect((await user.put('/api/tasks/nope').send({ name: 'x' })).status).toBe(404);
  });

  it('moves a task to another project only while it has no time entries', async () => {
    const user = await createUser();
    const { project, task } = await createClientProjectTask(user);
    const target = (await user.post('/api/projects').send({ client_id: project.client_id, name: 'Target' })).body;

    expect((await user.put(`/api/tasks/${task.id}`).send({ project_id: 'nope' })).status).toBe(404);
    const moved = await user.put(`/api/tasks/${task.id}`).send({ project_id: target.id });
    expect(moved.status).toBe(200);
    expect(moved.body.project_id).toBe(target.id);

    await addEntry(user, { project_id: target.id, task_id: task.id, start: '2025-01-01T10:00:00.000Z', seconds: 60 });
    expect((await user.put(`/api/tasks/${task.id}`).send({ project_id: project.id })).status).toBe(409);
    expect((await user.get(`/api/tasks/${task.id}`)).body.project_id).toBe(target.id);
  });

  it('deletes a task with its subtasks and entries, keeping the project', async () => {
    const user = await createUser();
    const { project, task } = await createClientProjectTask(user);
    const sub = (await user.post(`/api/tasks/${task.id}/subtasks`).send({ title: 'S' })).body;
    const entry = await addEntry(user, { project_id: project.id, task_id: task.id, start: '2025-01-01T10:00:00.000Z', seconds: 60 });

    expect((await user.delete(`/api/tasks/${task.id}`)).status).toBe(200);
    expect(user.db.prepare('SELECT COUNT(*) AS n FROM subtasks WHERE id = ?').get(sub.id).n).toBe(0);
    expect(user.db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE id = ?').get(entry.id).n).toBe(0);
    expect((await user.get(`/api/projects/${project.id}`)).status).toBe(200);
    expect((await user.delete(`/api/tasks/${task.id}`)).status).toBe(404);
  });
});

describe('subtasks', () => {
  it('requires a title and an existing task', async () => {
    const user = await createUser();
    const { task } = await createClientProjectTask(user);
    expect((await user.post(`/api/tasks/${task.id}/subtasks`).send({})).status).toBe(400);
    expect((await user.post('/api/tasks/nope/subtasks').send({ title: 'x' })).status).toBe(404);
  });

  it('creates, updates and deletes a subtask', async () => {
    const user = await createUser();
    const { task } = await createClientProjectTask(user);
    const created = await user.post(`/api/tasks/${task.id}/subtasks`).send({
      title: 'Write copy',
      due_date: '2025-05-01',
      priority: 'high',
      communication_platforms: ['email']
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ task_id: task.id, title: 'Write copy', is_completed: 0, due_date: '2025-05-01', priority: 'high' });

    const done = await user.put(`/api/tasks/subtasks/${created.body.id}`).send({ is_completed: true, title: '  Trimmed  ' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ is_completed: 1, title: 'Trimmed', due_date: '2025-05-01' });

    const cleared = await user.put(`/api/tasks/subtasks/${created.body.id}`).send({ due_date: '', priority: '' });
    expect(cleared.body).toMatchObject({ due_date: null, priority: 'normal' });

    const fetched = await user.get(`/api/tasks/${task.id}`);
    expect(fetched.body.subtasks).toHaveLength(1);

    expect((await user.delete(`/api/tasks/subtasks/${created.body.id}`)).status).toBe(200);
    expect((await user.delete(`/api/tasks/subtasks/${created.body.id}`)).status).toBe(404);
  });

  it('rejects empty titles and empty updates', async () => {
    const user = await createUser();
    const { task } = await createClientProjectTask(user);
    const sub = (await user.post(`/api/tasks/${task.id}/subtasks`).send({ title: 'S' })).body;
    expect((await user.put(`/api/tasks/subtasks/${sub.id}`).send({ title: '   ' })).status).toBe(400);
    expect((await user.put(`/api/tasks/subtasks/${sub.id}`).send({})).status).toBe(400);
    expect((await user.put('/api/tasks/subtasks/nope').send({ title: 'x' })).status).toBe(404);
  });

  it('moves a subtask to another task unless it has time entries', async () => {
    const user = await createUser();
    const { project, task } = await createClientProjectTask(user);
    const other = (await user.post('/api/tasks').send({ project_id: project.id, name: 'Other' })).body;
    const sub = (await user.post(`/api/tasks/${task.id}/subtasks`).send({ title: 'S' })).body;

    expect((await user.put(`/api/tasks/subtasks/${sub.id}`).send({ task_id: 'nope' })).status).toBe(404);
    const moved = await user.put(`/api/tasks/subtasks/${sub.id}`).send({ task_id: other.id });
    expect(moved.status).toBe(200);
    expect(moved.body.task_id).toBe(other.id);

    await addEntry(user, { project_id: project.id, task_id: other.id, subtask_id: sub.id, start: '2025-01-01T10:00:00.000Z', seconds: 60 });
    expect((await user.put(`/api/tasks/subtasks/${sub.id}`).send({ task_id: task.id })).status).toBe(409);
  });
});
