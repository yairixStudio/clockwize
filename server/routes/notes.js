import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Helper to get db
const getDb = (req) => req.app.locals.db;

router.use(authMiddleware);
router.use(workspaceMiddleware);

// Get all notes for an entity
router.get('/:entityType/:entityId', (req, res) => {
  try {
    const db = getDb(req);
    const { entityType, entityId } = req.params;

    const notes = db.prepare(`
      SELECT * FROM notes 
      WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC
    `).all(req.workspaceId, entityType, entityId);

    res.json(notes);
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת פתקים' });
  }
});

// Create note
router.post('/', (req, res) => {
  try {
    const db = getDb(req);
    const { 
      entity_type, 
      entity_id, 
      title, 
      content 
    } = req.body;

    if (!entity_type || !entity_id) {
      return res.status(400).json({ error: 'חסרים פרטי שיוך לפתק' });
    }

    // Verify ownership of entity based on type
    if (entity_type === 'client') {
      const client = db.prepare('SELECT id FROM clients WHERE id = ? AND workspace_id = ?').get(entity_id, req.workspaceId);
      if (!client) {
        return res.status(404).json({ error: 'לקוח לא נמצא' });
      }
    } else if (entity_type === 'project') {
      const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(entity_id, req.workspaceId);
      if (!project) {
        return res.status(404).json({ error: 'פרויקט לא נמצא' });
      }
    } else if (entity_type === 'task') {
      const task = db.prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?').get(entity_id, req.workspaceId);
      if (!task) {
        return res.status(404).json({ error: 'משימה לא נמצאה' });
      }
    }

    const id = uuidv4();
    
    db.prepare(`
      INSERT INTO notes (
        id, user_id, workspace_id, entity_type, entity_id, title, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.userId, req.workspaceId, entity_type, entity_id, title || '', content || ''
    );

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    res.status(201).json(note);
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת פתק' });
  }
});

// Update note
router.put('/:id', (req, res) => {
  try {
    const db = getDb(req);
    const { id } = req.params;
    const { title, content } = req.body;

    const note = db.prepare('SELECT * FROM notes WHERE id = ? AND workspace_id = ?').get(id, req.workspaceId);
    if (!note) {
      return res.status(404).json({ error: 'פתק לא נמצא' });
    }

    db.prepare(`
      UPDATE notes 
      SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(
      title !== undefined ? title : note.title, 
      content !== undefined ? content : note.content, 
      id, 
      req.workspaceId
    );

    const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    res.json(updated);
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון פתק' });
  }
});

// Delete note
router.delete('/:id', (req, res) => {
  try {
    const db = getDb(req);
    const { id } = req.params;

    const result = db.prepare('DELETE FROM notes WHERE id = ? AND workspace_id = ?').run(id, req.workspaceId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'פתק לא נמצא' });
    }

    res.json({ message: 'פתק נמחק בהצלחה' });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת פתק' });
  }
});

export default router;
