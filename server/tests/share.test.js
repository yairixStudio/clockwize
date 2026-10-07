import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getApp, createUser } from './helpers.js';
import { insertTimeEntry, cookieFrom } from './helpers-money.js';

let app;
let alice;   // owns the shared data
let data;    // { client, project, task, otherClient, otherProject }

beforeAll(async () => {
  ({ app } = await getApp());
  alice = await createUser({ name: 'Alice Owner' });

  const client = (await alice.post('/api/clients').send({
    name: 'Shared Client',
    hourly_rate: 333,
    bank_name: 'Bank Hapoalim',
    bank_account: '123456789',
    bank_branch: '600',
    tax_id: '514000000',
    email: 'client@secret.example',
    phone: '050-0000000',
    notes: 'internal notes about the client'
  })).body;
  const project = (await alice.post('/api/projects').send({
    client_id: client.id, name: 'Shared Project', pricing_type: 'hourly', hourly_rate: 444, description: 'visible description'
  })).body;
  const task = (await alice.post('/api/tasks').send({ project_id: project.id, name: 'Shared Task' })).body;

  const otherClient = (await alice.post('/api/clients').send({ name: 'Other Client', bank_account: '999' })).body;
  const otherProject = (await alice.post('/api/projects').send({ client_id: otherClient.id, name: 'Other Project' })).body;
  await alice.post('/api/tasks').send({ project_id: otherProject.id, name: 'Other Task' });

  insertTimeEntry(alice, { project_id: project.id, task_id: task.id, duration: 5400 });
  insertTimeEntry(alice, { project_id: otherProject.id, duration: 999 });

  data = { client, project, task, otherClient, otherProject };
});

const share = (body) => alice.post('/api/share').send(body);
const access = (token, cookie) => {
  const req = request(app).get(`/api/share/access/${token}`);
  if (cookie) req.set('Cookie', cookie);
  return req;
};
const verifyPassword = (token, body) => request(app).post(`/api/share/verify-password/${token}`).send(body);
const linkRow = (id) => alice.db.prepare('SELECT * FROM shared_links WHERE id = ?').get(id);

describe('share link management', () => {
  it('requires a login for the owner endpoints', async () => {
    expect((await request(app).post('/api/share').send({})).status).toBe(401);
    expect((await request(app).get('/api/share/my-links')).status).toBe(401);
    expect((await request(app).get('/api/share/shared-with-me')).status).toBe(401);
    expect((await request(app).put(`/api/share/${uuidv4()}`).send({})).status).toBe(401);
    expect((await request(app).delete(`/api/share/${uuidv4()}`)).status).toBe(401);
    expect((await request(app).post(`/api/share/verify-email/${uuidv4()}`)).status).toBe(401);
  });

  it('creates a public link and never returns the password hash', async () => {
    const res = await share({ resource_type: 'client', resource_id: data.client.id, name: 'For the client' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      resource_type: 'client',
      resource_id: data.client.id,
      share_type: 'public',
      is_active: 1,
      name: 'For the client',
      workspace_id: alice.workspaceId
    });
    expect(res.body.share_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).not.toHaveProperty('share_password');

    const mine = await alice.get('/api/share/my-links');
    const link = mine.body.find(l => l.id === res.body.id);
    expect(link.resource_name).toBe('Shared Client');
    expect(mine.body.every(l => !('share_password' in l))).toBe(true);
  });

  it('404s for unknown resources and resource types', async () => {
    expect((await share({ resource_type: 'client', resource_id: uuidv4() })).status).toBe(404);
    expect((await share({ resource_type: 'project', resource_id: uuidv4() })).status).toBe(404);
    expect((await share({ resource_type: 'invoice', resource_id: data.client.id })).status).toBe(404);
    expect((await share({ resource_id: data.client.id })).status).toBe(404);
  });

  it('rejects unknown share types', async () => {
    const res = await share({ resource_type: 'client', resource_id: data.client.id, share_type: 'secret-handshake' });
    expect(res.status).toBe(400);
  });

  it('requires a password for password links and an email for email links', async () => {
    expect((await share({ resource_type: 'client', resource_id: data.client.id, share_type: 'password' })).status).toBe(400);
    expect((await share({ resource_type: 'client', resource_id: data.client.id, share_type: 'email' })).status).toBe(400);
  });

  it('deletes a link; the token then stops working', async () => {
    const link = (await share({ resource_type: 'project', resource_id: data.project.id })).body;
    expect((await access(link.share_token)).status).toBe(200);
    expect((await alice.delete(`/api/share/${link.id}`)).status).toBe(200);
    expect((await access(link.share_token)).status).toBe(404);
    expect((await request(app).get(`/api/share/info/${link.share_token}`)).status).toBe(404);
    expect((await alice.delete(`/api/share/${link.id}`)).status).toBe(404);
  });

  it('PUT 404s for an unknown link', async () => {
    expect((await alice.put(`/api/share/${uuidv4()}`).send({ name: 'x' })).status).toBe(404);
  });
});

