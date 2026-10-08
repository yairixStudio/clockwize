import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Runs before every test file. Points every on-disk path at a throwaway directory so
// the suite never reads or writes the real database, uploads, backups or session file.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clockwize-test-'));

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.CLOCKWIZE_DB_PATH = ':memory:';
process.env.CLOCKWIZE_SESSION_FILE = 'off';
process.env.CLOCKWIZE_UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.CLOCKWIZE_BACKUP_DIR = path.join(tmp, 'backups');
process.env.CLOCKWIZE_PORT_FILE = path.join(tmp, '.server-port');
process.env.CLOCKWIZE_CLIENT_DIST = path.join(tmp, 'no-client-build');

// The database logs every migration step; keep test output readable
if (!process.env.DEBUG_TESTS) {
  for (const level of ['log', 'info']) console[level] = () => {};
}
