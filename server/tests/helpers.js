import request from 'supertest';

let appPromise = null;

// One app (and one in-memory database) per test file
export function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const { dbPromise } = await import('../database.js');
      const { createApp } = await import('../app.js');
      const db = await dbPromise;
      const app = await createApp(db);
      return { app, db };
    })();
  }
  return appPromise;
}

let counter = 0;

// Registers a fresh user and returns a small client bound to their token + workspace
export async function createUser(overrides = {}) {
  const { app, db } = await getApp();
  counter += 1;
  const body = {
    email: `user${counter}-${Date.now()}@example.com`,
    password: 'Secret123!',
    name: `User ${counter}`,
    ...overrides
  };
  const res = await request(app).post('/api/auth/register').send(body);
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return bindClient(app, db, {
    token: res.body.token,
    user: res.body.user,
    workspaceId: res.body.currentWorkspace.id,
    password: body.password
  });
}

export function bindClient(app, db, session) {
  const withAuth = (req, workspaceId = session.workspaceId) => {
    req.set('Authorization', `Bearer ${session.token}`);
    if (workspaceId) req.set('X-Workspace-Id', workspaceId);
    return req;
  };
  return {
    ...session,
    app,
    db,
    get: (url, ws) => withAuth(request(app).get(url), ws),
    post: (url, ws) => withAuth(request(app).post(url), ws),
    put: (url, ws) => withAuth(request(app).put(url), ws),
    patch: (url, ws) => withAuth(request(app).patch(url), ws),
    delete: (url, ws) => withAuth(request(app).delete(url), ws)
  };
}

// Client -> project -> task, the chain most features hang off
export async function createClientProjectTask(user, { hourlyRate = 200 } = {}) {
  const client = await user.post('/api/clients').send({ name: 'Acme Ltd', hourly_rate: hourlyRate });
  if (client.status >= 300) throw new Error(`client: ${client.status} ${JSON.stringify(client.body)}`);
  const project = await user.post('/api/projects').send({
    client_id: client.body.id,
    name: 'Website',
    pricing_type: 'hourly',
    hourly_rate: hourlyRate
  });
  if (project.status >= 300) throw new Error(`project: ${project.status} ${JSON.stringify(project.body)}`);
  const task = await user.post('/api/tasks').send({ project_id: project.body.id, name: 'Landing page' });
  if (task.status >= 300) throw new Error(`task: ${task.status} ${JSON.stringify(task.body)}`);
  return { client: client.body, project: project.body, task: task.body };
}
