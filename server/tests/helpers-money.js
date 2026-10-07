import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createUser, createClientProjectTask } from './helpers.js';

// Extra helpers for the money / sharing / secrets suites. Kept apart from helpers.js,
// which other suites share.

// Adds an existing user to another user's workspace (bypasses the invite flow)
export function addMember(owner, member, role = 'member') {
  owner.db.prepare(`
    INSERT INTO workspace_members (id, workspace_id, user_id, role)
    VALUES (?, ?, ?, ?)
  `).run(uuidv4(), owner.workspaceId, member.user.id, role);
}

// Two unrelated users, each with their own client -> project -> task chain
export async function twoWorkspaces() {
  const alice = await createUser({ name: 'Alice' });
  const bob = await createUser({ name: 'Bob' });
  const a = await createClientProjectTask(alice);
  const b = await createClientProjectTask(bob);
  return { alice, bob, a, b };
}

// Writes a finished time entry straight to the DB
export function insertTimeEntry(user, { project_id, task_id = null, duration = 3600, start_time } = {}) {
  const id = uuidv4();
  const start = start_time || new Date(Date.now() - duration * 1000).toISOString();
  user.db.prepare(`
    INSERT INTO time_entries (id, user_id, workspace_id, project_id, task_id, start_time, end_time, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, user.user.id, user.workspaceId, project_id, task_id, start, new Date().toISOString(), duration);
  return id;
}

// Shape of a value produced by utils/crypto.js encrypt(): iv:ciphertext:tag, all hex
export const ENCRYPTED_SHAPE = /^[0-9a-f]{32}:[0-9a-f]+:[0-9a-f]{32}$/;

// Re-implements the pre-migration encryption (hard-coded secret) so legacy rows can be faked
export const LEGACY_SECRET = 'clockwize-secret-key-change-in-production';

export function legacyEncrypt(text, salt, secret = LEGACY_SECRET) {
  const key = crypto.pbkdf2Sync(secret, String(salt), 100000, 32, 'sha256');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return `${iv.toString('hex')}:${enc}:${cipher.getAuthTag().toString('hex')}`;
}

// Pulls "name=value" for one cookie out of a supertest response
export function cookieFrom(res, prefix) {
  const raw = [].concat(res.headers['set-cookie'] || []);
  const line = raw.find(c => c.startsWith(prefix));
  return line ? { pair: line.split(';')[0], line } : null;
}
