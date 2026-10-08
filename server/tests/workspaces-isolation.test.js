import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { addEntry, addMember, backdateTimer } from './helpers-core.js';

// Two unrelated tenants. Alice owns a full data set; Bob owns his own and must never touch hers.
async function twoTenants() {
  const alice = await createUser({ name: 'Alice' });
  const bob = await createUser({ name: 'Bob' });
  const a = await createClientProjectTask(alice);
  a.subtask = (await alice.post(`/api/tasks/${a.task.id}/subtasks`).send({ title: 'Alice sub' })).body;
  a.entry = await addEntry(alice, { project_id: a.project.id, task_id: a.task.id, start: '2025-03-10T09:00:00.000Z', seconds: 3600, notes: 'alice work' });
  a.timer = (await alice.post('/api/timer/start').send({ project_id: a.project.id })).body;
  const b = await createClientProjectTask(bob);
  return { alice, bob, a, b };
}

// Everything of Alice's that Bob might try to change, read back through Alice's own session
async function aliceSnapshot(alice, a) {
  const client = (await alice.get(`/api/clients/${a.client.id}`)).body;
  const project = (await alice.get(`/api/projects/${a.project.id}`)).body;
  const task = (await alice.get(`/api/tasks/${a.task.id}`)).body;
  const entries = (await alice.get('/api/timer/entries')).body;
  const timers = (await alice.get('/api/timer/active')).body;
  const projectStats = (await alice.get(`/api/stats/project/${a.project.id}`)).body;
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  return {
    client: pick(client, ['id', 'name', 'hourly_rate', 'is_favorite', 'share_token', 'total_time', 'project_count']),
    project: pick(project, ['id', 'name', 'client_id', 'status', 'is_favorite', 'share_token', 'total_time', 'task_count']),
    task: { ...pick(task, ['id', 'name', 'project_id', 'status', 'total_time']), subtasks: task.subtasks.map((s) => pick(s, ['id', 'title', 'task_id', 'is_completed'])) },
    entries: entries.map((e) => pick(e, ['id', 'project_id', 'task_id', 'start_time', 'end_time', 'duration', 'notes'])),
    timers: timers.map((t) => pick(t, ['id', 'is_running', 'accumulated_seconds', 'start_time'])),
    projectStats
  };
}

describe('workspace isolation - reads', () => {
  let t;
  beforeAll(async () => {
    t = await twoTenants();
  });

  it("Bob's lists never contain Alice's data, even when filtering by her ids", async () => {
    const { bob, a, b } = t;
    const clients = (await bob.get('/api/clients')).body;
    expect(clients.map((c) => c.id)).toEqual([b.client.id]);
    expect((await bob.get('/api/projects')).body.map((p) => p.id)).toEqual([b.project.id]);
    expect((await bob.get('/api/tasks')).body.map((x) => x.id)).toEqual([b.task.id]);
    expect((await bob.get('/api/timer/active')).body).toEqual([]);
    expect((await bob.get('/api/timer/entries')).body).toEqual([]);

    expect((await bob.get(`/api/projects?client_id=${a.client.id}`)).body).toEqual([]);
    expect((await bob.get(`/api/tasks?project_id=${a.project.id}`)).body).toEqual([]);
    expect((await bob.get(`/api/timer/entries?project_id=${a.project.id}`)).body).toEqual([]);
    expect((await bob.get(`/api/timer/entries?task_id=${a.task.id}`)).body).toEqual([]);
    expect((await bob.get(`/api/timer/active/project/${a.project.id}`)).text).toBe('null');
  });

  it("Bob gets 404 reading any of Alice's records directly", async () => {
    const { bob, a } = t;
    const urls = [
      `/api/clients/${a.client.id}`,
      `/api/projects/${a.project.id}`,
      `/api/tasks/${a.task.id}`,
      `/api/stats/client/${a.client.id}`,
      `/api/stats/project/${a.project.id}`,
      `/api/timer/entries/${a.entry.id}/intervals`,
      `/api/timer/active/${a.timer.id}/intervals`
    ];
    for (const url of urls) {
      const res = await bob.get(url);
      expect(res.status, url).toBe(404);
      expect(JSON.stringify(res.body), url).not.toContain('Acme');
    }
  });

  it("Bob's dashboard counts only his own workspace", async () => {
    const { bob } = t;
    const res = await bob.get('/api/stats/dashboard?month=2&year=2025');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clients: 1, projects: { total: 1, active: 1 }, tasks: { total: 1, completed: 0 }, time: { total: 0, thisMonth: 0 } });
  });

  it("Bob's domain lookup does not see Alice's client domains", async () => {
    const { alice, bob, a } = t;
    await alice.put(`/api/clients/${a.client.id}`).send({ domains: ['alice-secret.com'] });
    const res = await bob.get('/api/clients/lookup/domain?domain=alice-secret.com');
    expect(res.body.clients).toEqual([]);
  });
});

