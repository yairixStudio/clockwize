import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware, canInviteMembers, canRemoveMember, canManageWorkspace } from '../middleware/auth.js';
import { UPLOADS_DIR } from '../paths.js';

const router = Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// ===== Deleting workspaces and accounts =====
// Data belongs to the workspace: deleting a workspace deletes everything in it, and deleting an
// account deletes the workspaces nobody else uses while the records the user created in shared
// workspaces stay there, handed to the workspace owner (or another remaining member).

// Runs fn as one transaction. fn must be synchronous: the database file is written on a later
// tick (save() -> setImmediate), and writing it (export()) would end an open transaction.
function inTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* nothing to roll back */ }
    throw error;
  }
}

const tablesWithColumn = (db, column) => db.prepare(`
  SELECT m.name FROM sqlite_master m
  WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
    AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = ?)
`).all(column).map(row => row.name);

// Deletes a workspace and every row that belongs to it. workspace_id on the data tables is a plain
// column without a foreign key, so each table is cleared explicitly (children go with their parents
// through the ON DELETE CASCADE keys). Returns the stored file names to remove from disk afterwards.
function deleteWorkspaceRows(db, workspaceId) {
  const storedFiles = db.prepare('SELECT storage_path FROM files WHERE workspace_id = ?').all(workspaceId)
    .map(file => file.storage_path);
  for (const table of tablesWithColumn(db, 'workspace_id')) {
    db.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).run(workspaceId);
  }
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  return storedFiles;
}

// Removes uploaded files whose database rows are gone (only once the deletion is committed)
function removeStoredFiles(db, storedFiles) {
  for (const name of storedFiles) {
    if (!name) continue;
    try {
      if (db.prepare('SELECT 1 FROM files WHERE storage_path = ?').get(name)) continue;
      const filePath = path.join(UPLOADS_DIR, path.basename(name));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
      console.error('Failed to remove uploaded file:', error.message);
    }
  }
}

export function deleteWorkspace(db, workspaceId) {
  const storedFiles = inTransaction(db, () => deleteWorkspaceRows(db, workspaceId));
  removeStoredFiles(db, storedFiles);
}

// The member who takes over a departing user's records in a workspace: the owner first, then
// admins, then members, earliest joined first. `scope` is the SQL expression for the workspace id.
const heirOf = (scope) => `
  SELECT wm.user_id FROM workspace_members wm
  WHERE wm.workspace_id = ${scope} AND wm.user_id != ?
  ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, wm.joined_at, wm.id
  LIMIT 1
`;

// Per-user state that leaves with the account instead of being handed over
const PERSONAL_TABLES = ['workspace_members', 'active_timers', 'planned_slots'];

export function deleteUserAccount(db, userId) {
  const storedFiles = inTransaction(db, () => {
    const removedFiles = [];

    // 1. Workspaces nobody else is a member of go away with all their data
    const soleWorkspaces = db.prepare(`
      SELECT w.id FROM workspaces w
      WHERE (w.created_by = ? OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id = ?))
        AND NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id != ?)
    `).all(userId, userId, userId);
    for (const { id } of soleWorkspaces) {
      removedFiles.push(...deleteWorkspaceRows(db, id));
    }

    // 2. A shared workspace the user owns gets a new owner (admins first, then members)
    const owned = db.prepare(`SELECT workspace_id FROM workspace_members WHERE user_id = ? AND role = 'owner'`).all(userId);
    for (const { workspace_id: workspaceId } of owned) {
      const heir = db.prepare(heirOf('?')).get(workspaceId, userId);
      if (heir) {
        db.prepare(`UPDATE workspace_members SET role = 'owner' WHERE workspace_id = ? AND user_id = ?`).run(workspaceId, heir.user_id);
      }
    }
    // workspaces.created_by is ON DELETE CASCADE - without this the shared workspace would be deleted
    db.prepare(`
      UPDATE workspaces SET created_by = (${heirOf('workspaces.id')})
      WHERE created_by = ? AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = workspaces.id AND wm.user_id != ?)
    `).run(userId, userId, userId);

    // 3. Everything they created in workspaces that stay is handed over (user_id is ON DELETE CASCADE)
    const handOver = tablesWithColumn(db, 'user_id')
      .filter(table => !PERSONAL_TABLES.includes(table) && db.columnExists(table, 'workspace_id'))
      .map(table => [table, 'user_id']);
    handOver.push(['shared_links', 'owner_id'], ['workspace_invites', 'created_by']);
    for (const [table, column] of handOver) {
      if (!db.columnExists(table, column) || !db.columnExists(table, 'workspace_id')) continue;
      // Unique keys here are per workspace (e.g. integrations is UNIQUE(workspace_id, provider)), so
      // changing user_id cannot collide; anything that still does fails the whole deletion (rolled back)
      db.prepare(`
        UPDATE ${table} SET ${column} = (${heirOf(`${table}.workspace_id`)})
        WHERE ${column} = ? AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = ${table}.workspace_id AND wm.user_id != ?)
      `).run(userId, userId, userId);
    }

    // 4. The account itself; personal rows (memberships, running timers, planned slots, passkeys,
    // read markers) go with it through ON DELETE CASCADE
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return removedFiles;
  });
  removeStoredFiles(db, storedFiles);
}

