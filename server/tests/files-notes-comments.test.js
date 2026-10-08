import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { twoWorkspaces, addMember } from './helpers-money.js';
import { UPLOADS_DIR } from '../paths.js';

let app;
beforeAll(async () => { ({ app } = await getApp()); });

const listUploads = () => (fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : []);
const upload = (user, { name = 'report.pdf', content = 'hello file', fields = {} } = {}) => {
  const req = user.post('/api/files/upload');
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  return req.attach('file', Buffer.from(content), name);
};
const binaryParser = (res, cb) => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('files', () => {
  it('uses the temp uploads dir, never the real one', () => {
    expect(UPLOADS_DIR).toBe(process.env.CLOCKWIZE_UPLOADS_DIR);
    expect(UPLOADS_DIR).not.toContain(path.join('server', 'uploads'));
  });

  it('requires a login', async () => {
    expect((await request(app).get('/api/files')).status).toBe(401);
    expect((await request(app).post('/api/files/upload').attach('file', Buffer.from('x'), 'x.txt')).status).toBe(401);
    expect((await request(app).get(`/api/files/${uuidv4()}/download`)).status).toBe(401);
    expect((await request(app).delete(`/api/files/${uuidv4()}`)).status).toBe(401);
  });

  it('400s without a file', async () => {
    const user = await createUser();
    const res = await user.post('/api/files/upload').field('client_id', '');
    expect(res.status).toBe(400);
  });

  it('uploads to disk under a random name, records metadata, downloads the same bytes', async () => {
    const user = await createUser();
    const { client, project, task } = await createClientProjectTask(user);
    const res = await upload(user, {
      name: 'contract.pdf',
      content: 'PDF-BYTES-1234',
      fields: { client_id: client.id, project_id: project.id, task_id: task.id }
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      original_name: 'contract.pdf',
      client_id: client.id,
      project_id: project.id,
      task_id: task.id,
      size: 14,
      workspace_id: user.workspaceId,
      user_id: user.user.id
    });
    expect(res.body.storage_path).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    const onDisk = path.join(UPLOADS_DIR, res.body.storage_path);
    expect(fs.readFileSync(onDisk, 'utf8')).toBe('PDF-BYTES-1234');

    const row = user.db.prepare('SELECT * FROM files WHERE id = ?').get(res.body.id);
    expect(row.storage_path).toBe(res.body.storage_path);

    const dl = await user.get(`/api/files/${res.body.id}/download`).buffer(true).parse(binaryParser);
    expect(dl.status).toBe(200);
    expect(dl.body.toString()).toBe('PDF-BYTES-1234');
    expect(dl.headers['content-disposition']).toContain('contract.pdf');
  });

  it('keeps a Hebrew file name intact', async () => {
    const user = await createUser();
    const res = await upload(user, { name: 'חשבונית מס.pdf' });
    expect(res.status).toBe(200);
    expect(res.body.original_name).toBe('חשבונית מס.pdf');
  });

  it('a path-traversal file name cannot escape the uploads dir', async () => {
    const user = await createUser();
    const res = await upload(user, { name: '../../../evil.sh', content: 'echo pwned' });
    expect(res.status).toBe(200);
    expect(res.body.storage_path).toMatch(/^[0-9a-f-]{36}\.sh$/);
    expect(fs.existsSync(path.join(UPLOADS_DIR, res.body.storage_path))).toBe(true);
    expect(fs.existsSync(path.resolve(UPLOADS_DIR, '../../../evil.sh'))).toBe(false);
  });

  it('lists by entity with the uploader name', async () => {
    const user = await createUser({ name: 'Uploader Uri' });
    const a = await createClientProjectTask(user);
    const b = await createClientProjectTask(user);
    const fa = (await upload(user, { fields: { client_id: a.client.id } })).body;
    const fb = (await upload(user, { fields: { project_id: b.project.id } })).body;
    const ft = (await upload(user, { fields: { task_id: b.task.id } })).body;

    const all = await user.get('/api/files');
    expect(all.body.map(f => f.id).sort()).toEqual([fa.id, fb.id, ft.id].sort());
    expect(all.body[0].uploader_name).toBe('Uploader Uri');
    expect((await user.get(`/api/files?client_id=${a.client.id}`)).body.map(f => f.id)).toEqual([fa.id]);
    expect((await user.get(`/api/files?project_id=${b.project.id}`)).body.map(f => f.id)).toEqual([fb.id]);
    expect((await user.get(`/api/files?task_id=${b.task.id}`)).body.map(f => f.id)).toEqual([ft.id]);
  });

  it('download 404s for an unknown id or a file missing on disk', async () => {
    const user = await createUser();
    expect((await user.get(`/api/files/${uuidv4()}/download`)).status).toBe(404);
    const f = (await upload(user)).body;
    fs.unlinkSync(path.join(UPLOADS_DIR, f.storage_path));
    expect((await user.get(`/api/files/${f.id}/download`)).status).toBe(404);
  });

  it('delete removes the row and the file on disk', async () => {
    const user = await createUser();
    const f = (await upload(user)).body;
    const onDisk = path.join(UPLOADS_DIR, f.storage_path);
    expect(fs.existsSync(onDisk)).toBe(true);
    expect((await user.delete(`/api/files/${f.id}`)).status).toBe(200);
    expect(fs.existsSync(onDisk)).toBe(false);
    expect(user.db.prepare('SELECT id FROM files WHERE id = ?').get(f.id)).toBeUndefined();
    expect((await user.delete(`/api/files/${f.id}`)).status).toBe(404);
  });

  describe('cross-workspace isolation', () => {
    it('another workspace cannot list, download or delete a file', async () => {
      const { alice, bob } = await twoWorkspaces();
      const f = (await upload(alice, { content: 'alice private' })).body;
      expect((await bob.get('/api/files')).body).toEqual([]);
      expect((await bob.get(`/api/files/${f.id}/download`)).status).toBe(404);
      expect((await bob.delete(`/api/files/${f.id}`)).status).toBe(404);
      expect(fs.existsSync(path.join(UPLOADS_DIR, f.storage_path))).toBe(true);
    });

    it('uploading onto another workspace\'s client/project/task 404s and leaves nothing on disk', async () => {
      const { bob, a } = await twoWorkspaces();
      const before = listUploads().length;
      for (const fields of [{ client_id: a.client.id }, { project_id: a.project.id }, { task_id: a.task.id }]) {
        const res = await upload(bob, { fields });
        expect(res.status).toBe(404);
      }
      expect(listUploads().length).toBe(before);
      expect(bob.db.prepare('SELECT COUNT(*) as n FROM files WHERE workspace_id = ?').get(bob.workspaceId).n).toBe(0);
    });
  });
});