describe('workspace isolation - writes', () => {
  it("Bob cannot change or delete any of Alice's records, and her data stays intact", async () => {
    const { alice, bob, a } = await twoTenants();
    backdateTimer(alice.db, a.timer.id, 60);
    const before = await aliceSnapshot(alice, a);

    const attempts = [
      ['put', `/api/clients/${a.client.id}`, { name: 'Hacked', hourly_rate: 1 }],
      ['patch', `/api/clients/${a.client.id}/favorite`, { is_favorite: true }],
      ['post', `/api/clients/${a.client.id}/share`, {}],
      ['delete', `/api/clients/${a.client.id}/share`],
      ['put', `/api/projects/${a.project.id}`, { name: 'Hacked', status: 'archived' }],
      ['patch', `/api/projects/${a.project.id}/favorite`, { is_favorite: true }],
      ['post', `/api/projects/${a.project.id}/share`, {}],
      ['delete', `/api/projects/${a.project.id}/share`],
      ['put', `/api/tasks/${a.task.id}`, { name: 'Hacked' }],
      ['post', `/api/tasks/${a.task.id}/subtasks`, { title: 'Injected' }],
      ['put', `/api/tasks/subtasks/${a.subtask.id}`, { title: 'Hacked', is_completed: true }],
      ['delete', `/api/tasks/subtasks/${a.subtask.id}`],
      ['post', `/api/timer/pause/${a.timer.id}`],
      ['post', `/api/timer/resume/${a.timer.id}`],
      ['put', `/api/timer/active/${a.timer.id}/start-time`, { start_time: '2020-01-01T00:00:00.000Z' }],
      ['post', `/api/timer/stop/${a.timer.id}`, { notes: 'stolen' }],
      ['delete', `/api/timer/discard/${a.timer.id}`],
      ['put', `/api/timer/entries/${a.entry.id}`, { start_time: '2020-01-01T00:00:00.000Z', end_time: '2020-01-01T10:00:00.000Z', notes: 'Hacked' }],
      ['delete', `/api/timer/entries/${a.entry.id}`],
      ['delete', `/api/tasks/${a.task.id}`],
      ['delete', `/api/projects/${a.project.id}`],
      ['delete', `/api/clients/${a.client.id}`]
    ];
    for (const [method, url, body] of attempts) {
      const req = bob[method](url);
      const res = body ? await req.send(body) : await req;
      expect([403, 404], `${method.toUpperCase()} ${url} -> ${res.status}`).toContain(res.status);
    }

    const after = await aliceSnapshot(alice, a);
    expect(after).toEqual(before);
    expect(after.client.name).toBe('Acme Ltd');
    expect(after.task.subtasks).toHaveLength(1);
    expect(after.timers).toHaveLength(1);
  });

  it("Bob cannot create records under Alice's client, project or task", async () => {
    const { alice, bob, a, b } = await twoTenants();
    const range = { start_time: '2025-03-11T09:00:00.000Z', end_time: '2025-03-11T10:00:00.000Z' };
    const attempts = [
      ['post', '/api/projects', { client_id: a.client.id, name: 'Sneaky' }],
      ['post', '/api/tasks', { project_id: a.project.id, name: 'Sneaky' }],
      ['post', '/api/timer/start', { project_id: a.project.id }],
      ['post', '/api/timer/start', { project_id: b.project.id, task_id: a.task.id }],
      ['post', '/api/timer/entries', { project_id: a.project.id, ...range }],
      ['post', '/api/timer/entries', { project_id: b.project.id, task_id: a.task.id, ...range }],
      ['put', `/api/projects/${b.project.id}`, { client_id: a.client.id }],
      ['put', `/api/tasks/${b.task.id}`, { project_id: a.project.id }]
    ];
    for (const [method, url, body] of attempts) {
      const res = await bob[method](url).send(body);
      expect(res.status, `${method.toUpperCase()} ${url} ${JSON.stringify(body)}`).toBe(404);
    }

    const bobSub = (await bob.post(`/api/tasks/${b.task.id}/subtasks`).send({ title: 'Bob sub' })).body;
    expect((await bob.put(`/api/tasks/subtasks/${bobSub.id}`).send({ task_id: a.task.id })).status).toBe(404);

    expect((await alice.get(`/api/projects?client_id=${a.client.id}`)).body).toHaveLength(1);
    expect((await alice.get(`/api/tasks?project_id=${a.project.id}`)).body).toHaveLength(1);
    expect((await alice.get(`/api/tasks/${a.task.id}`)).body.subtasks).toHaveLength(1);
    expect((await bob.get('/api/timer/active')).body).toEqual([]);
    expect((await bob.get('/api/timer/entries')).body).toEqual([]);
  });

  it("Bob cannot point his own timer's entry at Alice's project, task or subtask on stop", async () => {
    const { alice, bob, a, b } = await twoTenants();
    const before = (await alice.get(`/api/stats/project/${a.project.id}`)).body;

    const bodies = [
      { project_id: a.project.id },
      { task_id: a.task.id },
      { subtask_id: a.subtask.id },
      { additional_associations: [{ project_id: a.project.id }] },
      { additional_associations: [{ task_id: a.task.id }] }
    ];
    for (const body of bodies) {
      const timer = (await bob.post('/api/timer/start').send({ project_id: b.project.id })).body;
      backdateTimer(bob.db, timer.id, 3600);
      const res = await bob.post(`/api/timer/stop/${timer.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(404);
      // Rejected before anything changed: the timer is still running
      const active = (await bob.get('/api/timer/active')).body;
      expect(active.map((x) => x.id)).toEqual([timer.id]);
      await bob.delete(`/api/timer/discard/${timer.id}`);
    }

    expect((await bob.get('/api/timer/entries')).body).toEqual([]);
    expect((await alice.get(`/api/stats/project/${a.project.id}`)).body).toEqual(before);
  });

  it("Bob cannot re-point his own entry at Alice's project, task or subtask", async () => {
    const { alice, bob, a, b } = await twoTenants();
    const before = await aliceSnapshot(alice, a);
    const entry = await addEntry(bob, { project_id: b.project.id, task_id: b.task.id, start: '2025-03-12T09:00:00.000Z', seconds: 7200 });
    const times = { start_time: entry.start_time, end_time: entry.end_time };

    const bodies = [
      { ...times, project_id: a.project.id },
      { ...times, task_id: a.task.id },
      { ...times, subtask_id: a.subtask.id },
      { ...times, additional_associations: [{ project_id: a.project.id }] },
      { ...times, additional_associations: [{ task_id: a.task.id }] }
    ];
    for (const body of bodies) {
      const res = await bob.put(`/api/timer/entries/${entry.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(404);
    }

    const [saved] = (await bob.get('/api/timer/entries')).body;
    expect(saved).toMatchObject({ project_id: b.project.id, task_id: b.task.id, subtask_id: null, project_name: 'Website', client_id: b.client.id });
    expect(saved.additional_associations).toEqual([]);
    expect(await aliceSnapshot(alice, a)).toEqual(before);
  });

  it("Bob cannot tag his clients with Alice's client source (and read its name back)", async () => {
    const { alice, bob, b } = await twoTenants();
    const { db } = alice;
    const aliceSource = `src-alice-${Date.now()}`;
    const globalSource = `src-global-${Date.now()}`;
    db.prepare('INSERT INTO client_sources (id, name, workspace_id) VALUES (?, ?, ?)').run(aliceSource, 'Alice secret source', alice.workspaceId);
    db.prepare('INSERT INTO client_sources (id, name, workspace_id) VALUES (?, ?, NULL)').run(globalSource, 'Global source');

    expect((await bob.post('/api/clients').send({ name: 'Tagged', source_id: aliceSource })).status).toBe(404);
    expect((await bob.put(`/api/clients/${b.client.id}`).send({ source_id: aliceSource })).status).toBe(404);
    const read = await bob.get(`/api/clients/${b.client.id}`);
    expect(read.body.source_id).toBeNull();
    expect(JSON.stringify(read.body)).not.toContain('Alice secret source');
    expect((await bob.get('/api/clients')).body.map((c) => c.name)).toEqual(['Acme Ltd']);

    // Global sources (workspace_id NULL) stay usable by everyone
    const tagged = await bob.put(`/api/clients/${b.client.id}`).send({ source_id: globalSource });
    expect(tagged.status).toBe(200);
    expect((await bob.get(`/api/clients/${b.client.id}`)).body.source_name).toBe('Global source');
    const created = await bob.post('/api/clients').send({ name: 'Global tagged', source_id: globalSource });
    expect(created.status).toBe(201);
  });

  it("Bob cannot attach Alice's project or task to a new manual entry", async () => {
    const { alice, bob, a, b } = await twoTenants();
    const before = (await alice.get(`/api/stats/project/${a.project.id}`)).body;
    for (const assoc of [{ project_id: a.project.id }, { task_id: a.task.id }]) {
      const res = await bob.post('/api/timer/entries').send({
        project_id: b.project.id,
        start_time: '2025-03-12T09:00:00.000Z',
        end_time: '2025-03-12T10:00:00.000Z',
        additional_associations: [assoc]
      });
      expect(res.status, JSON.stringify(assoc)).toBe(404);
    }
    expect((await bob.get('/api/timer/entries')).body).toEqual([]);
    expect((await alice.get(`/api/stats/project/${a.project.id}`)).body).toEqual(before);
  });
});

describe('workspace isolation - forged X-Workspace-Id', () => {
  let t;
  beforeAll(async () => {
    t = await twoTenants();
  });

  it("a workspace header Bob doesn't belong to is refused with 403 on every route family", async () => {
    const { bob, alice, a } = t;
    const urls = [
      '/api/clients',
      `/api/clients/${a.client.id}`,
      '/api/projects',
      `/api/projects/${a.project.id}`,
      '/api/tasks',
      `/api/tasks/${a.task.id}`,
      '/api/timer/active',
      '/api/timer/entries',
      `/api/timer/entries/${a.entry.id}/intervals`,
      '/api/stats/dashboard',
      `/api/stats/client/${a.client.id}`,
      `/api/stats/project/${a.project.id}`,
      '/api/workspaces/current',
      `/api/workspaces/${alice.workspaceId}/members`,
      `/api/workspaces/${alice.workspaceId}/invites`
    ];
    for (const url of urls) {
      const res = await bob.get(url, alice.workspaceId);
      expect(res.status, url).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('Acme');
    }
  });

  it('forged writes are refused and create nothing in the foreign workspace', async () => {
    const { bob, alice, a } = t;
    const ws = alice.workspaceId;
    const writes = [
      ['post', '/api/clients', { name: 'Planted' }],
      ['post', '/api/projects', { client_id: a.client.id, name: 'Planted' }],
      ['post', '/api/tasks', { project_id: a.project.id, name: 'Planted' }],
      ['post', '/api/timer/start', { project_id: a.project.id }],
      ['post', '/api/timer/entries', { project_id: a.project.id, start_time: '2025-01-01T10:00:00.000Z', end_time: '2025-01-01T11:00:00.000Z' }],
      ['put', `/api/clients/${a.client.id}`, { name: 'Hacked' }],
      ['delete', `/api/clients/${a.client.id}`],
      ['put', `/api/workspaces/${ws}`, { name: 'Hacked' }],
      ['delete', `/api/workspaces/${ws}`],
      ['post', `/api/workspaces/${ws}/invites`, { role: 'admin' }],
      ['post', `/api/workspaces/${ws}/leave`, {}]
    ];
    for (const [method, url, body] of writes) {
      const req = bob[method](url, ws);
      const res = body ? await req.send(body) : await req;
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403);
    }
    expect((await alice.get('/api/clients')).body.map((c) => c.name)).toEqual(['Acme Ltd']);
    expect((await alice.get('/api/projects')).body).toHaveLength(1);
    expect((await alice.get('/api/tasks')).body).toHaveLength(1);
    expect((await alice.get('/api/timer/entries')).body).toHaveLength(1);
    expect((await alice.get('/api/workspaces/current')).body.name).toBe('Alice');
    expect((await alice.get(`/api/workspaces/${ws}/invites`)).body).toEqual([]);
  });

  it('an unknown workspace id is refused with 403', async () => {
    const { bob } = t;
    expect((await bob.get('/api/clients', 'no-such-workspace')).status).toBe(403);
    expect((await bob.get('/api/workspaces/current', 'no-such-workspace')).status).toBe(403);
  });

  it('without a header the first workspace of the user is used', async () => {
    const { bob, b } = t;
    const { app } = await getApp();
    const res = await request(app).get('/api/clients').set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.id)).toEqual([b.client.id]);
  });

  it('workspace routes refuse a path id that differs from the header workspace', async () => {
    const { bob, alice } = t;
    const ws = alice.workspaceId;
    expect((await bob.get(`/api/workspaces/${ws}/members`)).status).toBe(403);
    expect((await bob.get(`/api/workspaces/${ws}/invites`)).status).toBe(403);
    expect((await bob.post(`/api/workspaces/${ws}/invites`).send({})).status).toBe(403);
    expect((await bob.put(`/api/workspaces/${ws}`).send({ name: 'x' })).status).toBe(403);
    expect((await bob.delete(`/api/workspaces/${ws}`)).status).toBe(403);
    expect((await bob.post(`/api/workspaces/${ws}/leave`)).status).toBe(403);
    const list = (await bob.get('/api/workspaces')).body;
    expect(list.map((w) => w.id)).toEqual([bob.workspaceId]);
  });
});

