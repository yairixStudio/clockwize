import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { addEntry, addMember, adminClient } from './helpers-core.js';

const login = async (email, password) => {
  const { app } = await getApp();
  return request(app).post('/api/auth/login').send({ email, password });
};

describe('auth - profile', () => {
  it('requires a login', async () => {
    const { app } = await getApp();
    expect((await request(app).put('/api/auth/profile').send({ name: 'x' })).status).toBe(401);
    expect((await request(app).delete('/api/auth/account').send({ password: 'x' })).status).toBe(401);
  });

  it('updates name, email and default hourly rate', async () => {
    const user = await createUser();
    const email = `renamed-${Date.now()}@example.com`;
    const res = await user.put('/api/auth/profile').send({ name: 'New Name', email, default_hourly_rate: 400 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.user.id, email, name: 'New Name', default_hourly_rate: 400 });

    const me = (await user.get('/api/auth/me')).body;
    expect(me).toMatchObject({ name: 'New Name', email, default_hourly_rate: 400 });
    expect((await login(email, user.password)).status).toBe(200);
  });

  it('an empty update changes nothing', async () => {
    const user = await createUser({ name: 'Same' });
    const res = await user.put('/api/auth/profile').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Same', email: user.user.email, default_hourly_rate: 250 });
  });

  it("refuses an email that belongs to someone else, accepts the user's own", async () => {
    const user = await createUser();
    const other = await createUser();
    const taken = await user.put('/api/auth/profile').send({ email: other.user.email });
    expect(taken.status).toBe(400);
    expect((await user.get('/api/auth/me')).body.email).toBe(user.user.email);
    expect((await user.put('/api/auth/profile').send({ email: user.user.email, name: 'Kept' })).status).toBe(200);
  });

  it('changing the password requires the correct current password', async () => {
    const user = await createUser();
    const email = user.user.email;

    const missing = await user.put('/api/auth/profile').send({ password: 'NewPass1!' });
    expect(missing.status).toBe(400);
    const wrong = await user.put('/api/auth/profile').send({ password: 'NewPass1!', currentPassword: 'wrong' });
    expect(wrong.status).toBe(401);
    expect((await login(email, 'NewPass1!')).status).toBe(401);

    const ok = await user.put('/api/auth/profile').send({ password: 'NewPass1!', currentPassword: user.password });
    expect(ok.status).toBe(200);
    expect(ok.body.password).toBeUndefined();
    expect((await login(email, 'NewPass1!')).status).toBe(200);
    expect((await login(email, user.password)).status).toBe(401);
  });

  it('the stored password is a hash, never the plain text', async () => {
    const user = await createUser();
    const row = user.db.prepare('SELECT password FROM users WHERE id = ?').get(user.user.id);
    expect(row.password).not.toBe(user.password);
    expect(row.password).toMatch(/^\$2[aby]\$/);
  });
});

describe('auth - account deletion', () => {
  it('refuses a wrong password and keeps the account', async () => {
    const user = await createUser();
    const res = await user.delete('/api/auth/account').send({ password: 'wrong' });
    expect(res.status).toBe(401);
    expect((await user.get('/api/auth/me')).status).toBe(200);
  });

  it('asks for the password instead of crashing when it is missing', async () => {
    const user = await createUser();
    const res = await user.delete('/api/auth/account').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect((await user.get('/api/auth/me')).status).toBe(200);
  });

  it('deletes the user with their workspace and data', async () => {
    const user = await createUser();
    const { client, project } = await createClientProjectTask(user);
    const entry = await addEntry(user, { project_id: project.id, start: '2025-01-01T10:00:00.000Z', seconds: 60 });
    await user.post('/api/timer/start').send({ project_id: project.id });

    const res = await user.delete('/api/auth/account').send({ password: user.password });
    expect(res.status).toBe(200);

    expect((await login(user.user.email, user.password)).status).toBe(401);
    // The old token is rejected outright (401 signs the client out)
    expect((await user.get('/api/auth/me')).status).toBe(401);
    expect((await user.get('/api/clients')).status).toBe(401);

    const { db } = user;
    const count = (sql, id) => db.prepare(sql).get(id).n;
    expect(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', user.user.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?', user.workspaceId)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM workspace_members WHERE user_id = ?', user.user.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM clients WHERE id = ?', client.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM time_entries WHERE id = ?', entry.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM active_timers WHERE user_id = ?', user.user.id)).toBe(0);
  });

  // clients.user_id is ON DELETE CASCADE (database.js), so when a member deletes their account every
  // client they created in a shared workspace - with all projects and everyone's entries - disappears
  it.fails("a member deleting their account keeps the clients they created in someone else's workspace", async () => {
    const owner = await createUser();
    const member = await addMember(owner, 'member');
    const client = (await member.post('/api/clients').send({ name: 'Team client' })).body;
    expect((await member.delete('/api/auth/account').send({ password: member.password })).status).toBe(200);
    expect((await owner.get(`/api/clients/${client.id}`)).status).toBe(200);
  });
});