describe('notes', () => {
  it('requires a login', async () => {
    expect((await request(app).get(`/api/notes/client/${uuidv4()}`)).status).toBe(401);
    expect((await request(app).post('/api/notes').send({})).status).toBe(401);
    expect((await request(app).put(`/api/notes/${uuidv4()}`).send({})).status).toBe(401);
    expect((await request(app).delete(`/api/notes/${uuidv4()}`)).status).toBe(401);
  });

  it('requires an entity', async () => {
    const user = await createUser();
    expect((await user.post('/api/notes').send({ title: 'x' })).status).toBe(400);
    expect((await user.post('/api/notes').send({ entity_type: 'client' })).status).toBe(400);
  });

  it('creates, lists, updates and deletes notes per entity', async () => {
    const user = await createUser();
    const { client, project, task } = await createClientProjectTask(user);
    const n1 = await user.post('/api/notes').send({ entity_type: 'client', entity_id: client.id, title: 'Kickoff', content: '<p>Hi</p>' });
    expect(n1.status).toBe(201);
    expect(n1.body).toMatchObject({ title: 'Kickoff', content: '<p>Hi</p>', workspace_id: user.workspaceId });
    const n2 = await user.post('/api/notes').send({ entity_type: 'client', entity_id: client.id });
    expect(n2.body).toMatchObject({ title: '', content: '' });
    await user.post('/api/notes').send({ entity_type: 'project', entity_id: project.id, title: 'P' });
    await user.post('/api/notes').send({ entity_type: 'task', entity_id: task.id, title: 'T' });

    const clientNotes = await user.get(`/api/notes/client/${client.id}`);
    expect(clientNotes.body.map(n => n.id).sort()).toEqual([n1.body.id, n2.body.id].sort());
    expect((await user.get(`/api/notes/project/${project.id}`)).body.map(n => n.title)).toEqual(['P']);
    expect((await user.get(`/api/notes/task/${task.id}`)).body.map(n => n.title)).toEqual(['T']);

    const upd = await user.put(`/api/notes/${n1.body.id}`).send({ content: '<p>Updated</p>' });
    expect(upd.body).toMatchObject({ title: 'Kickoff', content: '<p>Updated</p>' });

    expect((await user.delete(`/api/notes/${n1.body.id}`)).status).toBe(200);
    expect((await user.delete(`/api/notes/${n1.body.id}`)).status).toBe(404);
    expect((await user.put(`/api/notes/${n1.body.id}`).send({ title: 'x' })).status).toBe(404);
  });

  it('404s for unknown entities', async () => {
    const user = await createUser();
    for (const entity_type of ['client', 'project', 'task']) {
      expect((await user.post('/api/notes').send({ entity_type, entity_id: uuidv4() })).status).toBe(404);
    }
  });

  it('cross-workspace: cannot attach to, read, edit or delete another workspace\'s notes', async () => {
    const { alice, bob, a } = await twoWorkspaces();
    const note = (await alice.post('/api/notes').send({ entity_type: 'client', entity_id: a.client.id, title: 'Secret plan' })).body;

    expect((await bob.post('/api/notes').send({ entity_type: 'client', entity_id: a.client.id })).status).toBe(404);
    expect((await bob.post('/api/notes').send({ entity_type: 'project', entity_id: a.project.id })).status).toBe(404);
    expect((await bob.post('/api/notes').send({ entity_type: 'task', entity_id: a.task.id })).status).toBe(404);
    expect((await bob.get(`/api/notes/client/${a.client.id}`)).body).toEqual([]);
    expect((await bob.put(`/api/notes/${note.id}`).send({ title: 'pwned' })).status).toBe(404);
    expect((await bob.delete(`/api/notes/${note.id}`)).status).toBe(404);
    expect((await alice.get(`/api/notes/client/${a.client.id}`)).body[0].title).toBe('Secret plan');
  });
});

