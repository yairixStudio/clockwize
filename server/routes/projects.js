import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Public shared project view - MUST BE BEFORE /:id route!
router.get('/shared/:token', (req, res) => {
  try {
    const db = getDb(req);
    const project = db.prepare(`
      SELECT p.id, p.name, p.description, p.status, p.pricing_type, p.share_permissions,
        c.name as client_name,
        (SELECT COALESCE(SUM(duration), 0) FROM time_entries WHERE project_id = p.id) as total_time,
        (SELECT COALESCE(SUM(te.duration), 0) FROM time_entries te LEFT JOIN tasks t ON te.task_id = t.id WHERE te.project_id = p.id AND (t.pricing_type IS NULL OR t.pricing_type != 'no_charge')) as billable_time
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      WHERE p.share_token = ?
    `).get(req.params.token);

    if (!project) {
      return res.status(404).json({ error: 'לינק לא תקין' });
    }

    // Get tasks for this project
    const tasks = db.prepare(`
      SELECT t.id, t.name, t.description, t.status,
        (SELECT COALESCE(SUM(duration), 0) FROM time_entries WHERE task_id = t.id) as total_time
      FROM tasks t 
      WHERE t.project_id = ?
    `).all(project.id);

    project.tasks = tasks;
    res.json(project);
  } catch (error) {
    console.error('Get shared project error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הנתונים' });
  }
});

// Get all projects (optionally filter by client)
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { client_id } = req.query;
    
    let query = `
      SELECT p.*, c.name as client_name,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
        (SELECT COALESCE(SUM(duration), 0) FROM time_entries WHERE project_id = p.id) as total_time,
        (SELECT COALESCE(SUM(te.duration), 0) FROM time_entries te LEFT JOIN tasks t ON te.task_id = t.id WHERE te.project_id = p.id AND (t.pricing_type IS NULL OR t.pricing_type != 'no_charge')) as billable_time
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      WHERE p.workspace_id = ? AND (p.is_internal IS NULL OR p.is_internal = 0)
    `;
    const params = [req.workspaceId];

    if (client_id) {
      query += ' AND p.client_id = ?';
      params.push(client_id);
    }

    query += ' ORDER BY p.created_at DESC';

    const projects = db.prepare(query).all(...params);
    res.json(projects);
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הפרויקטים' });
  }
});

// Get single project
router.get('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const project = db.prepare(`
      SELECT p.*, c.name as client_name, c.hourly_rate as client_hourly_rate,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
        (SELECT COALESCE(SUM(duration), 0) FROM time_entries WHERE project_id = p.id) as total_time,
        (SELECT COALESCE(SUM(te.duration), 0) FROM time_entries te LEFT JOIN tasks t ON te.task_id = t.id WHERE te.project_id = p.id AND (t.pricing_type IS NULL OR t.pricing_type != 'no_charge')) as billable_time
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      WHERE p.id = ? AND p.workspace_id = ?
    `).get(req.params.id, req.workspaceId);

    if (!project) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    res.json(project);
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הפרויקט' });
  }
});

// Create project
router.post('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { client_id, name, description, pricing_type = 'hourly', fixed_price, hourly_rate, notes, status = 'active', paid_amount = 0, estimated_hours, priority = 'normal', communication_platforms } = req.body;

    if (!client_id || !name) {
      return res.status(400).json({ error: 'לקוח ושם פרויקט נדרשים' });
    }

    // Verify client belongs to workspace
    const client = db.prepare('SELECT * FROM clients WHERE id = ? AND workspace_id = ?').get(client_id, req.workspaceId);
    if (!client) {
      return res.status(404).json({ error: 'לקוח לא נמצא' });
    }

    const id = uuidv4();
    const platformsJson = communication_platforms ? JSON.stringify(communication_platforms) : null;

    db.prepare(`
      INSERT INTO projects (id, client_id, user_id, workspace_id, name, description, pricing_type, fixed_price, hourly_rate, notes, status, paid_amount, estimated_hours, priority, communication_platforms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, client_id, req.userId, req.workspaceId, name, description || null, pricing_type, fixed_price || null, hourly_rate || null, notes || null, status, paid_amount || 0, estimated_hours || null, priority, platformsJson);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.status(201).json(project);
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת הפרויקט' });
  }
});

// Update project
router.put('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { client_id, name, description, pricing_type, fixed_price, hourly_rate, status, notes, paid_amount, estimated_hours, priority, communication_platforms } = req.body;

    const existing = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').get(req.params.id, req.workspaceId);
    if (!existing) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    // Check if client_id is being changed
    const newClientId = client_id || existing.client_id;
    if (client_id && client_id !== existing.client_id) {
      // Verify no linked time entries
      const entryCount = db.prepare('SELECT COUNT(*) as count FROM time_entries WHERE project_id = ?').get(req.params.id);
      if (entryCount.count > 0) {
        return res.status(409).json({ error: 'לא ניתן לשנות שיוך לקוח לפרויקט שמשויכות אליו רשומות זמן. ראשית יש לנתק את רשומות הזמן מהפרויקט.' });
      }
      // Validate new client belongs to workspace
      const newClient = db.prepare('SELECT id FROM clients WHERE id = ? AND workspace_id = ?').get(client_id, req.workspaceId);
      if (!newClient) {
        return res.status(404).json({ error: 'לקוח לא נמצא' });
      }
    }

    const platformsJson = communication_platforms ? JSON.stringify(communication_platforms) : null;

    db.prepare(`
      UPDATE projects
      SET client_id = ?, name = ?, description = ?, pricing_type = ?, fixed_price = ?, hourly_rate = ?, status = ?, notes = ?, paid_amount = ?, estimated_hours = ?, priority = ?, communication_platforms = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(newClientId, name, description || null, pricing_type, fixed_price || null, hourly_rate || null, status, notes || null, paid_amount || 0, estimated_hours || null, priority || 'normal', platformsJson, req.params.id, req.workspaceId);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json(project);
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הפרויקט' });
  }
});

// Toggle favorite for project
router.patch('/:id/favorite', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { is_favorite } = req.body;

    const existing = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').get(req.params.id, req.workspaceId);
    if (!existing) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    db.prepare(`
      UPDATE projects 
      SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(is_favorite ? 1 : 0, req.params.id, req.workspaceId);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json(project);
  } catch (error) {
    console.error('Update project favorite error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הפרויקט' });
  }
});

// Delete project
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const result = db.prepare('DELETE FROM projects WHERE id = ? AND workspace_id = ?').run(req.params.id, req.workspaceId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    res.json({ message: 'הפרויקט נמחק בהצלחה' });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת הפרויקט' });
  }
});

// Generate share link for project
router.post('/:id/share', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { permissions = 'view' } = req.body;
    const shareToken = uuidv4();

    const result = db.prepare(`
      UPDATE projects SET share_token = ?, share_permissions = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(shareToken, permissions, req.params.id, req.workspaceId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    res.json({ share_token: shareToken, permissions });
  } catch (error) {
    console.error('Generate project share link error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת הלינק' });
  }
});

// Remove share link for project
router.delete('/:id/share', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const result = db.prepare(`
      UPDATE projects SET share_token = NULL, share_permissions = 'view', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(req.params.id, req.workspaceId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    res.json({ message: 'הלינק הוסר בהצלחה' });
  } catch (error) {
    console.error('Remove project share link error:', error);
    res.status(500).json({ error: 'שגיאה בהסרת הלינק' });
  }
});

export default router;