// Helper to generate a slug from name
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05FF]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50) + '-' + uuidv4().substring(0, 8);
};

// Get all workspaces for current user
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const workspaces = db.prepare(`
      SELECT w.*, wm.role,
        (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY wm.joined_at ASC
    `).all(req.userId);

    res.json(workspaces);
  } catch (error) {
    console.error('Get workspaces error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת workspaces' });
  }
});

// Get current workspace details
router.get('/current', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const workspace = db.prepare(`
      SELECT w.*, 
        (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count
      FROM workspaces w
      WHERE w.id = ?
    `).get(req.workspaceId);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace לא נמצא' });
    }

    workspace.role = req.workspaceRole;
    res.json(workspace);
  } catch (error) {
    console.error('Get current workspace error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת workspace' });
  }
});

// Create a new workspace
router.post('/', authMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { name } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'שם workspace נדרש' });
    }

    const id = uuidv4();
    const slug = generateSlug(name);

    // Create workspace
    db.prepare(`
      INSERT INTO workspaces (id, name, slug, created_by)
      VALUES (?, ?, ?, ?)
    `).run(id, name.trim(), slug, req.userId);

    // Add creator as owner
    db.prepare(`
      INSERT INTO workspace_members (id, workspace_id, user_id, role)
      VALUES (?, ?, ?, 'owner')
    `).run(uuidv4(), id, req.userId);

    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    workspace.role = 'owner';
    workspace.member_count = 1;

    res.status(201).json(workspace);
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת workspace' });
  }
});

