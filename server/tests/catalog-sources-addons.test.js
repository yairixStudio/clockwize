import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { addMember, ENCRYPTED_SHAPE, legacyEncrypt } from './helpers-money.js';

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

  // Bug: `price || null` turns a free (price 0) item into "no price"
  it.fails('keeps a price of 0', async () => {
    const user = await createUser();
    const res = await item(user, { name: 'Free consult', price: 0 });
    expect(res.body.price).toBe(0);
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
    const own = (await source(alice, { name: uniq('Own') })).body;
    const bobs = (await source(bob, { name: uniq('Bobs') })).body;
    const global = (await source(bob, { name: uniq('Global'), is_global: true })).body;
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
    const global = (await source(alice, { name: uniq('Shared Global'), is_global: true })).body;
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

  it('assigns a global source to the current workspace once', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const global = (await source(alice, { name: uniq('Claimable'), is_global: true })).body;
    const bobs = (await source(bob, { name: uniq('Bob private') })).body;

    expect((await alice.post(`/api/client-sources/${uuidv4()}/assign-to-workspace`)).status).toBe(404);
    const res = await alice.post(`/api/client-sources/${global.id}/assign-to-workspace`);
    expect(res.status).toBe(200);
    expect(res.body.workspace_id).toBe(alice.workspaceId);
    expect((await alice.post(`/api/client-sources/${global.id}/assign-to-workspace`)).status).toBe(400);

    // Another workspace's own source cannot be taken over
    expect((await alice.post(`/api/client-sources/${bobs.id}/assign-to-workspace`)).status).toBe(400);
    expect(alice.db.prepare('SELECT workspace_id FROM client_sources WHERE id = ?').get(bobs.id).workspace_id).toBe(bob.workspaceId);
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

  // Bug (database.js, not fixed here): user_addons has UNIQUE(user_id, addon_id), so a member of
  // two workspaces gets a 500 the first time they toggle an addon in their second workspace
  it.fails('a member of two workspaces can toggle the same addon in both', async () => {
    const owner = await createUser();
    const member = await createUser();
    addMember(owner, member, 'admin');
    expect((await member.put('/api/addons/catalog').send({ isEnabled: true })).status).toBe(200);
    expect((await member.put('/api/addons/catalog', owner.workspaceId).send({ isEnabled: true })).status).toBe(200);
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
