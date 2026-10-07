import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getApp, createUser } from './helpers.js';
import { addEntry, backdateTimer } from './helpers-core.js';

const near = (actual, expected, slack = 4) => {
  expect(actual).toBeGreaterThanOrEqual(expected);
  expect(actual).toBeLessThan(expected + slack);
};

// month is 0-indexed in the API (Date.UTC semantics): 2 = March
const MARCH_2025 = 'month=2&year=2025';

async function seeded() {
  const user = await createUser();
  const client = (await user.post('/api/clients').send({ name: 'Stats client' })).body;
  const internal = (await user.post('/api/clients').send({ name: 'Internal' })).body;
  user.db.prepare('UPDATE clients SET is_internal = 1 WHERE id = ?').run(internal.id);
  const active = (await user.post('/api/projects').send({ client_id: client.id, name: 'Active' })).body;
  const done = (await user.post('/api/projects').send({ client_id: client.id, name: 'Done', status: 'completed' })).body;
  const hidden = (await user.post('/api/projects').send({ client_id: internal.id, name: 'Hidden' })).body;
  user.db.prepare('UPDATE projects SET is_internal = 1 WHERE id = ?').run(hidden.id);
  await user.post('/api/tasks').send({ project_id: active.id, name: 'T1', status: 'completed' });
  await user.post('/api/tasks').send({ project_id: active.id, name: 'T2' });
  await user.post('/api/tasks').send({ project_id: done.id, name: 'T3', status: 'completed' });

  // March 10th: 1h. February 15th: 30m. March 31st 22:00 -> April 1st 02:00: 4h (half in March).
  await addEntry(user, { project_id: active.id, start: '2025-03-10T09:00:00.000Z', seconds: 3600 });
  await addEntry(user, { project_id: active.id, start: '2025-02-15T09:00:00.000Z', seconds: 1800 });
  await addEntry(user, { project_id: done.id, start: '2025-03-31T22:00:00.000Z', seconds: 14400 });
  return { user, client, active, done };
}

