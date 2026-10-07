import request from 'supertest';
import { getApp, createUser, bindClient } from './helpers.js';

// Extra helpers for the core suites (clients/projects/tasks/timer/stats/workspaces/auth/admin).
// helpers.js is shared with another suite, so additions live here.

// Moves a timer's current start (and its open interval) `seconds` into the past,
// so elapsed-time math can be tested without sleeping.
export function backdateTimer(db, timerId, seconds) {
  const timer = db.prepare('SELECT start_time FROM active_timers WHERE id = ?').get(timerId);
  if (!timer) throw new Error(`timer ${timerId} not found`);
  const iso = new Date(new Date(timer.start_time).getTime() - seconds * 1000).toISOString();
  db.prepare('UPDATE active_timers SET start_time = ? WHERE id = ?').run(iso, timerId);
  db.prepare('UPDATE timer_intervals SET start_time = ? WHERE timer_id = ? AND end_time IS NULL').run(iso, timerId);
  return iso;
}

// Live total of an active timer as the UI shows it: accumulated + time since the last (re)start
export function liveTotal(timer) {
  let total = timer.accumulated_seconds || 0;
  if (timer.is_running) total += Math.floor((Date.now() - new Date(timer.start_time).getTime()) / 1000);
  return total;
}

// Registers a new user and joins `owner`'s workspace through an invite link.
// Returns that user bound to the owner's workspace, plus their own personal workspace id
// and their workspace_members row id in the owner's workspace.
export async function addMember(owner, role = 'member', overrides = {}) {
  const invite = await owner.post(`/api/workspaces/${owner.workspaceId}/invites`).send({ role });
  if (invite.status !== 201) throw new Error(`invite: ${invite.status} ${JSON.stringify(invite.body)}`);
  const user = await createUser(overrides);
  const join = await user.post(`/api/workspaces/join/${invite.body.token}`);
  if (join.status !== 200) throw new Error(`join: ${join.status} ${JSON.stringify(join.body)}`);
  const { app, db } = await getApp();
  const membership = db
    .prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(owner.workspaceId, user.user.id);
  const bound = bindClient(app, db, {
    token: user.token,
    user: user.user,
    password: user.password,
    workspaceId: owner.workspaceId
  });
  return { ...bound, ownWorkspaceId: user.workspaceId, memberId: membership.id };
}

// Logs in as the seeded admin/admin account
export async function adminClient() {
  const { app, db } = await getApp();
  const res = await request(app).post('/api/auth/login').send({ email: 'admin', password: 'admin' });
  if (res.status !== 200) throw new Error(`admin login: ${res.status} ${JSON.stringify(res.body)}`);
  return bindClient(app, db, {
    token: res.body.token,
    user: res.body.user,
    password: 'admin',
    workspaceId: res.body.currentWorkspace ? res.body.currentWorkspace.id : null
  });
}

// Creates a manual time entry of `seconds` starting at `start` (Date or ISO string)
export async function addEntry(user, { project_id, task_id, start, seconds, notes, ...rest }) {
  const startMs = new Date(start).getTime();
  const res = await user.post('/api/timer/entries').send({
    project_id,
    task_id,
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(startMs + seconds * 1000).toISOString(),
    notes,
    ...rest
  });
  if (res.status !== 201) throw new Error(`entry: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
