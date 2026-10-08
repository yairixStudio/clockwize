// Forced password reset across both sign-in paths (password and passkey), the desktop session file,
// and the sign-in rate limits.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

const localSession = vi.hoisted(() => ({ saveLocalSession: vi.fn(), clearLocalSession: vi.fn() }));
vi.mock('../utils/localSession.js', () => localSession);

// The WebAuthn ceremony itself is the library's job; here every assertion is accepted
const webauthn = vi.hoisted(() => ({
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'test-challenge' })),
  verifyAuthenticationResponse: vi.fn(async () => ({ verified: true, authenticationInfo: { newCounter: 1 } })),
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn()
}));
vi.mock('@simplewebauthn/server', () => webauthn);

import { getApp, createUser } from './helpers.js';
import { adminClient } from './helpers-core.js';
import { RATE_LIMIT_MESSAGE } from '../middleware/rateLimit.js';

const post = async (url, body) => {
  const { app } = await getApp();
  return request(app).post(url).send(body);
};
const login = (email, password) => post('/api/auth/login', { email, password });

const flag = async (userId) => {
  const admin = await adminClient();
  expect((await admin.post(`/api/admin/users/${userId}/force-password-reset`)).status).toBe(200);
};

// Gives the user a passkey and signs in with it (the mocked library accepts the assertion)
const addPasskey = async (userId) => {
  const { db } = await getApp();
  const credentialId = `cred-${uuidv4()}`;
  db.prepare(`
    INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
    VALUES (?, ?, ?, ?, 0, '[]', 'singleDevice', 0, 'Test key')
  `).run(uuidv4(), userId, credentialId, Buffer.from('public-key').toString('base64url'));
  return credentialId;
};
const passkeyLogin = async (credentialId) => {
  const options = await post('/api/passkeys/login/options', {});
  expect(options.status).toBe(200);
  return post('/api/passkeys/login/verify', { flowId: options.body.flowId, response: { id: credentialId } });
};

beforeEach(() => {
  localSession.saveLocalSession.mockClear();
});

describe('forced password reset - no session before the reset', () => {
  it('password login: a reset token, nothing saved for the desktop app; the reset saves the new session', async () => {
    const user = await createUser();
    await flag(user.user.id);
    localSession.saveLocalSession.mockClear();

    const res = await login(user.user.email, user.password);
    expect(res.body).toEqual({ requiresPasswordReset: true, resetToken: expect.any(String) });
    expect(localSession.saveLocalSession).not.toHaveBeenCalled();

    const reset = await post('/api/auth/reset-password', { resetToken: res.body.resetToken, newPassword: 'Fresh123!' });
    expect(reset.status).toBe(200);
    expect(localSession.saveLocalSession).toHaveBeenCalledWith(reset.body.token, user.workspaceId);
  });

  it('passkey login of a flagged user gets a reset token too, and the reset works without the old password', async () => {
    const user = await createUser();
    const credentialId = await addPasskey(user.user.id);
    await flag(user.user.id);
    localSession.saveLocalSession.mockClear();

    const res = await passkeyLogin(credentialId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requiresPasswordReset: true, resetToken: expect.any(String) });
    expect(localSession.saveLocalSession).not.toHaveBeenCalled();

    const reset = await post('/api/auth/reset-password', { resetToken: res.body.resetToken, newPassword: 'ViaPasskey1' });
    expect(reset.status).toBe(200);
    expect(reset.body.user).toMatchObject({ id: user.user.id, has_password: 1 });
    expect((await login(user.user.email, 'ViaPasskey1')).body.requiresPasswordReset).toBe(false);

    // Not flagged any more: the passkey signs in normally again
    const again = await passkeyLogin(credentialId);
    expect(again.body).toMatchObject({ requiresPasswordReset: false, token: expect.any(String) });
  });

  it('an unflagged passkey login is a normal session and is handed to the desktop app', async () => {
    const user = await createUser();
    const credentialId = await addPasskey(user.user.id);

    const res = await passkeyLogin(credentialId);
    expect(res.body).toMatchObject({ requiresPasswordReset: false, user: { id: user.user.id, has_password: 1 } });
    expect(localSession.saveLocalSession).toHaveBeenCalledWith(res.body.token, user.workspaceId);
  });
});

