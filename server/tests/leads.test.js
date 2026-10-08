import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { twoWorkspaces, addMember, insertTimeEntry } from './helpers-money.js';

let app;
beforeAll(async () => { ({ app } = await getApp()); });

const newLead = async (user, body = {}) => {
  const res = await user.post('/api/leads').send({ name: 'Dana Lead', ...body });
  if (res.status !== 201) throw new Error(`lead: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
const utcDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

describe('leads: auth', () => {
  it('every endpoint except the webhook requires a login', async () => {
    const id = uuidv4();
    const calls = [
      request(app).get('/api/leads'),
      request(app).get('/api/leads/stats'),
      request(app).get('/api/leads/pipeline'),
      request(app).get(`/api/leads/${id}`),
      request(app).post('/api/leads').send({ name: 'x' }),
      request(app).put(`/api/leads/${id}`).send({}),
      request(app).patch(`/api/leads/${id}/status`).send({ status: 'won' }),
      request(app).patch(`/api/leads/${id}/assign`).send({}),
      request(app).post(`/api/leads/${id}/convert`).send({}),
      request(app).delete(`/api/leads/${id}`),
      request(app).post(`/api/leads/${id}/tasks`).send({ name: 'x' }),
      request(app).get(`/api/leads/${id}/activities`),
      request(app).post(`/api/leads/${id}/reminders`).send({})
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });
});

describe('leads: CRUD', () => {
  it('requires a name', async () => {
    const user = await createUser();
    expect((await user.post('/api/leads').send({ email: 'a@b.c' })).status).toBe(400);
  });

  it('creates a lead with defaults and logs a system activity', async () => {
    const user = await createUser();
    const lead = await newLead(user, { email: 'dana@x.co', phone: '050-1', company: 'Dana Ltd', expected_value: 12000, tags: ['web', 'vip'] });
    expect(lead).toMatchObject({
      name: 'Dana Lead', email: 'dana@x.co', company: 'Dana Ltd', status: 'new', priority: 'warm', source_type: 'other',
      expected_value: 12000, is_opportunity: 0, client_id: null, workspace_id: user.workspaceId, user_id: user.user.id
    });
    expect(JSON.parse(lead.tags)).toEqual(['web', 'vip']);

    const full = await user.get(`/api/leads/${lead.id}`);
    expect(full.status).toBe(200);
    expect(full.body.activities).toHaveLength(1);
    expect(full.body.activities[0]).toMatchObject({ activity_type: 'system', content: 'ליד חדש נוצר' });
    expect(full.body).toMatchObject({ reminders: [], plannedSlots: [], tasks: [], timeEntries: [], totalTimeInvested: 0 });
    expect((await user.get(`/api/leads/${uuidv4()}`)).status).toBe(404);
  });

  it('an opportunity on an existing client is flagged and named', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    const lead = await newLead(user, { client_id: client.id });
    expect(lead).toMatchObject({ is_opportunity: 1, client_id: client.id, opportunity_client_name: client.name });
    const acts = (await user.get(`/api/leads/${lead.id}/activities`)).body;
    expect(acts[0].content).toBe('הזדמנות חדשה נוצרה');
  });

  it('filters, searches and sorts', async () => {
    const user = await createUser();
    const member = await createUser({ name: 'Sales Sam' });
    addMember(user, member);
    const a = await newLead(user, { name: 'Alpha', email: 'alpha@acme.io', status: 'new', priority: 'hot', expected_value: 100, expected_close_date: '2026-03-01' });
    const b = await newLead(user, { name: 'Bravo', company: 'Acme Corp', status: 'contacted', priority: 'cold', expected_value: 300, expected_close_date: '2026-05-01', assigned_to: member.user.id });
    const c = await newLead(user, { name: 'Charlie', phone: '052-999', status: 'won', priority: 'hot', expected_value: 200 });

    const ids = async (qs) => (await user.get(`/api/leads?${qs}`)).body.map(l => l.id);
    expect((await ids('status=new,contacted')).sort()).toEqual([a.id, b.id].sort());
    expect((await ids('priority=hot')).sort()).toEqual([a.id, c.id].sort());
    expect(await ids(`assigned_to=${member.user.id}`)).toEqual([b.id]);
    expect((await ids('search=acme')).sort()).toEqual([a.id, b.id].sort());
    expect(await ids('search=052-999')).toEqual([c.id]);
    expect(await ids('from_date=2026-04-01')).toEqual([b.id]);
    expect(await ids('to_date=2026-04-01')).toEqual([a.id]);
    expect(await ids('sort=name&order=asc')).toEqual([a.id, b.id, c.id]);
    expect(await ids('sort=expected_value&order=desc')).toEqual([b.id, c.id, a.id]);

    const withName = (await user.get(`/api/leads?assigned_to=${member.user.id}`)).body[0];
    expect(withName.assigned_to_name).toBe('Sales Sam');
  });

  it('ignores an unknown sort column (no SQL injection through ORDER BY)', async () => {
    const user = await createUser();
    await newLead(user);
    const res = await user.get('/api/leads?sort=' + encodeURIComponent('name; DROP TABLE leads; --'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(user.db.prepare('SELECT COUNT(*) as n FROM leads').get().n).toBeGreaterThan(0);
  });

  it('stats count by status / priority and upcoming closes', async () => {
    const user = await createUser();
    await newLead(user, { status: 'new', priority: 'hot', expected_value: 1000, expected_close_date: utcDay(3) });
    await newLead(user, { status: 'new', priority: 'warm', expected_value: 500, expected_close_date: utcDay(30) });
    await newLead(user, { status: 'proposal', priority: 'hot', expected_value: 2000, expected_close_date: utcDay(1) });
    await newLead(user, { status: 'lost', priority: 'hot', expected_close_date: utcDay(2) });
    const toWin = await newLead(user, { expected_value: 4000 });
    await user.post(`/api/leads/${toWin.id}/convert`).send({});

    const res = await user.get('/api/leads/stats');
    expect(res.status).toBe(200);
    const byStatus = Object.fromEntries(res.body.byStatus.map(s => [s.status, s]));
    expect(byStatus.new).toMatchObject({ count: 2, total_value: 1500 });
    expect(byStatus.proposal).toMatchObject({ count: 1, total_value: 2000 });
    expect(byStatus.won).toMatchObject({ count: 1, total_value: 4000 });
    const byPriority = Object.fromEntries(res.body.byPriority.map(p => [p.priority, p.count]));
    expect(byPriority).toEqual({ hot: 2, warm: 1 });
    expect(res.body).toMatchObject({ total: 5, active: 3, wonThisMonth: 1, wonThisMonthValue: 4000, upcomingCloses: 2 });
  });

  it('pipeline groups leads by stage', async () => {
    const user = await createUser();
    const a = await newLead(user, { status: 'qualified' });
    const b = await newLead(user, { status: 'negotiation' });
    await newLead(user, { status: 'not-a-stage' });
    const res = await user.get('/api/leads/pipeline');
    expect(Object.keys(res.body)).toEqual(['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost']);
    expect(res.body.qualified.map(l => l.id)).toEqual([a.id]);
    expect(res.body.negotiation.map(l => l.id)).toEqual([b.id]);
    expect(Object.values(res.body).flat()).toHaveLength(2);
  });

  it('PUT updates only the given fields and logs status/assignment changes', async () => {
    const user = await createUser();
    const member = await createUser({ name: 'Rina Rep' });
    addMember(user, member);
    const lead = await newLead(user, { email: 'keep@x.co', notes: 'keep notes', expected_value: 10 });

    const res = await user.put(`/api/leads/${lead.id}`).send({ status: 'qualified', priority: 'hot', assigned_to: member.user.id, tags: ['a'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'qualified', priority: 'hot', email: 'keep@x.co', notes: 'keep notes', expected_value: 10,
      assigned_to: member.user.id, assigned_to_name: 'Rina Rep', tags: '["a"]'
    });

    const acts = (await user.get(`/api/leads/${lead.id}/activities`)).body;
    const status = acts.find(a => a.activity_type === 'status_change');
    expect(JSON.parse(status.metadata)).toEqual({ from_status: 'new', to_status: 'qualified' });
    expect(acts.find(a => a.activity_type === 'assignment').content).toBe('הוקצה ל-Rina Rep');

    // Same status again does not log a second change
    await user.put(`/api/leads/${lead.id}`).send({ status: 'qualified' });
    const again = (await user.get(`/api/leads/${lead.id}/activities`)).body;
    expect(again.filter(a => a.activity_type === 'status_change')).toHaveLength(1);

    expect((await user.put(`/api/leads/${uuidv4()}`).send({ name: 'x' })).status).toBe(404);
  });

  it('a lead assigned to someone who left the workspace can still be edited', async () => {
    const user = await createUser();
    const member = await createUser();
    addMember(user, member);
    const lead = await newLead(user, { assigned_to: member.user.id });
    user.db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(user.workspaceId, member.user.id);

    const res = await user.put(`/api/leads/${lead.id}`).send({ name: 'Renamed', assigned_to: member.user.id });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
    expect((await user.patch(`/api/leads/${lead.id}/assign`).send({ assigned_to: member.user.id })).status).toBe(200);
    // ...but cannot be newly assigned to them
    const other = await newLead(user);
    expect((await user.patch(`/api/leads/${other.id}/assign`).send({ assigned_to: member.user.id })).status).toBe(404);
  });

  it('PATCH status validates the stage and records the lost reason', async () => {
    const user = await createUser();
    const lead = await newLead(user);
    expect((await user.patch(`/api/leads/${lead.id}/status`).send({ status: 'maybe' })).status).toBe(400);
    expect((await user.patch(`/api/leads/${uuidv4()}/status`).send({ status: 'won' })).status).toBe(404);

    const lost = await user.patch(`/api/leads/${lead.id}/status`).send({ status: 'lost', lost_reason: 'Too expensive' });
    expect(lost.body).toMatchObject({ status: 'lost', lost_reason: 'Too expensive' });
    const back = await user.patch(`/api/leads/${lead.id}/status`).send({ status: 'contacted' });
    expect(back.body).toMatchObject({ status: 'contacted', lost_reason: 'Too expensive' });
    const acts = (await user.get(`/api/leads/${lead.id}/activities`)).body.filter(a => a.activity_type === 'status_change');
    expect(acts).toHaveLength(2);
  });

  it('PATCH assign sets and clears the assignee', async () => {
    const user = await createUser({ name: 'Owner Oz' });
    const lead = await newLead(user);
    const set = await user.patch(`/api/leads/${lead.id}/assign`).send({ assigned_to: user.user.id });
    expect(set.body).toMatchObject({ assigned_to: user.user.id, assigned_to_name: 'Owner Oz' });
    const cleared = await user.patch(`/api/leads/${lead.id}/assign`).send({ assigned_to: null });
    expect(cleared.body.assigned_to).toBeNull();
    const acts = (await user.get(`/api/leads/${lead.id}/activities`)).body.filter(a => a.activity_type === 'assignment');
    expect(acts.map(a => a.content).sort()).toEqual(['הוסרה הקצאה', 'הוקצה ל-Owner Oz'].sort());
  });

  it('delete removes the lead with its internal project, tasks, time and reminders', async () => {
    const user = await createUser();
    const lead = await newLead(user);
    const task = (await user.post(`/api/leads/${lead.id}/tasks`).send({ name: 'Call back' })).body;
    const { internal_project_id: projectId } = user.db.prepare('SELECT internal_project_id FROM leads WHERE id = ?').get(lead.id);
    insertTimeEntry(user, { project_id: projectId, task_id: task.id, duration: 600 });
    await user.post(`/api/leads/${lead.id}/reminders`).send({ content: 'follow up', due_date: '2026-05-01' });

    expect((await user.delete(`/api/leads/${lead.id}`)).status).toBe(200);
    const count = (sql, ...p) => user.db.prepare(sql).get(...p).n;
    expect(count('SELECT COUNT(*) as n FROM leads WHERE id = ?', lead.id)).toBe(0);
    expect(count('SELECT COUNT(*) as n FROM projects WHERE id = ?', projectId)).toBe(0);
    expect(count('SELECT COUNT(*) as n FROM tasks WHERE project_id = ?', projectId)).toBe(0);
    expect(count('SELECT COUNT(*) as n FROM time_entries WHERE project_id = ?', projectId)).toBe(0);
    expect(count("SELECT COUNT(*) as n FROM reminders WHERE association_type = 'lead' AND association_id = ?", lead.id)).toBe(0);
    expect((await user.delete(`/api/leads/${lead.id}`)).status).toBe(404);
  });
});

describe('leads: tasks, time, activities and reminders', () => {
  it('a lead task lives in a hidden internal project under the internal leads client', async () => {
    const user = await createUser();
    const lead = await newLead(user, { name: 'Shadow' });
    expect((await user.get(`/api/leads/${lead.id}/tasks`)).body).toEqual([]);
    expect((await user.get(`/api/leads/${lead.id}/time-entries`)).body).toEqual([]);
    expect((await user.post(`/api/leads/${lead.id}/tasks`).send({})).status).toBe(400);

    const task = await user.post(`/api/leads/${lead.id}/tasks`).send({ name: 'Send proposal', estimated_hours: 2 });
    expect(task.status).toBe(201);
    expect(task.body).toMatchObject({ name: 'Send proposal', status: 'pending', priority: 'normal', estimated_hours: 2, workspace_id: user.workspaceId });

    const project = user.db.prepare('SELECT * FROM projects WHERE id = ?').get(task.body.project_id);
    expect(project).toMatchObject({ is_internal: 1, lead_id: lead.id, name: 'ליד: Shadow', workspace_id: user.workspaceId });
    const client = user.db.prepare('SELECT * FROM clients WHERE id = ?').get(project.client_id);
    expect(client).toMatchObject({ is_internal: 1, workspace_id: user.workspaceId });

    // ensure-project is idempotent, and a second lead reuses the same internal client
    const again = await user.post(`/api/leads/${lead.id}/ensure-project`);
    expect(again.body.project_id).toBe(project.id);
    const other = await newLead(user, { name: 'Other' });
    const otherProject = (await user.post(`/api/leads/${other.id}/ensure-project`)).body.project_id;
    expect(user.db.prepare('SELECT client_id FROM projects WHERE id = ?').get(otherProject).client_id).toBe(client.id);

    insertTimeEntry(user, { project_id: project.id, task_id: task.body.id, duration: 1500 });
    const tasks = (await user.get(`/api/leads/${lead.id}/tasks`)).body;
    expect(tasks[0].total_time).toBe(1500);
    const entries = (await user.get(`/api/leads/${lead.id}/time-entries`)).body;
    expect(entries[0]).toMatchObject({ duration: 1500, task_name: 'Send proposal' });
    expect((await user.get(`/api/leads/${lead.id}`)).body.totalTimeInvested).toBe(1500);

    // Internal clients/projects stay out of the normal lists
    expect((await user.get('/api/clients')).body.map(c => c.id)).not.toContain(client.id);
  });

  it('adds, lists and deletes activities', async () => {
    const user = await createUser();
    const lead = await newLead(user);
    expect((await user.post(`/api/leads/${lead.id}/activities`).send({ activity_type: 'call' })).status).toBe(400);
    expect((await user.post(`/api/leads/${uuidv4()}/activities`).send({ activity_type: 'call', content: 'x' })).status).toBe(404);

    const act = await user.post(`/api/leads/${lead.id}/activities`).send({ activity_type: 'call', content: 'Discussed scope' });
    expect(act.status).toBe(201);
    expect(act.body).toMatchObject({ activity_type: 'call', content: 'Discussed scope', user_name: user.user.name });
    expect((await user.get(`/api/leads/${lead.id}/activities`)).body).toHaveLength(2);

    expect((await user.delete(`/api/leads/${lead.id}/activities/${act.body.id}`)).status).toBe(200);
    expect((await user.get(`/api/leads/${lead.id}/activities`)).body).toHaveLength(1);
  });

  it('lead reminders live in the unified reminders table', async () => {
    const user = await createUser();
    const lead = await newLead(user, { name: 'Remind Me' });
    expect((await user.post(`/api/leads/${lead.id}/reminders`).send({ content: 'x' })).status).toBe(400);
    expect((await user.post(`/api/leads/${uuidv4()}/reminders`).send({ content: 'x', due_date: '2026-01-01' })).status).toBe(404);

    const r = await user.post(`/api/leads/${lead.id}/reminders`).send({ content: 'Follow up', due_date: '2026-06-01T08:00:00Z' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ content: 'Follow up', association_type: 'lead', association_id: lead.id, is_completed: 0 });

    // Visible in the global reminders list, with the lead name
    const global = (await user.get('/api/reminders')).body.find(x => x.id === r.body.id);
    expect(global.lead_name).toBe('Remind Me');

    const done = await user.put(`/api/leads/${lead.id}/reminders/${r.body.id}`).send({ is_completed: true });
    expect(done.body).toMatchObject({ is_completed: 1, content: 'Follow up', due_date: '2026-06-01T08:00:00Z' });
    const renamed = await user.put(`/api/leads/${lead.id}/reminders/${r.body.id}`).send({ content: 'Call again' });
    expect(renamed.body).toMatchObject({ is_completed: 1, content: 'Call again' });

    expect((await user.get(`/api/leads/${lead.id}/reminders`)).body).toHaveLength(1);
    expect((await user.delete(`/api/leads/${lead.id}/reminders/${r.body.id}`)).status).toBe(200);
    expect((await user.get(`/api/leads/${lead.id}/reminders`)).body).toEqual([]);
  });
});

describe('leads: convert to client', () => {
  it('converts a new lead: client, acquisition project, history transfer, note and status', async () => {
    const user = await createUser();
    const source = (await user.post('/api/client-sources').send({ name: `Facebook ${uuidv4()}` })).body;
    const lead = await newLead(user, {
      name: 'Convert Me', email: 'cm@x.co', phone: '054-1', company: 'CM Ltd', source_id: source.id,
      source_detail: 'ad #7', expected_value: 9000, notes: 'Wants a shop'
    });
    await user.post(`/api/leads/${lead.id}/activities`).send({ activity_type: 'meeting', content: 'Met at cafe' });
    const task = (await user.post(`/api/leads/${lead.id}/tasks`).send({ name: 'Prep' })).body;
    const internalId = task.project_id;
    insertTimeEntry(user, { project_id: internalId, task_id: task.id, duration: 3600 });

    const res = await user.post(`/api/leads/${lead.id}/convert`).send({ override_email: 'billing@cm.co' });
    expect(res.status).toBe(200);
    const { client, lead: converted, acquisition_project_id: projectId } = res.body;

    expect(client).toMatchObject({
      name: 'Convert Me', email: 'billing@cm.co', phone: '054-1', address: 'CM Ltd', source_id: source.id,
      sub_source: 'ad #7', lead_id: lead.id, workspace_id: user.workspaceId
    });
    expect(converted).toMatchObject({ status: 'won', converted_client_id: client.id, converted_client_name: 'Convert Me', internal_project_id: null });
    expect(converted.converted_at).toBeTruthy();

    const project = user.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    expect(project).toMatchObject({ client_id: client.id, name: 'רכישת לקוח', is_internal: 0, lead_id: lead.id, workspace_id: user.workspaceId });

    // History moved over and the internal project is gone
    expect(user.db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(task.id).project_id).toBe(projectId);
    expect(user.db.prepare('SELECT COUNT(*) as n FROM time_entries WHERE project_id = ?').get(projectId).n).toBe(1);
    expect(user.db.prepare('SELECT COUNT(*) as n FROM projects WHERE id = ?').get(internalId).n).toBe(0);

    // The activity history note is visible through the notes API of the new project
    const notes = (await user.get(`/api/notes/project/${projectId}`)).body;
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('היסטוריית ליד');
    expect(notes[0].content).toContain('Met at cafe');

    const acts = (await user.get(`/api/leads/${lead.id}/activities`)).body;
    const conv = acts.find(a => a.content === 'ליד הומר ללקוח');
    expect(JSON.parse(conv.metadata)).toMatchObject({ client_id: client.id, acquisition_project_id: projectId, transferred_history: true, was_opportunity: false });

    expect((await user.post(`/api/leads/${lead.id}/convert`).send({})).status).toBe(400);
  });

  it('can convert without an acquisition project', async () => {
    const user = await createUser();
    const lead = await newLead(user);
    const res = await user.post(`/api/leads/${lead.id}/convert`).send({ create_acquisition_project: false, override_name: 'Renamed Client' });
    expect(res.status).toBe(200);
    expect(res.body.acquisition_project_id).toBeNull();
    expect(res.body.client.name).toBe('Renamed Client');
    expect(user.db.prepare('SELECT COUNT(*) as n FROM projects WHERE client_id = ?').get(res.body.client.id).n).toBe(0);
  });

  it('refuses to convert while a timer runs on the lead', async () => {
    const user = await createUser();
    const lead = await newLead(user);
    const projectId = (await user.post(`/api/leads/${lead.id}/ensure-project`)).body.project_id;
    user.db.prepare(`
      INSERT INTO active_timers (id, user_id, workspace_id, project_id, start_time) VALUES (?, ?, ?, ?, ?)
    `).run(uuidv4(), user.user.id, user.workspaceId, projectId, new Date().toISOString());
    const res = await user.post(`/api/leads/${lead.id}/convert`).send({});
    expect(res.status).toBe(400);
    expect(user.db.prepare('SELECT status FROM leads WHERE id = ?').get(lead.id).status).toBe('new');
  });

  it('converting an opportunity reuses the client and adds a zero-cost acquisition task', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    const lead = await newLead(user, { name: 'Upsell', client_id: client.id, expected_value: 5000, company: 'Acme' });
    await user.post(`/api/leads/${lead.id}/activities`).send({ activity_type: 'note', content: 'Upsell discussed' });

    const res = await user.post(`/api/leads/${lead.id}/convert`).send({});
    expect(res.status).toBe(200);
    expect(res.body.client.id).toBe(client.id);
    expect(user.db.prepare('SELECT COUNT(*) as n FROM clients WHERE workspace_id = ? AND (is_internal IS NULL OR is_internal = 0)').get(user.workspaceId).n).toBe(1);

    const task = user.db.prepare('SELECT * FROM tasks WHERE id = ?').get(res.body.acquisition_task_id);
    expect(task).toMatchObject({ name: 'רכישת פרויקט', status: 'completed', hourly_rate: 0, pricing_type: 'no_charge', project_id: res.body.acquisition_project_id });
    expect(task.description).toContain('שם ליד: Upsell');
    expect(task.description).toContain('ערך צפוי: ₪5000');
    expect(task.description).toContain('Upsell discussed');
  });
});

describe('leads: webhook', () => {
  const hook = (key, body) => {
    const req = request(app).post('/api/leads/webhook');
    if (key !== undefined) req.set('X-API-Key', key);
    return req.send(body);
  };

  it('requires an API key and rejects a wrong one', async () => {
    expect((await hook(undefined, { name: 'x' })).status).toBe(401);
    expect((await hook('nope-not-a-key', { name: 'x' })).status).toBe(403);
  });

  it('the key is stored encrypted, and a valid key creates a lead in that workspace', async () => {
    const user = await createUser();
    const key = `whk_${uuidv4()}`;
    const saved = await user.put('/api/addons/leads_management/settings').send({ webhook_api_key: key });
    expect(saved.status).toBe(200);
    const raw = user.db.prepare("SELECT setting_value FROM addon_settings WHERE workspace_id = ? AND setting_key = 'webhook_api_key'").get(user.workspaceId);
    expect(raw.setting_value).not.toContain(key);

    expect((await hook(key, { email: 'no-name@x.co' })).status).toBe(400);
    const res = await hook(key, { name: 'From Website', email: 'web@x.co', source_detail: 'contact form' });
    expect(res.status).toBe(201);
    const lead = (await user.get(`/api/leads/${res.body.id}`)).body;
    expect(lead).toMatchObject({ name: 'From Website', email: 'web@x.co', source_type: 'website', status: 'new', user_id: user.user.id });
    expect(lead.activities[0].content).toBe('ליד נוצר דרך webhook');

    // The ciphertext itself is not a valid key, and another workspace's key does not reach this one
    expect((await hook(raw.setting_value, { name: 'x' })).status).toBe(403);
    const other = await createUser();
    const otherKey = `whk_${uuidv4()}`;
    await other.put('/api/addons/leads_management/settings').send({ webhook_api_key: otherKey });
    const viaOther = await hook(otherKey, { name: 'Other WS lead' });
    expect(viaOther.status).toBe(201);
    expect((await user.get('/api/leads')).body.map(l => l.name)).not.toContain('Other WS lead');
  });
});

describe('leads: webhook (legacy plain-text key)', () => {
  it('still accepts a key stored before encryption existed', async () => {
    const user = await createUser();
    const key = `legacy_${uuidv4()}`;
    user.db.prepare(`
      INSERT INTO addon_settings (id, workspace_id, addon_id, setting_key, setting_value)
      VALUES (?, ?, 'leads_management', 'webhook_api_key', ?)
    `).run(uuidv4(), user.workspaceId, key);
    const res = await request(app).post('/api/leads/webhook').set('X-API-Key', key).send({ name: 'Legacy hook lead' });
    expect(res.status).toBe(201);
    expect((await user.get('/api/leads')).body.map(l => l.name)).toEqual(['Legacy hook lead']);
  });
});

describe('leads: cross-workspace isolation', () => {
  it('another workspace cannot see or touch a lead', async () => {
    const { alice, bob } = await twoWorkspaces();
    const lead = await newLead(alice, { name: 'Alice Lead', expected_value: 777 });
    const r = (await alice.post(`/api/leads/${lead.id}/reminders`).send({ content: 'alice reminder', due_date: '2026-01-01' })).body;
    const act = (await alice.post(`/api/leads/${lead.id}/activities`).send({ activity_type: 'note', content: 'alice note' })).body;

    expect((await bob.get('/api/leads')).body).toEqual([]);
    expect((await bob.get('/api/leads/stats')).body.total).toBe(0);
    expect(Object.values((await bob.get('/api/leads/pipeline')).body).flat()).toEqual([]);
    for (const res of await Promise.all([
      bob.get(`/api/leads/${lead.id}`),
      bob.put(`/api/leads/${lead.id}`).send({ name: 'pwned' }),
      bob.patch(`/api/leads/${lead.id}/status`).send({ status: 'lost' }),
      bob.patch(`/api/leads/${lead.id}/assign`).send({ assigned_to: bob.user.id }),
      bob.post(`/api/leads/${lead.id}/convert`).send({}),
      bob.post(`/api/leads/${lead.id}/ensure-project`),
      bob.get(`/api/leads/${lead.id}/tasks`),
      bob.post(`/api/leads/${lead.id}/tasks`).send({ name: 'x' }),
      bob.get(`/api/leads/${lead.id}/time-entries`),
      bob.post(`/api/leads/${lead.id}/activities`).send({ activity_type: 'note', content: 'x' }),
      bob.post(`/api/leads/${lead.id}/reminders`).send({ content: 'x', due_date: '2026-01-01' }),
      bob.delete(`/api/leads/${lead.id}`)
    ])) {
      expect(res.status).toBe(404);
    }
    expect((await bob.get(`/api/leads/${lead.id}/activities`)).body).toEqual([]);
    expect((await bob.get(`/api/leads/${lead.id}/reminders`)).body).toEqual([]);

    await bob.delete(`/api/leads/${lead.id}/activities/${act.id}`);
    await bob.delete(`/api/leads/${lead.id}/reminders/${r.id}`);
    const still = (await alice.get(`/api/leads/${lead.id}`)).body;
    expect(still).toMatchObject({ name: 'Alice Lead', status: 'new', assigned_to: null });
    expect(still.activities.map(a => a.id)).toContain(act.id);
    expect(still.reminders.map(x => x.id)).toEqual([r.id]);
  });

  it('cannot read or edit another workspace\'s reminder through a lead of its own', async () => {
    const { alice, bob } = await twoWorkspaces();
    const aliceLead = await newLead(alice);
    const r = (await alice.post(`/api/leads/${aliceLead.id}/reminders`).send({ content: 'Alice private reminder', due_date: '2026-01-01' })).body;
    const bobLead = await newLead(bob);

    const res = await bob.put(`/api/leads/${bobLead.id}/reminders/${r.id}`).send({ content: 'pwned' });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Alice private reminder');
    expect((await alice.get(`/api/leads/${aliceLead.id}/reminders`)).body[0].content).toBe('Alice private reminder');
  });

  it('cannot open an opportunity on another workspace\'s client (and so cannot convert it to expose the client)', async () => {
    const { alice, bob, a } = await twoWorkspaces();
    alice.db.prepare("UPDATE clients SET name = 'Alice Secret Client', bank_account = '11-222-333' WHERE id = ?").run(a.client.id);

    const res = await bob.post('/api/leads').send({ name: 'Sneaky', client_id: a.client.id });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Alice Secret Client');
    expect((await bob.get('/api/leads')).body).toEqual([]);
    expect(alice.db.prepare('SELECT COUNT(*) as n FROM projects WHERE client_id = ?').get(a.client.id).n).toBe(1);
  });

  it('cannot assign a lead to a user outside the workspace or use another workspace\'s source', async () => {
    const { alice, bob } = await twoWorkspaces();
    const aliceSource = (await alice.post('/api/client-sources').send({ name: `Alice only ${uuidv4()}` })).body;

    expect((await bob.post('/api/leads').send({ name: 'x', assigned_to: alice.user.id })).status).toBe(404);
    expect((await bob.post('/api/leads').send({ name: 'x', source_id: aliceSource.id })).status).toBe(404);

    const lead = await newLead(bob);
    expect((await bob.put(`/api/leads/${lead.id}`).send({ assigned_to: alice.user.id })).status).toBe(404);
    expect((await bob.put(`/api/leads/${lead.id}`).send({ source_id: aliceSource.id })).status).toBe(404);
    expect((await bob.patch(`/api/leads/${lead.id}/assign`).send({ assigned_to: alice.user.id })).status).toBe(404);
    const dump = JSON.stringify((await bob.get(`/api/leads/${lead.id}`)).body);
    expect(dump).not.toContain('Alice');

    // A global source (no workspace) is fine
    const global = (await bob.post('/api/client-sources').send({ name: `Global ${uuidv4()}`, is_global: true })).body;
    expect((await bob.post('/api/leads').send({ name: 'ok', source_id: global.id })).status).toBe(201);
  });
});
