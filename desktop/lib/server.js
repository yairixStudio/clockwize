const fs = require('fs');
const path = require('path');
const { utilityProcess } = require('electron');

const START_TIMEOUT_MS = 45000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function openLog(logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  try {
    if (fs.statSync(logFile).size > MAX_LOG_BYTES) fs.truncateSync(logFile, 0);
  } catch { /* first run */ }
  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  stream.write(`\n=== ${new Date().toISOString()} starting Clockwize server ===\n`);
  return stream;
}

// Starts server/index.js on Electron's bundled Node (no system Node or PATH needed).
// Resolves with { port, child }. When another Clockwize server already owns the database
// (e.g. `npm run dev`), the new one bows out and we attach to the running one: child is null.
function startServer({ projectRoot, logFile, onExit }) {
  const serverDir = path.join(projectRoot, 'server');
  const log = openLog(logFile);
  const recent = [];
  const remember = (chunk) => {
    log.write(chunk);
    recent.push(...chunk.toString().split('\n').filter(Boolean));
    recent.splice(0, Math.max(0, recent.length - 15));
  };

  const child = utilityProcess.fork(path.join(serverDir, 'index.js'), [], {
    cwd: serverDir,
    stdio: 'pipe',
    serviceName: 'Clockwize Server',
    env: { ...process.env, HOST: process.env.HOST || '127.0.0.1' }
  });
  child.stdout?.on('data', remember);
  child.stderr?.on('data', remember);

  return new Promise((resolve, reject) => {
    let settled = false;
    let alreadyRunning = null;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const fail = (message) => {
      const error = new Error(message);
      error.details = recent.join('\n');
      settle(reject, error);
    };

    const timer = setTimeout(() => {
      child.kill();
      fail('השרת לא עלה בזמן');
    }, START_TIMEOUT_MS);

    child.on('message', (msg) => {
      if (msg?.type === 'listening') settle(resolve, { port: msg.port, child });
      else if (msg?.type === 'already-running') alreadyRunning = msg;
      else if (msg?.type === 'error') fail(msg.message);
    });

    child.on('exit', (code) => {
      log.write(`=== server exited with code ${code} ===\n`);
      if (alreadyRunning?.port) {
        settle(resolve, { port: alreadyRunning.port, child: null });
      } else if (!settled) {
        fail(`השרת נעצר (קוד ${code})`);
      } else {
        onExit?.(code, recent.join('\n'));
      }
    });
  });
}

module.exports = { startServer };
