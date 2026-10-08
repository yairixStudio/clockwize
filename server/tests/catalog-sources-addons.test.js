import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import initSqlJs from 'sql.js';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { addMember, ENCRYPTED_SHAPE, legacyEncrypt } from './helpers-money.js';
import { adminClient } from './helpers-core.js';

let app;
let cryptoUtil;
beforeAll(async () => {
  ({ app } = await getApp());
  cryptoUtil = await import('../utils/crypto.js');
});

describe('catalog', () => {
  const item = (user, body) => user.post('/api/catalog').send(body);

  it('requires a login', async () => {
    expect((await request(app).get('/api/catalog')).status).toBe(401);
    expect((await request(app).get('/api/catalog/meta/categories')).status).toBe(401);
    expect((await request(app).post('/api/catalog').send({ name: 'x' })).status).toBe(401);
    expect((await request(app).put(`/api/catalog/${uuidv4()}`).send({ name: 'x' })).status).toBe(401);
    expect((await request(app).delete(`/api/catalog/${uuidv4()}`)).status).toBe(401);
  });

  it('requires a name', async () => {
    const user = await createUser();
    expect((await item(user, { price: 100 })).status).toBe(400);
  });

  it('creates items with defaults, lists by category then name, filters', async () => {
    const user = await createUser();
    const logo = (await item(user, { name: 'Logo', price: 1500, category: 'Design', unit: 'project', description: 'd', notes: 'n' })).body;
    expect(logo).toMatchObject({ name: 'Logo', price: 1500, pricing_type: 'fixed', is_active: 1, category: 'Design', workspace_id: user.workspaceId });
    const banner = (await item(user, { name: 'Banner', price: 300, category: 'Design' })).body;
    const hour = (await item(user, { name: 'Dev hour', price: 250, pricing_type: 'hourly', category: 'Dev' })).body;
    const misc = (await item(user, { name: 'Misc' })).body;
    expect(misc.price).toBeNull();

    const all = await user.get('/api/catalog');
    expect(all.body.map(i => i.id)).toEqual([misc.id, banner.id, logo.id, hour.id]);
    expect((await user.get('/api/catalog?category=Design')).body.map(i => i.id)).toEqual([banner.id, logo.id]);

    await user.put(`/api/catalog/${banner.id}`).send({ name: 'Banner', price: 300, category: 'Design', is_active: false });
    expect((await user.get('/api/catalog?active_only=true')).body.map(i => i.id)).not.toContain(banner.id);
    expect((await user.get('/api/catalog?active_only=true')).body).toHaveLength(3);

    expect((await user.get('/api/catalog/meta/categories')).body).toEqual(['Design', 'Dev']);
    expect((await user.get(`/api/catalog/${hour.id}`)).body).toMatchObject({ name: 'Dev hour', pricing_type: 'hourly' });
    expect((await user.get(`/api/catalog/${uuidv4()}`)).status).toBe(404);
  });

  it('PUT replaces the item; without a name it is a 400, not a crash', async () => {
    const user = await createUser();
    const it_ = (await item(user, { name: 'Site', price: 5000, category: 'Web', notes: 'n' })).body;
    const res = await user.put(`/api/catalog/${it_.id}`).send({ name: 'Site v2', price: 6000, pricing_type: 'package' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Site v2', price: 6000, pricing_type: 'package', is_active: 1 });

    const bad = await user.put(`/api/catalog/${it_.id}`).send({ price: 1 });
    expect(bad.status).toBe(400);
    expect((await user.get(`/api/catalog/${it_.id}`)).body.name).toBe('Site v2');
  });

  // `price || null` used to turn a free (price 0) item into "no price"
  it('keeps a price of 0', async () => {
    const user = await createUser();
    const res = await item(user, { name: 'Free consult', price: 0 });
    expect(res.body.price).toBe(0);

    const paid = (await item(user, { name: 'Paid', price: 100 })).body;
    const updated = await user.put(`/api/catalog/${paid.id}`).send({ name: 'Paid', price: 0 });
    expect(updated.body.price).toBe(0);

    // An empty or missing price is still "no price"
    expect((await item(user, { name: 'Empty', price: '' })).body.price).toBeNull();
    expect((await user.put(`/api/catalog/${paid.id}`).send({ name: 'Paid' })).body.price).toBeNull();
  });

  it('deletes and then 404s', async () => {
    const user = await createUser();
    const it_ = (await item(user, { name: 'Temp' })).body;
    expect((await user.delete(`/api/catalog/${it_.id}`)).status).toBe(200);
    expect((await user.delete(`/api/catalog/${it_.id}`)).status).toBe(404);
    expect((await user.put(`/api/catalog/${it_.id}`).send({ name: 'x' })).status).toBe(404);
  });

  it('cross-workspace: cannot list, read, edit or delete another workspace\'s items', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const it_ = (await item(alice, { name: 'Alice item', price: 10, category: 'Secret' })).body;
    expect((await bob.get('/api/catalog')).body).toEqual([]);
    expect((await bob.get('/api/catalog/meta/categories')).body).toEqual([]);
    expect((await bob.get(`/api/catalog/${it_.id}`)).status).toBe(404);
    expect((await bob.put(`/api/catalog/${it_.id}`).send({ name: 'pwned' })).status).toBe(404);
    expect((await bob.delete(`/api/catalog/${it_.id}`)).status).toBe(404);
    expect((await alice.get(`/api/catalog/${it_.id}`)).body.name).toBe('Alice item');
  });
});

describe('client sources', () => {
  const source = (user, body) => user.post('/api/client-sources').send(body);
  const uniq = (s) => `${s} ${uuidv4().slice(0, 8)}`;

  it('requires a login', async () => {
    expect((await request(app).get('/api/client-sources')).status).toBe(401);
    expect((await request(app).get('/api/client-sources/stats')).status).toBe(401);
    expect((await request(app).post('/api/client-sources').send({ name: 'x' })).status).toBe(401);
  });

  it('requires a name and rejects duplicates within the workspace only', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const name = uniq('Instagram');
    expect((await source(alice, {})).status).toBe(400);
    const created = await source(alice, { name });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name, workspace_id: alice.workspaceId });
    expect((await source(alice, { name })).status).toBe(400);
    expect((await source(bob, { name })).status).toBe(201);
  });

  it('lists the workspace\'s own sources plus global ones, never another workspace\'s', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const admin = await adminClient();
    const own = (await source(alice, { name: uniq('Own') })).body;
    const bobs = (await source(bob, { name: uniq('Bobs') })).body;
    const global = (await source(admin, { name: uniq('Global'), is_global: true })).body;
    expect(global.workspace_id).toBeNull();

    const ids = (await alice.get('/api/client-sources')).body.map(s => s.id);
    expect(ids).toContain(own.id);
    expect(ids).toContain(global.id);
    expect(ids).not.toContain(bobs.id);
  });

  it('stats count only this workspace\'s clients per source', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const ref = (await source(alice, { name: uniq('Referral') })).body;
    const global = (await source(await adminClient(), { name: uniq('Shared Global'), is_global: true })).body;
    const c1 = (await alice.post('/api/clients').send({ name: 'C1', source_id: ref.id, sub_source: 'Moshe' })).body;
    await alice.post('/api/clients').send({ name: 'C2', source_id: ref.id });
    await alice.post('/api/clients').send({ name: 'C3', source_id: global.id });
    await alice.post('/api/clients').send({ name: 'C4' });
    // Bob's client on the same global source must not show up in Alice's stats
    await bob.post('/api/clients').send({ name: 'Bob client', source_id: global.id });

    const res = await alice.get('/api/client-sources/stats');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.sources.map(s => [s.id, s]));
    expect(byId[ref.id].client_count).toBe(2);
    expect(byId[global.id].client_count).toBe(1);
    expect(res.body.noSourceCount).toBe(1);
    expect(res.body.clients.map(c => c.name).sort()).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(res.body.clients.find(c => c.id === c1.id)).toMatchObject({ source_name: ref.name, sub_source: 'Moshe' });
    expect(JSON.stringify(res.body)).not.toContain('Bob client');
  });

  it('a system admin assigns a global source to their current workspace once', async () => {
    const admin = await adminClient();
    const bob = await createUser();
    const global = (await source(admin, { name: uniq('Claimable'), is_global: true })).body;
    const bobs = (await source(bob, { name: uniq('Bob private') })).body;

    expect((await admin.post(`/api/client-sources/${uuidv4()}/assign-to-workspace`)).status).toBe(404);
    const res = await admin.post(`/api/client-sources/${global.id}/assign-to-workspace`);
    expect(res.status).toBe(200);
    expect(res.body.workspace_id).toBe(admin.workspaceId);
    expect((await admin.post(`/api/client-sources/${global.id}/assign-to-workspace`)).status).toBe(400);

    // Another workspace's own source cannot be taken over
    expect((await admin.post(`/api/client-sources/${bobs.id}/assign-to-workspace`)).status).toBe(400);
    expect(admin.db.prepare('SELECT workspace_id FROM client_sources WHERE id = ?').get(bobs.id).workspace_id).toBe(bob.workspaceId);
  });

  // A global source shows up in every workspace, so a regular user must not be able to create one
  // (planting a name in everyone's list) or claim one for their own workspace (taking it from everyone)
  it('only a system admin creates global sources; a workspace owner or admin role is not enough', async () => {
    const owner = await createUser();
    const wsAdmin = await createUser();
    addMember(owner, wsAdmin, 'admin');
    const name = uniq('Everywhere');

    for (const [user, ws] of [[owner, owner.workspaceId], [wsAdmin, owner.workspaceId]]) {
      const res = await user.post('/api/client-sources', ws).send({ name, is_global: true });
      expect(res.status).toBe(403);
      expect(res.body.error).toBeTruthy();
    }
    expect(owner.db.prepare('SELECT COUNT(*) AS n FROM client_sources WHERE name = ?').get(name).n).toBe(0);

    // Without the flag the source is created in the user's own workspace
    const own = await source(owner, { name });
    expect(own.status).toBe(201);
    expect(own.body.workspace_id).toBe(owner.workspaceId);
  });

  it('a regular user cannot claim a global source for their workspace', async () => {
    const admin = await adminClient();
    const user = await createUser();
    const global = (await source(admin, { name: uniq('Not yours'), is_global: true })).body;

    const res = await user.post(`/api/client-sources/${global.id}/assign-to-workspace`);
    expect(res.status).toBe(403);
    expect(user.db.prepare('SELECT workspace_id FROM client_sources WHERE id = ?').get(global.id).workspace_id).toBeNull();
    expect((await user.get('/api/client-sources')).body.map(s => s.id)).toContain(global.id);
  });
});

