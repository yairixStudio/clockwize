import fs from 'fs';

// sql.js keeps the whole database in memory and rewrites the file on every save, so two
// servers on the same file would silently overwrite each other's changes. A lock file next
// to the database makes sure only one server (desktop app or `npm run dev`) owns it.

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

const answersHealth = async (port) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return body?.status === 'ok';
  } catch {
    return false;
  }
};

const readLock = (lockPath) => {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
};

// Resolves to { ok: true } once the lock is ours, or { ok: false, pid, port } when another
// live server holds it. A lock left behind by a crashed server is taken over.
export async function acquireDbLock(dbPath) {
  const lockPath = `${dbPath}.lock`;
  const existing = readLock(lockPath);

  if (existing && existing.pid !== process.pid && isAlive(existing.pid)) {
    // A recorded port that no longer answers means the pid was recycled by another process
    if (!existing.port || await answersHealth(existing.port)) {
      return { ok: false, pid: existing.pid, port: existing.port };
    }
  }

  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  const release = () => {
    if (readLock(lockPath)?.pid === process.pid) {
      try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
    }
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => process.exit(0));
  }

  return {
    ok: true,
    setPort: (port) => {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }));
    }
  };
}