describe('password change - the current session stays signed in', () => {
  it('hands the fresh token to the desktop app', async () => {
    const user = await createUser();
    localSession.saveLocalSession.mockClear();

    const res = await user.put('/api/auth/profile').send({ password: 'NewPass1!', currentPassword: user.password });

    expect(res.status).toBe(200);
    expect(localSession.saveLocalSession).toHaveBeenCalledWith(res.body.token, user.workspaceId);
  });

  it('does not touch the desktop session for other profile updates', async () => {
    const user = await createUser();
    localSession.saveLocalSession.mockClear();

    await user.put('/api/auth/profile').send({ name: 'Renamed' });

    expect(localSession.saveLocalSession).not.toHaveBeenCalled();
  });
});

describe('sign-in rate limits', () => {
  afterEach(() => {
    delete process.env.CLOCKWIZE_RATE_LIMIT;
  });

  it('are off in tests unless switched on', async () => {
    const user = await createUser();
    for (let i = 0; i < 12; i += 1) {
      expect((await login(user.user.email, 'wrong')).status).toBe(401);
    }
    expect((await login(user.user.email, user.password)).status).toBe(200);
  });

  it('login: 10 failed attempts per IP + account, then 429 even with the right password', async () => {
    process.env.CLOCKWIZE_RATE_LIMIT = 'on';
    const user = await createUser();
    const other = await createUser();

    for (let i = 0; i < 10; i += 1) {
      expect((await login(user.user.email, 'wrong')).status).toBe(401);
    }
    const blocked = await login(user.user.email.toUpperCase(), user.password);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe(RATE_LIMIT_MESSAGE);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // Another account from the same IP is not affected
    expect((await login(other.user.email, other.password)).status).toBe(200);
  });

  it('login: a successful sign-in clears the failed attempts', async () => {
    process.env.CLOCKWIZE_RATE_LIMIT = 'on';
    const user = await createUser();

    for (let i = 0; i < 9; i += 1) await login(user.user.email, 'wrong');
    expect((await login(user.user.email, user.password)).status).toBe(200);
    for (let i = 0; i < 9; i += 1) {
      expect((await login(user.user.email, 'wrong')).status).toBe(401);
    }
    expect((await login(user.user.email, user.password)).status).toBe(200);
  });

  it('reset-password: 10 failed attempts per IP + account, then 429; other accounts still reset', async () => {
    process.env.CLOCKWIZE_RATE_LIMIT = 'on';
    const user = await createUser();
    const other = await createUser();
    await flag(user.user.id);
    await flag(other.user.id);
    const { resetToken } = (await login(user.user.email, user.password)).body;
    const otherToken = (await login(other.user.email, other.password)).body.resetToken;

    // Rejected attempts for this account (reusing the current password)
    for (let i = 0; i < 10; i += 1) {
      expect((await post('/api/auth/reset-password', { resetToken, newPassword: user.password })).status).toBe(400);
    }
    expect((await post('/api/auth/reset-password', { resetToken, newPassword: 'Fresh123!' })).status).toBe(429);

    // Garbage tokens fill their own bucket ...
    for (let i = 0; i < 11; i += 1) {
      await post('/api/auth/reset-password', { resetToken: 'garbage', newPassword: 'abcd1234' });
    }
    expect((await post('/api/auth/reset-password', { resetToken: 'garbage', newPassword: 'abcd1234' })).status).toBe(429);
    // ... and lock nobody else out
    expect((await post('/api/auth/reset-password', { resetToken: otherToken, newPassword: 'Fresh123!' })).status).toBe(200);
  });

  it('passkey sign-in: failed verifications per IP + credential, and challenges per IP', async () => {
    process.env.CLOCKWIZE_RATE_LIMIT = 'on';
    for (let i = 0; i < 10; i += 1) {
      expect((await post('/api/passkeys/login/verify', { flowId: 'expired', response: { id: 'unknown-cred' } })).status).toBe(400);
    }
    expect((await post('/api/passkeys/login/verify', { flowId: 'expired', response: { id: 'unknown-cred' } })).status).toBe(429);

    // Challenges: 30 per IP (this file already used a few while the limiter was off - those don't count)
    let status = 200;
    let allowed = 0;
    while (status === 200 && allowed < 40) {
      status = (await post('/api/passkeys/login/options', {})).status;
      if (status === 200) allowed += 1;
    }
    expect(allowed).toBe(30);
    expect(status).toBe(429);
  });
});
