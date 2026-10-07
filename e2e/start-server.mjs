// Starts an isolated Clockwize server for the Playwright suite (used by playwright.config.js webServer).
//
// Safety: every on-disk path the server knows about (database, uploads, backups, port file,
// session file) is pointed at a fresh temp directory, the session file is disabled and the
// server runs with that temp dir as its cwd, so dotenv never loads server/.env and nothing
// lands in server/clockwize.db, server/uploads, backups/, .server-port or .local-session.
//
// The server serves the built client from client/dist (single origin), so build it first:
//   cd client && npm run build
import { fork } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(ROOT, 'server', 'index.js');
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
const PORT = Number(process.env.E2E_PORT) || 4317;
const HOST = '127.0.0.1';

const fail = (message) => {
  console.error(`[e2e] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  fail('client/dist/index.html not found. Build the client first: cd client && npm run build');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clockwize-e2e-'));
const secret = () => crypto.randomBytes(32).toString('hex');

const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(PORT),
  HOST,
  JWT_SECRET: secret(),
  ENCRYPTION_SECRET: secret(),
  // dotenv must not pick up a real .env (cwd is the temp dir as well)
  DOTENV_CONFIG_PATH: path.join(tmp, '.env'),
  CLOCKWIZE_DB_PATH: path.join(tmp, 'clockwize.db'),
  CLOCKWIZE_UPLOADS_DIR: path.join(tmp, 'uploads'),
  CLOCKWIZE_BACKUP_DIR: path.join(tmp, 'backups'),
  CLOCKWIZE_PORT_FILE: path.join(tmp, '.server-port'),
  CLOCKWIZE_SESSION_FILE: 'off',
  CLOCKWIZE_CLIENT_DIST: CLIENT_DIST
};
fs.mkdirSync(env.CLOCKWIZE_UPLOADS_DIR, { recursive: true });

console.log(`[e2e] data dir: ${tmp}`);

const child = fork(SERVER_ENTRY, [], { cwd: tmp, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });

let cleanedUp = false;
const cleanup = () => {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // best effort
  }
};

const childRunning = () => child.exitCode === null && child.signalCode === null;

// Exit code this runner should report once the server is gone (null = mirror the server's)
let requestedExitCode = null;
const stop = (code) => {
  requestedExitCode = code;
  if (!childRunning()) {
    cleanup();
    process.exit(code);
  }
  child.kill('SIGTERM');
  setTimeout(() => childRunning() && child.kill('SIGKILL'), 4000).unref();
};

child.on('message', (message) => {
  if (message?.type === 'listening') {
    // index.js silently moves to the next port when ours is taken - the suite would then
    // hit whatever else is listening on PORT, so refuse to run instead
    if (message.port !== PORT) {
      console.error(`[e2e] port ${PORT} is busy (server moved to ${message.port}). Free it and retry.`);
      stop(1);
      return;
    }
    console.log(`[e2e] server ready on http://${HOST}:${PORT}`);
  } else if (message?.type === 'already-running' || message?.type === 'error') {
    console.error(`[e2e] server failed to start: ${JSON.stringify(message)}`);
    stop(1);
  }
});

// The server never exits on its own while healthy; if it does, take the runner down with it
child.on('exit', (code, signal) => {
  if (requestedExitCode === null && code) console.error(`[e2e] server exited with code ${code}`);
  cleanup();
  process.exit(requestedExitCode ?? code ?? (signal ? 0 : 1));
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => stop(0));
}
process.on('exit', () => {
  if (childRunning()) child.kill('SIGKILL');
  cleanup();
});