describe('comments', () => {
  const setCreatedAt = (user, id, ts) => user.db.prepare('UPDATE comments SET created_at = ? WHERE id = ?').run(ts, id);

  it('requires a login', async () => {
    expect((await request(app).get('/api/comments')).status).toBe(401);
    expect((await request(app).get('/api/comments/unread')).status).toBe(401);
    expect((await request(app).post('/api/comments').send({ content: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/comments/mark-read').send({})).status).toBe(401);
  });

  it('requires content', async () => {
    const user = await createUser();
    expect((await user.post('/api/comments').send({})).status).toBe(400);
  });

  it('creates and filters comments by context, oldest first', async () => {
    const user = await createUser({ name: 'Commenter' });
    const { client, project, task } = await createClientProjectTask(user);
    const general = (await user.post('/api/comments').send({ content: 'general' })).body;
    const onClient = (await user.post('/api/comments').send({ content: 'client', client_id: client.id })).body;
    const onProject = (await user.post('/api/comments').send({ content: 'project', project_id: project.id })).body;
    const onTask = (await user.post('/api/comments').send({ content: 'task', task_id: task.id })).body;
    const reply = (await user.post('/api/comments').send({ content: 'reply', parent_id: general.id })).body;
    expect(general).toMatchObject({ content: 'general', user_name: 'Commenter', workspace_id: user.workspaceId });
    expect(reply.parent_id).toBe(general.id);

    setCreatedAt(user, general.id, '2026-01-01 10:00:00');
    setCreatedAt(user, reply.id, '2026-01-01 11:00:00');

    expect((await user.get('/api/comments?dashboard=true')).body.map(c => c.id)).toEqual([general.id, reply.id]);
    expect((await user.get(`/api/comments?client_id=${client.id}`)).body.map(c => c.id)).toEqual([onClient.id]);
    expect((await user.get(`/api/comments?project_id=${project.id}`)).body.map(c => c.id)).toEqual([onProject.id]);
    expect((await user.get(`/api/comments?task_id=${task.id}`)).body.map(c => c.id)).toEqual([onTask.id]);
    expect((await user.get('/api/comments')).body).toHaveLength(5);
    expect((await user.get(`/api/comments?client_id=${uuidv4()}`)).status).toBe(404);
  });

  it('only the author can edit or delete a comment', async () => {
    const owner = await createUser();
    const colleague = await createUser();
    addMember(owner, colleague);
    const c = (await owner.post('/api/comments').send({ content: 'mine' })).body;

    // The colleague sees it in the shared workspace...
    expect((await colleague.get('/api/comments', owner.workspaceId)).body.map(x => x.id)).toContain(c.id);
    // ...but cannot change it
    expect((await colleague.put(`/api/comments/${c.id}`, owner.workspaceId).send({ content: 'hacked' })).status).toBe(403);
    expect((await colleague.delete(`/api/comments/${c.id}`, owner.workspaceId)).status).toBe(403);

    const upd = await owner.put(`/api/comments/${c.id}`).send({ content: 'edited' });
    expect(upd.status).toBe(200);
    expect(upd.body.content).toBe('edited');
    expect((await owner.delete(`/api/comments/${c.id}`)).status).toBe(200);
    expect((await owner.delete(`/api/comments/${c.id}`)).status).toBe(404);
  });

  it('editing without content is a 400, not a crash', async () => {
    const user = await createUser();
    const c = (await user.post('/api/comments').send({ content: 'keep me' })).body;
    expect((await user.put(`/api/comments/${c.id}`).send({})).status).toBe(400);
    expect((await user.put(`/api/comments/${c.id}`).send({ content: '' })).status).toBe(400);
    expect((await user.get('/api/comments')).body[0].content).toBe('keep me');
  });

  it('counts unread comments per context and resets on mark-read', async () => {
    const user = await createUser();
    const { client } = await createClientProjectTask(user);
    const g1 = (await user.post('/api/comments').send({ content: 'g1' })).body;
    const g2 = (await user.post('/api/comments').send({ content: 'g2' })).body;
    const c1 = (await user.post('/api/comments').send({ content: 'c1', client_id: client.id })).body;
    for (const c of [g1, g2, c1]) setCreatedAt(user, c.id, '2026-01-01 10:00:00');

    expect((await user.get('/api/comments/unread?dashboard=true')).body.unread).toBe(2);
    expect((await user.get(`/api/comments/unread?client_id=${client.id}`)).body.unread).toBe(1);

    expect((await user.post('/api/comments/mark-read').send({ dashboard: true })).status).toBe(200);
    expect((await user.get('/api/comments/unread?dashboard=true')).body.unread).toBe(0);
    // Other contexts are untouched
    expect((await user.get(`/api/comments/unread?client_id=${client.id}`)).body.unread).toBe(1);

    // A newer comment after the read mark is unread again
    const g3 = (await user.post('/api/comments').send({ content: 'g3' })).body;
    setCreatedAt(user, g3.id, '2999-01-01 00:00:00');
    expect((await user.get('/api/comments/unread?dashboard=true')).body.unread).toBe(1);

    // Marking twice updates the same row
    await user.post('/api/comments/mark-read').send({ client_id: client.id });
    await user.post('/api/comments/mark-read').send({ client_id: client.id });
    const rows = user.db.prepare("SELECT COUNT(*) as n FROM comment_read_status WHERE user_id = ? AND context_type = 'client'").get(user.user.id);
    expect(rows.n).toBe(1);
    expect((await user.get(`/api/comments/unread?client_id=${client.id}`)).body.unread).toBe(0);
  });

  it('cross-workspace: cannot read, post on, edit or delete another workspace\'s comments', async () => {
    const { alice, bob, a } = await twoWorkspaces();
    const c = (await alice.post('/api/comments').send({ content: 'alice only', client_id: a.client.id })).body;

    expect((await bob.get('/api/comments')).body).toEqual([]);
    expect((await bob.get(`/api/comments?client_id=${a.client.id}`)).status).toBe(404);
    expect((await bob.get(`/api/comments?project_id=${a.project.id}`)).status).toBe(404);
    expect((await bob.get(`/api/comments?task_id=${a.task.id}`)).status).toBe(404);
    expect((await bob.get(`/api/comments/unread?client_id=${a.client.id}`)).body.unread).toBe(0);
    expect((await bob.post('/api/comments').send({ content: 'x', client_id: a.client.id })).status).toBe(404);
    expect((await bob.post('/api/comments').send({ content: 'x', project_id: a.project.id })).status).toBe(404);
    expect((await bob.post('/api/comments').send({ content: 'x', task_id: a.task.id })).status).toBe(404);
    expect((await bob.put(`/api/comments/${c.id}`).send({ content: 'x' })).status).toBe(404);
    expect((await bob.delete(`/api/comments/${c.id}`)).status).toBe(404);
    expect((await alice.get(`/api/comments?client_id=${a.client.id}`)).body[0].content).toBe('alice only');
  });
});
