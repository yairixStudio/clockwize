import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Get all tasks (optionally filter by project)
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { project_id } = req.query;

    let query = `
      SELECT t.*, p.name as project_name, c.name as client_name,
        (SELECT COALESCE(SUM(duration), 0) FROM time_entries WHERE task_id = t.id) as total_time
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      JOIN clients c ON p.client_id = c.id
      WHERE t.workspace_id = ?
    `;
    const params = [req.workspaceId];

    if (project_id) {
      query += ' AND t.project_id = ?';
      params.push(project_id);
    }

    query += ' ORDER BY t.created_at DESC';

    const tasks = db.prepare(query).all(...params);

    // Optionally include subtasks (used by export)
    if (req.query.include_subtasks === 'true') {
      const subtasksStmt = db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY created_at ASC');
      for (const task of tasks) {
        task.subtasks = subtasksStmt.all(task.id);
      }
    }

    res.json(tasks);
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת המשימות' });
  }
});

// Get single task
router.get('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const task = db.prepare(`
      SELECT t.*, p.name as project_name, p.hourly_rate as project_hourly_rate,
        p.pricing_type as project_pricing_type,
        p.client_id as client_id,
        c.name as client_name, c.hourly_rate as client_hourly_rate,
        (SELECT COALESCE(SUM(duration), 0) FROM time_entries WHERE task_id = t.id) as total_time
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      JOIN clients c ON p.client_id = c.id
      WHERE t.id = ? AND t.workspace_id = ?
    `).get(req.params.id, req.workspaceId);

    if (!task) {
      return res.status(404).json({ error: 'משימה לא נמצאה' });
    }

    // Get subtasks
    const subtasks = db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY created_at ASC').all(task.id);
    task.subtasks = subtasks;

    res.json(task);
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת המשימה' });
  }
});

// Create task
router.post('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { project_id, name, description, pricing_type, hourly_rate, notes, status = 'pending', paid_amount = 0, estimated_hours, priority = 'normal', communication_platforms } = req.body;

    if (!project_id || !name) {
      return res.status(400).json({ error: 'פרויקט ושם משימה נדרשים' });
    }

    // Verify project belongs to workspace
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').get(project_id, req.workspaceId);
    if (!project) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    const id = uuidv4();
    const platformsJson = communication_platforms ? JSON.stringify(communication_platforms) : null;

    db.prepare(`
      INSERT INTO tasks (id, project_id, user_id, workspace_id, name, description, pricing_type, hourly_rate, notes, status, paid_amount, estimated_hours, priority, communication_platforms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, project_id, req.userId, req.workspaceId, name, description || null, pricing_type || null, hourly_rate || null, notes || null, status, paid_amount || 0, estimated_hours || null, priority, platformsJson);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    res.status(201).json(task);
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת המשימה' });
  }
});

// Update task
router.put('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { project_id, name, description, pricing_type, hourly_rate, status, notes, paid_amount, estimated_hours, priority, communication_platforms } = req.body;

    const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(req.params.id, req.workspaceId);
    if (!existing) {
      return res.status(404).json({ error: 'משימה לא נמצאה' });
    }

    // Check if project_id is being changed
    const newProjectId = project_id || existing.project_id;
    if (project_id && project_id !== existing.project_id) {
      // Verify no linked time entries
      const entryCount = db.prepare('SELECT COUNT(*) as count FROM time_entries WHERE task_id = ?').get(req.params.id);
      if (entryCount.count > 0) {
        return res.status(409).json({ error: 'לא ניתן לשנות שיוך פרויקט למשימה שמשויכות אליה רשומות זמן. ראשית יש לנתק את רשומות הזמן מהמשימה.' });
      }
      // Validate new project belongs to workspace
      const newProject = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(project_id, req.workspaceId);
      if (!newProject) {
        return res.status(404).json({ error: 'פרויקט לא נמצא' });
      }
    }

    const platformsJson = communication_platforms ? JSON.stringify(communication_platforms) : null;

    db.prepare(`
      UPDATE tasks
      SET project_id = ?, name = ?, description = ?, pricing_type = ?, hourly_rate = ?, status = ?, notes = ?, paid_amount = ?, estimated_hours = ?, priority = ?, communication_platforms = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(newProjectId, name, description || null, pricing_type || null, hourly_rate || null, status, notes || null, paid_amount || 0, estimated_hours || null, priority || 'normal', platformsJson, req.params.id, req.workspaceId);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    res.json(task);
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון המשימה' });
  }
});

// Delete task
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const result = db.prepare('DELETE FROM tasks WHERE id = ? AND workspace_id = ?').run(req.params.id, req.workspaceId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'משימה לא נמצאה' });
    }

    res.json({ message: 'המשימה נמחקה בהצלחה' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת המשימה' });
  }
});

// Subtasks routes

// Create subtask
router.post('/:id/subtasks', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { title, due_date, description, priority, communication_platforms } = req.body;
    const taskId = req.params.id;

    if (!title) {
      return res.status(400).json({ error: 'כותרת תת-המשימה נדרשת' });
    }

    // Verify task belongs to workspace
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(taskId, req.workspaceId);
    if (!task) {
      return res.status(404).json({ error: 'משימה לא נמצאה' });
    }

    const id = uuidv4();
    const platformsJson = communication_platforms ? JSON.stringify(communication_platforms) : null;

    db.prepare(`
      INSERT INTO subtasks (id, task_id, title, due_date, description, priority, communication_platforms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, taskId, title, due_date || null, description || null, priority || 'normal', platformsJson);

    const subtask = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id);
    res.status(201).json(subtask);
  } catch (error) {
    console.error('Create subtask error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת תת-המשימה' });
  }
});

