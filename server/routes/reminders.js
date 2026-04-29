import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Helper to get db
const getDb = (req) => req.app.locals.db;

router.use(authMiddleware);
router.use(workspaceMiddleware);

// Get all reminders
router.get('/', (req, res) => {
  try {
    const db = getDb(req);
    const { type, id: associationId, include_read } = req.query;

    let query = `
      SELECT
        r.*,
        c.name as client_name,
        p.name as project_name,
        t.name as task_name,
        pc.name as task_project_name,
        pc.id as task_project_id,
        pcc.name as task_client_name,
        pcc.id as task_client_id,
        p2c.name as project_client_name,
        p2c.id as project_client_id,
        ld.name as lead_name
      FROM reminders r
      LEFT JOIN clients c ON r.association_type = 'client' AND r.association_id = c.id
      LEFT JOIN projects p ON r.association_type = 'project' AND r.association_id = p.id
      LEFT JOIN tasks t ON r.association_type = 'task' AND r.association_id = t.id
      LEFT JOIN projects pc ON t.project_id = pc.id
      LEFT JOIN clients pcc ON pc.client_id = pcc.id
      LEFT JOIN clients p2c ON p.client_id = p2c.id
      LEFT JOIN leads ld ON r.association_type = 'lead' AND r.association_id = ld.id
      WHERE r.workspace_id = ?
    `;
    const params = [req.workspaceId];

    if (type) {
      query += ' AND r.association_type = ?';
      params.push(type);
    }

    if (associationId) {
      query += ' AND r.association_id = ?';
      params.push(associationId);
    }

    query += ' ORDER BY r.due_date ASC, r.created_at DESC';

    const reminders = db.prepare(query).all(...params);

    // Load project associations for each reminder
    const reminderIds = reminders.map(r => r.id);
    if (reminderIds.length > 0) {
      const associations = db.prepare(`
        SELECT ra.reminder_id, ra.project_id, p.name as project_name, p.client_id, c.name as client_name
        FROM reminder_associations ra
        LEFT JOIN projects p ON ra.project_id = p.id
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE ra.reminder_id IN (${reminderIds.map(() => '?').join(',')})
      `).all(...reminderIds);

      // Group associations by reminder_id
      const associationMap = {};
      associations.forEach(a => {
        if (!associationMap[a.reminder_id]) {
          associationMap[a.reminder_id] = [];
        }
        associationMap[a.reminder_id].push({
          project_id: a.project_id,
          project_name: a.project_name,
          client_id: a.client_id,
          client_name: a.client_name
        });
      });

      // Attach associations to reminders
      reminders.forEach(r => {
        r.project_associations = associationMap[r.id] || [];
      });
    }

    res.json(reminders);
  } catch (error) {
    console.error('Get reminders error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת תזכורות' });
  }
});

