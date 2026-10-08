import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getApp, createUser } from './helpers.js';

describe('auth', () => {
  it('registers a user with a personal workspace', async () => {
    const user = await createUser({ name: 'Dana' });
    expect(user.token).toBeTruthy();
    expect(user.user.name).toBe('Dana');
    expect(user.workspaceId).toBeTruthy();
  });

  it('rejects registration with missing fields', async () => {
    const { app } = await getApp();
    const res = await request(app).post('/api/auth/register').send({ email: 'a@b.c' });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate email', async () => {
    const { app } = await getApp();
    const user = await createUser();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: user.user.email, password: 'x', name: 'Copy' });
    expect(res.status).toBe(400);
  });

  it('logs in with the right password only', async () => {
    const { app } = await getApp();
    const user = await createUser();
    const ok = await request(app).post('/api/auth/login').send({ email: user.user.email, password: user.password });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.currentWorkspace.id).toBe(user.workspaceId);

    const bad = await request(app).post('/api/auth/login').send({ email: user.user.email, password: 'wrong' });
    expect(bad.status).toBe(401);
  });

  it('protects /me and returns the profile with a token', async () => {
    const { app } = await getApp();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);

    const user = await createUser({ name: 'Me' });
    const me = await user.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.name).toBe('Me');
    expect(me.body.password).toBeUndefined();
  });

  it('seeds the default admin account', async () => {
    const { app } = await getApp();
    const res = await request(app).post('/api/auth/login').send({ email: 'admin', password: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user.is_admin).toBe(1);
  });
});

describe('app shell', () => {
  it('answers the health check', async () => {
    const { app } = await getApp();
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('ok');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const { app } = await getApp();
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('requires a login for the backup endpoints', async () => {
    const { app } = await getApp();
    expect((await request(app).get('/api/backup/status')).status).toBe(401);
    expect((await request(app).post('/api/backup/trigger')).status).toBe(401);
  });
});