describe('workspaces - CRUD', () => {
  it('lists, creates, renames and switches workspaces', async () => {
    const user = await createUser({ name: 'Wendy' });
    const list = await user.get('/api/workspaces');
    expect(list.body).toEqual([expect.objectContaining({ id: user.workspaceId, role: 'owner', member_count: 1, name: 'Wendy' })]);

    expect((await user.post('/api/workspaces').send({ name: '   ' })).status).toBe(400);
    const created = await user.post('/api/workspaces').send({ name: '  Studio  ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Studio', role: 'owner', member_count: 1, created_by: user.user.id });
    expect(created.body.slug).toMatch(/^studio-[0-9a-f]{8}$/);

    const current = await user.get('/api/workspaces/current', created.body.id);
    expect(current.body).toMatchObject({ id: created.body.id, role: 'owner' });

    // Data is scoped to the selected workspace
    await user.post('/api/clients', created.body.id).send({ name: 'Studio client' });
    expect((await user.get('/api/clients')).body).toEqual([]);
    expect((await user.get('/api/clients', created.body.id)).body.map((c) => c.name)).toEqual(['Studio client']);

    expect((await user.put(`/api/workspaces/${created.body.id}`, created.body.id).send({ name: '' })).status).toBe(400);
    const renamed = await user.put(`/api/workspaces/${created.body.id}`, created.body.id).send({ name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Renamed');
  });

  it('cannot delete the only workspace; can delete a second one and loses access to it', async () => {
    const user = await createUser();
    expect((await user.delete(`/api/workspaces/${user.workspaceId}`)).status).toBe(400);
    const second = (await user.post('/api/workspaces').send({ name: 'Temp' })).body;
    const res = await user.delete(`/api/workspaces/${second.id}`, second.id);
    expect(res.status).toBe(200);
    expect((await user.get('/api/clients', second.id)).status).toBe(403);
    expect((await user.get('/api/workspaces')).body.map((w) => w.id)).toEqual([user.workspaceId]);
  });

  // workspace_id on clients/projects/... is a plain column without a foreign key, so the comment
  // "CASCADE will handle ... data" in DELETE /workspaces/:id is wrong and the rows are orphaned
  it.fails('deleting a workspace also deletes its clients, projects and entries', async () => {
    const user = await createUser();
    const second = (await user.post('/api/workspaces').send({ name: 'Doomed' })).body;
    const c = (await user.post('/api/clients', second.id).send({ name: 'Doomed client' })).body;
    await user.post('/api/projects', second.id).send({ client_id: c.id, name: 'Doomed project' });
    expect((await user.delete(`/api/workspaces/${second.id}`, second.id)).status).toBe(200);
    expect(user.db.prepare('SELECT COUNT(*) AS n FROM clients WHERE workspace_id = ?').get(second.id).n).toBe(0);
    expect(user.db.prepare('SELECT COUNT(*) AS n FROM projects WHERE workspace_id = ?').get(second.id).n).toBe(0);
  });
});

describe('workspaces - invites and joining', () => {
  it('an owner invites, the invite is public, and joining grants access to the shared data', async () => {
    const owner = await createUser({ name: 'Olga' });
    const { client } = await createClientProjectTask(owner);
    const { app } = await getApp();

    const invite = await owner.post(`/api/workspaces/${owner.workspaceId}/invites`).send({ expires_in_days: 7, max_uses: 2 });
    expect(invite.status).toBe(201);
    expect(invite.body).toMatchObject({ role: 'member', max_uses: 2, used_count: 0, is_active: 1, workspace_id: owner.workspaceId });
    const days = (new Date(invite.body.expires_at) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const info = await request(app).get(`/api/workspaces/invite/${invite.body.token}`);
    expect(info.status).toBe(200);
    expect(info.body).toEqual({ workspace_name: 'Olga', inviter_name: 'Olga', role: 'member' });

    const guest = await createUser({ name: 'Gil' });
    const join = await guest.post(`/api/workspaces/join/${invite.body.token}`);
    expect(join.status).toBe(200);
    expect(join.body).toMatchObject({ workspace_id: owner.workspaceId, role: 'member' });
    expect((await guest.post(`/api/workspaces/join/${invite.body.token}`)).status).toBe(400);

    const mine = (await guest.get('/api/workspaces')).body;
    expect(mine.map((w) => w.id).sort()).toEqual([guest.workspaceId, owner.workspaceId].sort());
    expect((await guest.get('/api/clients', owner.workspaceId)).body.map((c) => c.id)).toEqual([client.id]);
    expect((await guest.get('/api/workspaces/current', owner.workspaceId)).body.role).toBe('member');

    const members = (await owner.get(`/api/workspaces/${owner.workspaceId}/members`)).body;
    expect(members.map((m) => [m.name, m.role])).toEqual([
      ['Olga', 'owner'],
      ['Gil', 'member']
    ]);
    expect(members[0].password).toBeUndefined();

    const invites = (await owner.get(`/api/workspaces/${owner.workspaceId}/invites`)).body;
    expect(invites).toEqual([expect.objectContaining({ id: invite.body.id, used_count: 1, created_by_name: 'Olga' })]);
  });

  it('rejects unknown, inactive, expired and used-up invites', async () => {
    const owner = await createUser();
    const guest = await createUser();
    const { app, db } = await getApp();
    const make = async (body = {}) => (await owner.post(`/api/workspaces/${owner.workspaceId}/invites`).send(body)).body;

    expect((await request(app).get('/api/workspaces/invite/nope')).status).toBe(404);
    expect((await guest.post('/api/workspaces/join/nope')).status).toBe(404);

    const inactive = await make();
    db.prepare('UPDATE workspace_invites SET is_active = 0 WHERE id = ?').run(inactive.id);
    const expired = await make();
    db.prepare("UPDATE workspace_invites SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(expired.id);
    const usedUp = await make({ max_uses: 1 });
    await (await createUser()).post(`/api/workspaces/join/${usedUp.token}`);

    for (const inv of [inactive, expired, usedUp]) {
      expect((await request(app).get(`/api/workspaces/invite/${inv.token}`)).status).toBe(410);
      expect((await guest.post(`/api/workspaces/join/${inv.token}`)).status).toBe(410);
    }
    expect((await guest.get('/api/clients', owner.workspaceId)).status).toBe(403);
  });

  it('enforces who may create, list and delete invites', async () => {
    const owner = await createUser();
    const admin = await addMember(owner, 'admin');
    const member = await addMember(owner, 'member');
    const ws = owner.workspaceId;

    expect((await owner.post(`/api/workspaces/${ws}/invites`).send({ role: 'owner' })).status).toBe(400);
    expect((await admin.post(`/api/workspaces/${ws}/invites`).send({ role: 'admin' })).status).toBe(403);
    const byAdmin = await admin.post(`/api/workspaces/${ws}/invites`).send({ role: 'member' });
    expect(byAdmin.status).toBe(201);
    expect((await member.post(`/api/workspaces/${ws}/invites`).send({})).status).toBe(403);
    expect((await member.get(`/api/workspaces/${ws}/invites`)).status).toBe(403);
    expect((await admin.get(`/api/workspaces/${ws}/invites`)).status).toBe(200);

    expect((await member.delete(`/api/workspaces/${ws}/invites/${byAdmin.body.id}`)).status).toBe(403);
    expect((await owner.delete(`/api/workspaces/${ws}/invites/${byAdmin.body.id}`)).status).toBe(200);
    expect((await owner.delete(`/api/workspaces/${ws}/invites/${byAdmin.body.id}`)).status).toBe(404);
  });
});

describe('workspaces - roles, removal and leaving', () => {
  it('only the owner manages roles; owners are protected', async () => {
    const owner = await createUser();
    const admin = await addMember(owner, 'admin');
    const member = await addMember(owner, 'member');
    const ws = owner.workspaceId;
    const ownerRow = owner.db.prepare("SELECT id FROM workspace_members WHERE workspace_id = ? AND role = 'owner'").get(ws);

    expect((await owner.put(`/api/workspaces/${ws}/members/${member.memberId}`).send({ role: 'owner' })).status).toBe(400);
    expect((await owner.put(`/api/workspaces/${ws}/members/${ownerRow.id}`).send({ role: 'member' })).status).toBe(403);
    expect((await admin.put(`/api/workspaces/${ws}/members/${ownerRow.id}`).send({ role: 'member' })).status).toBe(403);
    expect((await member.put(`/api/workspaces/${ws}/members/${admin.memberId}`).send({ role: 'member' })).status).toBe(403);
    expect((await admin.put(`/api/workspaces/${ws}/members/${member.memberId}`).send({ role: 'admin' })).status).toBe(403);
    expect((await owner.put(`/api/workspaces/${ws}/members/nope`).send({ role: 'admin' })).status).toBe(404);

    const other = await createUser();
    const outsider = await addMember(other, 'member');
    expect((await owner.put(`/api/workspaces/${ws}/members/${outsider.memberId}`).send({ role: 'admin' })).status).toBe(404);

    expect((await owner.put(`/api/workspaces/${ws}/members/${member.memberId}`).send({ role: 'admin' })).status).toBe(200);
    expect((await member.get('/api/workspaces/current')).body.role).toBe('admin');
  });

  // An admin may remove only plain members, so they must not be able to demote a fellow admin first
  it('an admin cannot demote another admin', async () => {
    const owner = await createUser();
    const admin1 = await addMember(owner, 'admin');
    const admin2 = await addMember(owner, 'admin');
    const res = await admin1.put(`/api/workspaces/${owner.workspaceId}/members/${admin2.memberId}`).send({ role: 'member' });
    expect(res.status).toBe(403);
  });

  it('removal rules: owner removes anyone, admin removes members only, member removes nobody', async () => {
    const owner = await createUser();
    const admin = await addMember(owner, 'admin');
    const admin2 = await addMember(owner, 'admin');
    const member = await addMember(owner, 'member');
    const member2 = await addMember(owner, 'member');
    const ws = owner.workspaceId;
    const ownerRow = owner.db.prepare("SELECT id FROM workspace_members WHERE workspace_id = ? AND role = 'owner'").get(ws);

    expect((await admin.delete(`/api/workspaces/${ws}/members/${ownerRow.id}`)).status).toBe(403);
    expect((await admin.delete(`/api/workspaces/${ws}/members/${admin2.memberId}`)).status).toBe(403);
    expect((await member.delete(`/api/workspaces/${ws}/members/${member2.memberId}`)).status).toBe(403);
    expect((await owner.delete(`/api/workspaces/${ws}/members/nope`)).status).toBe(404);

    expect((await admin.delete(`/api/workspaces/${ws}/members/${member2.memberId}`)).status).toBe(200);
    expect((await member2.get('/api/clients')).status).toBe(403);
    expect((await owner.delete(`/api/workspaces/${ws}/members/${admin2.memberId}`)).status).toBe(200);
    expect((await admin2.get('/api/projects')).status).toBe(403);

    // They still have their own personal workspaces
    expect((await member2.get('/api/clients', member2.ownWorkspaceId)).status).toBe(200);
  });

  it('members can leave, owners cannot', async () => {
    const owner = await createUser();
    const member = await addMember(owner, 'member');
    const ws = owner.workspaceId;
    expect((await owner.post(`/api/workspaces/${ws}/leave`)).status).toBe(403);
    expect((await member.post(`/api/workspaces/${ws}/leave`)).status).toBe(200);
    expect((await member.get('/api/clients')).status).toBe(403);
    const members = (await owner.get(`/api/workspaces/${ws}/members`)).body;
    expect(members).toHaveLength(1);
  });

  it('only owner/admin can rename; only the owner can delete', async () => {
    const owner = await createUser();
    const admin = await addMember(owner, 'admin');
    const member = await addMember(owner, 'member');
    const ws = owner.workspaceId;
    expect((await member.put(`/api/workspaces/${ws}`).send({ name: 'M' })).status).toBe(403);
    expect((await admin.put(`/api/workspaces/${ws}`).send({ name: 'By admin' })).status).toBe(200);
    expect((await member.delete(`/api/workspaces/${ws}`)).status).toBe(403);
    expect((await admin.delete(`/api/workspaces/${ws}`)).status).toBe(403);
    expect((await owner.get('/api/workspaces/current')).body.name).toBe('By admin');
  });
});

describe('workspaces - shared data and time entry visibility', () => {
  async function team() {
    const owner = await createUser({ name: 'Owner' });
    const chain = await createClientProjectTask(owner);
    const admin = await addMember(owner, 'admin', { name: 'Admin' });
    const member = await addMember(owner, 'member', { name: 'Member' });
    const ownerEntry = await addEntry(owner, { project_id: chain.project.id, start: '2025-03-05T09:00:00.000Z', seconds: 3600 });
    const memberEntry = await addEntry(member, { project_id: chain.project.id, start: '2025-03-06T09:00:00.000Z', seconds: 1800 });
    return { owner, admin, member, ...chain, ownerEntry, memberEntry };
  }

  it('members see only their own entries; owner and admin see all', async () => {
    const { owner, admin, member, ownerEntry, memberEntry } = await team();
    const ids = async (u) => (await u.get('/api/timer/entries')).body.map((e) => e.id).sort();
    expect(await ids(member)).toEqual([memberEntry.id]);
    expect(await ids(owner)).toEqual([ownerEntry.id, memberEntry.id].sort());
    expect(await ids(admin)).toEqual([ownerEntry.id, memberEntry.id].sort());
    const row = (await owner.get('/api/timer/entries')).body.find((e) => e.id === memberEntry.id);
    expect(row.user_name).toBe('Member');
  });

  it("members cannot read, edit or delete other users' entries; owners can", async () => {
    const { owner, member, ownerEntry, memberEntry } = await team();
    const times = { start_time: ownerEntry.start_time, end_time: ownerEntry.end_time };
    expect((await member.get(`/api/timer/entries/${ownerEntry.id}/intervals`)).status).toBe(403);
    expect((await member.put(`/api/timer/entries/${ownerEntry.id}`).send({ ...times, notes: 'x' })).status).toBe(403);
    expect((await member.delete(`/api/timer/entries/${ownerEntry.id}`)).status).toBe(403);
    expect((await owner.get('/api/timer/entries')).body.find((e) => e.id === ownerEntry.id).notes).toBeNull();

    const edited = await owner.put(`/api/timer/entries/${memberEntry.id}`).send({
      start_time: memberEntry.start_time,
      end_time: memberEntry.end_time,
      notes: 'reviewed'
    });
    expect(edited.status).toBe(200);
    expect(edited.body.notes).toBe('reviewed');
    expect((await owner.delete(`/api/timer/entries/${memberEntry.id}`)).status).toBe(200);
  });

  it("timers are private: a member cannot see or control the owner's timer", async () => {
    const { owner, member, project } = await team();
    const timer = (await owner.post('/api/timer/start').send({ project_id: project.id })).body;
    expect((await member.get('/api/timer/active')).body).toEqual([]);
    expect((await member.post(`/api/timer/pause/${timer.id}`)).status).toBe(404);
    expect((await member.post(`/api/timer/stop/${timer.id}`).send({})).status).toBe(404);
    expect((await member.get(`/api/timer/active/${timer.id}/intervals`)).status).toBe(404);
    expect((await member.delete(`/api/timer/discard/${timer.id}`)).status).toBe(403);
    expect((await owner.get('/api/timer/active')).body.map((x) => x.id)).toEqual([timer.id]);

    // Each user can run their own timer on the same project
    expect((await member.post('/api/timer/start').send({ project_id: project.id })).status).toBe(201);
  });

  it('dashboard time is per-user for members and workspace-wide for owners', async () => {
    const { owner, member } = await team();
    const q = '/api/stats/dashboard?month=2&year=2025';
    expect((await member.get(q)).body.time).toEqual({ total: 1800, thisMonth: 1800 });
    expect((await owner.get(q)).body.time).toEqual({ total: 5400, thisMonth: 5400 });
  });

  it('members share the workspace clients, projects and tasks', async () => {
    const { member, client, project, task } = await team();
    expect((await member.get(`/api/clients/${client.id}`)).status).toBe(200);
    expect((await member.get(`/api/projects/${project.id}`)).status).toBe(200);
    expect((await member.get(`/api/tasks/${task.id}`)).status).toBe(200);
    const created = await member.post('/api/clients').send({ name: 'From member' });
    expect(created.status).toBe(201);
    expect(created.body.workspace_id).toBe(member.workspaceId);
  });
});
