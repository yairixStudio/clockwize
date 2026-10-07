import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { addEntry } from './helpers-core.js';

describe('clients - create', () => {
  it('requires a login', async () => {
    const { app } = await getApp();
    expect((await request(app).get('/api/clients')).status).toBe(401);
    expect((await request(app).post('/api/clients').send({ name: 'x' })).status).toBe(401);
  });

  it('requires a name', async () => {
    const user = await createUser();
    const res = await user.post('/api/clients').send({ phone: '050' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('creates a client with defaults and stores it in the current workspace', async () => {
    const user = await createUser();
    const res = await user.post('/api/clients').send({ name: 'Acme' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Acme',
      status: 'active',
      is_favorite: 0,
      hourly_rate: null,
      workspace_id: user.workspaceId,
      user_id: user.user.id,
      aliases: [],
      domains: []
    });
    expect(res.body.id).toBeTruthy();
  });

  it('stores all optional fields and round-trips aliases/domains as arrays', async () => {
    const user = await createUser();
    const res = await user.post('/api/clients').send({
      name: 'Full Co',
      address: 'Herzl 1',
      phone: '050-1234567',
      email: 'full@example.com',
      tax_id: '512345678',
      notes: 'VIP',
      hourly_rate: 320,
      status: 'inactive',
      is_favorite: true,
      aliases: ['FC', 'Full'],
      domains: ['full.co.il']
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      address: 'Herzl 1',
      phone: '050-1234567',
      email: 'full@example.com',
      tax_id: '512345678',
      notes: 'VIP',
      hourly_rate: 320,
      status: 'inactive',
      is_favorite: 1,
      aliases: ['FC', 'Full'],
      domains: ['full.co.il']
    });

    const fetched = await user.get(`/api/clients/${res.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.aliases).toEqual(['FC', 'Full']);
    expect(fetched.body.domains).toEqual(['full.co.il']);
  });

  it('ignores aliases/domains that are not arrays', async () => {
    const user = await createUser();
    const res = await user.post('/api/clients').send({ name: 'Odd', aliases: 'nope', domains: { a: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.aliases).toEqual([]);
    expect(res.body.domains).toEqual([]);
  });
});

describe('clients - read', () => {
  it('returns 404 for an unknown client', async () => {
    const user = await createUser();
    const res = await user.get('/api/clients/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('lists only the workspace clients and hides internal ones', async () => {
    const user = await createUser();
    const a = await user.post('/api/clients').send({ name: 'Visible' });
    const b = await user.post('/api/clients').send({ name: 'Internal' });
    user.db.prepare('UPDATE clients SET is_internal = 1 WHERE id = ?').run(b.body.id);

    const res = await user.get('/api/clients');
    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.id)).toEqual([a.body.id]);
  });

  it('puts favourites first, then the most recent interaction', async () => {
    const user = await createUser();
    const old = await user.post('/api/clients').send({ name: 'Old' });
    const recent = await user.post('/api/clients').send({ name: 'Recent' });
    const fav = await user.post('/api/clients').send({ name: 'Fav' });
    const { db } = user;
    db.prepare("UPDATE clients SET created_at = '2024-01-01 10:00:00', updated_at = '2024-01-01 10:00:00' WHERE id = ?").run(old.body.id);
    db.prepare("UPDATE clients SET created_at = '2024-01-01 10:00:00', updated_at = '2024-06-01 10:00:00' WHERE id = ?").run(recent.body.id);
    db.prepare("UPDATE clients SET created_at = '2023-01-01 10:00:00', updated_at = '2023-01-01 10:00:00', is_favorite = 1 WHERE id = ?").run(fav.body.id);

    const res = await user.get('/api/clients');
    expect(res.body.map((c) => c.name)).toEqual(['Fav', 'Recent', 'Old']);
    expect(res.body.find((c) => c.name === 'Recent').last_interaction).toBe('2024-06-01 10:00:00');
  });

  it('a newer time entry on an older client moves it up', async () => {
    const user = await createUser();
    const quiet = await user.post('/api/clients').send({ name: 'Quiet' });
    const busy = await user.post('/api/clients').send({ name: 'Busy' });
    const { db } = user;
    db.prepare("UPDATE clients SET created_at = '2024-01-01 10:00:00', updated_at = '2024-05-01 10:00:00' WHERE id = ?").run(quiet.body.id);
    db.prepare("UPDATE clients SET created_at = '2023-01-01 10:00:00', updated_at = '2023-01-01 10:00:00' WHERE id = ?").run(busy.body.id);
    const project = await user.post('/api/projects').send({ client_id: busy.body.id, name: 'P' });
    db.prepare("UPDATE projects SET created_at = '2023-01-01 10:00:00', updated_at = '2023-01-01 10:00:00' WHERE id = ?").run(project.body.id);
    await addEntry(user, { project_id: project.body.id, start: '2024-09-01T10:00:00.000Z', seconds: 60 });

    const res = await user.get('/api/clients');
    expect(res.body.map((c) => c.name)).toEqual(['Busy', 'Quiet']);
  });

  it('reports project count, total time and billable time (no_charge excluded)', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'Stats' })).body;
    const billable = (await user.post('/api/projects').send({ client_id: client.id, name: 'Billable' })).body;
    const free = (await user.post('/api/projects').send({ client_id: client.id, name: 'Free', pricing_type: 'no_charge' })).body;
    const freeTask = (await user.post('/api/tasks').send({ project_id: billable.id, name: 'Free task', pricing_type: 'no_charge' })).body;
    const paidTask = (await user.post('/api/tasks').send({ project_id: billable.id, name: 'Paid task' })).body;

    await addEntry(user, { project_id: billable.id, start: '2025-01-05T08:00:00.000Z', seconds: 3600 });
    await addEntry(user, { project_id: billable.id, task_id: paidTask.id, start: '2025-01-05T10:00:00.000Z', seconds: 1800 });
    await addEntry(user, { project_id: billable.id, task_id: freeTask.id, start: '2025-01-05T12:00:00.000Z', seconds: 600 });
    await addEntry(user, { project_id: free.id, start: '2025-01-05T14:00:00.000Z', seconds: 900 });

    const list = (await user.get('/api/clients')).body.find((c) => c.id === client.id);
    expect(list.project_count).toBe(2);
    expect(list.total_time).toBe(3600 + 1800 + 600 + 900);
    expect(list.billable_time).toBe(3600 + 1800);

    const single = (await user.get(`/api/clients/${client.id}`)).body;
    expect(single.project_count).toBe(2);
    expect(single.total_time).toBe(6900);
    expect(single.billable_time).toBe(5400);
  });

  it('includes the client source name', async () => {
    const user = await createUser();
    const sourceId = 'src-' + Date.now();
    user.db.prepare('INSERT INTO client_sources (id, name, workspace_id) VALUES (?, ?, ?)').run(sourceId, 'Facebook', user.workspaceId);
    const client = (await user.post('/api/clients').send({ name: 'Sourced', source_id: sourceId, sub_source: 'ad' })).body;
    const res = await user.get(`/api/clients/${client.id}`);
    expect(res.body.source_name).toBe('Facebook');
    expect(res.body.sub_source).toBe('ad');
  });
});

describe('clients - update', () => {
  it('returns 404 for an unknown client', async () => {
    const user = await createUser();
    expect((await user.put('/api/clients/nope').send({ name: 'x' })).status).toBe(404);
    expect((await user.patch('/api/clients/nope/favorite').send({ is_favorite: true })).status).toBe(404);
  });

  it('updates the fields that are sent', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'Before', hourly_rate: 100 })).body;
    const res = await user.put(`/api/clients/${client.id}`).send({
      name: 'After',
      phone: '03-555',
      hourly_rate: 450,
      status: 'inactive',
      aliases: ['A'],
      domains: ['after.com']
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'After',
      phone: '03-555',
      hourly_rate: 450,
      status: 'inactive',
      aliases: ['A'],
      domains: ['after.com']
    });
  });

  it('keeps name, status, favourite, aliases and domains when they are not sent', async () => {
    const user = await createUser();
    const client = (
      await user.post('/api/clients').send({
        name: 'Keep',
        status: 'inactive',
        is_favorite: true,
        aliases: ['K'],
        domains: ['keep.io']
      })
    ).body;
    const res = await user.put(`/api/clients/${client.id}`).send({ notes: 'just notes' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Keep',
      status: 'inactive',
      is_favorite: 1,
      aliases: ['K'],
      domains: ['keep.io'],
      notes: 'just notes'
    });
  });

  // The breadcrumb rename (ClientDetail) and the source editor (MarketingFunnels) send partial bodies
  it('a partial update (rename) does not wipe contact, billing or rate fields', async () => {
    const user = await createUser();
    const client = (
      await user.post('/api/clients').send({
        name: 'Original',
        address: 'Main st 5',
        phone: '050-9999999',
        email: 'c@example.com',
        bank_name: 'Leumi',
        bank_account: '123456',
        bank_branch: '800',
        tax_id: '987654321',
        notes: 'important',
        hourly_rate: 300
      })
    ).body;

    const res = await user.put(`/api/clients/${client.id}`).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Renamed',
      address: 'Main st 5',
      phone: '050-9999999',
      email: 'c@example.com',
      bank_name: 'Leumi',
      bank_account: '123456',
      bank_branch: '800',
      tax_id: '987654321',
      notes: 'important',
      hourly_rate: 300
    });

    const sourceOnly = await user.put(`/api/clients/${client.id}`).send({ source_id: null, sub_source: null });
    expect(sourceOnly.status).toBe(200);
    expect(sourceOnly.body.phone).toBe('050-9999999');
    expect(sourceOnly.body.hourly_rate).toBe(300);
  });

  it('can still clear a field explicitly', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'Clear', phone: '050', hourly_rate: 200 })).body;
    const res = await user.put(`/api/clients/${client.id}`).send({ phone: '', hourly_rate: null });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBeNull();
    expect(res.body.hourly_rate).toBeNull();
    expect(res.body.name).toBe('Clear');
  });

  it('can set aliases back to empty', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'Al', aliases: ['x'] })).body;
    const res = await user.put(`/api/clients/${client.id}`).send({ aliases: null });
    expect(res.body.aliases).toEqual([]);
  });

  it('toggles favourite', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'Fav' })).body;
    const on = await user.patch(`/api/clients/${client.id}/favorite`).send({ is_favorite: true });
    expect(on.status).toBe(200);
    expect(on.body.is_favorite).toBe(1);
    const off = await user.patch(`/api/clients/${client.id}/favorite`).send({ is_favorite: false });
    expect(off.body.is_favorite).toBe(0);
  });
});

describe('clients - delete', () => {
  it('returns 404 for an unknown client', async () => {
    const user = await createUser();
    expect((await user.delete('/api/clients/nope')).status).toBe(404);
  });

  it('deletes the client and cascades to projects, tasks, subtasks, entries, intervals and timers', async () => {
    const user = await createUser();
    const { client, project, task } = await createClientProjectTask(user);
    const subtask = (await user.post(`/api/tasks/${task.id}/subtasks`).send({ title: 'Sub' })).body;
    const entry = await addEntry(user, { project_id: project.id, task_id: task.id, start: '2025-02-01T10:00:00.000Z', seconds: 600 });
    const timer = (await user.post('/api/timer/start').send({ project_id: project.id })).body;

    const res = await user.delete(`/api/clients/${client.id}`);
    expect(res.status).toBe(200);

    const { db } = user;
    const count = (sql, id) => db.prepare(sql).get(id).n;
    expect(count('SELECT COUNT(*) AS n FROM clients WHERE id = ?', client.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM projects WHERE id = ?', project.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM tasks WHERE id = ?', task.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM subtasks WHERE id = ?', subtask.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM time_entries WHERE id = ?', entry.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM timer_intervals WHERE time_entry_id = ?', entry.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM active_timers WHERE id = ?', timer.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM timer_intervals WHERE timer_id = ?', timer.id)).toBe(0);

    expect((await user.get(`/api/clients/${client.id}`)).status).toBe(404);
    expect((await user.delete(`/api/clients/${client.id}`)).status).toBe(404);
  });
});

describe('clients - domain lookup', () => {
  it('requires the domain parameter', async () => {
    const user = await createUser();
    expect((await user.get('/api/clients/lookup/domain')).status).toBe(400);
  });

  it('matches exact domains, subdomains and full URLs, case-insensitively', async () => {
    const user = await createUser();
    const client = (await user.post('/api/clients').send({ name: 'Dom', domains: ['Example.com'] })).body;
    await user.post('/api/clients').send({ name: 'Other', domains: ['other.org'] });
    await user.post('/api/clients').send({ name: 'NoDomains' });

    for (const domain of ['example.com', 'app.example.com', 'https://EXAMPLE.com/path?q=1']) {
      const res = await user.get(`/api/clients/lookup/domain?domain=${encodeURIComponent(domain)}`);
      expect(res.status).toBe(200);
      expect(res.body.clients).toEqual([{ id: client.id, name: 'Dom', status: 'active', matched_domain: 'example.com' }]);
    }

    const miss = await user.get('/api/clients/lookup/domain?domain=notexample.com');
    expect(miss.body.clients).toEqual([]);
  });

  it("never matches another workspace's clients", async () => {
    const owner = await createUser();
    const other = await createUser();
    await owner.post('/api/clients').send({ name: 'Private', domains: ['secret.io'] });
    const res = await other.get('/api/clients/lookup/domain?domain=secret.io');
    expect(res.status).toBe(200);
    expect(res.body.clients).toEqual([]);
  });
});

describe('clients - share links', () => {
  it('creates a public view with project totals and revokes it', async () => {
    const user = await createUser();
    const { app } = await getApp();
    const { client, project } = await createClientProjectTask(user);
    await addEntry(user, { project_id: project.id, start: '2025-03-01T10:00:00.000Z', seconds: 1200 });

    const share = await user.post(`/api/clients/${client.id}/share`).send({});
    expect(share.status).toBe(200);
    expect(share.body.permissions).toBe('view');
    const token = share.body.share_token;

    const pub = await request(app).get(`/api/clients/shared/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.name).toBe(client.name);
    expect(pub.body.projects).toHaveLength(1);
    expect(pub.body.projects[0].total_time).toBe(1200);
    expect(pub.body.bank_account).toBeUndefined();

    const revoke = await user.delete(`/api/clients/${client.id}/share`);
    expect(revoke.status).toBe(200);
    expect((await request(app).get(`/api/clients/shared/${token}`)).status).toBe(404);
  });

  it('returns 404 for unknown clients and tokens', async () => {
    const user = await createUser();
    const { app } = await getApp();
    expect((await user.post('/api/clients/nope/share').send({})).status).toBe(404);
    expect((await user.delete('/api/clients/nope/share')).status).toBe(404);
    expect((await request(app).get('/api/clients/shared/not-a-token')).status).toBe(404);
  });
});
