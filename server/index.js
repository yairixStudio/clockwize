import 'dotenv/config';
import fs from 'fs';
import { startBackupScheduler } from './backup.js';
import { createApp } from './app.js';
import { acquireDbLock } from './dbLock.js';
import { DB_PATH, IN_MEMORY_DB, PORT_FILE } from './paths.js';

const START_PORT = Number(process.env.PORT) || 3000;
// HOST is optional; the desktop app pins it to 127.0.0.1
const HOST = process.env.HOST || undefined;

// Tell the parent (desktop app) which port we ended up on.
// Electron's utilityProcess exposes parentPort, a plain child_process.fork exposes send().
function notifyParent(message) {
  if (process.parentPort) process.parentPort.postMessage(message);
  else if (process.send) process.send(message);
}

async function startServer() {
  // Only one server may own the database file - see dbLock.js
  const lock = IN_MEMORY_DB ? null : await acquireDbLock(DB_PATH);
  if (lock && !lock.ok) {
    console.error(`⛔ Clockwize server already running on port ${lock.port ?? '?'} (pid ${lock.pid}) with this database.`);
    console.error('   Use that one (the desktop app or another `npm run dev`), or quit it first.');
    notifyParent({ type: 'already-running', port: lock.port, pid: lock.pid });
    process.exit(3);
  }

  // Imported only after the lock is ours: opening the database runs migrations that write to it
  const { dbPromise } = await import('./database.js');
  const db = await dbPromise;
  const app = await createApp(db);

  // Start automatic backup scheduler
  startBackupScheduler();

  // Try to find an available port starting from START_PORT
  const tryPort = (port) => {
    const server = app.listen(port, HOST, () => {
      // שמירת הפורט לקובץ כדי שהקליינט יידע
      try {
        fs.writeFileSync(PORT_FILE, String(port));
      } catch (e) {
        console.error('Failed to write port file:', e.message);
      }
      lock?.setPort(port);
      console.log(`🕐 Clockwize server running on http://localhost:${port}`);
      notifyParent({ type: 'listening', port });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️  Port ${port} is busy, trying ${port + 1}...`);
        tryPort(port + 1);
      } else {
        console.error('Server error:', err);
        notifyParent({ type: 'error', message: err.message });
      }
    });
  };

  tryPort(START_PORT);
}

startServer().catch((err) => {
  console.error(err);
  notifyParent({ type: 'error', message: err.message });
  process.exit(1);
});
