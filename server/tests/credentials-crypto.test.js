import { describe, it, expect, beforeAll } from 'vitest';
import nodeCrypto from 'crypto';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { ENCRYPTED_SHAPE, legacyEncrypt, LEGACY_SECRET } from './helpers-money.js';

let cryptoUtil;
beforeAll(async () => {
  await getApp();
  cryptoUtil = await import('../utils/crypto.js');
});

const rawCredential = (db, id) => db.prepare('SELECT * FROM credentials WHERE id = ?').get(id);

describe('utils/crypto', () => {
  it('round-trips text, including Hebrew and emoji', () => {
    const { encrypt, decrypt } = cryptoUtil;
    for (const text of ['hunter2', 'סיסמה סודית 123', 'p@ss 🔐 word', 'x'.repeat(5000)]) {
      const enc = encrypt(text, 'salt-1');
      expect(enc).toMatch(ENCRYPTED_SHAPE);
      expect(enc).not.toContain(Buffer.from(text).toString('hex'));
      expect(decrypt(enc, 'salt-1')).toBe(text);
    }
  });

  it('uses a random IV - the same plaintext encrypts differently each time', () => {
    const { encrypt, decrypt } = cryptoUtil;
    const a = encrypt('same', 'salt');
    const b = encrypt('same', 'salt');
    expect(a).not.toBe(b);
    expect(decrypt(a, 'salt')).toBe('same');
    expect(decrypt(b, 'salt')).toBe('same');
  });

  it('returns null for empty input', () => {
    const { encrypt, decrypt, decryptDetailed } = cryptoUtil;
    expect(encrypt('', 'salt')).toBeNull();
    expect(encrypt(null, 'salt')).toBeNull();
    expect(decrypt('', 'salt')).toBeNull();
    expect(decrypt(null, 'salt')).toBeNull();
    expect(decryptDetailed(undefined, 'salt')).toBeNull();
  });

  it('will not decrypt with a different salt (per-workspace keys)', () => {
    const { encrypt, decrypt } = cryptoUtil;
    const enc = encrypt('secret', 'workspace-a');
    expect(decrypt(enc, 'workspace-b')).toBeNull();
  });

  it('detects tampering with the ciphertext, tag or IV', () => {
    const { encrypt, decrypt } = cryptoUtil;
    const enc = encrypt('do not touch', 'salt');
    const [iv, data, tag] = enc.split(':');
    const flip = (hex) => (hex[0] === 'a' ? 'b' : 'a') + hex.slice(1);
    expect(decrypt(`${iv}:${flip(data)}:${tag}`, 'salt')).toBeNull();
    expect(decrypt(`${iv}:${data}:${flip(tag)}`, 'salt')).toBeNull();
    expect(decrypt(`${flip(iv)}:${data}:${tag}`, 'salt')).toBeNull();
    expect(decrypt(`${iv}:${data}:${tag.slice(0, 8)}`, 'salt')).toBeNull();
  });

  it('rejects malformed input instead of throwing', () => {
    const { decrypt } = cryptoUtil;
    expect(decrypt('plain text value', 'salt')).toBeNull();
    expect(decrypt('aa:bb', 'salt')).toBeNull();
    expect(decrypt('aa:bb:cc:dd', 'salt')).toBeNull();
    expect(decrypt('zz:zz:zz', 'salt')).toBeNull();
  });

  it('reads values encrypted with the legacy hard-coded secret and flags them', () => {
    const { decryptDetailed, decrypt } = cryptoUtil;
    const legacy = legacyEncrypt('old secret', 'user-1');
    expect(decryptDetailed(legacy, 'user-1')).toEqual({ value: 'old secret', legacy: true });
    expect(decrypt(legacy, 'user-1')).toBe('old secret');

    const current = cryptoUtil.encrypt('new secret', 'user-1');
    expect(decryptDetailed(current, 'user-1')).toEqual({ value: 'new secret', legacy: false });
  });

  it('never encrypts with the legacy secret', () => {
    const enc = cryptoUtil.encrypt('fresh', 'salt-x');
    const [ivHex, data, tagHex] = enc.split(':');
    const legacyKey = nodeCrypto.pbkdf2Sync(LEGACY_SECRET, 'salt-x', 100000, 32, 'sha256');
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', legacyKey, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    expect(() => { decipher.update(data, 'hex', 'utf8'); decipher.final('utf8'); }).toThrow();
    expect(cryptoUtil.decryptDetailed(enc, 'salt-x').legacy).toBe(false);
  });

  describe('migrateLegacyEncryption', () => {
    it('re-encrypts legacy credentials (legacy secret and user-id salt) with the current secret + workspace salt', async () => {
      const { db } = await getApp();
      const user = await createUser();
      const id = uuidv4();
      db.prepare(`
        INSERT INTO credentials (id, user_id, workspace_id, service_name, username, password, notes)
        VALUES (?, ?, ?, 'Legacy', ?, ?, ?)
      `).run(
        id, user.user.id, user.workspaceId,
        legacyEncrypt('legacy-user', user.user.id),          // legacy secret, user salt
        cryptoUtil.encrypt('pre-workspace-pass', user.user.id), // current secret, old user salt
        legacyEncrypt('legacy-notes', user.workspaceId)      // legacy secret, workspace salt
      );

      const migrated = cryptoUtil.migrateLegacyEncryption(db);
      expect(migrated).toBeGreaterThanOrEqual(1);

      const row = rawCredential(db, id);
      for (const [field, plain] of [['username', 'legacy-user'], ['password', 'pre-workspace-pass'], ['notes', 'legacy-notes']]) {
        expect(row[field]).toMatch(ENCRYPTED_SHAPE);
        expect(cryptoUtil.decryptDetailed(row[field], user.workspaceId)).toEqual({ value: plain, legacy: false });
      }

      // And the API now serves the decrypted values
      const list = await user.get('/api/credentials');
      const cred = list.body.find(c => c.id === id);
      expect(cred).toMatchObject({ username: 'legacy-user', password: 'pre-workspace-pass', notes: 'legacy-notes' });

      // Idempotent: a second run has nothing left to do for this row
      const before = rawCredential(db, id);
      cryptoUtil.migrateLegacyEncryption(db);
      expect(rawCredential(db, id)).toEqual(before);
    });

    it('re-encrypts legacy addon settings with the workspace salt', async () => {
      const { db } = await getApp();
      const user = await createUser();
      const id = uuidv4();
      db.prepare(`
        INSERT INTO addon_settings (id, workspace_id, addon_id, setting_key, setting_value)
        VALUES (?, ?, 'ai_assistant', 'openai_api_key', ?)
      `).run(id, user.workspaceId, legacyEncrypt('sk-legacy-key-123456', user.user.id));

      cryptoUtil.migrateLegacyEncryption(db);
      const row = db.prepare('SELECT setting_value FROM addon_settings WHERE id = ?').get(id);
      expect(cryptoUtil.decryptDetailed(row.setting_value, user.workspaceId)).toEqual({ value: 'sk-legacy-key-123456', legacy: false });
    });

    it('leaves values it cannot decrypt untouched', async () => {
      const { db } = await getApp();
      const user = await createUser();
      const id = uuidv4();
      const foreign = legacyEncrypt('unknown', 'salt', 'some-other-secret-that-is-long-enough-123');
      db.prepare(`
        INSERT INTO credentials (id, user_id, workspace_id, service_name, password)
        VALUES (?, ?, ?, 'Foreign', ?)
      `).run(id, user.user.id, user.workspaceId, foreign);
      cryptoUtil.migrateLegacyEncryption(db);
      expect(rawCredential(db, id).password).toBe(foreign);
    });
  });
});