// Update workspace
router.put('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { name } = req.body;

    if (req.params.id !== req.workspaceId) {
      return res.status(403).json({ error: 'אין גישה לworkspace זה' });
    }

    if (!canManageWorkspace(req)) {
      return res.status(403).json({ error: 'אין לך הרשאה לערוך workspace זה' });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'שם workspace נדרש' });
    }

    db.prepare(`
      UPDATE workspaces SET name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name.trim(), req.workspaceId);

    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.workspaceId);
    workspace.role = req.workspaceRole;
    
    res.json(workspace);
  } catch (error) {
    console.error('Update workspace error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון workspace' });
  }
});

// Delete workspace (owner only)
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    if (req.params.id !== req.workspaceId) {
      return res.status(403).json({ error: 'אין גישה לworkspace זה' });
    }

    if (req.workspaceRole !== 'owner') {
      return res.status(403).json({ error: 'רק הבעלים יכול למחוק workspace' });
    }

    // Check if user has other workspaces
    const otherWorkspaces = db.prepare(`
      SELECT COUNT(*) as count FROM workspace_members WHERE user_id = ? AND workspace_id != ?
    `).get(req.userId, req.workspaceId);

    if (otherWorkspaces.count === 0) {
      return res.status(400).json({ error: 'לא ניתן למחוק את ה-workspace היחיד שלך' });
    }

    // Delete the workspace with all of its data (workspace_id has no foreign key, so no CASCADE)
    deleteWorkspace(db, req.workspaceId);

    res.json({ message: 'Workspace נמחק בהצלחה' });
  } catch (error) {
    console.error('Delete workspace error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת workspace' });
  }
});

// Get workspace members
router.get('/:id/members', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    if (req.params.id !== req.workspaceId) {
      return res.status(403).json({ error: 'אין גישה לworkspace זה' });
    }

    const members = db.prepare(`
      SELECT wm.id, wm.role, wm.joined_at,
        u.id as user_id, u.name, u.email
      FROM workspace_members wm
      JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = ?
      ORDER BY 
        CASE wm.role 
          WHEN 'owner' THEN 1 
          WHEN 'admin' THEN 2 
          ELSE 3 
        END,
        wm.joined_at ASC
    `).all(req.workspaceId);

    res.json(members);
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת חברי הצוות' });
  }
});

// Update member role
router.put('/:id/members/:memberId', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { role } = req.body;

    if (req.params.id !== req.workspaceId) {
      return res.status(403).json({ error: 'אין גישה לworkspace זה' });
    }

    if (!canManageWorkspace(req)) {
      return res.status(403).json({ error: 'אין לך הרשאה לשנות תפקידים' });
    }

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'תפקיד לא תקין' });
    }

    const member = db.prepare('SELECT * FROM workspace_members WHERE id = ?').get(req.params.memberId);
    
    if (!member || member.workspace_id !== req.workspaceId) {
      return res.status(404).json({ error: 'חבר צוות לא נמצא' });
    }

    if (member.role === 'owner') {
      return res.status(403).json({ error: 'לא ניתן לשנות תפקיד של בעלים' });
    }

    // Admin can't promote to admin
    if (req.workspaceRole === 'admin' && role === 'admin') {
      return res.status(403).json({ error: 'רק הבעלים יכול למנות מנהלים' });
    }

    // ...nor demote a fellow admin (that would side-step the rule that admins remove members only)
    if (req.workspaceRole === 'admin' && member.role === 'admin') {
      return res.status(403).json({ error: 'רק הבעלים יכול לשנות תפקיד של מנהל' });
    }

    db.prepare('UPDATE workspace_members SET role = ? WHERE id = ?').run(role, req.params.memberId);

    res.json({ message: 'תפקיד עודכן בהצלחה' });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון תפקיד' });
  }
});

// Remove member from workspace
router.delete('/:id/members/:memberId', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    if (req.params.id !== req.workspaceId) {
      return res.status(403).json({ error: 'אין גישה לworkspace זה' });
    }

    const member = db.prepare('SELECT * FROM workspace_members WHERE id = ?').get(req.params.memberId);
    
    if (!member || member.workspace_id !== req.workspaceId) {
      return res.status(404).json({ error: 'חבר צוות לא נמצא' });
    }

    // Can't remove owner
    if (member.role === 'owner') {
      return res.status(403).json({ error: 'לא ניתן להסיר את בעלי ה-workspace' });
    }

    // Check permissions
    if (!canRemoveMember(req, member.role)) {
      return res.status(403).json({ error: 'אין לך הרשאה להסיר חבר צוות זה' });
    }

    db.prepare('DELETE FROM workspace_members WHERE id = ?').run(req.params.memberId);

    res.json({ message: 'חבר צוות הוסר בהצלחה' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'שגיאה בהסרת חבר צוות' });
  }
});

// Leave workspace (for non-owners)
router.post('/:id/leave', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    if (req.params.id !== req.workspaceId) {
      return res.status(403).json({ error: 'אין גישה לworkspace זה' });
    }

    if (req.workspaceRole === 'owner') {
      return res.status(403).json({ error: 'בעלים לא יכול לעזוב. יש למחוק את ה-workspace או להעביר בעלות' });
    }

    db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(req.workspaceId, req.userId);

    res.json({ message: 'עזבת את ה-workspace בהצלחה' });
  } catch (error) {
    console.error('Leave workspace error:', error);
    res.status(500).json({ error: 'שגיאה בעזיבת workspace' });
  }
});

// === Invitation Management ===

// Get workspace invites
router.get('/:id/invites', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    if (req.params.id !== req.workspaceId) {
      return res.status(403).json({ error: 'אין גישה לworkspace זה' });
    }

    if (!canManageWorkspace(req)) {
      return res.status(403).json({ error: 'אין לך הרשאה לצפות בהזמנות' });
    }

    const invites = db.prepare(`
      SELECT wi.*, u.name as created_by_name
      FROM workspace_invites wi
      JOIN users u ON u.id = wi.created_by
      WHERE wi.workspace_id = ?
      ORDER BY wi.created_at DESC
    `).all(req.workspaceId);

    res.json(invites);
  } catch (error) {
    console.error('Get invites error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הזמנות' });
  }
});

// Create invite link
router.post('/:id/invites', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { role = 'member', expires_in_days, max_uses } = req.body;

    if (req.params.id !== req.workspaceId) {
      return res.status(403).json({ error: 'אין גישה לworkspace זה' });
    }

    if (!canInviteMembers(req)) {
      return res.status(403).json({ error: 'אין לך הרשאה ליצור הזמנות' });
    }

    // Only owner can create admin invites
    if (role === 'admin' && req.workspaceRole !== 'owner') {
      return res.status(403).json({ error: 'רק הבעלים יכול להזמין מנהלים' });
    }

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'תפקיד לא תקין' });
    }

    const id = uuidv4();
    const token = uuidv4();
    
    let expires_at = null;
    if (expires_in_days) {
      const date = new Date();
      date.setDate(date.getDate() + parseInt(expires_in_days));
      expires_at = date.toISOString();
    }

    db.prepare(`
      INSERT INTO workspace_invites (id, workspace_id, token, role, expires_at, max_uses, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.workspaceId, token, role, expires_at, max_uses || null, req.userId);

    const invite = db.prepare('SELECT * FROM workspace_invites WHERE id = ?').get(id);

    res.status(201).json(invite);
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת הזמנה' });
  }
});

