import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import initSqlJs from 'sql.js';

// This file runs against a real database file (the rest of the suite uses :memory:)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clockwize-db-'));
const dbFile = path.join(dir, 'clockwize.db');
process.env.CLOCKWIZE_DB_PATH = dbFile;

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

const readFromDisk = async (sql, ...params) => {
  const SQL = await initSqlJs();
  const disk = new SQL.Database(fs.readFileSync(dbFile));
  const stmt = disk.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  disk.close();
  return rows;
};

let db;

beforeAll(async () => {
  const { dbPromise } = await import('../database.js');
  db = await dbPromise;
  await nextTick();
});

describe('database file persistence', () => {
  it('creates the file with the schema and the seeded admin', async () => {
    expect(fs.existsSync(dbFile)).toBe(true);
    const admins = await readFromDisk("SELECT email FROM users WHERE email = 'admin'");
    expect(admins).toHaveLength(1);
  });

  it('gives the seeded admin a workspace on a fresh install', async () => {
    const rows = await readFromDisk(`
      SELECT wm.role FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE u.email = 'admin'
    `);
    expect(rows).toEqual([{ role: 'owner' }]);
  });

  it('coalesces the writes of one tick into a single atomic file write', async () => {
    const rename = vi.spyOn(fs, 'renameSync');
    for (let i = 0; i < 5; i++) {
      db.prepare('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)')
        .run(`u-${i}`, `persist${i}@example.com`, 'x', `Persist ${i}`);
    }
    expect(rename).not.toHaveBeenCalled();
    await nextTick();
    expect(rename).toHaveBeenCalledTimes(1);
    rename.mockRestore();

    const rows = await readFromDisk("SELECT COUNT(*) as n FROM users WHERE email LIKE 'persist%'");
    expect(rows[0].n).toBe(5);
    // No temp file left next to the database
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('flush() writes pending changes immediately', async () => {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run('Renamed', 'u-0');
    db.flush();
    const rows = await readFromDisk('SELECT name FROM users WHERE id = ?', 'u-0');
    expect(rows[0].name).toBe('Renamed');
  });

  it('keeps foreign keys enforced after a save', async () => {
    db.flush();
    expect(() => db.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)')
      .run('m-x', 'no-such-workspace', 'no-such-user', 'owner')).toThrow();
  });
});