// Create reminder
router.post('/', (req, res) => {
  try {
    const db = getDb(req);
    const {
      content,
      notes,
      due_date,
      association_type = 'general',
      association_id,
      project_ids = [], // Array of project IDs for multi-project association
      is_recurring = 0,
      recurrence_interval
    } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'תוכן התזכורת נדרש' });
    }

    const id = uuidv4();

    // Convert empty string to null for association_id
    const cleanAssociationId = association_id || null;

    db.prepare(`
      INSERT INTO reminders (
        id, user_id, workspace_id, content, notes, due_date, association_type, association_id, is_recurring, recurrence_interval
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.userId, req.workspaceId, content, notes || null, due_date, association_type, cleanAssociationId, is_recurring ? 1 : 0, recurrence_interval
    );

    // Create project associations if project_ids provided
    if (project_ids && project_ids.length > 0) {
      const insertAssoc = db.prepare(`
        INSERT INTO reminder_associations (id, reminder_id, project_id, workspace_id)
        VALUES (?, ?, ?, ?)
      `);
      for (const projectId of project_ids) {
        insertAssoc.run(uuidv4(), id, projectId, req.workspaceId);
      }
    }

    const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);

    // Load associations
    reminder.project_associations = db.prepare(`
      SELECT ra.project_id, p.name as project_name, p.client_id, c.name as client_name
      FROM reminder_associations ra
      LEFT JOIN projects p ON ra.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE ra.reminder_id = ?
    `).all(id);

    res.status(201).json(reminder);
  } catch (error) {
    console.error('Create reminder error:', error);
    console.error('Request body:', req.body);
    res.status(500).json({ error: 'שגיאה ביצירת תזכורת: ' + error.message });
  }
});

// Update reminder (mark as read, edit)
router.put('/:id', (req, res) => {
  try {
    const db = getDb(req);
    const { id } = req.params;
    const updates = req.body;

    const reminder = db.prepare('SELECT * FROM reminders WHERE id = ? AND workspace_id = ?').get(id, req.workspaceId);
    if (!reminder) {
      return res.status(404).json({ error: 'תזכורת לא נמצאה' });
    }

    // Handle recurring logic when marking as read (is_read = 1)
    if (updates.is_read === true && reminder.is_recurring && reminder.recurrence_interval) {
        let nextDate = new Date(reminder.due_date || new Date());

        switch (reminder.recurrence_interval) {
            case 'daily':
                nextDate.setDate(nextDate.getDate() + 1);
                break;
            case 'weekly':
                nextDate.setDate(nextDate.getDate() + 7);
                break;
            case 'monthly':
                nextDate.setMonth(nextDate.getMonth() + 1);
                break;
            case 'yearly':
                nextDate.setFullYear(nextDate.getFullYear() + 1);
                break;
        }

        db.prepare(`
            UPDATE reminders
            SET due_date = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(nextDate.toISOString(), id);

        const updated = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
        updated.project_associations = db.prepare(`
          SELECT ra.project_id, p.name as project_name, p.client_id, c.name as client_name
          FROM reminder_associations ra
          LEFT JOIN projects p ON ra.project_id = p.id
          LEFT JOIN clients c ON p.client_id = c.id
          WHERE ra.reminder_id = ?
        `).all(id);
        return res.json({ ...updated, message: 'Recurring reminder rescheduled' });
    }

    // Handle project_ids update
    if (updates.project_ids !== undefined) {
      // Delete existing associations
      db.prepare('DELETE FROM reminder_associations WHERE reminder_id = ?').run(id);

      // Insert new associations
      if (updates.project_ids && updates.project_ids.length > 0) {
        const insertAssoc = db.prepare(`
          INSERT INTO reminder_associations (id, reminder_id, project_id, workspace_id)
          VALUES (?, ?, ?, ?)
        `);
        for (const projectId of updates.project_ids) {
          insertAssoc.run(uuidv4(), id, projectId, req.workspaceId);
        }
      }
    }

    // Standard update
    const allowedUpdates = ['content', 'notes', 'due_date', 'is_read', 'is_archived', 'association_type', 'association_id', 'is_recurring', 'recurrence_interval'];
    const sets = [];
    const values = [];

    allowedUpdates.forEach(key => {
      if (updates[key] !== undefined) {
        sets.push(`${key} = ?`);
        values.push(key === 'is_recurring' || key === 'is_read' || key === 'is_archived' ? (updates[key] ? 1 : 0) : updates[key]);
      }
    });

    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');

      values.push(id);
      values.push(req.workspaceId);

      db.prepare(`
        UPDATE reminders
        SET ${sets.join(', ')}
        WHERE id = ? AND workspace_id = ?
      `).run(...values);
    }

    const updated = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);

    // Load associations
    updated.project_associations = db.prepare(`
      SELECT ra.project_id, p.name as project_name, p.client_id, c.name as client_name
      FROM reminder_associations ra
      LEFT JOIN projects p ON ra.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE ra.reminder_id = ?
    `).all(id);

    res.json(updated);
  } catch (error) {
    console.error('Update reminder error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון תזכורת' });
  }
});

// Delete reminder
router.delete('/:id', (req, res) => {
  try {
    const db = getDb(req);
    const { id } = req.params;

    const result = db.prepare('DELETE FROM reminders WHERE id = ? AND workspace_id = ?').run(id, req.workspaceId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'תזכורת לא נמצאה' });
    }

    res.json({ message: 'תזכורת נמחקה בהצלחה' });
  } catch (error) {
    console.error('Delete reminder error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת תזכורת' });
  }
});

export default router;
