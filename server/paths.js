import path from 'path';
import { fileURLToPath } from 'url';

// Every on-disk location the server uses. Each one can be overridden by an env variable,
// so the desktop app and the test suite can point the server at a chosen data directory
// instead of the files that sit next to the source code.
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(SERVER_DIR, '..');

const fromEnv = (name, fallback) => process.env[name] || fallback;

// ':memory:' keeps the database in RAM only (used by the tests)
export const DB_PATH = fromEnv('CLOCKWIZE_DB_PATH', path.join(SERVER_DIR, 'clockwize.db'));
export const IN_MEMORY_DB = DB_PATH === ':memory:';
export const UPLOADS_DIR = fromEnv('CLOCKWIZE_UPLOADS_DIR', path.join(SERVER_DIR, 'uploads'));
export const BACKUP_DIR = fromEnv('CLOCKWIZE_BACKUP_DIR', path.join(ROOT_DIR, 'backups'));
export const PORT_FILE = fromEnv('CLOCKWIZE_PORT_FILE', path.join(ROOT_DIR, '.server-port'));
export const LOCAL_SESSION_FILE = fromEnv('CLOCKWIZE_SESSION_FILE', path.join(ROOT_DIR, '.local-session'));
export const CLIENT_DIST_DIR = fromEnv('CLOCKWIZE_CLIENT_DIST', path.join(ROOT_DIR, 'client', 'dist'));
