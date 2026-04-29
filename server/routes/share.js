import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Create a new shared link
router.post('/', authMiddleware, workspaceMiddleware, async (req, res) => {
  try {
    const db = getDb(req);
    const { 
      resource_type, // 'client' or 'project'
      resource_id,
      share_type = 'public', // 'public', 'password', 'email'
      password,
      allowed_email,
      name,
      expires_at
    } = req.body;

    // Validate resource exists and belongs to workspace
    let resource;
    if (resource_type === 'client') {
      resource = db.prepare('SELECT * FROM clients WHERE id = ? AND workspace_id = ?').get(resource_id, req.workspaceId);
    } else if (resource_type === 'project') {
      resource = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').get(resource_id, req.workspaceId);
    }

    if (!resource) {
      return res.status(404).json({ error: 'משאב לא נמצא' });
    }

    const id = uuidv4();
    const shareToken = uuidv4();
    
    // Hash password if provided
    let hashedPassword = null;
    if (share_type === 'password' && password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Normalize email if provided
    const normalizedEmail = allowed_email ? allowed_email.toLowerCase().trim() : null;

    db.prepare(`
      INSERT INTO shared_links (id, owner_id, workspace_id, resource_type, resource_id, share_token, share_type, share_password, allowed_email, name, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.userId, req.workspaceId, resource_type, resource_id, shareToken, share_type, hashedPassword, normalizedEmail, name || null, expires_at || null);

    const link = db.prepare('SELECT * FROM shared_links WHERE id = ?').get(id);
    
    // Don't return the password hash
    delete link.share_password;
    
    res.status(201).json(link);
  } catch (error) {
    console.error('Create shared link error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת הלינק' });
  }
});

// Get all shared links owned by workspace
router.get('/my-links', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const links = db.prepare(`
      SELECT sl.*, 
        CASE 
          WHEN sl.resource_type = 'client' THEN (SELECT name FROM clients WHERE id = sl.resource_id)
          WHEN sl.resource_type = 'project' THEN (SELECT name FROM projects WHERE id = sl.resource_id)
        END as resource_name
      FROM shared_links sl
      WHERE sl.workspace_id = ?
      ORDER BY sl.created_at DESC
    `).all(req.workspaceId);

    // Don't return password hashes
    links.forEach(link => delete link.share_password);

    res.json(links);
  } catch (error) {
    console.error('Get my links error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הלינקים' });
  }
});

// Get shared links shared with the current user (by email)
router.get('/shared-with-me', authMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    // Get user's email
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }

    const links = db.prepare(`
      SELECT sl.*, 
        CASE 
          WHEN sl.resource_type = 'client' THEN (SELECT name FROM clients WHERE id = sl.resource_id)
          WHEN sl.resource_type = 'project' THEN (SELECT name FROM projects WHERE id = sl.resource_id)
        END as resource_name,
        u.name as owner_name
      FROM shared_links sl
      JOIN users u ON sl.owner_id = u.id
      WHERE sl.allowed_email = ? AND sl.is_active = 1
      ORDER BY sl.created_at DESC
    `).all(user.email.toLowerCase());

    // Don't return password hashes
    links.forEach(link => delete link.share_password);

    res.json(links);
  } catch (error) {
    console.error('Get shared with me error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הלינקים' });
  }
});

// Update a shared link
router.put('/:id', authMiddleware, workspaceMiddleware, async (req, res) => {
  try {
    const db = getDb(req);
    const { share_type, password, allowed_email, name, is_active, expires_at } = req.body;

    const existing = db.prepare('SELECT * FROM shared_links WHERE id = ? AND workspace_id = ?').get(req.params.id, req.workspaceId);
    if (!existing) {
      return res.status(404).json({ error: 'לינק לא נמצא' });
    }

    // Hash password if provided
    let hashedPassword = existing.share_password;
    if (share_type === 'password' && password) {
      hashedPassword = await bcrypt.hash(password, 10);
    } else if (share_type !== 'password') {
      hashedPassword = null;
    }

    // Normalize email if provided
    const normalizedEmail = allowed_email ? allowed_email.toLowerCase().trim() : null;

    db.prepare(`
      UPDATE shared_links 
      SET share_type = ?, share_password = ?, allowed_email = ?, name = ?, is_active = ?, expires_at = ?
      WHERE id = ? AND workspace_id = ?
    `).run(
      share_type || existing.share_type,
      hashedPassword,
      normalizedEmail,
      name !== undefined ? name : existing.name,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      expires_at !== undefined ? expires_at : existing.expires_at,
      req.params.id,
      req.workspaceId
    );

    const link = db.prepare('SELECT * FROM shared_links WHERE id = ?').get(req.params.id);
    delete link.share_password;

    res.json(link);
  } catch (error) {
    console.error('Update shared link error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הלינק' });
  }
});

// Delete a shared link
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const result = db.prepare('DELETE FROM shared_links WHERE id = ? AND workspace_id = ?').run(req.params.id, req.workspaceId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'לינק לא נמצא' });
    }

    res.json({ message: 'הלינק נמחק בהצלחה' });
  } catch (error) {
    console.error('Delete shared link error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת הלינק' });
  }
});

// Get shared link info (public - for access page)
router.get('/info/:token', (req, res) => {
  try {
    const db = getDb(req);
    const link = db.prepare(`
      SELECT sl.id, sl.share_type, sl.resource_type, sl.name, sl.is_active, sl.expires_at,
        CASE 
          WHEN sl.resource_type = 'client' THEN (SELECT name FROM clients WHERE id = sl.resource_id)
          WHEN sl.resource_type = 'project' THEN (SELECT name FROM projects WHERE id = sl.resource_id)
        END as resource_name,
        u.name as owner_name
      FROM shared_links sl
      JOIN users u ON sl.owner_id = u.id
      WHERE sl.share_token = ?
    `).get(req.params.token);

    if (!link) {
      return res.status(404).json({ error: 'לינק לא נמצא' });
    }

    // Check if link is active
    if (!link.is_active) {
      return res.status(403).json({ error: 'הלינק לא פעיל', inactive: true });
    }

    // Check expiration
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(403).json({ error: 'הלינק פג תוקף', expired: true });
    }

    res.json(link);
  } catch (error) {
    console.error('Get shared link info error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הלינק' });
  }
});

// Verify password for password-protected link
router.post('/verify-password/:token', async (req, res) => {
  try {
    const db = getDb(req);
    const { password } = req.body;

    const link = db.prepare('SELECT * FROM shared_links WHERE share_token = ?').get(req.params.token);

    if (!link) {
      return res.status(404).json({ error: 'לינק לא נמצא' });
    }

    if (!link.is_active) {
      return res.status(403).json({ error: 'הלינק לא פעיל' });
    }

    if (link.share_type !== 'password') {
      return res.status(400).json({ error: 'לינק זה לא מוגן בסיסמא' });
    }

    const isValid = await bcrypt.compare(password, link.share_password);
    if (!isValid) {
      return res.status(401).json({ error: 'סיסמא שגויה' });
    }

    // Return access token for this session
    const accessToken = uuidv4();
    
    // Log access
    db.prepare(`
      INSERT INTO shared_link_access (id, shared_link_id, created_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(uuidv4(), link.id);

    res.json({ 
      success: true, 
      access_token: accessToken,
      resource_type: link.resource_type,
      resource_id: link.resource_id
    });
  } catch (error) {
    console.error('Verify password error:', error);
    res.status(500).json({ error: 'שגיאה באימות' });
  }
});

// Verify email access (for logged-in users)
router.post('/verify-email/:token', authMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    const link = db.prepare('SELECT * FROM shared_links WHERE share_token = ?').get(req.params.token);

    if (!link) {
      return res.status(404).json({ error: 'לינק לא נמצא' });
    }

    if (!link.is_active) {
      return res.status(403).json({ error: 'הלינק לא פעיל' });
    }

    if (link.share_type !== 'email') {
      return res.status(400).json({ error: 'לינק זה לא מוגבל למייל' });
    }

    // Get user's email
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.userId);
    
    if (user.email.toLowerCase() !== link.allowed_email.toLowerCase()) {
      return res.status(403).json({ error: 'אין לך הרשאה לצפות בלינק זה' });
    }

    // Log access
    db.prepare(`
      INSERT INTO shared_link_access (id, shared_link_id, accessed_by_email, accessed_by_user_id, verified_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(uuidv4(), link.id, user.email, req.userId);

    res.json({ 
      success: true,
      resource_type: link.resource_type,
      resource_id: link.resource_id
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'שגיאה באימות' });
  }
});

// Access shared resource (after verification)
router.get('/access/:token', (req, res) => {
  try {
    const db = getDb(req);
    const { password_verified, user_email } = req.query;

    const link = db.prepare('SELECT * FROM shared_links WHERE share_token = ?').get(req.params.token);

    if (!link) {
      return res.status(404).json({ error: 'לינק לא נמצא' });
    }

    if (!link.is_active) {
      return res.status(403).json({ error: 'הלינק לא פעיל' });
    }

    // Check expiration
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(403).json({ error: 'הלינק פג תוקף' });
    }

    // For public links, allow direct access
    if (link.share_type === 'public') {
      return getResourceData(db, link, res);
    }

    // For password links, require verification flag
    if (link.share_type === 'password' && !password_verified) {
      return res.status(401).json({ error: 'נדרש אימות סיסמא', requires_password: true });
    }

    // For email links, require user email match
    if (link.share_type === 'email') {
      if (!user_email || user_email.toLowerCase() !== link.allowed_email.toLowerCase()) {
        return res.status(401).json({ error: 'נדרשת התחברות', requires_email: true, allowed_email: link.allowed_email });
      }
    }

    return getResourceData(db, link, res);
  } catch (error) {
    console.error('Access shared resource error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הנתונים' });
  }
});

// Helper function to get resource data
function getResourceData(db, link, res) {
  if (link.resource_type === 'client') {
    const client = db.prepare(`
      SELECT c.id, c.name
      FROM clients c
      WHERE c.id = ?
    `).get(link.resource_id);

    if (!client) {
      return res.status(404).json({ error: 'לקוח לא נמצא' });
    }

    const projects = db.prepare(`
      SELECT p.id, p.name, p.description, p.status, p.pricing_type,
        (SELECT COALESCE(SUM(duration), 0) FROM time_entries WHERE project_id = p.id) as total_time
      FROM projects p 
      WHERE p.client_id = ?
    `).all(client.id);

    client.projects = projects;
    res.json({ type: 'client', data: client });
  } else if (link.resource_type === 'project') {
    const project = db.prepare(`
      SELECT p.id, p.name, p.description, p.status, p.pricing_type,
        c.name as client_name,
        (SELECT COALESCE(SUM(duration), 0) FROM time_entries WHERE project_id = p.id) as total_time
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `).get(link.resource_id);

    if (!project) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    const tasks = db.prepare(`
      SELECT t.id, t.name, t.description, t.status,
        (SELECT COALESCE(SUM(duration), 0) FROM time_entries WHERE task_id = t.id) as total_time
      FROM tasks t 
      WHERE t.project_id = ?
    `).all(project.id);

    project.tasks = tasks;
    res.json({ type: 'project', data: project });
  }
}

export default router;