describe('credentials API', () => {
  it('requires a login', async () => {
    const { app } = await getApp();
    expect((await request(app).get('/api/credentials')).status).toBe(401);
    expect((await request(app).post('/api/credentials').send({ service_name: 'x' })).status).toBe(401);
    expect((await request(app).get('/api/credentials/account')).status).toBe(401);
  });

  it('rejects a workspace the user does not belong to', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const res = await alice.get('/api/credentials', bob.workspaceId);
    expect(res.status).toBe(403);
  });

  it('requires a service name', async () => {
    const user = await createUser();
    const res = await user.post('/api/credentials').send({ username: 'u', password: 'p' });
    expect(res.status).toBe(400);
  });

  it('stores username, password and notes encrypted at rest and returns them decrypted', async () => {
    const user = await createUser();
    const res = await user.post('/api/credentials').send({
      service_name: 'Hosting',
      username: 'admin@site.co.il',
      password: 'Sup3r-S3cret-סיסמה',
      url: 'https://cpanel.example.com',
      notes: 'PIN is 4242'
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      service_name: 'Hosting',
      username: 'admin@site.co.il',
      password: 'Sup3r-S3cret-סיסמה',
      notes: 'PIN is 4242',
      url: 'https://cpanel.example.com'
    });

    const row = rawCredential(user.db, res.body.id);
    expect(row.workspace_id).toBe(user.workspaceId);
    for (const [field, plain] of [['username', 'admin@site.co.il'], ['password', 'Sup3r-S3cret-סיסמה'], ['notes', 'PIN is 4242']]) {
      expect(row[field]).toMatch(ENCRYPTED_SHAPE);
      expect(row[field]).not.toContain(plain);
      expect(cryptoUtil.decrypt(row[field], user.workspaceId)).toBe(plain);
    }
    // The whole raw row must not contain any secret in plain text
    const dump = JSON.stringify(row);
    expect(dump).not.toContain('Sup3r');
    expect(dump).not.toContain('4242');
  });

  it('keeps empty secrets as NULL', async () => {
    const user = await createUser();
    const res = await user.post('/api/credentials').send({ service_name: 'Only name' });
    expect(res.status).toBe(201);
    const row = rawCredential(user.db, res.body.id);
    expect(row.username).toBeNull();
    expect(row.password).toBeNull();
    expect(row.notes).toBeNull();
    expect(res.body.password).toBeNull();
  });

  it('lists by client, project and account scope', async () => {
    const user = await createUser();
    const { client, project } = await createClientProjectTask(user);
    const c = await user.post('/api/credentials').send({ service_name: 'Client cred', client_id: client.id, password: 'c' });
    const p = await user.post('/api/credentials').send({ service_name: 'Project cred', project_id: project.id, password: 'p' });
    const acc = await user.post('/api/credentials').send({ service_name: 'Account cred', password: 'a' });

    const byClient = await user.get(`/api/credentials/client/${client.id}`);
    expect(byClient.status).toBe(200);
    expect(byClient.body.map(x => x.id)).toEqual([c.body.id]);
    expect(byClient.body[0].password).toBe('c');

    const byProject = await user.get(`/api/credentials/project/${project.id}`);
    expect(byProject.body.map(x => x.id)).toEqual([p.body.id]);
    expect(byProject.body[0].password).toBe('p');

    const account = await user.get('/api/credentials/account');
    expect(account.body.map(x => x.id)).toEqual([acc.body.id]);

    const all = await user.get('/api/credentials');
    expect(all.body).toHaveLength(3);
    const withClient = all.body.find(x => x.id === c.body.id);
    expect(withClient.client_name).toBe(client.name);
  });

  it('updates and re-encrypts secrets', async () => {
    const user = await createUser();
    const created = await user.post('/api/credentials').send({ service_name: 'S', username: 'u1', password: 'p1', notes: 'n1', url: 'https://a' });
    const before = rawCredential(user.db, created.body.id);

    const res = await user.put(`/api/credentials/${created.body.id}`).send({ service_name: 'S2', username: 'u2', password: 'p2', notes: 'n2' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ service_name: 'S2', username: 'u2', password: 'p2', notes: 'n2', url: 'https://a' });

    const after = rawCredential(user.db, created.body.id);
    expect(after.password).toMatch(ENCRYPTED_SHAPE);
    expect(after.password).not.toBe(before.password);
    expect(after.password).not.toContain('p2');
  });

  it('keeps stored secrets when a partial update omits them', async () => {
    const user = await createUser();
    const created = await user.post('/api/credentials').send({ service_name: 'S', username: 'keep-me', password: 'keep-pass', notes: 'keep-notes' });
    const before = rawCredential(user.db, created.body.id);
    const res = await user.put(`/api/credentials/${created.body.id}`).send({ url: 'https://new.example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'keep-me', password: 'keep-pass', notes: 'keep-notes', url: 'https://new.example.com' });
    // The stored ciphertext is kept as-is, not re-encrypted
    expect(rawCredential(user.db, created.body.id).password).toBe(before.password);
  });

  it('an explicit null or empty string clears only that secret', async () => {
    const user = await createUser();
    const created = await user.post('/api/credentials').send({ service_name: 'S', username: 'u', password: 'p', notes: 'n' });
    const noNotes = await user.put(`/api/credentials/${created.body.id}`).send({ notes: null });
    expect(noNotes.body).toMatchObject({ username: 'u', password: 'p', notes: null });
    const noUser = await user.put(`/api/credentials/${created.body.id}`).send({ username: '' });
    expect(noUser.body).toMatchObject({ username: null, password: 'p', notes: null });
    expect(rawCredential(user.db, created.body.id).username).toBeNull();
  });

  it('deletes and then 404s', async () => {
    const user = await createUser();
    const created = await user.post('/api/credentials').send({ service_name: 'Temp', password: 'x' });
    expect((await user.delete(`/api/credentials/${created.body.id}`)).status).toBe(200);
    expect(rawCredential(user.db, created.body.id)).toBeUndefined();
    expect((await user.delete(`/api/credentials/${created.body.id}`)).status).toBe(404);
    expect((await user.put(`/api/credentials/${created.body.id}`).send({ service_name: 'y' })).status).toBe(404);
  });

  describe('cross-workspace isolation', () => {
    it('another workspace cannot list, read, update or delete credentials', async () => {
      const alice = await createUser();
      const bob = await createUser();
      const { client, project } = await createClientProjectTask(alice);
      const cred = await alice.post('/api/credentials').send({ service_name: 'Bank', client_id: client.id, password: 'alice-secret' });

      const bobAll = await bob.get('/api/credentials');
      expect(bobAll.body).toEqual([]);
      expect((await bob.get(`/api/credentials/client/${client.id}`)).status).toBe(404);
      expect((await bob.get(`/api/credentials/project/${project.id}`)).status).toBe(404);
      expect((await bob.get('/api/credentials/account')).body).toEqual([]);

      const upd = await bob.put(`/api/credentials/${cred.body.id}`).send({ password: 'hacked' });
      expect(upd.status).toBe(404);
      expect((await bob.delete(`/api/credentials/${cred.body.id}`)).status).toBe(404);

      const still = await alice.get(`/api/credentials/client/${client.id}`);
      expect(still.body[0].password).toBe('alice-secret');
    });

    it('cannot attach a credential to another workspace\'s client or project', async () => {
      const alice = await createUser();
      const bob = await createUser();
      const { client, project } = await createClientProjectTask(alice);
      expect((await bob.post('/api/credentials').send({ service_name: 'x', client_id: client.id })).status).toBe(404);
      expect((await bob.post('/api/credentials').send({ service_name: 'x', project_id: project.id })).status).toBe(404);
    });

    it('a ciphertext copied into another workspace does not decrypt there (workspace-bound keys)', async () => {
      const alice = await createUser();
      const bob = await createUser();
      const cred = await alice.post('/api/credentials').send({ service_name: 'S', password: 'only-for-alice' });
      const stolen = rawCredential(alice.db, cred.body.id).password;

      const bobCred = await bob.post('/api/credentials').send({ service_name: 'B', password: 'bob' });
      bob.db.prepare('UPDATE credentials SET password = ? WHERE id = ?').run(stolen, bobCred.body.id);

      const list = await bob.get('/api/credentials');
      expect(list.body[0].password).toBeNull();
    });
  });
});