// Delete invite
router.delete('/:id/invites/:inviteId', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    if (req.params.id !== req.workspaceId) {
      return res.status(403).json({ error: 'אין גישה לworkspace זה' });
    }

    if (!canManageWorkspace(req)) {
      return res.status(403).json({ error: 'אין לך הרשאה למחוק הזמנות' });
    }

    const result = db.prepare('DELETE FROM workspace_invites WHERE id = ? AND workspace_id = ?').run(req.params.inviteId, req.workspaceId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'הזמנה לא נמצאה' });
    }

    res.json({ message: 'הזמנה נמחקה בהצלחה' });
  } catch (error) {
    console.error('Delete invite error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת הזמנה' });
  }
});

// === Public invite endpoints (no auth required for info, auth required for join) ===

// Get invite info (public)
router.get('/invite/:token', (req, res) => {
  try {
    const db = getDb(req);
    
    const invite = db.prepare(`
      SELECT wi.id, wi.role, wi.expires_at, wi.max_uses, wi.used_count, wi.is_active,
        w.id as workspace_id, w.name as workspace_name,
        u.name as inviter_name
      FROM workspace_invites wi
      JOIN workspaces w ON w.id = wi.workspace_id
      JOIN users u ON u.id = wi.created_by
      WHERE wi.token = ?
    `).get(req.params.token);

    if (!invite) {
      return res.status(404).json({ error: 'קישור הזמנה לא תקין' });
    }

    if (!invite.is_active) {
      return res.status(410).json({ error: 'קישור הזמנה לא פעיל' });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'קישור הזמנה פג תוקף' });
    }

    if (invite.max_uses && invite.used_count >= invite.max_uses) {
      return res.status(410).json({ error: 'קישור הזמנה מוצה' });
    }

    res.json({
      workspace_name: invite.workspace_name,
      inviter_name: invite.inviter_name,
      role: invite.role
    });
  } catch (error) {
    console.error('Get invite info error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת פרטי הזמנה' });
  }
});

// Join workspace via invite link
router.post('/join/:token', authMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    const invite = db.prepare(`
      SELECT wi.*, w.name as workspace_name
      FROM workspace_invites wi
      JOIN workspaces w ON w.id = wi.workspace_id
      WHERE wi.token = ?
    `).get(req.params.token);

    if (!invite) {
      return res.status(404).json({ error: 'קישור הזמנה לא תקין' });
    }

    if (!invite.is_active) {
      return res.status(410).json({ error: 'קישור הזמנה לא פעיל' });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'קישור הזמנה פג תוקף' });
    }

    if (invite.max_uses && invite.used_count >= invite.max_uses) {
      return res.status(410).json({ error: 'קישור הזמנה מוצה' });
    }

    // Check if already a member
    const existingMember = db.prepare(`
      SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?
    `).get(invite.workspace_id, req.userId);

    if (existingMember) {
      return res.status(400).json({ error: 'אתה כבר חבר ב-workspace זה' });
    }

    // Add user to workspace
    db.prepare(`
      INSERT INTO workspace_members (id, workspace_id, user_id, role)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), invite.workspace_id, req.userId, invite.role);

    // Increment used count
    db.prepare('UPDATE workspace_invites SET used_count = used_count + 1 WHERE id = ?').run(invite.id);

    res.json({
      message: 'הצטרפת בהצלחה!',
      workspace_id: invite.workspace_id,
      workspace_name: invite.workspace_name,
      role: invite.role
    });
  } catch (error) {
    console.error('Join workspace error:', error);
    res.status(500).json({ error: 'שגיאה בהצטרפות ל-workspace' });
  }
});

export default router;