describe('addons', () => {
  it('requires a login', async () => {
    expect((await request(app).get('/api/addons')).status).toBe(401);
    expect((await request(app).get('/api/addons/enabled')).status).toBe(401);
    expect((await request(app).put('/api/addons/catalog').send({ isEnabled: true })).status).toBe(401);
    expect((await request(app).get('/api/addons/ai_assistant/settings')).status).toBe(401);
    expect((await request(app).put('/api/addons/ai_assistant/settings').send({})).status).toBe(401);
  });

  it('lists addons with their default state', async () => {
    const user = await createUser();
    const res = await user.get('/api/addons');
    const state = Object.fromEntries(res.body.map(a => [a.id, a.isEnabled]));
    expect(state).toMatchObject({ credentials: true, files: true, notes: true, catalog: false, leads_management: false, ai_assistant: false });
    expect((await user.get('/api/addons/enabled')).body).toEqual(['credentials', 'files', 'notes', 'reminders', 'schedule']);
  });

  it('toggles a single addon and persists per workspace', async () => {
    const user = await createUser();
    expect((await user.put('/api/addons/not-an-addon').send({ isEnabled: true })).status).toBe(404);
    expect((await user.put('/api/addons/catalog').send({ isEnabled: true })).body).toEqual({ success: true, addonId: 'catalog', isEnabled: true });
    await user.put('/api/addons/files').send({ isEnabled: false });
    await user.put('/api/addons/files').send({ isEnabled: false });
    const enabled = (await user.get('/api/addons/enabled')).body;
    expect(enabled).toContain('catalog');
    expect(enabled).not.toContain('files');
    expect(user.db.prepare("SELECT COUNT(*) as n FROM user_addons WHERE workspace_id = ? AND addon_id = 'files'").get(user.workspaceId).n).toBe(1);
  });

  it('bulk-updates addons, skipping unknown ids', async () => {
    const user = await createUser();
    const res = await user.put('/api/addons').send({ addons: [{ id: 'catalog', isEnabled: true }, { id: 'ghost', isEnabled: true }, { id: 'notes', isEnabled: false }] });
    expect(res.status).toBe(200);
    const enabled = (await user.get('/api/addons/enabled')).body;
    expect(enabled).toContain('catalog');
    expect(enabled).not.toContain('notes');
    expect(user.db.prepare("SELECT COUNT(*) as n FROM user_addons WHERE addon_id = 'ghost'").get().n).toBe(0);
  });

  it('bulk update without an addons array is a 400, not a crash', async () => {
    const user = await createUser();
    expect((await user.put('/api/addons').send({})).status).toBe(400);
    expect((await user.put('/api/addons').send({ addons: 'catalog' })).status).toBe(400);
  });

  it('addon toggles are isolated between workspaces', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await alice.put('/api/addons/catalog').send({ isEnabled: true });
    expect((await bob.get('/api/addons/enabled')).body).not.toContain('catalog');
  });

  // user_addons used to be UNIQUE(user_id, addon_id), so a member of two workspaces got a 500 the
  // first time they toggled an addon in their second workspace
  it('a member of two workspaces can toggle the same addon in both', async () => {
    const owner = await createUser();
    const member = await createUser();
    addMember(owner, member, 'admin');
    expect((await member.put('/api/addons/catalog').send({ isEnabled: true })).status).toBe(200);
    expect((await member.put('/api/addons/catalog', owner.workspaceId).send({ isEnabled: true })).status).toBe(200);
    expect((await member.put('/api/addons', owner.workspaceId).send({ addons: [{ id: 'notes', isEnabled: false }] })).status).toBe(200);
    expect((await member.put('/api/addons').send({ addons: [{ id: 'notes', isEnabled: false }] })).status).toBe(200);

    // Each workspace keeps its own state
    await member.put('/api/addons/catalog', owner.workspaceId).send({ isEnabled: false });
    expect((await member.get('/api/addons/enabled')).body).toContain('catalog');
    expect((await owner.get('/api/addons/enabled')).body).not.toContain('catalog');
    const rows = member.db.prepare("SELECT workspace_id FROM user_addons WHERE addon_id = 'catalog' AND workspace_id IN (?, ?)").all(owner.workspaceId, member.workspaceId);
    expect(rows).toHaveLength(2);
  });

  // Turning an addon on or off changes the workspace for everyone, so it is an owner/admin decision
  it('a plain member cannot toggle addons; the owner and a workspace admin can', async () => {
    const owner = await createUser();
    const admin = await createUser();
    const member = await createUser();
    addMember(owner, admin, 'admin');
    addMember(owner, member, 'member');
    const ws = owner.workspaceId;

    expect((await member.put('/api/addons/files', ws).send({ isEnabled: false })).status).toBe(403);
    expect((await member.put('/api/addons', ws).send({ addons: [{ id: 'files', isEnabled: false }] })).status).toBe(403);
    expect(owner.db.prepare('SELECT COUNT(*) AS n FROM user_addons WHERE workspace_id = ?').get(ws).n).toBe(0);
    expect((await member.get('/api/addons/enabled', ws)).body).toContain('files');

    expect((await admin.put('/api/addons/catalog', ws).send({ isEnabled: true })).status).toBe(200);
    expect((await owner.put('/api/addons/files').send({ isEnabled: false })).status).toBe(200);
    const enabled = (await member.get('/api/addons/enabled', ws)).body;
    expect(enabled).toContain('catalog');
    expect(enabled).not.toContain('files');

    // A member still manages their own personal workspace
    expect((await member.put('/api/addons/catalog').send({ isEnabled: true })).status).toBe(200);
  });

  describe('user_addons unique key migration', () => {
    const OLD_SCHEMA = `CREATE TABLE user_addons (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      addon_id TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, workspace_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, addon_id)
    )`;

    // A throwaway database with the pre-migration user_addons table
    async function oldDatabase() {
      const { Database } = await import('../database.js');
      const SQL = await initSqlJs();
      const db = new Database(new SQL.Database());
      db.pragma('foreign_keys = ON');
      db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
      db.exec(OLD_SCHEMA);
      for (const id of ['u1', 'u2']) db.prepare('INSERT INTO users (id) VALUES (?)').run(id);
      return db;
    }
    const uniqueKeys = (db) => db.prepare(`SELECT name FROM pragma_index_list('user_addons') WHERE "unique" = 1 AND origin = 'u'`).all()
      .map(i => db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(i.name).map(c => c.name));
    const allRows = (db) => db.prepare('SELECT id, user_id, workspace_id, addon_id, is_enabled, created_at, updated_at FROM user_addons ORDER BY id').all();

    it('rebuilds the table keyed by workspace, keeps every row, and runs only once', async () => {
      const { migrateUserAddonsUniqueKey } = await import('../database.js');
      const db = await oldDatabase();
      const insert = db.prepare(`INSERT INTO user_addons (id, user_id, workspace_id, addon_id, is_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      insert.run('a', 'u1', 'w1', 'catalog', 1, '2025-01-01 10:00:00', '2025-01-02 10:00:00');
      insert.run('b', 'u1', 'w1', 'files', 0, '2025-01-01 10:00:00', '2025-01-01 10:00:00');
      insert.run('c', 'u2', 'w2', 'catalog', 0, '2025-02-01 10:00:00', '2025-02-01 10:00:00');
      insert.run('d', 'u2', null, 'notes', 1, '2025-02-01 10:00:00', '2025-02-01 10:00:00');
      const before = allRows(db);

      expect(migrateUserAddonsUniqueKey(db)).toBe(true);
      expect(uniqueKeys(db)).toEqual([['workspace_id', 'addon_id']]);
      expect(allRows(db)).toEqual(before);
      expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'user_addons_new'").get().n).toBe(0);

      // Idempotent: a second start changes nothing
      expect(migrateUserAddonsUniqueKey(db)).toBe(false);
      expect(allRows(db)).toEqual(before);

      // The bug is gone: the same user can now have the addon in a second workspace...
      insert.run('e', 'u1', 'w2b', 'catalog', 1, '2025-03-01 10:00:00', '2025-03-01 10:00:00');
      // ...and the foreign key to users still holds
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(() => insert.run('f', 'ghost', 'w3', 'catalog', 1, null, null)).toThrow();
      } finally {
        errors.mockRestore();
      }
      db.prepare('DELETE FROM users WHERE id = ?').run('u2');
      expect(allRows(db).map(r => r.id)).toEqual(['a', 'b', 'e']);
    });

    it('leaves the old table untouched when the rows do not fit the new key', async () => {
      const { migrateUserAddonsUniqueKey } = await import('../database.js');
      const db = await oldDatabase();
      // Two users toggled the same addon in one workspace - allowed by the old key, not by the new one
      db.prepare(`INSERT INTO user_addons (id, user_id, workspace_id, addon_id) VALUES ('a', 'u1', 'w1', 'catalog')`).run();
      db.prepare(`INSERT INTO user_addons (id, user_id, workspace_id, addon_id) VALUES ('b', 'u2', 'w1', 'catalog')`).run();
      const before = allRows(db);

      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(migrateUserAddonsUniqueKey(db)).toBe(false);
      } finally {
        errors.mockRestore();
      }
      expect(uniqueKeys(db)).toEqual([['user_id', 'addon_id']]);
      expect(allRows(db)).toEqual(before);
      expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'user_addons_new'").get().n).toBe(0);
    });
  });

  describe('settings', () => {
    it('only addons with settings have them', async () => {
      const user = await createUser();
      expect((await user.get('/api/addons/ghost/settings')).status).toBe(404);
      expect((await user.get('/api/addons/catalog/settings')).status).toBe(400);
      expect((await user.put('/api/addons/catalog/settings').send({ x: 1 })).status).toBe(400);
      expect((await user.get('/api/addons/ai_assistant/settings')).body).toEqual({});
    });

    it('encrypts every sensitive setting at rest and masks it on read', async () => {
      const user = await createUser();
      const secrets = {
        openai_api_key: 'sk-proj-ABCDEFGH12345678',
        some_api_secret: 'secret-value-999',
        access_token: 'tok_live_000111222',
        admin_password: 'P@ssw0rd!!'
      };
      const res = await user.put('/api/addons/ai_assistant/settings').send({ ...secrets, model: 'gpt-4o' });
      expect(res.status).toBe(200);

      const rows = Object.fromEntries(
        user.db.prepare('SELECT setting_key, setting_value FROM addon_settings WHERE workspace_id = ?').all(user.workspaceId)
          .map(r => [r.setting_key, r.setting_value])
      );
      for (const [key, plain] of Object.entries(secrets)) {
        expect(rows[key]).toMatch(ENCRYPTED_SHAPE);
        expect(rows[key]).not.toContain(plain);
        expect(cryptoUtil.decrypt(rows[key], user.workspaceId)).toBe(plain);
      }
      expect(rows.model).toBe('gpt-4o');

      const read = await user.get('/api/addons/ai_assistant/settings');
      expect(read.body).toMatchObject({
        openai_api_key: 'sk-p****5678',
        openai_api_key_configured: true,
        access_token: 'tok_****1222',
        // short secrets are fully hidden - first+last 4 would give away most of a password
        admin_password: '****',
        admin_password_configured: true,
        some_api_secret: 'secr****-999',
        model: 'gpt-4o'
      });
      expect(JSON.stringify(read.body)).not.toContain('ABCDEFGH');
      expect(JSON.stringify(read.body)).not.toContain('P@ss');
    });

    it('a short secret is fully masked', async () => {
      const user = await createUser();
      await user.put('/api/addons/ai_assistant/settings').send({ api_key: 'abc' });
      const read = (await user.get('/api/addons/ai_assistant/settings')).body;
      expect(read).toMatchObject({ api_key: '****', api_key_configured: true });
    });

    it('sending the masked value back keeps the stored secret; a new value replaces it', async () => {
      const user = await createUser();
      await user.put('/api/addons/ai_assistant/settings').send({ openai_api_key: 'sk-original-123456789' });
      const masked = (await user.get('/api/addons/ai_assistant/settings')).body;

      await user.put('/api/addons/ai_assistant/settings').send({ ...masked, model: 'x' });
      const { getAddonSetting } = await import('../routes/addons.js');
      expect(await getAddonSetting(user.db, user.workspaceId, user.user.id, 'ai_assistant', 'openai_api_key')).toBe('sk-original-123456789');
      expect(user.db.prepare("SELECT COUNT(*) as n FROM addon_settings WHERE setting_key LIKE '%_configured'").get().n).toBe(0);

      await user.put('/api/addons/ai_assistant/settings').send({ openai_api_key: 'sk-rotated-987654321' });
      expect(await getAddonSetting(user.db, user.workspaceId, user.user.id, 'ai_assistant', 'openai_api_key')).toBe('sk-rotated-987654321');
      expect(await getAddonSetting(user.db, user.workspaceId, user.user.id, 'ai_assistant', 'model')).toBe('x');
      expect(await getAddonSetting(user.db, user.workspaceId, user.user.id, 'ai_assistant', 'missing')).toBeNull();
    });

    it('re-encrypts a legacy (user-salted, old secret) value with the workspace key on first read', async () => {
      const user = await createUser();
      user.db.prepare(`
        INSERT INTO addon_settings (id, workspace_id, addon_id, setting_key, setting_value)
        VALUES (?, ?, 'ai_assistant', 'openai_api_key', ?)
      `).run(uuidv4(), user.workspaceId, legacyEncrypt('sk-legacy-abcdefgh', user.user.id));

      const read = (await user.get('/api/addons/ai_assistant/settings')).body;
      expect(read.openai_api_key).toBe('sk-l****efgh');
      const row = user.db.prepare("SELECT setting_value FROM addon_settings WHERE workspace_id = ? AND setting_key = 'openai_api_key'").get(user.workspaceId);
      expect(cryptoUtil.decryptDetailed(row.setting_value, user.workspaceId)).toEqual({ value: 'sk-legacy-abcdefgh', legacy: false });
    });

    it('only the owner or a workspace admin changes settings; a member only sees whether a key is configured', async () => {
      const owner = await createUser();
      const admin = await createUser();
      const member = await createUser();
      addMember(owner, admin, 'admin');
      addMember(owner, member, 'member');
      const ws = owner.workspaceId;
      const { getAddonSetting } = await import('../routes/addons.js');
      await owner.put('/api/addons/ai_assistant/settings').send({ openai_api_key: 'sk-owner-key-1234567890', model: 'gpt-4o' });

      const denied = await member.put('/api/addons/ai_assistant/settings', ws).send({ openai_api_key: 'sk-member-override-0000' });
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBeTruthy();
      expect(await getAddonSetting(owner.db, ws, owner.user.id, 'ai_assistant', 'openai_api_key')).toBe('sk-owner-key-1234567890');

      const seen = await member.get('/api/addons/ai_assistant/settings', ws);
      expect(seen.status).toBe(200);
      expect(seen.body).toEqual({ openai_api_key_configured: true, model: 'gpt-4o' });
      expect(JSON.stringify(seen.body)).not.toContain('sk-o');

      expect((await owner.get('/api/addons/ai_assistant/settings')).body.openai_api_key).toBe('sk-o****7890');
      expect((await admin.get('/api/addons/ai_assistant/settings', ws)).body.openai_api_key).toBe('sk-o****7890');
      expect((await admin.put('/api/addons/ai_assistant/settings', ws).send({ openai_api_key: 'sk-admin-rotated-12345' })).status).toBe(200);
      expect(await getAddonSetting(owner.db, ws, owner.user.id, 'ai_assistant', 'openai_api_key')).toBe('sk-admin-rotated-12345');
    });

    it('settings are isolated between workspaces, and a stolen ciphertext does not decrypt elsewhere', async () => {
      const alice = await createUser();
      const bob = await createUser();
      await alice.put('/api/addons/ai_assistant/settings').send({ openai_api_key: 'sk-alice-only-123456' });
      expect((await bob.get('/api/addons/ai_assistant/settings')).body).toEqual({});

      const stolen = alice.db.prepare("SELECT setting_value FROM addon_settings WHERE workspace_id = ? AND setting_key = 'openai_api_key'").get(alice.workspaceId).setting_value;
      bob.db.prepare(`
        INSERT INTO addon_settings (id, workspace_id, addon_id, setting_key, setting_value)
        VALUES (?, ?, 'ai_assistant', 'openai_api_key', ?)
      `).run(uuidv4(), bob.workspaceId, stolen);
      const read = (await bob.get('/api/addons/ai_assistant/settings')).body;
      expect(read.openai_api_key_configured).toBe(false);
      expect(JSON.stringify(read)).not.toContain('alice');
    });
  });
});

describe('integrations unique key migration', () => {
  const OLD_SCHEMA = `CREATE TABLE integrations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      api_key TEXT,
      api_secret TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expires_at DATETIME,
      settings TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, workspace_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, provider)
    )`;
  const COLUMNS = 'id, user_id, workspace_id, provider, api_key, api_secret, access_token, refresh_token, expires_at, settings, is_active, created_at, updated_at';

  async function oldDatabase() {
    const { Database } = await import('../database.js');
    const SQL = await initSqlJs();
    const db = new Database(new SQL.Database());
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    db.exec(OLD_SCHEMA);
    for (const id of ['u1', 'u2']) db.prepare('INSERT INTO users (id) VALUES (?)').run(id);
    return db;
  }
  const uniqueKeys = (db) => db.prepare(`SELECT name FROM pragma_index_list('integrations') WHERE "unique" = 1 AND origin = 'u'`).all()
    .map(i => db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(i.name).map(c => c.name));
  const allRows = (db) => db.prepare(`SELECT ${COLUMNS} FROM integrations ORDER BY id`).all();
  const quiet = (fn) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { return fn(); } finally { errors.mockRestore(); }
  };

  it('rebuilds the table keyed by workspace + provider, keeps every row and column, and runs only once', async () => {
    const { migrateIntegrationsUniqueKey } = await import('../database.js');
    const db = await oldDatabase();
    const insert = db.prepare(`INSERT INTO integrations (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run('a', 'u1', 'w1', 'morning', 'key', 'secret', 'tok', 'ref', '2026-01-01', '{"x":1}', 1, '2025-01-01 10:00:00', '2025-01-02 10:00:00');
    insert.run('b', 'u2', 'w2', 'morning', null, null, null, null, null, null, 0, '2025-02-01 10:00:00', '2025-02-01 10:00:00');
    const before = allRows(db);

    expect(migrateIntegrationsUniqueKey(db)).toBe(true);
    expect(uniqueKeys(db)).toEqual([['workspace_id', 'provider']]);
    expect(allRows(db)).toEqual(before);
    expect(migrateIntegrationsUniqueKey(db)).toBe(false);
    expect(allRows(db)).toEqual(before);

    // The same user can now connect the provider in a second workspace, but a workspace has one connection
    insert.run('c', 'u1', 'w3', 'morning', null, null, null, null, null, null, 1, null, null);
    expect(() => quiet(() => insert.run('d', 'u2', 'w3', 'morning', null, null, null, null, null, null, 1, null, null))).toThrow();
    expect(() => quiet(() => insert.run('e', 'ghost', 'w4', 'morning', null, null, null, null, null, null, 1, null, null))).toThrow();
  });

  it('leaves the old table untouched when two connections share a workspace + provider', async () => {
    const { migrateIntegrationsUniqueKey } = await import('../database.js');
    const db = await oldDatabase();
    db.prepare(`INSERT INTO integrations (id, user_id, workspace_id, provider) VALUES ('a', 'u1', 'w1', 'morning')`).run();
    db.prepare(`INSERT INTO integrations (id, user_id, workspace_id, provider) VALUES ('b', 'u2', 'w1', 'morning')`).run();
    const before = allRows(db);
    expect(quiet(() => migrateIntegrationsUniqueKey(db))).toBe(false);
    expect(uniqueKeys(db)).toEqual([['user_id', 'provider']]);
    expect(allRows(db)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'integrations_new'").get().n).toBe(0);
  });

  it('the app database already uses the new key', async () => {
    const { db } = await getApp();
    expect(uniqueKeys(db)).toEqual([['workspace_id', 'provider']]);
  });
});

describe('ai and integrations (auth only - no network)', () => {
  it('require a login', async () => {
    const calls = [
      request(app).post('/api/ai/chat').send({ message: 'hi' }),
      request(app).post('/api/ai/execute').send({}),
      request(app).get('/api/integrations'),
      request(app).post('/api/integrations/morning/connect').send({}),
      request(app).post('/api/integrations/morning/disconnect'),
      request(app).get('/api/integrations/morning/clients')
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });

  it('reject a workspace the user does not belong to', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await createClientProjectTask(alice);
    expect((await bob.get('/api/integrations', alice.workspaceId)).status).toBe(403);
    expect((await bob.post('/api/ai/chat', alice.workspaceId).send({ message: 'hi' })).status).toBe(403);
  });
});