describe('public access', () => {
  it('serves link info without internal ids or secrets', async () => {
    const link = (await share({ resource_type: 'client', resource_id: data.client.id, share_type: 'password', password: 'pw-1234', name: 'Info' })).body;
    const res = await request(app).get(`/api/share/info/${link.share_token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ share_type: 'password', resource_type: 'client', resource_name: 'Shared Client', owner_name: 'Alice Owner', name: 'Info' });
    expect(res.body).not.toHaveProperty('share_password');
    expect(res.body).not.toHaveProperty('resource_id');
    expect(res.body).not.toHaveProperty('owner_id');
  });

  it('404s for a bad token', async () => {
    expect((await request(app).get('/api/share/info/not-a-real-token')).status).toBe(404);
    expect((await access('not-a-real-token')).status).toBe(404);
    expect((await verifyPassword('not-a-real-token', { password: 'x' })).status).toBe(404);
  });

  it('a public client link shows only that client\'s projects and no private client data', async () => {
    const link = (await share({ resource_type: 'client', resource_id: data.client.id })).body;
    const res = await access(link.share_token);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('client');

    const client = res.body.data;
    expect(Object.keys(client).sort()).toEqual(['id', 'name', 'projects']);
    expect(client.name).toBe('Shared Client');
    expect(client.projects.map(p => p.name)).toEqual(['Shared Project']);
    expect(client.projects[0].total_time).toBe(5400);
    for (const p of client.projects) {
      expect(Object.keys(p).sort()).toEqual(['description', 'id', 'name', 'pricing_type', 'status', 'total_time']);
    }

    const body = JSON.stringify(res.body);
    for (const secret of ['123456789', 'Bank Hapoalim', '514000000', 'client@secret.example', '050-0000000', 'internal notes', '333', '444', 'Other Client', 'Other Project', alice.user.email]) {
      expect(body).not.toContain(secret);
    }
  });

  it('a public project link shows only that project\'s tasks and no rates', async () => {
    const link = (await share({ resource_type: 'project', resource_id: data.project.id })).body;
    const res = await access(link.share_token);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('project');
    const project = res.body.data;
    expect(project).toMatchObject({ name: 'Shared Project', client_name: 'Shared Client', total_time: 5400, description: 'visible description' });
    expect(project.tasks.map(t => t.name)).toEqual(['Shared Task']);
    expect(project.tasks[0].total_time).toBe(5400);
    expect(Object.keys(project).sort()).toEqual(['client_name', 'description', 'id', 'name', 'pricing_type', 'status', 'tasks', 'total_time']);

    const body = JSON.stringify(res.body);
    for (const secret of ['444', '333', '123456789', 'Other Task', 'Other Project']) {
      expect(body).not.toContain(secret);
    }
  });

  it('a client link hides internal lead (shadow) projects', async () => {
    // An opportunity on an existing client gets an internal project under that client
    const lead = (await alice.post('/api/leads').send({ name: 'Upsell Deal', client_id: data.client.id })).body;
    const ensured = await alice.post(`/api/leads/${lead.id}/ensure-project`);
    expect(ensured.status).toBe(200);

    const link = (await share({ resource_type: 'client', resource_id: data.client.id })).body;
    const res = await access(link.share_token);
    expect(res.body.data.projects.map(p => p.name)).toEqual(['Shared Project']);
    expect(JSON.stringify(res.body)).not.toContain('Upsell Deal');
  });

  it('a deactivated link is refused, and works again once re-activated', async () => {
    const link = (await share({ resource_type: 'project', resource_id: data.project.id })).body;
    const off = await alice.put(`/api/share/${link.id}`).send({ is_active: false });
    expect(off.status).toBe(200);
    expect(off.body.is_active).toBe(0);
    expect(off.body).not.toHaveProperty('share_password');

    const denied = await access(link.share_token);
    expect(denied.status).toBe(403);
    expect(denied.body.data).toBeUndefined();
    const info = await request(app).get(`/api/share/info/${link.share_token}`);
    expect(info.status).toBe(403);
    expect(info.body.inactive).toBe(true);

    await alice.put(`/api/share/${link.id}`).send({ is_active: true });
    expect((await access(link.share_token)).status).toBe(200);
  });

  it('an expired link is refused', async () => {
    const link = (await share({ resource_type: 'project', resource_id: data.project.id, expires_at: '2000-01-01T00:00:00Z' })).body;
    const res = await access(link.share_token);
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
    const info = await request(app).get(`/api/share/info/${link.share_token}`);
    expect(info.status).toBe(403);
    expect(info.body.expired).toBe(true);

    const future = (await share({ resource_type: 'project', resource_id: data.project.id, expires_at: '2999-01-01T00:00:00Z' })).body;
    expect((await access(future.share_token)).status).toBe(200);
  });

  it('a link to a deleted resource 404s', async () => {
    const tmpClient = (await alice.post('/api/clients').send({ name: 'Temp' })).body;
    const link = (await share({ resource_type: 'client', resource_id: tmpClient.id })).body;
    alice.db.prepare('DELETE FROM clients WHERE id = ?').run(tmpClient.id);
    expect((await access(link.share_token)).status).toBe(404);
  });

  it('fails closed for a link with an unrecognised share type', async () => {
    const link = (await share({ resource_type: 'client', resource_id: data.client.id })).body;
    alice.db.prepare("UPDATE shared_links SET share_type = 'legacy-weird' WHERE id = ?").run(link.id);
    const res = await access(link.share_token);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.data).toBeUndefined();
  });
});

describe('password-protected links', () => {
  let link;
  beforeAll(async () => {
    link = (await share({ resource_type: 'project', resource_id: data.project.id, share_type: 'password', password: 'open-sesame' })).body;
  });

  it('stores only a bcrypt hash of the password', () => {
    const row = linkRow(link.id);
    expect(row.share_password).toMatch(/^\$2[aby]\$10\$/);
    expect(row.share_password).not.toContain('open-sesame');
  });

  it('refuses access without a verified session', async () => {
    const res = await access(link.share_token);
    expect(res.status).toBe(401);
    expect(res.body.requires_password).toBe(true);
    expect(res.body.data).toBeUndefined();
  });

  it('ignores client-side "verified" flags in the query string', async () => {
    const res = await request(app).get(`/api/share/access/${link.share_token}?verified=true&password=open-sesame`);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong or missing password', async () => {
    const wrong = await verifyPassword(link.share_token, { password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.headers['set-cookie']).toBeUndefined();

    const missing = await verifyPassword(link.share_token, {});
    expect(missing.status).toBe(400);
    expect(missing.headers['set-cookie']).toBeUndefined();
  });

  it('a correct password grants an httpOnly cookie scoped to /api/share that opens the link', async () => {
    const res = await verifyPassword(link.share_token, { password: 'open-sesame' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, resource_type: 'project', resource_id: data.project.id });

    const cookie = cookieFrom(res, `share_access_${link.id}=`);
    expect(cookie).not.toBeNull();
    expect(cookie.line).toMatch(/HttpOnly/i);
    expect(cookie.line).toMatch(/Path=\/api\/share/);
    expect(cookie.line).toMatch(/SameSite=Lax/i);

    const ok = await access(link.share_token, cookie.pair);
    expect(ok.status).toBe(200);
    expect(ok.body.data.name).toBe('Shared Project');

    const logged = alice.db.prepare('SELECT COUNT(*) as n FROM shared_link_access WHERE shared_link_id = ?').get(link.id);
    expect(logged.n).toBeGreaterThanOrEqual(1);
  });

  it('a cookie for one link does not open another link', async () => {
    const other = (await share({ resource_type: 'client', resource_id: data.client.id, share_type: 'password', password: 'other-pw' })).body;
    const res = await verifyPassword(link.share_token, { password: 'open-sesame' });
    const cookie = cookieFrom(res, `share_access_${link.id}=`);

    // Same cookie value presented under the other link's cookie name
    const value = cookie.pair.split('=').slice(1).join('=');
    expect((await access(other.share_token, `share_access_${other.id}=${value}`)).status).toBe(401);
    expect((await access(other.share_token, cookie.pair)).status).toBe(401);
  });

  it('rejects forged, expired, or garbage access cookies', async () => {
    const name = `share_access_${link.id}`;
    const forged = jwt.sign({ linkId: link.id }, 'x'.repeat(64), { expiresIn: '2h' });
    const expired = jwt.sign({ linkId: link.id, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
    const wrongLink = jwt.sign({ linkId: uuidv4() }, process.env.JWT_SECRET, { expiresIn: '2h' });
    for (const value of [forged, expired, wrongLink, 'garbage', '']) {
      expect((await access(link.share_token, `${name}=${value}`)).status).toBe(401);
    }
    // A normal login token is not a share session either
    expect((await access(link.share_token, `${name}=${alice.token}`)).status).toBe(401);
  });

  it('a share session cookie is not a login token', async () => {
    const res = await verifyPassword(link.share_token, { password: 'open-sesame' });
    const value = cookieFrom(res, `share_access_${link.id}=`).pair.split('=').slice(1).join('=');
    const me = await request(app).get('/api/clients').set('Authorization', `Bearer ${decodeURIComponent(value)}`);
    expect(me.status).not.toBe(200);
  });

  it('verify-password refuses inactive links and non-password links', async () => {
    const pub = (await share({ resource_type: 'client', resource_id: data.client.id })).body;
    expect((await verifyPassword(pub.share_token, { password: 'x' })).status).toBe(400);

    const off = (await share({ resource_type: 'client', resource_id: data.client.id, share_type: 'password', password: 'pw' })).body;
    await alice.put(`/api/share/${off.id}`).send({ is_active: false });
    expect((await verifyPassword(off.share_token, { password: 'pw' })).status).toBe(403);
  });

  it('a deactivated link refuses even a previously valid cookie', async () => {
    const l = (await share({ resource_type: 'project', resource_id: data.project.id, share_type: 'password', password: 'pw2' })).body;
    const cookie = cookieFrom(await verifyPassword(l.share_token, { password: 'pw2' }), `share_access_${l.id}=`).pair;
    expect((await access(l.share_token, cookie)).status).toBe(200);
    await alice.put(`/api/share/${l.id}`).send({ is_active: false });
    expect((await access(l.share_token, cookie)).status).toBe(403);
  });

  it('toggling active (the ShareModal payload) keeps the password', async () => {
    const l = (await share({ resource_type: 'project', resource_id: data.project.id, share_type: 'password', password: 'keep-me' })).body;
    await alice.put(`/api/share/${l.id}`).send({ is_active: false });
    await alice.put(`/api/share/${l.id}`).send({ is_active: true });
    const row = linkRow(l.id);
    expect(row.share_type).toBe('password');
    expect(row.share_password).toBeTruthy();
    expect((await verifyPassword(l.share_token, { password: 'keep-me' })).status).toBe(200);
  });

  it('editing without a new password keeps the old one; a new password replaces it', async () => {
    const l = (await share({ resource_type: 'project', resource_id: data.project.id, share_type: 'password', password: 'first' })).body;
    await alice.put(`/api/share/${l.id}`).send({ share_type: 'password', name: 'Renamed', is_active: true });
    expect(linkRow(l.id).name).toBe('Renamed');
    expect((await verifyPassword(l.share_token, { password: 'first' })).status).toBe(200);

    await alice.put(`/api/share/${l.id}`).send({ share_type: 'password', password: 'second' });
    expect((await verifyPassword(l.share_token, { password: 'first' })).status).toBe(401);
    expect((await verifyPassword(l.share_token, { password: 'second' })).status).toBe(200);
  });

  it('switching a link to public drops the password hash', async () => {
    const l = (await share({ resource_type: 'project', resource_id: data.project.id, share_type: 'password', password: 'pw' })).body;
    await alice.put(`/api/share/${l.id}`).send({ share_type: 'public' });
    expect(linkRow(l.id).share_password).toBeNull();
    expect((await access(l.share_token)).status).toBe(200);
  });

  it('a link left without a password hash by older versions can still be renamed and switched off', async () => {
    const l = (await share({ resource_type: 'project', resource_id: data.project.id, share_type: 'password', password: 'pw' })).body;
    alice.db.prepare('UPDATE shared_links SET share_password = NULL WHERE id = ?').run(l.id);
    expect((await alice.put(`/api/share/${l.id}`).send({ name: 'Broken link' })).status).toBe(200);
    expect((await alice.put(`/api/share/${l.id}`).send({ is_active: false })).status).toBe(200);
    expect(linkRow(l.id)).toMatchObject({ is_active: 0, name: 'Broken link' });
    // ...and verifying against it is a clean refusal, not a crash
    await alice.put(`/api/share/${l.id}`).send({ is_active: true });
    expect((await verifyPassword(l.share_token, { password: 'pw' })).status).toBe(401);
  });

  it('switching to password without giving a password is rejected', async () => {
    const l = (await share({ resource_type: 'project', resource_id: data.project.id })).body;
    const res = await alice.put(`/api/share/${l.id}`).send({ share_type: 'password' });
    expect(res.status).toBe(400);
    expect(linkRow(l.id).share_type).toBe('public');
  });
});

describe('email-restricted links', () => {
  let guest;
  let link;
  beforeAll(async () => {
    guest = await createUser({ name: 'Guest', email: `Guest.Person.${Date.now()}@Example.com` });
    link = (await share({ resource_type: 'client', resource_id: data.client.id, share_type: 'email', allowed_email: `  ${guest.user.email.toUpperCase()} ` })).body;
  });

  it('normalises the allowed email', () => {
    expect(link.allowed_email).toBe(guest.user.email.toLowerCase());
  });

  it('refuses anonymous access', async () => {
    const res = await access(link.share_token);
    expect(res.status).toBe(401);
    expect(res.body.requires_email).toBe(true);
    expect(res.body.data).toBeUndefined();
  });

  it('refuses a logged-in user with a different email', async () => {
    const stranger = await createUser();
    const res = await stranger.post(`/api/share/verify-email/${link.share_token}`);
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('verify-email refuses non-email links', async () => {
    const pub = (await share({ resource_type: 'client', resource_id: data.client.id })).body;
    expect((await guest.post(`/api/share/verify-email/${pub.share_token}`)).status).toBe(400);
  });

  it('the invited user gets a session cookie and can open the link', async () => {
    const res = await guest.post(`/api/share/verify-email/${link.share_token}`);
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res, `share_access_${link.id}=`);
    expect(cookie.line).toMatch(/HttpOnly/i);
    const ok = await access(link.share_token, cookie.pair);
    expect(ok.status).toBe(200);
    expect(ok.body.data.name).toBe('Shared Client');
    expect(JSON.stringify(ok.body)).not.toContain('123456789');

    const logged = alice.db.prepare('SELECT * FROM shared_link_access WHERE shared_link_id = ? AND accessed_by_user_id = ?').get(link.id, guest.user.id);
    expect(logged.accessed_by_email).toBe(guest.user.email);
  });

  it('shows up in "shared with me" only for the invited user', async () => {
    const mine = await guest.get('/api/share/shared-with-me');
    expect(mine.status).toBe(200);
    const found = mine.body.find(l => l.id === link.id);
    expect(found).toMatchObject({ resource_name: 'Shared Client', owner_name: 'Alice Owner' });
    expect(found).not.toHaveProperty('share_password');

    const stranger = await createUser();
    const theirs = await stranger.get('/api/share/shared-with-me');
    expect(theirs.body.find(l => l.id === link.id)).toBeUndefined();
  });

  it('toggling active keeps the allowed email', async () => {
    const l = (await share({ resource_type: 'client', resource_id: data.client.id, share_type: 'email', allowed_email: guest.user.email })).body;
    await alice.put(`/api/share/${l.id}`).send({ is_active: false });
    await alice.put(`/api/share/${l.id}`).send({ is_active: true });
    expect(linkRow(l.id).allowed_email).toBe(guest.user.email.toLowerCase());
    expect((await guest.post(`/api/share/verify-email/${l.share_token}`)).status).toBe(200);
  });

  it('an email link left without an email can still be switched off, and refuses verification', async () => {
    const l = (await share({ resource_type: 'client', resource_id: data.client.id, share_type: 'email', allowed_email: guest.user.email })).body;
    alice.db.prepare('UPDATE shared_links SET allowed_email = NULL WHERE id = ?').run(l.id);
    expect((await guest.post(`/api/share/verify-email/${l.share_token}`)).status).toBe(403);
    expect((await alice.put(`/api/share/${l.id}`).send({ is_active: false })).status).toBe(200);
  });

  it('switching to email without an email is rejected', async () => {
    const l = (await share({ resource_type: 'client', resource_id: data.client.id })).body;
    const res = await alice.put(`/api/share/${l.id}`).send({ share_type: 'email' });
    expect(res.status).toBe(400);
  });
});

describe('share cross-workspace isolation', () => {
  it('another workspace cannot share, list, edit or delete someone else\'s links', async () => {
    const bob = await createUser();
    expect((await bob.post('/api/share').send({ resource_type: 'client', resource_id: data.client.id })).status).toBe(404);
    expect((await bob.post('/api/share').send({ resource_type: 'project', resource_id: data.project.id })).status).toBe(404);

    const link = (await share({ resource_type: 'project', resource_id: data.project.id, share_type: 'password', password: 'pw' })).body;
    const bobLinks = await bob.get('/api/share/my-links');
    expect(bobLinks.body).toEqual([]);

    expect((await bob.put(`/api/share/${link.id}`).send({ share_type: 'public' })).status).toBe(404);
    expect((await bob.delete(`/api/share/${link.id}`)).status).toBe(404);
    expect(linkRow(link.id).share_type).toBe('password');
    expect((await access(link.share_token)).status).toBe(401);
  });

  it('a member of the workspace cannot use another workspace id header to reach the links', async () => {
    const bob = await createUser();
    expect((await bob.get('/api/share/my-links', alice.workspaceId)).status).toBe(403);
  });
});
