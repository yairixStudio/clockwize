const fs = require('fs');
const http = require('http');
const { EventEmitter } = require('events');

const TIMERS_POLL_MS = 10000;
const SUMMARY_POLL_MS = 60000;
const SESSION_CHECK_MS = 3000;

// Single source of truth for the menu-bar popover, the tray title, the Dock menu and the
// Notification Center widget. Reads the session the server writes on every login (browser
// or app window) and talks to the regular REST API. Emits 'change' with a plain snapshot.
function createTimerState({ getPort, getSessionFile }) {
  const events = new EventEmitter();
  let session = null;
  let sessionMtime = 0;
  let timers = [];
  let summary = null;
  let serverUp = false;
  let lastError = null;
  let busy = false;
  let lastSummaryAt = 0;
  let announcedToken = null;
  const intervals = [];

  const request = (method, endpoint, body = null) => new Promise((resolve, reject) => {
    const port = getPort();
    if (!port) return reject(Object.assign(new Error('השרת עדיין עולה'), { code: 'NO_SERVER' }));
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: `/api${endpoint}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(session?.token && { Authorization: `Bearer ${session.token}` }),
        ...(session?.workspaceId && { 'X-Workspace-Id': session.workspaceId })
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { /* not JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(Object.assign(new Error(json?.error || `HTTP ${res.statusCode}`), { status: res.statusCode }));
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });

  const loadSession = () => {
    try {
      const file = getSessionFile();
      const { mtimeMs } = fs.statSync(file);
      if (mtimeMs === sessionMtime) return false;
      sessionMtime = mtimeMs;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data?.token) return false;
      session = { token: data.token, workspaceId: data.workspaceId };
      return true;
    } catch {
      return false;
    }
  };

  const elapsedSeconds = (timer) => {
    let elapsed = timer.accumulated_seconds || 0;
    if (timer.is_running && timer.start_time) {
      elapsed += Math.max(0, Math.floor((Date.now() - new Date(timer.start_time).getTime()) / 1000));
    }
    return elapsed;
  };

  const snapshot = () => {
    const now = Date.now();
    const list = timers.map((timer) => {
      const elapsed = elapsedSeconds(timer);
      return {
        id: timer.id,
        projectId: timer.project_id,
        taskId: timer.task_id,
        projectName: timer.project_name || 'פרויקט',
        taskName: timer.task_name || null,
        clientName: timer.client_name || null,
        isRunning: Boolean(timer.is_running),
        elapsedSeconds: elapsed,
        runningSince: timer.is_running ? new Date(now - elapsed * 1000).toISOString() : null
      };
    });
    const runningExtra = list.reduce((sum, t) => sum + t.elapsedSeconds, 0);
    return {
      updatedAt: new Date(now).toISOString(),
      serverUp,
      signedIn: Boolean(session),
      busy,
      error: lastError,
      timers: list,
      today: { loggedSeconds: summary?.today?.seconds ?? null, withTimersSeconds: summary ? summary.today.seconds + runningExtra : null },
      week: { loggedSeconds: summary?.week?.seconds ?? null, withTimersSeconds: summary ? summary.week.seconds + runningExtra : null },
      recent: (summary?.recent || []).map((r) => ({
        projectId: r.project_id,
        taskId: r.task_id,
        projectName: r.project_name,
        taskName: r.task_name,
        clientName: r.client_name
      })),
      api: session && getPort()
        ? { baseUrl: `http://127.0.0.1:${getPort()}/api`, token: session.token, workspaceId: session.workspaceId }
        : null
    };
  };

  const emit = () => events.emit('change', snapshot());

  async function refresh({ withSummary = false } = {}) {
    if (!session) {
      timers = [];
      summary = null;
      serverUp = Boolean(getPort());
      emit();
      return;
    }
    try {
      const result = await request('GET', '/timer/active');
      timers = Array.isArray(result) ? result : [];
      serverUp = true;
      lastError = null;
      // A login (browser or window) produced a working session - let the app adopt it
      if (session && session.token !== announcedToken) {
        announcedToken = session.token;
        events.emit('session', { ...session });
      }
      if (withSummary || Date.now() - lastSummaryAt > SUMMARY_POLL_MS) {
        summary = await request('GET', '/desktop/summary').catch(() => summary);
        lastSummaryAt = Date.now();
      }
    } catch (e) {
      if (e.status === 401) {
        session = null; // token expired - wait for the next login
      } else {
        serverUp = false;
      }
    }
    emit();
  }

  const actions = {
    pause: (id) => request('POST', `/timer/pause/${id}`),
    resume: (id) => request('POST', `/timer/resume/${id}`),
    stop: (id) => request('POST', `/timer/stop/${id}`, { notes: '' }),
    discard: (id) => request('DELETE', `/timer/discard/${id}`),
    start: ({ projectId, taskId }) => request('POST', '/timer/start', { project_id: projectId, task_id: taskId || null })
  };

  async function act(name, payload) {
    if (!actions[name] || busy) return { ok: false };
    busy = true;
    lastError = null;
    emit();
    try {
      await actions[name](payload);
      return { ok: true };
    } catch (e) {
      lastError = e.message;
      return { ok: false, error: e.message };
    } finally {
      busy = false;
      await refresh({ withSummary: true });
      events.emit('acted', name);
    }
  }

  return {
    on: (...args) => events.on(...args),
    snapshot,
    refresh,
    act,
    start() {
      loadSession();
      refresh({ withSummary: true });
      intervals.push(setInterval(() => refresh(), TIMERS_POLL_MS));
      intervals.push(setInterval(() => { if (loadSession()) refresh({ withSummary: true }); }, SESSION_CHECK_MS));
    },
    stop() {
      intervals.forEach(clearInterval);
      intervals.length = 0;
    }
  };
}

module.exports = { createTimerState };
