import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getApp, createUser, createClientProjectTask } from './helpers.js';
import { addEntry, backdateTimer, liveTotal } from './helpers-core.js';

// Durations are computed from wall-clock time; allow a few seconds of slack
const near = (actual, expected, slack = 4) => {
  expect(actual).toBeGreaterThanOrEqual(expected);
  expect(actual).toBeLessThan(expected + slack);
};

async function setup() {
  const user = await createUser();
  const chain = await createClientProjectTask(user);
  return { user, db: user.db, ...chain };
}

const start = async (user, body) => {
  const res = await user.post('/api/timer/start').send(body);
  if (res.status !== 201) throw new Error(`start: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

describe('timer - start', () => {
  it('requires a login', async () => {
    const { app } = await getApp();
    expect((await request(app).get('/api/timer/active')).status).toBe(401);
    expect((await request(app).post('/api/timer/start').send({ project_id: 'x' })).status).toBe(401);
  });

  it('validates the project and task', async () => {
    const { user, project } = await setup();
    expect((await user.post('/api/timer/start').send({})).status).toBe(400);
    expect((await user.post('/api/timer/start').send({ project_id: 'nope' })).status).toBe(404);
    expect((await user.post('/api/timer/start').send({ project_id: project.id, task_id: 'nope' })).status).toBe(404);
  });

  it('starts a running timer with names and an open interval', async () => {
    const { user, db, project, task } = await setup();
    const timer = await start(user, { project_id: project.id, task_id: task.id });
    expect(timer).toMatchObject({
      project_id: project.id,
      task_id: task.id,
      is_running: 1,
      accumulated_seconds: 0,
      project_name: 'Website',
      task_name: 'Landing page',
      client_name: 'Acme Ltd',
      user_id: user.user.id,
      workspace_id: user.workspaceId
    });
    const intervals = db.prepare('SELECT * FROM timer_intervals WHERE timer_id = ?').all(timer.id);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].end_time).toBeNull();
    expect(intervals[0].start_time).toBe(timer.start_time);
  });

  it('allows one timer per project/task pair, but several in parallel', async () => {
    const { user, project, task } = await setup();
    const other = (await user.post('/api/projects').send({ client_id: project.client_id, name: 'Other' })).body;

    const projectTimer = await start(user, { project_id: project.id });
    expect((await user.post('/api/timer/start').send({ project_id: project.id })).status).toBe(400);

    const taskTimer = await start(user, { project_id: project.id, task_id: task.id });
    expect((await user.post('/api/timer/start').send({ project_id: project.id, task_id: task.id })).status).toBe(400);

    const otherTimer = await start(user, { project_id: other.id });

    const active = (await user.get('/api/timer/active')).body;
    expect(active.map((t) => t.id).sort()).toEqual([projectTimer.id, taskTimer.id, otherTimer.id].sort());
  });

  it('finds the timer of a specific project / task', async () => {
    const { user, project, task } = await setup();
    const projectTimer = await start(user, { project_id: project.id });
    const taskTimer = await start(user, { project_id: project.id, task_id: task.id });

    const byProject = await user.get(`/api/timer/active/project/${project.id}`);
    expect(byProject.body.id).toBe(projectTimer.id);
    const byTask = await user.get(`/api/timer/active/project/${project.id}?taskId=${task.id}`);
    expect(byTask.body.id).toBe(taskTimer.id);
    const none = await user.get('/api/timer/active/project/nope');
    expect(none.status).toBe(200);
    expect(none.text).toBe('null');
  });
});

describe('timer - pause / resume / stop', () => {
  it('accumulates time across pause and resume and saves it on stop', async () => {
    const { user, db, project } = await setup();
    const timer = await start(user, { project_id: project.id });
    const firstStart = backdateTimer(db, timer.id, 120);

    const paused = await user.post(`/api/timer/pause/${timer.id}`);
    expect(paused.status).toBe(200);
    expect(paused.body.is_running).toBe(0);
    near(paused.body.accumulated_seconds, 120);
    const closed = db.prepare('SELECT * FROM timer_intervals WHERE timer_id = ?').all(timer.id);
    expect(closed).toHaveLength(1);
    expect(closed[0].end_time).toBeTruthy();
    expect(closed[0].duration_seconds).toBe(paused.body.accumulated_seconds);

    expect((await user.post(`/api/timer/pause/${timer.id}`)).status).toBe(400);

    const resumed = await user.post(`/api/timer/resume/${timer.id}`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.is_running).toBe(1);
    expect(resumed.body.accumulated_seconds).toBe(paused.body.accumulated_seconds);
    expect((await user.post(`/api/timer/resume/${timer.id}`)).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM timer_intervals WHERE timer_id = ?').get(timer.id).n).toBe(2);

    backdateTimer(db, timer.id, 30);
    const live = (await user.get('/api/timer/active')).body.find((t) => t.id === timer.id);
    near(liveTotal(live), 150);

    const stopped = await user.post(`/api/timer/stop/${timer.id}`).send({ notes: 'done' });
    expect(stopped.status).toBe(200);
    near(stopped.body.duration, 150);
    expect(stopped.body).toMatchObject({ project_id: project.id, task_id: null, notes: 'done', user_id: user.user.id });
    expect(stopped.body.start_time).toBe(firstStart);
    expect(stopped.body.additional_associations).toEqual([]);

    const intervals = (await user.get(`/api/timer/entries/${stopped.body.id}/intervals`)).body;
    expect(intervals).toHaveLength(2);
    expect(intervals.reduce((s, i) => s + i.duration_seconds, 0)).toBe(stopped.body.duration);
    near(intervals[0].duration_seconds, 120);
    near(intervals[1].duration_seconds, 30);

    expect((await user.get('/api/timer/active')).body).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM timer_intervals WHERE timer_id = ?').get(timer.id).n).toBe(0);
    expect((await user.post(`/api/timer/stop/${timer.id}`).send({})).status).toBe(404);
  });

  it('stopping a paused timer saves exactly the accumulated time', async () => {
    const { user, db, project } = await setup();
    const timer = await start(user, { project_id: project.id });
    backdateTimer(db, timer.id, 300);
    const paused = (await user.post(`/api/timer/pause/${timer.id}`)).body;
    const stopped = await user.post(`/api/timer/stop/${timer.id}`).send({});
    expect(stopped.status).toBe(200);
    expect(stopped.body.duration).toBe(paused.accumulated_seconds);
  });

  it('can re-assign the entry to another project/task of the workspace on stop', async () => {
    const { user, db, project, task } = await setup();
    const target = (await user.post('/api/projects').send({ client_id: project.client_id, name: 'Target' })).body;
    const targetTask = (await user.post('/api/tasks').send({ project_id: target.id, name: 'Target task' })).body;
    const sub = (await user.post(`/api/tasks/${targetTask.id}/subtasks`).send({ title: 'Target sub' })).body;
    const timer = await start(user, { project_id: project.id, task_id: task.id });
    backdateTimer(db, timer.id, 60);

    const stopped = await user.post(`/api/timer/stop/${timer.id}`).send({
      project_id: target.id,
      task_id: targetTask.id,
      subtask_id: sub.id,
      additional_associations: [{ project_id: project.id, task_id: task.id }, {}]
    });
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({ project_id: target.id, task_id: targetTask.id, subtask_id: sub.id });
    expect(stopped.body.additional_associations).toEqual([
      expect.objectContaining({ project_id: project.id, task_id: task.id, project_name: 'Website', task_name: 'Landing page' })
    ]);
  });

  it('uses edited intervals sent with stop (update, add, drop)', async () => {
    const { user, db, project } = await setup();
    const timer = await start(user, { project_id: project.id });
    backdateTimer(db, timer.id, 100);
    await user.post(`/api/timer/pause/${timer.id}`);
    await user.post(`/api/timer/resume/${timer.id}`);
    const [first, second] = (await user.get(`/api/timer/active/${timer.id}/intervals`)).body;
    expect(second.is_active).toBe(true);

    const stopped = await user.post(`/api/timer/stop/${timer.id}`).send({
      intervals: [
        { id: first.id, start_time: '2025-04-01T08:00:00.000Z', end_time: '2025-04-01T09:00:00.000Z' },
        { start_time: '2025-04-01T10:00:00.000Z', end_time: '2025-04-01T10:30:00.000Z' }
      ]
    });
    expect(stopped.status).toBe(200);
    expect(stopped.body.duration).toBe(3600 + 1800);
    expect(stopped.body.start_time).toBe('2025-04-01T08:00:00.000Z');

    const saved = (await user.get(`/api/timer/entries/${stopped.body.id}/intervals`)).body;
    expect(saved.map((i) => i.duration_seconds)).toEqual([3600, 1800]);
    expect(saved.map((i) => i.id)).not.toContain(second.id);
  });

  it('returns 404 for unknown timers', async () => {
    const { user } = await setup();
    expect((await user.post('/api/timer/pause/nope')).status).toBe(404);
    expect((await user.post('/api/timer/resume/nope')).status).toBe(404);
    expect((await user.post('/api/timer/stop/nope').send({})).status).toBe(404);
    expect((await user.delete('/api/timer/discard/nope')).status).toBe(404);
    expect((await user.get('/api/timer/active/nope/intervals')).status).toBe(404);
    expect((await user.put('/api/timer/active/nope/start-time').send({ start_time: new Date().toISOString() })).status).toBe(404);
  });
});

describe('timer - discard', () => {
  it('drops the timer and its intervals without creating an entry', async () => {
    const { user, db, project } = await setup();
    const timer = await start(user, { project_id: project.id });
    backdateTimer(db, timer.id, 500);

    const res = await user.delete(`/api/timer/discard/${timer.id}`);
    expect(res.status).toBe(200);
    expect((await user.get('/api/timer/active')).body).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM timer_intervals WHERE timer_id = ?').get(timer.id).n).toBe(0);
    expect((await user.get('/api/timer/entries')).body).toEqual([]);
    expect((await user.delete(`/api/timer/discard/${timer.id}`)).status).toBe(404);
  });
});

describe('timer - edit start time', () => {
  it('validates the new start time', async () => {
    const { user, project } = await setup();
    const timer = await start(user, { project_id: project.id });
    expect((await user.put(`/api/timer/active/${timer.id}/start-time`).send({})).status).toBe(400);
    expect((await user.put(`/api/timer/active/${timer.id}/start-time`).send({ start_time: 'not a date' })).status).toBe(400);
  });

  it('moving a fresh running timer earlier adds the difference', async () => {
    const { user, project } = await setup();
    const timer = await start(user, { project_id: project.id });
    const earlier = new Date(Date.now() - 600 * 1000).toISOString();
    const res = await user.put(`/api/timer/active/${timer.id}/start-time`).send({ start_time: earlier });
    expect(res.status).toBe(200);
    expect(res.body.start_time).toBe(earlier);
    near(liveTotal(res.body), 600);

    const intervals = (await user.get(`/api/timer/active/${timer.id}/intervals`)).body;
    expect(intervals[0].start_time).toBe(earlier);

    const stopped = await user.post(`/api/timer/stop/${timer.id}`).send({});
    near(stopped.body.duration, 600);
  });

  it('on a paused timer only the start time changes', async () => {
    const { user, db, project } = await setup();
    const timer = await start(user, { project_id: project.id });
    backdateTimer(db, timer.id, 200);
    const paused = (await user.post(`/api/timer/pause/${timer.id}`)).body;
    const res = await user.put(`/api/timer/active/${timer.id}/start-time`).send({ start_time: '2025-01-01T10:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.accumulated_seconds).toBe(paused.accumulated_seconds);
    expect(res.body.start_time).toBe('2025-01-01T10:00:00.000Z');
  });

  // start-time rejects a time in the future, which would otherwise save a negative duration
  it('a start time in the future never yields a negative duration', async () => {
    const { user, project } = await setup();
    const timer = await start(user, { project_id: project.id });
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const res = await user.put(`/api/timer/active/${timer.id}/start-time`).send({ start_time: future });
    if (res.status === 400) return;
    const stopped = await user.post(`/api/timer/stop/${timer.id}`).send({});
    expect(stopped.body.duration).toBeGreaterThanOrEqual(0);
  });

  // The live total shown by the UI (accumulated + now - start) must match what stop saves
  it('on a resumed timer the live total matches the saved duration', async () => {
    const { user, db, project } = await setup();
    const timer = await start(user, { project_id: project.id });
    backdateTimer(db, timer.id, 600);
    await user.post(`/api/timer/pause/${timer.id}`);
    const resumed = (await user.post(`/api/timer/resume/${timer.id}`)).body;
    const earlier = new Date(new Date(resumed.start_time).getTime() - 300 * 1000).toISOString();

    const res = await user.put(`/api/timer/active/${timer.id}/start-time`).send({ start_time: earlier });
    expect(res.status).toBe(200);
    const shown = liveTotal(res.body);
    near(shown, 900);

    const stopped = await user.post(`/api/timer/stop/${timer.id}`).send({});
    near(stopped.body.duration, shown);
  });
});

describe('timer - manual entries', () => {
  it('validates project, task and subtask', async () => {
    const { user, project, task } = await setup();
    const otherTask = (await user.post('/api/tasks').send({ project_id: project.id, name: 'Other' })).body;
    const sub = (await user.post(`/api/tasks/${otherTask.id}/subtasks`).send({ title: 'S' })).body;
    const base = { start_time: '2025-01-01T10:00:00.000Z', end_time: '2025-01-01T11:00:00.000Z' };

    expect((await user.post('/api/timer/entries').send(base)).status).toBe(400);
    expect((await user.post('/api/timer/entries').send({ ...base, project_id: 'nope' })).status).toBe(404);
    expect((await user.post('/api/timer/entries').send({ ...base, project_id: project.id, task_id: 'nope' })).status).toBe(404);
    // subtask belongs to a different task
    expect((await user.post('/api/timer/entries').send({ ...base, project_id: project.id, task_id: task.id, subtask_id: sub.id })).status).toBe(404);
  });

  it('rejects a subtask sent without its task (instead of crashing)', async () => {
    const { user, project, task } = await setup();
    const sub = (await user.post(`/api/tasks/${task.id}/subtasks`).send({ title: 'S' })).body;
    const res = await user.post('/api/timer/entries').send({
      project_id: project.id,
      subtask_id: sub.id,
      start_time: '2025-01-01T10:00:00.000Z',
      end_time: '2025-01-01T11:00:00.000Z'
    });
    expect(res.status).toBe(404);
  });

  it('requires a start time (instead of crashing on the NOT NULL column)', async () => {
    const { user, project } = await setup();
    const res = await user.post('/api/timer/entries').send({ project_id: project.id, duration: 600, notes: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('accepts an open entry with a start time and no end time', async () => {
    const { user, project } = await setup();
    const res = await user.post('/api/timer/entries').send({ project_id: project.id, start_time: '2025-01-01T10:00:00.000Z', duration: 600 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ duration: 600, end_time: null });
  });

  it('computes the duration from start/end and records a single interval', async () => {
    const { user, project, task } = await setup();
    const sub = (await user.post(`/api/tasks/${task.id}/subtasks`).send({ title: 'Sub' })).body;
    const res = await user.post('/api/timer/entries').send({
      project_id: project.id,
      task_id: task.id,
      subtask_id: sub.id,
      start_time: '2025-01-01T10:00:00.000Z',
      end_time: '2025-01-01T11:30:00.000Z',
      notes: 'manual'
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      duration: 5400,
      is_manual: 1,
      notes: 'manual',
      project_name: 'Website',
      task_name: 'Landing page',
      subtask_title: 'Sub',
      additional_associations: []
    });
    const intervals = (await user.get(`/api/timer/entries/${res.body.id}/intervals`)).body;
    expect(intervals).toEqual([
      expect.objectContaining({ start_time: '2025-01-01T10:00:00.000Z', end_time: '2025-01-01T11:30:00.000Z', duration_seconds: 5400 })
    ]);
  });

  it('keeps an explicit duration (e.g. net of breaks)', async () => {
    const { user, project } = await setup();
    const res = await user.post('/api/timer/entries').send({
      project_id: project.id,
      start_time: '2025-01-01T10:00:00.000Z',
      end_time: '2025-01-01T12:00:00.000Z',
      duration: 3000
    });
    expect(res.body.duration).toBe(3000);
  });

  // Both POST and PUT reject end-before-start with 400
  it('rejects a manual entry that ends before it starts', async () => {
    const { user, project } = await setup();
    const res = await user.post('/api/timer/entries').send({
      project_id: project.id,
      start_time: '2025-01-01T12:00:00.000Z',
      end_time: '2025-01-01T10:00:00.000Z'
    });
    expect(res.status).toBe(400);
  });

  it('stores additional associations', async () => {
    const { user, project, task } = await setup();
    const other = (await user.post('/api/projects').send({ client_id: project.client_id, name: 'Other' })).body;
    const entry = await addEntry(user, {
      project_id: project.id,
      start: '2025-01-01T10:00:00.000Z',
      seconds: 60,
      additional_associations: [{ project_id: other.id }, { task_id: task.id }, { foo: 1 }]
    });
    expect(entry.additional_associations).toHaveLength(2);
    expect(entry.additional_associations.map((a) => a.project_name || a.task_name).sort()).toEqual(['Landing page', 'Other']);
  });
});

describe('timer - entries listing', () => {
  it('lists entries with names, intervals and associations, and filters by project/task', async () => {
    const { user, project, task } = await setup();
    const other = (await user.post('/api/projects').send({ client_id: project.client_id, name: 'Other' })).body;
    const e1 = await addEntry(user, { project_id: project.id, task_id: task.id, start: '2025-01-01T10:00:00.000Z', seconds: 60 });
    const e2 = await addEntry(user, { project_id: project.id, start: '2025-01-02T10:00:00.000Z', seconds: 120 });
    const e3 = await addEntry(user, { project_id: other.id, start: '2025-01-03T10:00:00.000Z', seconds: 180 });

    const all = (await user.get('/api/timer/entries')).body;
    expect(all.map((e) => e.id).sort()).toEqual([e1.id, e2.id, e3.id].sort());
    const row = all.find((e) => e.id === e1.id);
    expect(row).toMatchObject({
      project_name: 'Website',
      task_name: 'Landing page',
      client_id: project.client_id,
      user_name: user.user.name,
      additional_associations: []
    });
    expect(row.intervals).toHaveLength(1);

    const byProject = (await user.get(`/api/timer/entries?project_id=${project.id}`)).body;
    expect(byProject.map((e) => e.id).sort()).toEqual([e1.id, e2.id].sort());
    const byTask = (await user.get(`/api/timer/entries?task_id=${task.id}`)).body;
    expect(byTask.map((e) => e.id)).toEqual([e1.id]);
  });
});

describe('timer - update entries', () => {
  it('returns 404 for an unknown entry', async () => {
    const { user } = await setup();
    expect((await user.put('/api/timer/entries/nope').send({ notes: 'x' })).status).toBe(404);
    expect((await user.get('/api/timer/entries/nope/intervals')).status).toBe(404);
    expect((await user.delete('/api/timer/entries/nope')).status).toBe(404);
  });

  it('updates times, recomputes the duration and marks the entry edited', async () => {
    const { user, project } = await setup();
    const entry = await addEntry(user, { project_id: project.id, start: '2025-01-01T10:00:00.000Z', seconds: 600 });
    const res = await user.put(`/api/timer/entries/${entry.id}`).send({
      start_time: '2025-01-01T10:00:00.000Z',
      end_time: '2025-01-01T12:00:00.000Z',
      notes: 'longer'
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ duration: 7200, notes: 'longer', is_edited: 1 });
  });

  it('rejects end before start and clamps the duration to the clock span', async () => {
    const { user, project } = await setup();
    const entry = await addEntry(user, { project_id: project.id, start: '2025-01-01T10:00:00.000Z', seconds: 600 });
    const bad = await user.put(`/api/timer/entries/${entry.id}`).send({
      start_time: '2025-01-01T12:00:00.000Z',
      end_time: '2025-01-01T10:00:00.000Z'
    });
    expect(bad.status).toBe(400);

    const clamped = await user.put(`/api/timer/entries/${entry.id}`).send({
      start_time: '2025-01-01T10:00:00.000Z',
      end_time: '2025-01-01T11:00:00.000Z',
      duration: 99999
    });
    expect(clamped.status).toBe(200);
    expect(clamped.body.duration).toBe(3600);
  });

  it('a partial update (notes only) keeps the times and duration', async () => {
    const { user, project } = await setup();
    const entry = await addEntry(user, { project_id: project.id, start: '2025-01-01T10:00:00.000Z', seconds: 600, notes: 'old' });
    const res = await user.put(`/api/timer/entries/${entry.id}`).send({ notes: 'new notes' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      notes: 'new notes',
      start_time: entry.start_time,
      end_time: entry.end_time,
      duration: 600,
      project_id: project.id
    });

    const durationOnly = await user.put(`/api/timer/entries/${entry.id}`).send({ duration: 300 });
    expect(durationOnly.status).toBe(200);
    expect(durationOnly.body).toMatchObject({ duration: 300, notes: 'new notes', start_time: entry.start_time });
  });

  it('re-assigns project, task and subtask within the workspace', async () => {
    const { user, project, task } = await setup();
    const target = (await user.post('/api/projects').send({ client_id: project.client_id, name: 'Target' })).body;
    const targetTask = (await user.post('/api/tasks').send({ project_id: target.id, name: 'TT' })).body;
    const sub = (await user.post(`/api/tasks/${targetTask.id}/subtasks`).send({ title: 'TS' })).body;
    const entry = await addEntry(user, { project_id: project.id, task_id: task.id, start: '2025-01-01T10:00:00.000Z', seconds: 600 });

    const res = await user.put(`/api/timer/entries/${entry.id}`).send({
      start_time: entry.start_time,
      end_time: entry.end_time,
      project_id: target.id,
      task_id: targetTask.id,
      subtask_id: sub.id
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ project_name: 'Target', task_name: 'TT', subtask_title: 'TS' });

    const unlinked = await user.put(`/api/timer/entries/${entry.id}`).send({ start_time: entry.start_time, end_time: entry.end_time, task_id: null, subtask_id: null });
    expect(unlinked.body).toMatchObject({ project_id: target.id, task_id: null, subtask_id: null });
  });

  it('replaces intervals (update, add, drop) and rejects overlaps', async () => {
    const { user, project } = await setup();
    const entry = await addEntry(user, { project_id: project.id, start: '2025-01-01T10:00:00.000Z', seconds: 3600 });
    const [original] = (await user.get(`/api/timer/entries/${entry.id}/intervals`)).body;

    const overlap = await user.put(`/api/timer/entries/${entry.id}`).send({
      start_time: '2025-01-01T10:00:00.000Z',
      end_time: '2025-01-01T12:00:00.000Z',
      intervals: [
        { id: original.id, start_time: '2025-01-01T10:00:00.000Z', end_time: '2025-01-01T11:00:00.000Z', duration_seconds: 3600 },
        { start_time: '2025-01-01T10:30:00.000Z', end_time: '2025-01-01T11:30:00.000Z', duration_seconds: 3600 }
      ]
    });
    expect(overlap.status).toBe(400);

    const ok = await user.put(`/api/timer/entries/${entry.id}`).send({
      start_time: '2025-01-01T10:00:00.000Z',
      end_time: '2025-01-01T12:00:00.000Z',
      duration: 4500,
      intervals: [
        { id: original.id, start_time: '2025-01-01T10:00:00.000Z', end_time: '2025-01-01T10:45:00.000Z', duration_seconds: 2700 },
        { start_time: '2025-01-01T11:30:00.000Z', end_time: '2025-01-01T12:00:00.000Z', duration_seconds: 1800 }
      ]
    });
    expect(ok.status).toBe(200);
    expect(ok.body.duration).toBe(4500);
    const saved = (await user.get(`/api/timer/entries/${entry.id}/intervals`)).body;
    expect(saved.map((i) => i.duration_seconds)).toEqual([2700, 1800]);
    expect(saved[0].id).toBe(original.id);

    const dropped = await user.put(`/api/timer/entries/${entry.id}`).send({
      start_time: '2025-01-01T11:30:00.000Z',
      end_time: '2025-01-01T12:00:00.000Z',
      intervals: [{ id: saved[1].id, start_time: saved[1].start_time, end_time: saved[1].end_time, duration_seconds: 1800 }]
    });
    expect(dropped.status).toBe(200);
    expect((await user.get(`/api/timer/entries/${entry.id}/intervals`)).body.map((i) => i.id)).toEqual([saved[1].id]);
  });

  it('replaces additional associations when sent, keeps them otherwise', async () => {
    const { user, project, task } = await setup();
    const other = (await user.post('/api/projects').send({ client_id: project.client_id, name: 'Other' })).body;
    const entry = await addEntry(user, {
      project_id: project.id,
      start: '2025-01-01T10:00:00.000Z',
      seconds: 600,
      additional_associations: [{ project_id: other.id }]
    });
    const times = { start_time: entry.start_time, end_time: entry.end_time };

    const kept = await user.put(`/api/timer/entries/${entry.id}`).send({ ...times, notes: 'n' });
    expect(kept.body.additional_associations.map((a) => a.project_id)).toEqual([other.id]);

    const replaced = await user.put(`/api/timer/entries/${entry.id}`).send({ ...times, additional_associations: [{ task_id: task.id }] });
    expect(replaced.body.additional_associations.map((a) => a.task_id)).toEqual([task.id]);

    const cleared = await user.put(`/api/timer/entries/${entry.id}`).send({ ...times, additional_associations: [] });
    expect(cleared.body.additional_associations).toEqual([]);
  });
});

describe('timer - delete entries', () => {
  it('deletes the entry with its intervals', async () => {
    const { user, db, project } = await setup();
    const entry = await addEntry(user, { project_id: project.id, start: '2025-01-01T10:00:00.000Z', seconds: 600 });
    expect((await user.delete(`/api/timer/entries/${entry.id}`)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM timer_intervals WHERE time_entry_id = ?').get(entry.id).n).toBe(0);
    expect((await user.get('/api/timer/entries')).body).toEqual([]);
    expect((await user.delete(`/api/timer/entries/${entry.id}`)).status).toBe(404);
  });
});
