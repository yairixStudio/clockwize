const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');

// Local feed for the Notification Center widget and the menu-bar/Control Center control
// (desktop/widget). The widget is sandboxed and macOS won't share an App Group container
// without a provisioning profile, so it talks to the app over loopback instead:
//   GET  /widget-state   -> current timer + today/week totals + recent work
//   POST /widget-action  -> pause / resume / stop / start / toggle
// Every request needs the per-install secret baked into the widget at build time. The
// widget never sees the user's API token.
function createWidgetFeed({ port, secret, state, reloadHelper }) {
  let latest = state.snapshot();
  let lastSignature = null;
  let reloadTimer = null;
  const expectedAuth = Buffer.from(`Bearer ${secret}`);

  const toWidgetState = (snapshot) => {
    const [primary, ...others] = snapshot.timers;
    return {
      version: 1,
      updatedAt: snapshot.updatedAt,
      api: null,
      signedIn: snapshot.signedIn,
      timer: primary
        ? {
          id: primary.id,
          projectName: primary.projectName,
          taskName: primary.taskName,
          clientName: primary.clientName,
          isRunning: primary.isRunning,
          elapsedSeconds: primary.elapsedSeconds,
          ...(primary.runningSince && { runningSince: primary.runningSince })
        }
        : null,
      otherTimers: others.length,
      today: { loggedSeconds: snapshot.today.loggedSeconds ?? 0 },
      week: { loggedSeconds: snapshot.week.loggedSeconds ?? 0 },
      recent: snapshot.recent.slice(0, 3)
    };
  };

  // What the widget visibly depends on - its running clock ticks by itself
  const signature = (widgetState) => JSON.stringify([
    widgetState.signedIn,
    widgetState.timer && [widgetState.timer.id, widgetState.timer.isRunning,
      widgetState.timer.isRunning ? widgetState.timer.runningSince?.slice(0, 16) : widgetState.timer.elapsedSeconds],
    widgetState.otherTimers,
    Math.floor(widgetState.today.loggedSeconds / 60),
    Math.floor(widgetState.week.loggedSeconds / 60),
    widgetState.recent.map((r) => `${r.projectId}:${r.taskId}`)
  ]);

  const reloadWidgets = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (reloadHelper && fs.existsSync(reloadHelper)) execFile(reloadHelper, { timeout: 10000 }, () => {});
    }, 500);
  };

  state.on('change', (snapshot) => {
    latest = snapshot;
    const next = signature(toWidgetState(snapshot));
    if (next !== lastSignature) {
      lastSignature = next;
      reloadWidgets();
    }
  });

  const authorized = (req) => {
    const header = Buffer.from(String(req.headers.authorization || ''));
    return header.length === expectedAuth.length && crypto.timingSafeEqual(header, expectedAuth);
  };

  // Loopback only, and no DNS-rebinding: the Host must be our own address
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req) => new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve(null); }
    });
  });

  const runAction = async (body) => {
    const primary = latest.timers[0];
    switch (body?.action) {
      case 'pause':
      case 'resume':
      case 'stop':
        if (!body.timerId) return { error: 'חסר טיימר' };
        return state.act(body.action, body.timerId);
      case 'start':
        if (!body.projectId) return { error: 'חסר פרויקט' };
        return state.act('start', { projectId: body.projectId, taskId: body.taskId || null });
      case 'toggle':
        if (primary) return state.act(primary.isRunning ? 'pause' : 'resume', primary.id);
        if (latest.recent[0]) return state.act('start', latest.recent[0]);
        return { error: 'אין טיימר או עבודה אחרונה להתחיל' };
      default:
        return { error: 'פעולה לא מוכרת' };
    }
  };

  const server = http.createServer(async (req, res) => {
    if (!allowedHosts.has(req.headers.host) || !authorized(req)) return send(res, 403, { error: 'forbidden' });
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && url.pathname === '/widget-state') {
      return send(res, 200, toWidgetState(latest));
    }
    if (req.method === 'POST' && url.pathname === '/widget-action') {
      const result = await runAction(await readBody(req));
      if (result?.error) return send(res, 400, { error: result.error });
      return send(res, 200, toWidgetState(state.snapshot()));
    }
    return send(res, 404, { error: 'not found' });
  });

  server.on('error', (e) => console.error(`widget feed unavailable on port ${port}:`, e.message));

  return {
    start() {
      // Once listening, tell WidgetKit so placed widgets switch from their cached state to live
      server.listen(port, '127.0.0.1', reloadWidgets);
    },
    stop() {
      clearTimeout(reloadTimer);
      server.close();
    }
  };
}

module.exports = { createWidgetFeed };