// Update subtask (toggle completion and/or update title)
router.put('/subtasks/:subtaskId', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { is_completed, title, due_date, description, priority, communication_platforms, task_id } = req.body;
    const { subtaskId } = req.params;

    // Verify subtask belongs to a task that belongs to the workspace
    const subtask = db.prepare(`
      SELECT s.*
      FROM subtasks s
      JOIN tasks t ON s.task_id = t.id
      WHERE s.id = ? AND t.workspace_id = ?
    `).get(subtaskId, req.workspaceId);

    if (!subtask) {
      return res.status(404).json({ error: 'תת-משימה לא נמצאה' });
    }

    // Check if task_id is being changed
    if (task_id && task_id !== subtask.task_id) {
      // Verify no linked time entries
      const entryCount = db.prepare('SELECT COUNT(*) as count FROM time_entries WHERE subtask_id = ?').get(subtaskId);
      if (entryCount.count > 0) {
        return res.status(409).json({ error: 'לא ניתן לשנות שיוך משימה לתת-משימה שמשויכות אליה רשומות זמן. ראשית יש לנתק את רשומות הזמן מתת-המשימה.' });
      }
      // Validate new task belongs to workspace
      const newTask = db.prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?').get(task_id, req.workspaceId);
      if (!newTask) {
        return res.status(404).json({ error: 'משימה לא נמצאה' });
      }
    }

    // Build update query dynamically based on what fields are provided
    const updates = [];
    const values = [];

    if (task_id !== undefined && task_id !== subtask.task_id) {
      updates.push('task_id = ?');
      values.push(task_id);
    }

    if (title !== undefined) {
      if (!title || !title.trim()) {
        return res.status(400).json({ error: 'כותרת תת-המשימה לא יכולה להיות ריקה' });
      }
      updates.push('title = ?');
      values.push(title.trim());
    }

    if (is_completed !== undefined) {
      updates.push('is_completed = ?');
      values.push(is_completed ? 1 : 0);
    }

    if (due_date !== undefined) {
      updates.push('due_date = ?');
      values.push(due_date || null);
    }

    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description || null);
    }

    if (priority !== undefined) {
      updates.push('priority = ?');
      values.push(priority || 'normal');
    }

    if (communication_platforms !== undefined) {
      updates.push('communication_platforms = ?');
      values.push(communication_platforms ? JSON.stringify(communication_platforms) : null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'לא סופקו שדות לעדכון' });
    }

    values.push(subtaskId);

    db.prepare(`
      UPDATE subtasks
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values);

    const updatedSubtask = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(subtaskId);
    res.json(updatedSubtask);
  } catch (error) {
    console.error('Update subtask error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון תת-המשימה' });
  }
});

// Delete subtask
router.delete('/subtasks/:subtaskId', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { subtaskId } = req.params;

    // Verify subtask belongs to a task that belongs to the workspace
    const subtask = db.prepare(`
      SELECT s.* 
      FROM subtasks s
      JOIN tasks t ON s.task_id = t.id
      WHERE s.id = ? AND t.workspace_id = ?
    `).get(subtaskId, req.workspaceId);

    if (!subtask) {
      return res.status(404).json({ error: 'תת-משימה לא נמצאה' });
    }

    db.prepare('DELETE FROM subtasks WHERE id = ?').run(subtaskId);
    res.json({ message: 'תת-המשימה נמחקה בהצלחה' });
  } catch (error) {
    console.error('Delete subtask error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת תת-המשימה' });
  }
});

export default router;
