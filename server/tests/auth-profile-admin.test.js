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
    expect(res.body).toEqual({ id: user.user.id, email, name: 'New Name', default_hourly_rate: 400, has_password: 1 });

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

  it('a password change signs out the other sessions and returns a fresh token for this one', async () => {
    const { app } = await getApp();
    const user = await createUser();
    const otherSession = (await login(user.user.email, user.password)).body.token;
    const me = (token) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect((await me(otherSession)).status).toBe(200);

    const res = await user.put('/api/auth/profile').send({ password: 'NewPass1!', currentPassword: user.password });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: user.user.id, has_password: 1, token: expect.any(String) });

    expect((await user.get('/api/auth/me')).status).toBe(401);
    expect((await me(otherSession)).status).toBe(401);
    const fresh = await me(res.body.token);
    expect(fresh.status).toBe(200);
    expect(fresh.body.id).toBe(user.user.id);
    // Signing in again works as usual
    expect((await me((await login(user.user.email, 'NewPass1!')).body.token)).status).toBe(200);
  });

  it('a profile update without a new password keeps every session and returns no token', async () => {
    const user = await createUser();
    const res = await user.put('/api/auth/profile').send({ name: 'Renamed' });
    expect(res.body.token).toBeUndefined();
    expect((await user.get('/api/auth/me')).status).toBe(200);
  });

  it('a passkey-only account sets its first password without a current one', async () => {
    const user = await createUser();
    user.db.prepare("UPDATE users SET password = '' WHERE id = ?").run(user.user.id);
    expect((await user.get('/api/auth/me')).body.has_password).toBe(0);

    const res = await user.put('/api/auth/profile').send({ password: 'First123!' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ has_password: 1, token: expect.any(String) });
    expect((await login(user.user.email, 'First123!')).status).toBe(200);

    // From now on the account has a password, so changing it needs the current one
    const { app } = await getApp();
    const again = await request(app).put('/api/auth/profile')
      .set('Authorization', `Bearer ${res.body.token}`)
      .send({ password: 'Second123!' });
    expect(again.status).toBe(400);
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

  // clients.user_id is ON DELETE CASCADE (database.js), so deleting the user row alone would take every
  // client they created in a shared workspace - with all projects and everyone's entries - with it
  it("a member deleting their account keeps the clients they created in someone else's workspace", async () => {
    const owner = await createUser();
    const member = await addMember(owner, 'member');
    const client = (await member.post('/api/clients').send({ name: 'Team client' })).body;
    const project = (await member.post('/api/projects').send({ client_id: client.id, name: 'Team project' })).body;
    const task = (await member.post('/api/tasks').send({ project_id: project.id, name: 'Team task' })).body;
    const memberEntry = await addEntry(member, { project_id: project.id, task_id: task.id, start: '2025-04-01T09:00:00.000Z', seconds: 1800 });
    const ownerEntry = await addEntry(owner, { project_id: project.id, start: '2025-04-02T09:00:00.000Z', seconds: 600 });
    await member.post('/api/timer/start').send({ project_id: project.id });
    // ...and something in their own personal workspace
    const personal = (await member.post('/api/clients', member.ownWorkspaceId).send({ name: 'Private client' })).body;

    expect((await member.delete('/api/auth/account').send({ password: member.password })).status).toBe(200);

    expect((await owner.get(`/api/clients/${client.id}`)).status).toBe(200);
    expect((await owner.get(`/api/projects/${project.id}`)).status).toBe(200);
    expect((await owner.get(`/api/tasks/${task.id}`)).status).toBe(200);
    expect((await owner.get('/api/timer/entries')).body.map((e) => e.id).sort()).toEqual([memberEntry.id, ownerEntry.id].sort());

    // The kept records now belong to the workspace owner; the account's personal state is gone
    const { db } = owner;
    const n = (sql, ...args) => db.prepare(sql).get(...args).n;
    for (const table of ['clients', 'projects', 'tasks', 'time_entries', 'timer_intervals']) {
      expect(n(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, member.user.id), table).toBe(0);
    }
    expect(db.prepare('SELECT user_id FROM clients WHERE id = ?').get(client.id).user_id).toBe(owner.user.id);
    expect(n('SELECT COUNT(*) AS n FROM active_timers WHERE user_id = ?', member.user.id)).toBe(0);
    expect(n('SELECT COUNT(*) AS n FROM workspace_members WHERE user_id = ?', member.user.id)).toBe(0);
    expect(n('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?', owner.workspaceId)).toBe(1);

    // Their personal workspace went with the account, data included
    expect(n('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?', member.ownWorkspaceId)).toBe(0);
    expect(n('SELECT COUNT(*) AS n FROM clients WHERE id = ?', personal.id)).toBe(0);
    expect(n('SELECT COUNT(*) AS n FROM clients WHERE workspace_id = ?', member.ownWorkspaceId)).toBe(0);
  });

  // integrations is UNIQUE(workspace_id, provider), so the workspace's connection moves to the owner
  // even when the owner has the same provider connected in another workspace
  it("keeps the workspace's integration a member connected, even if the owner has that provider elsewhere", async () => {
    const owner = await createUser();
    const member = await addMember(owner, 'member');
    const other = (await owner.post('/api/workspaces').send({ name: 'Owner other' })).body;
    const insert = owner.db.prepare(`INSERT INTO integrations (id, user_id, workspace_id, provider) VALUES (?, ?, ?, 'morning')`);
    const ownersId = `int-${Date.now()}-a`;
    const teamId = `int-${Date.now()}-b`;
    insert.run(ownersId, owner.user.id, other.id);
    insert.run(teamId, member.user.id, owner.workspaceId);
    const client = (await member.post('/api/clients').send({ name: 'Still kept' })).body;

    expect((await member.delete('/api/auth/account').send({ password: member.password })).status).toBe(200);
    expect((await owner.get(`/api/clients/${client.id}`)).status).toBe(200);
    const rows = owner.db.prepare('SELECT id, user_id, workspace_id FROM integrations WHERE id IN (?, ?) ORDER BY id').all(ownersId, teamId);
    expect(rows).toEqual([
      { id: ownersId, user_id: owner.user.id, workspace_id: other.id },
      { id: teamId, user_id: owner.user.id, workspace_id: owner.workspaceId }
    ]);
    expect((await owner.get('/api/integrations')).body.map((i) => i.provider)).toEqual(['morning']);
  });

  describe('passkey-only accounts (no password stored)', () => {
    // A passkey signup stores password '' (routes/passkeys.js) - same state as this
    const passkeyOnly = async () => {
      const user = await createUser({ email: `Passkey.User-${Date.now()}@Example.com` });
      user.db.prepare("UPDATE users SET password = '' WHERE id = ?").run(user.user.id);
      return user;
    };

    it('/me tells the client whether the account has a password', async () => {
      const withPassword = await createUser();
      expect((await withPassword.get('/api/auth/me')).body.has_password).toBe(1);
      expect((await (await passkeyOnly()).get('/api/auth/me')).body.has_password).toBe(0);
    });

    it('confirm the deletion with their email (exact, case-insensitive) instead of a password', async () => {
      const user = await passkeyOnly();
      const { client } = await createClientProjectTask(user);
      const email = user.user.email;

      const missing = await user.delete('/api/auth/account').send({});
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBeTruthy();
      expect((await user.delete('/api/auth/account').send({ password: 'anything' })).status).toBe(400);
      expect((await user.delete('/api/auth/account').send({ confirmEmail: 'someone-else@example.com' })).status).toBe(401);
      expect((await user.delete('/api/auth/account').send({ confirmEmail: `${email}x` })).status).toBe(401);
      expect((await user.delete('/api/auth/account').send({ confirmEmail: ` ${email}` })).status).toBe(401);
      expect((await user.get('/api/auth/me')).status).toBe(200);

      const res = await user.delete('/api/auth/account').send({ confirmEmail: email.toUpperCase() });
      expect(res.status).toBe(200);
      expect((await user.get('/api/auth/me')).status).toBe(401);
      expect(user.db.prepare('SELECT COUNT(*) AS n FROM clients WHERE id = ?').get(client.id).n).toBe(0);
      expect(user.db.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?').get(user.workspaceId).n).toBe(0);
    });

    it('a password account still needs its password - the email is not enough', async () => {
      const user = await createUser();
      const res = await user.delete('/api/auth/account').send({ confirmEmail: user.user.email });
      expect(res.status).toBe(400);
      expect((await user.get('/api/auth/me')).status).toBe(200);
      expect((await user.delete('/api/auth/account').send({ confirmEmail: user.user.email, password: 'wrong' })).status).toBe(401);
      expect((await user.get('/api/auth/me')).status).toBe(200);
    });
  });

  it('an owner deleting their account hands a shared workspace to a remaining member, admins first', async () => {
    const owner = await createUser({ name: 'Leaving owner' });
    const { client, project } = await createClientProjectTask(owner);
    const member = await addMember(owner, 'member', { name: 'Early member' });
    const admin = await addMember(owner, 'admin', { name: 'Later admin' });
    const memberClient = (await member.post('/api/clients').send({ name: 'Member client' })).body;
    const invite = (await owner.post(`/api/workspaces/${owner.workspaceId}/invites`).send({})).body;
    await owner.put('/api/addons/catalog').send({ isEnabled: true });
    const ws = owner.workspaceId;

    expect((await owner.delete('/api/auth/account').send({ password: owner.password })).status).toBe(200);

    // The workspace survives (workspaces.created_by is ON DELETE CASCADE) with the admin as its owner
    const { db } = admin;
    expect(db.prepare('SELECT created_by FROM workspaces WHERE id = ?').get(ws)).toEqual({ created_by: admin.user.id });
    expect((await admin.get('/api/workspaces/current')).body.role).toBe('owner');
    expect((await member.get('/api/workspaces/current')).body.role).toBe('member');
    expect((await admin.get(`/api/workspaces/${ws}/members`)).body.map((m) => m.name).sort()).toEqual(['Early member', 'Later admin']);

    // All of the workspace's data is still there; the departed owner's records now belong to the new owner
    expect((await admin.get('/api/clients')).body.map((c) => c.id).sort()).toEqual([client.id, memberClient.id].sort());
    expect((await member.get(`/api/projects/${project.id}`)).status).toBe(200);
    expect(db.prepare('SELECT user_id FROM clients WHERE id = ?').get(client.id).user_id).toBe(admin.user.id);
    expect(db.prepare('SELECT user_id FROM clients WHERE id = ?').get(memberClient.id).user_id).toBe(member.user.id);
    expect(db.prepare('SELECT created_by FROM workspace_invites WHERE id = ?').get(invite.id)).toEqual({ created_by: admin.user.id });
    expect((await admin.get('/api/addons/enabled')).body).toContain('catalog');
    expect((await member.get(`/api/workspaces/invite/${invite.token}`)).body.inviter_name).toBe('Later admin');
  });
});

describe('auth - forced password reset', () => {
  const flag = async (user) => {
    const admin = await adminClient();
    expect((await admin.post(`/api/admin/users/${user.user.id}/force-password-reset`)).status).toBe(200);
  };
  const resetPassword = async (body) => {
    const { app } = await getApp();
    return request(app).post('/api/auth/reset-password').send(body);
  };

  it('validates the request', async () => {
    const user = await createUser();
    await flag(user);
    const { resetToken } = (await login(user.user.email, user.password)).body;

    expect((await resetPassword({ resetToken })).status).toBe(400);
    expect((await resetPassword({ newPassword: 'abcd1234' })).status).toBe(400);
    expect((await resetPassword({ resetToken, newPassword: 'abc' })).status).toBe(400);
    expect((await resetPassword({ resetToken: 'not-a-token', newPassword: 'abcd1234' })).status).toBe(401);
    // A normal session token is not a reset token
    const other = await createUser();
    expect((await resetPassword({ resetToken: other.token, newPassword: 'abcd1234' })).status).toBe(401);
    // The old password again doesn't count as a new one
    expect((await resetPassword({ resetToken, newPassword: user.password })).status).toBe(400);
    // Nothing changed: the user still has to reset
    expect((await login(user.user.email, user.password)).body.requiresPasswordReset).toBe(true);
  });

  it('admin forces a reset, login gets a reset token instead of a session, and the reset signs in', async () => {
    const { app } = await getApp();
    const user = await createUser();
    await createUser(); // another user's workspace must not leak into the response
    await flag(user);

    const flagged = await login(user.user.email, user.password);
    expect(flagged.status).toBe(200);
    expect(flagged.body).toEqual({ requiresPasswordReset: true, resetToken: expect.any(String) });

    // The reset token is not a session
    const asSession = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${flagged.body.resetToken}`);
    expect(asSession.status).toBe(401);

    const reset = await resetPassword({ resetToken: flagged.body.resetToken, newPassword: 'Fresh123!' });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({
      requiresPasswordReset: false,
      user: { id: user.user.id, email: user.user.email, has_password: 1, is_admin: 0 },
      currentWorkspace: { id: user.workspaceId, role: 'owner', member_count: 1 }
    });
    expect(reset.body.workspaces.map((w) => w.id)).toEqual([user.workspaceId]);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${reset.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.user.id);

    // Single use: the flag is gone, so the same reset token can't set another password
    expect((await resetPassword({ resetToken: flagged.body.resetToken, newPassword: 'Again123!' })).status).toBe(400);

    const after = await login(user.user.email, 'Fresh123!');
    expect(after.status).toBe(200);
    expect(after.body.requiresPasswordReset).toBe(false);
    expect(after.body.token).toBeTruthy();
    expect((await login(user.user.email, user.password)).status).toBe(401);
  });

  it('flagging a user ends their existing sessions for good', async () => {
    const user = await createUser();
    expect((await user.get('/api/auth/me')).status).toBe(200);

    await flag(user);
    const blocked = await user.get('/api/clients');
    expect(blocked.status).toBe(401);
    expect(blocked.body.error).toBe('אנא התחבר למערכת');
    expect((await user.get('/api/auth/me')).status).toBe(401);

    const { resetToken } = (await login(user.user.email, user.password)).body;
    const reset = await resetPassword({ resetToken, newPassword: 'Fresh123!' });
    // Sessions from before the flag stay revoked after the reset; the new one works
    expect((await user.get('/api/auth/me')).status).toBe(401);
    const { app } = await getApp();
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${reset.body.token}`)).status).toBe(200);
  });

  it('the admin cannot impersonate a flagged user', async () => {
    const admin = await adminClient();
    const user = await createUser();
    await flag(user);
    const res = await admin.post(`/api/admin/impersonate/${user.user.id}`);
    expect(res.status).toBe(409);
    expect(res.body.token).toBeUndefined();
  });

  it('a suspended user cannot use a reset token', async () => {
    const admin = await adminClient();
    const user = await createUser();
    await flag(user);
    const { resetToken } = (await login(user.user.email, user.password)).body;
    await admin.post(`/api/admin/users/${user.user.id}/toggle-active`);

    expect((await resetPassword({ resetToken, newPassword: 'Fresh123!' })).status).toBe(403);
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

  it('a password set by the admin signs the user out of existing sessions', async () => {
    const admin = await adminClient();
    const user = await createUser();
    expect((await user.get('/api/auth/me')).status).toBe(200);
    // iatMs is in milliseconds; make sure the revocation time is strictly later than the token
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await admin.post(`/api/admin/users/${user.user.id}/set-password`).send({ password: 'byAdmin2' })).status).toBe(200);
    expect((await user.get('/api/auth/me')).status).toBe(401);
    expect((await login(user.user.email, 'byAdmin2')).status).toBe(200);
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

  it("deleting a user keeps what they created in someone else's workspace", async () => {
    const admin = await adminClient();
    const owner = await createUser();
    const member = await addMember(owner, 'member');
    const client = (await member.post('/api/clients').send({ name: 'Kept client' })).body;
    expect((await admin.delete(`/api/admin/users/${member.user.id}`)).status).toBe(200);
    expect((await owner.get(`/api/clients/${client.id}`)).status).toBe(200);
    expect(owner.db.prepare('SELECT user_id FROM clients WHERE id = ?').get(client.id).user_id).toBe(owner.user.id);
    expect(owner.db.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?').get(member.ownWorkspaceId).n).toBe(0);
  });
});
