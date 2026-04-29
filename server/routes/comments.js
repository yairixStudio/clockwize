import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Helper to get db
const getDb = (req) => req.app.locals.db;

// Apply auth and workspace middleware to all routes
router.use(authMiddleware);
router.use(workspaceMiddleware);

// Get unread comments count
router.get('/unread', (req, res) => {
  try {
    const db = getDb(req);
    const { client_id, project_id, task_id, dashboard } = req.query;
    
    // Determine context
    let contextType = 'dashboard';
    let contextId = null;
    
    if (client_id) {
      contextType = 'client';
      contextId = client_id;
    } else if (project_id) {
      contextType = 'project';
      contextId = project_id;
    } else if (task_id) {
      contextType = 'task';
      contextId = task_id;
    }
    
    // Get last read timestamp for this context
    const readStatus = db.prepare(`
      SELECT last_read_at FROM comment_read_status 
      WHERE user_id = ? AND context_type = ? AND (context_id = ? OR (context_id IS NULL AND ? IS NULL))
    `).get(req.userId, contextType, contextId, contextId);
    
    const lastReadAt = readStatus?.last_read_at || '1970-01-01 00:00:00';
    
    // Build query to count unread comments in workspace
    let query = `
      SELECT COUNT(*) as count FROM comments 
      WHERE workspace_id = ? AND created_at > ?
    `;
    const params = [req.workspaceId, lastReadAt];
    
    if (dashboard === 'true') {
      query += ` AND client_id IS NULL AND project_id IS NULL AND task_id IS NULL`;
    } else {
      if (client_id) {
        query += ` AND client_id = ?`;
        params.push(client_id);
      }
      if (project_id) {
        query += ` AND project_id = ?`;
        params.push(project_id);
      }
      if (task_id) {
        query += ` AND task_id = ?`;
        params.push(task_id);
      }
    }
    
    const result = db.prepare(query).get(...params);
    res.json({ unread: result?.count || 0 });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

// Mark comments as read
router.post('/mark-read', (req, res) => {
  try {
    const db = getDb(req);
    const { client_id, project_id, task_id, dashboard } = req.body;
    
    // Determine context
    let contextType = 'dashboard';
    let contextId = null;
    
    if (client_id) {
      contextType = 'client';
      contextId = client_id;
    } else if (project_id) {
      contextType = 'project';
      contextId = project_id;
    } else if (task_id) {
      contextType = 'task';
      contextId = task_id;
    }
    
    // Upsert read status
    const existingStatus = db.prepare(`
      SELECT id FROM comment_read_status 
      WHERE user_id = ? AND context_type = ? AND (context_id = ? OR (context_id IS NULL AND ? IS NULL))
    `).get(req.userId, contextType, contextId, contextId);
    
    if (existingStatus) {
      db.prepare(`
        UPDATE comment_read_status 
        SET last_read_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(existingStatus.id);
    } else {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO comment_read_status (id, user_id, context_type, context_id, last_read_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(id, req.userId, contextType, contextId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking comments as read:', error);
    res.status(500).json({ error: 'Failed to mark comments as read' });
  }
});

// Get comments (optionally filtered by entity)
router.get('/', (req, res) => {
  try {
    const db = getDb(req);
    const { client_id, project_id, task_id, parent_id, dashboard } = req.query;
    
    let query = `
      SELECT c.*, u.name as user_name 
      FROM comments c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.workspace_id = ?
    `;
    const params = [req.workspaceId];

    if (dashboard === 'true') {
      // For dashboard, we want general comments (not linked to specific entities)
      query += ` AND c.client_id IS NULL AND c.project_id IS NULL AND c.task_id IS NULL`;
    } else {
      if (client_id) {
        // Verify client belongs to workspace
        const client = db.prepare('SELECT id FROM clients WHERE id = ? AND workspace_id = ?').get(client_id, req.workspaceId);
        if (!client) {
          return res.status(404).json({ error: 'Client not found' });
        }
        query += ` AND c.client_id = ?`;
        params.push(client_id);
      }
      if (project_id) {
        // Verify project belongs to workspace
        const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(project_id, req.workspaceId);
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }
        query += ` AND c.project_id = ?`;
        params.push(project_id);
      }
      if (task_id) {
        // Verify task belongs to workspace
        const task = db.prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?').get(task_id, req.workspaceId);
        if (!task) {
          return res.status(404).json({ error: 'Task not found' });
        }
        query += ` AND c.task_id = ?`;
        params.push(task_id);
      }
    }
    
    // Sort by created_at asc (oldest first for chat)
    query += ` ORDER BY c.created_at ASC`;
    
    const comments = db.prepare(query).all(...params);
    res.json(comments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Create a comment
router.post('/', (req, res) => {
  try {
    const db = getDb(req);
    const { content, parent_id, client_id, project_id, task_id } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Verify ownership of entities if provided
    if (client_id) {
      const client = db.prepare('SELECT id FROM clients WHERE id = ? AND workspace_id = ?').get(client_id, req.workspaceId);
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }
    }
    if (project_id) {
      const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(project_id, req.workspaceId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
    }
    if (task_id) {
      const task = db.prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?').get(task_id, req.workspaceId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO comments (id, user_id, workspace_id, content, parent_id, client_id, project_id, task_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.userId, req.workspaceId, content, parent_id || null, client_id || null, project_id || null, task_id || null);

    const newComment = db.prepare(`
      SELECT c.*, u.name as user_name 
      FROM comments c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.id = ?
    `).get(id);

    res.status(201).json(newComment);
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Update a comment
router.put('/:id', (req, res) => {
  try {
    const db = getDb(req);
    const { id } = req.params;
    const { content } = req.body;

    const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND workspace_id = ?').get(id, req.workspaceId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only the author can edit their comment
    if (comment.user_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    db.prepare(`
      UPDATE comments 
      SET content = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(content, id);

    const updatedComment = db.prepare(`
      SELECT c.*, u.name as user_name 
      FROM comments c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.id = ?
    `).get(id);

    res.json(updatedComment);
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete a comment
router.delete('/:id', (req, res) => {
  try {
    const db = getDb(req);
    const { id } = req.params;

    const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND workspace_id = ?').get(id, req.workspaceId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only the author can delete their comment
    if (comment.user_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(id);

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

export default router;