describe('stats - dashboard', () => {
  it('requires a login', async () => {
    const { app } = await getApp();
    expect((await request(app).get('/api/stats/dashboard')).status).toBe(401);
  });

  it('starts at zero for a new user', async () => {
    const user = await createUser();
    const res = await user.get(`/api/stats/dashboard?${MARCH_2025}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      clients: 0,
      projects: { total: 0, active: 0 },
      tasks: { total: 0, completed: 0 },
      time: { total: 0, thisMonth: 0 },
      earnings: { total: 0, thisMonth: 0 }
    });
  });

  it('counts clients, projects and tasks (internal ones excluded)', async () => {
    const { user } = await seeded();
    const res = await user.get(`/api/stats/dashboard?${MARCH_2025}`);
    expect(res.body.clients).toBe(1);
    expect(res.body.projects).toEqual({ total: 2, active: 1 });
    expect(res.body.tasks).toEqual({ total: 3, completed: 2 });
  });

  it('splits time by month, pro-rating an entry that crosses the month boundary', async () => {
    const { user } = await seeded();
    const total = 3600 + 1800 + 14400;

    const march = (await user.get(`/api/stats/dashboard?${MARCH_2025}`)).body;
    expect(march.time).toEqual({ total, thisMonth: 3600 + 7200 });
    expect(march.selectedPeriod).toEqual({
      startDate: '2025-03-01T00:00:00.000Z',
      endDate: '2025-03-31T23:59:59.999Z',
      isCustomRange: false,
      periodIncludesToday: false
    });

    expect((await user.get('/api/stats/dashboard?month=1&year=2025')).body.time.thisMonth).toBe(1800);
    expect((await user.get('/api/stats/dashboard?month=3&year=2025')).body.time.thisMonth).toBe(7200);
    expect((await user.get('/api/stats/dashboard?month=0&year=2025')).body.time.thisMonth).toBe(0);
  });

  it('uses the right last day of the month (leap February)', async () => {
    const user = await createUser();
    const res = await user.get('/api/stats/dashboard?month=1&year=2024');
    expect(res.body.selectedPeriod.startDate).toBe('2024-02-01T00:00:00.000Z');
    expect(res.body.selectedPeriod.endDate).toBe('2024-02-29T23:59:59.999Z');
  });

  it('supports a custom date range with whole-day UTC boundaries', async () => {
    const { user } = await seeded();
    const res = await user.get('/api/stats/dashboard?startDate=2025-03-10&endDate=2025-03-10');
    expect(res.body.selectedPeriod).toMatchObject({
      startDate: '2025-03-10T00:00:00.000Z',
      endDate: '2025-03-10T23:59:59.999Z',
      isCustomRange: true
    });
    expect(res.body.time.thisMonth).toBe(3600);

    // 31 March only: the 22:00-24:00 part, i.e. half of the 4h entry
    const lastDay = await user.get('/api/stats/dashboard?startDate=2025-03-31&endDate=2025-03-31');
    expect(lastDay.body.time.thisMonth).toBe(7200);

    const span = await user.get('/api/stats/dashboard?startDate=2025-02-01&endDate=2025-04-30');
    expect(span.body.time.thisMonth).toBe(3600 + 1800 + 14400);
  });

  it('attributes a zero-span entry to its start day', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'C' })).body;
    const project = (await user.post('/api/projects').send({ client_id: client.id, name: 'P' })).body;
    await user.post('/api/timer/entries').send({
      project_id: project.id,
      start_time: '2025-03-15T12:00:00.000Z',
      end_time: '2025-03-15T12:00:00.000Z',
      duration: 600
    });
    expect((await user.get(`/api/stats/dashboard?${MARCH_2025}`)).body.time.thisMonth).toBe(600);
    expect((await user.get('/api/stats/dashboard?month=3&year=2025')).body.time.thisMonth).toBe(0);
  });

  it('computes earnings from the default hourly rate', async () => {
    const { user } = await seeded();
    const total = 19800;
    const before = (await user.get(`/api/stats/dashboard?${MARCH_2025}`)).body.earnings;
    expect(before).toEqual({ total: Math.round((total / 3600) * 250), thisMonth: Math.round((10800 / 3600) * 250) });

    await user.put('/api/auth/profile').send({ default_hourly_rate: 400 });
    const after = (await user.get(`/api/stats/dashboard?${MARCH_2025}`)).body.earnings;
    expect(after).toEqual({ total: Math.round((total / 3600) * 400), thisMonth: 1200 });
  });

  it('includes running and paused timers in the totals', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'C' })).body;
    const project = (await user.post('/api/projects').send({ client_id: client.id, name: 'P' })).body;
    const task = (await user.post('/api/tasks').send({ project_id: project.id, name: 'T' })).body;
    const running = (await user.post('/api/timer/start').send({ project_id: project.id })).body;
    backdateTimer(user.db, running.id, 3600);
    const paused = (await user.post('/api/timer/start').send({ project_id: project.id, task_id: task.id })).body;
    backdateTimer(user.db, paused.id, 600);
    const pausedBody = (await user.post(`/api/timer/pause/${paused.id}`)).body;

    const today = new Date();
    const day = (offset) => new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);
    const res = await user.get(`/api/stats/dashboard?startDate=${day(-2)}&endDate=${day(1)}`);
    expect(res.body.selectedPeriod.periodIncludesToday).toBe(true);
    near(res.body.time.total, 3600 + pausedBody.accumulated_seconds);
    near(res.body.time.thisMonth, 3600 + pausedBody.accumulated_seconds);

    // A period in the past does not get the live timer time, but the all-time total does
    const past = (await user.get(`/api/stats/dashboard?${MARCH_2025}`)).body.time;
    expect(past.thisMonth).toBe(0);
    near(past.total, 3600 + pausedBody.accumulated_seconds);
  });

  it('defaults to the current UTC month', async () => {
    const user = await createUser();
    const res = await user.get('/api/stats/dashboard');
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    expect(res.body.selectedPeriod.startDate).toBe(first);
    expect(res.body.selectedPeriod.periodIncludesToday).toBe(true);
  });
});

describe('stats - client', () => {
  it('returns 404 for an unknown client', async () => {
    const user = await createUser();
    expect((await user.get('/api/stats/client/nope')).status).toBe(404);
  });

  it('sums time and bills only chargeable work at the client rate', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'Rated', hourly_rate: 120 })).body;
    const paid = (await user.post('/api/projects').send({ client_id: client.id, name: 'Paid' })).body;
    const free = (await user.post('/api/projects').send({ client_id: client.id, name: 'Free', pricing_type: 'no_charge', status: 'completed' })).body;
    const freeTask = (await user.post('/api/tasks').send({ project_id: paid.id, name: 'Free task', pricing_type: 'no_charge' })).body;
    await addEntry(user, { project_id: paid.id, start: '2025-03-01T09:00:00.000Z', seconds: 7200 });
    await addEntry(user, { project_id: paid.id, task_id: freeTask.id, start: '2025-03-02T09:00:00.000Z', seconds: 3600 });
    await addEntry(user, { project_id: free.id, start: '2025-03-03T09:00:00.000Z', seconds: 1800 });

    const res = await user.get(`/api/stats/client/${client.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projects: { total: 2, active: 1 },
      time: { total: 7200 + 3600 + 1800 },
      earnings: { total: 240, hourlyRate: 120 }
    });
  });

  it('falls back to the user default rate, then 250', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'No rate' })).body;
    const project = (await user.post('/api/projects').send({ client_id: client.id, name: 'P' })).body;
    await addEntry(user, { project_id: project.id, start: '2025-03-01T09:00:00.000Z', seconds: 3600 });
    expect((await user.get(`/api/stats/client/${client.id}`)).body.earnings).toEqual({ total: 250, hourlyRate: 250 });
    await user.put('/api/auth/profile').send({ default_hourly_rate: 300 });
    expect((await user.get(`/api/stats/client/${client.id}`)).body.earnings).toEqual({ total: 300, hourlyRate: 300 });
  });
});