describe('auth - forced password reset', () => {
  it('validates the request', async () => {
    const { app } = await getApp();
    const user = await createUser();
    const post = (body) => request(app).post('/api/auth/reset-password').send(body);
    expect((await post({ userId: user.user.id, oldPassword: user.password })).status).toBe(400);
    expect((await post({ userId: user.user.id, oldPassword: user.password, newPassword: 'abc' })).status).toBe(400);
    expect((await post({ userId: 'nope', oldPassword: 'x', newPassword: 'abcd1234' })).status).toBe(404);
    expect((await post({ userId: user.user.id, oldPassword: 'wrong', newPassword: 'abcd1234' })).status).toBe(401);
    // Not flagged for a reset
    expect((await post({ userId: user.user.id, oldPassword: user.password, newPassword: 'abcd1234' })).status).toBe(400);
    expect((await login(user.user.email, user.password)).status).toBe(200);
  });

  it('admin forces a reset, login flags it, and the reset clears it', async () => {
    const { app } = await getApp();
    const admin = await adminClient();
    const user = await createUser();
    expect((await admin.post(`/api/admin/users/${user.user.id}/force-password-reset`)).status).toBe(200);

    const flagged = await login(user.user.email, user.password);
    expect(flagged.status).toBe(200);
    expect(flagged.body.requiresPasswordReset).toBe(true);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ userId: user.user.id, oldPassword: user.password, newPassword: 'Fresh123!' });
    expect(reset.status).toBe(200);
    expect(reset.body.token).toBeTruthy();
    expect(reset.body.currentWorkspace.id).toBe(user.workspaceId);

    const after = await login(user.user.email, 'Fresh123!');
    expect(after.status).toBe(200);
    expect(after.body.requiresPasswordReset).toBe(false);
    expect((await login(user.user.email, user.password)).status).toBe(401);
  });
});

describe('admin - access control', () => {
  it('requires a login', async () => {
    const { app } = await getApp();
    expect((await request(app).get('/api/admin/users')).status).toBe(401);
  });

  it('refuses every admin action to a regular user and changes nothing', async () => {
    const user = await createUser();
    const victim = await createUser();
    const id = victim.user.id;
    const attempts = [
      ['get', '/api/admin/users'],
      ['post', `/api/admin/impersonate/${id}`],
      ['post', `/api/admin/users/${id}/force-password-reset`],
      ['post', `/api/admin/users/${id}/set-password`, { password: 'owned1234' }],
      ['post', `/api/admin/users/${id}/toggle-active`],
      ['delete', `/api/admin/users/${id}`]
    ];
    for (const [method, url, body] of attempts) {
      const req = user[method](url);
      const res = body ? await req.send(body) : await req;
      expect(res.status, url).toBe(403);
      expect(res.body.token).toBeUndefined();
    }
    const row = victim.db.prepare('SELECT is_active, force_password_reset FROM users WHERE id = ?').get(id);
    expect(row).toEqual({ is_active: 1, force_password_reset: 0 });
    expect((await login(victim.user.email, victim.password)).status).toBe(200);
  });

  it('a workspace owner/admin role does not grant system admin', async () => {
    const owner = await createUser();
    const wsAdmin = await addMember(owner, 'admin');
    expect((await owner.get('/api/admin/users')).status).toBe(403);
    expect((await wsAdmin.get('/api/admin/users')).status).toBe(403);
  });
});

