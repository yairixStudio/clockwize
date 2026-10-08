import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getApp, createUser } from './helpers.js';

// A signed-in device should stay signed in: long sliding sessions, and the email is not case-sensitive
describe('staying signed in', () => {
  it('logs in whatever the case of the email', async () => {
    const { app } = await getApp();
    const user = await createUser({ email: `Mixed.Case-${Date.now()}@Example.com` });
    for (const email of [user.user.email, user.user.email.toLowerCase(), user.user.email.toUpperCase(), ` ${user.user.email} `]) {
      const res = await request(app).post('/api/auth/login').send({ email, password: user.password });
      expect(res.status, email).toBe(200);
      expect(res.body.user.id).toBe(user.user.id);
    }
  });

  it('refuses to register the same email in another case', async () => {
    const { app } = await getApp();
    const user = await createUser({ email: `dup-${Date.now()}@example.com` });
    const res = await request(app).post('/api/auth/register')
      .send({ email: user.user.email.toUpperCase(), password: 'Secret123!', name: 'Copy' });
    expect(res.status).toBe(400);
  });

  it('issues year-long session tokens', async () => {
    const user = await createUser();
    const { exp, iat } = jwt.decode(user.token);
    expect(exp - iat).toBe(365 * 24 * 60 * 60);
  });

  it('swaps a day-old token for a fresh one on /me, and the old one keeps working until then', async () => {
    const { app } = await getApp();
    const user = await createUser();

    const fresh = await user.get('/api/auth/me');
    expect(fresh.status).toBe(200);
    expect(fresh.body.token).toBeUndefined();

    // A token issued two days ago (same user, same secret)
    const old = jwt.sign({ userId: user.user.id, iatMs: Date.now() - 2 * 24 * 3600 * 1000 }, process.env.JWT_SECRET, { expiresIn: '365d' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${old}`);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    const { exp, iatMs } = jwt.decode(res.body.token);
    expect(Date.now() - iatMs).toBeLessThan(60 * 1000);
    expect(exp * 1000).toBeGreaterThan(Date.now() + 300 * 24 * 3600 * 1000);

    const again = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(again.status).toBe(200);
  });
});