describe('stats - project', () => {
  async function project(user, clientBody, projectBody) {
    const client = (await user.post('/api/clients').send({ name: 'C', ...clientBody })).body;
    return (await user.post('/api/projects').send({ client_id: client.id, name: 'P', ...projectBody })).body;
  }

  it('returns 404 for an unknown project', async () => {
    const user = await createUser();
    expect((await user.get('/api/stats/project/nope')).status).toBe(404);
  });

  it('hourly rate falls back project -> client -> user default', async () => {
    const user = await createUser();
    const own = await project(user, { hourly_rate: 150 }, { hourly_rate: 200 });
    const fromClient = await project(user, { hourly_rate: 150 }, {});
    const fromUser = await project(user, {}, {});
    for (const p of [own, fromClient, fromUser]) {
      await addEntry(user, { project_id: p.id, start: '2025-03-01T09:00:00.000Z', seconds: 5400 });
    }
    await user.put('/api/auth/profile').send({ default_hourly_rate: 320 });

    const stats = async (p) => (await user.get(`/api/stats/project/${p.id}`)).body.earnings;
    expect(await stats(own)).toMatchObject({ hourlyRate: 200, total: 300, costPerHour: 200, pricingType: 'hourly' });
    expect(await stats(fromClient)).toMatchObject({ hourlyRate: 150, total: 225, costPerHour: 150 });
    expect(await stats(fromUser)).toMatchObject({ hourlyRate: 320, total: 480, costPerHour: 320 });
  });

  it('bills only chargeable tasks and counts tasks', async () => {
    const user = await createUser();
    const p = await project(user, {}, { hourly_rate: 100 });
    const free = (await user.post('/api/tasks').send({ project_id: p.id, name: 'Free', pricing_type: 'no_charge', status: 'completed' })).body;
    const paid = (await user.post('/api/tasks').send({ project_id: p.id, name: 'Paid' })).body;
    await addEntry(user, { project_id: p.id, task_id: paid.id, start: '2025-03-01T09:00:00.000Z', seconds: 3600 });
    await addEntry(user, { project_id: p.id, task_id: free.id, start: '2025-03-01T11:00:00.000Z', seconds: 3600 });
    await addEntry(user, { project_id: p.id, start: '2025-03-01T13:00:00.000Z', seconds: 1800 });

    const res = (await user.get(`/api/stats/project/${p.id}`)).body;
    expect(res.tasks).toEqual({ total: 2, completed: 1 });
    expect(res.time).toEqual({ total: 9000 });
    expect(res.earnings).toMatchObject({ total: 150, hourlyRate: 100 });
  });

  it('fixed price: earnings are the price and cost per hour is price / hours', async () => {
    const user = await createUser();
    const p = await project(user, {}, { pricing_type: 'fixed', fixed_price: 5000 });
    expect((await user.get(`/api/stats/project/${p.id}`)).body.earnings).toMatchObject({ total: 5000, costPerHour: 0, fixedPrice: 5000, pricingType: 'fixed' });
    await addEntry(user, { project_id: p.id, start: '2025-03-01T09:00:00.000Z', seconds: 7200 });
    expect((await user.get(`/api/stats/project/${p.id}`)).body.earnings).toMatchObject({ total: 5000, costPerHour: 2500 });
  });

  it('no_charge projects earn nothing', async () => {
    const user = await createUser();
    const p = await project(user, { hourly_rate: 500 }, { pricing_type: 'no_charge' });
    await addEntry(user, { project_id: p.id, start: '2025-03-01T09:00:00.000Z', seconds: 7200 });
    const res = (await user.get(`/api/stats/project/${p.id}`)).body;
    expect(res.time.total).toBe(7200);
    expect(res.earnings).toMatchObject({ total: 0, costPerHour: 0, pricingType: 'no_charge' });
  });
});