describe('admin - actions', () => {
  it('lists users with their counts and without passwords', async () => {
    const admin = await adminClient();
    const user = await createUser({ name: 'Listed' });
    await createClientProjectTask(user);
    const res = await admin.get('/api/admin/users');
    expect(res.status).toBe(200);
    const row = res.body.find((u) => u.id === user.user.id);
    expect(row).toMatchObject({ name: 'Listed', email: user.user.email, is_active: 1, force_password_reset: 0, client_count: 1, project_count: 1 });
    expect(res.body.every((u) => u.password === undefined)).toBe(true);
  });

  it('impersonates a user with a working token', async () => {
    const { app } = await getApp();
    const admin = await adminClient();
    const user = await createUser({ name: 'Target' });
    expect((await admin.post('/api/admin/impersonate/nope')).status).toBe(404);
    const res = await admin.post(`/api/admin/impersonate/${user.user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.user.id, name: 'Target', is_admin: 0 });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.body.id).toBe(user.user.id);
  });

  it('cannot target admin accounts or unknown users', async () => {
    const admin = await adminClient();
    const self = admin.user.id;
    expect((await admin.post(`/api/admin/users/${self}/force-password-reset`)).status).toBe(403);
    expect((await admin.post(`/api/admin/users/${self}/set-password`).send({ password: 'newadmin' })).status).toBe(403);
    expect((await admin.post(`/api/admin/users/${self}/toggle-active`)).status).toBe(403);
    expect((await admin.delete(`/api/admin/users/${self}`)).status).toBe(403);
    expect((await login('admin', 'admin')).status).toBe(200);

    expect((await admin.post('/api/admin/users/nope/force-password-reset')).status).toBe(404);
    expect((await admin.post('/api/admin/users/nope/set-password').send({ password: 'abcd' })).status).toBe(404);
    expect((await admin.post('/api/admin/users/nope/toggle-active')).status).toBe(404);
    expect((await admin.delete('/api/admin/users/nope')).status).toBe(404);
  });

  it('sets a new password (min 4 chars) and clears a pending forced reset', async () => {
    const admin = await adminClient();
    const user = await createUser();
    await admin.post(`/api/admin/users/${user.user.id}/force-password-reset`);
    expect((await admin.post(`/api/admin/users/${user.user.id}/set-password`).send({ password: 'abc' })).status).toBe(400);
    expect((await admin.post(`/api/admin/users/${user.user.id}/set-password`).send({})).status).toBe(400);
    expect((await admin.post(`/api/admin/users/${user.user.id}/set-password`).send({ password: 'byAdmin1' })).status).toBe(200);
    const res = await login(user.user.email, 'byAdmin1');
    expect(res.status).toBe(200);
    expect(res.body.requiresPasswordReset).toBe(false);
    expect((await login(user.user.email, user.password)).status).toBe(401);
  });

  it('suspends and re-activates an account', async () => {
    const admin = await adminClient();
    const user = await createUser();
    const off = await admin.post(`/api/admin/users/${user.user.id}/toggle-active`);
    expect(off.body.is_active).toBe(0);
    expect((await login(user.user.email, user.password)).status).toBe(403);
    const on = await admin.post(`/api/admin/users/${user.user.id}/toggle-active`);
    expect(on.body.is_active).toBe(1);
    expect((await login(user.user.email, user.password)).status).toBe(200);
  });

  // authMiddleware checks users.is_active on every request (401 makes the client sign out)
  it("a suspended user's existing token stops working", async () => {
    const admin = await adminClient();
    const user = await createUser();
    await createClientProjectTask(user);
    await admin.post(`/api/admin/users/${user.user.id}/toggle-active`);
    expect((await user.get('/api/clients')).status).toBe(401);
  });

  it('deletes a user and their data', async () => {
    const admin = await adminClient();
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    expect((await admin.delete(`/api/admin/users/${user.user.id}`)).status).toBe(200);
    expect((await login(user.user.email, user.password)).status).toBe(401);
    expect(user.db.prepare('SELECT COUNT(*) AS n FROM clients WHERE id = ?').get(client.id).n).toBe(0);
    expect(user.db.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?').get(user.workspaceId).n).toBe(0);
    expect((await admin.get('/api/admin/users')).body.find((u) => u.id === user.user.id)).toBeUndefined();
  });
});
