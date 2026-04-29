import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = Router();

const getDb = (req) => req.app.locals.db;

// Helper: format Date to YYYY-MM-DD
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Helper: generate recurrence dates until endDate
function generateRecurrenceDates(startDate, recurrenceType, interval, endDate) {
  const dates = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T23:59:59');
  const MAX_OCCURRENCES = 365; // safety limit

  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const d = new Date(start);

    switch (recurrenceType) {
      case 'daily':
        d.setDate(start.getDate() + (i * interval));
        break;
      case 'weekly':
        d.setDate(start.getDate() + (i * 7 * interval));
        break;
      case 'biweekly':
        d.setDate(start.getDate() + (i * 14 * interval));
        break;
      case 'monthly':
        d.setMonth(start.getMonth() + (i * interval));
        break;
      case 'yearly':
        d.setFullYear(start.getFullYear() + (i * interval));
        break;
      default:
        d.setDate(start.getDate() + (i * 7));
    }

    if (d > end) break;
    dates.push(formatDate(d));
  }

  return dates;
}

// Get all planned slots
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const slots = db.prepare(`
      SELECT ps.*, c.name as client_name, p.name as project_name, l.name as lead_name
      FROM planned_slots ps
      LEFT JOIN clients c ON ps.client_id = c.id
      LEFT JOIN projects p ON ps.project_id = p.id
      LEFT JOIN leads l ON ps.lead_id = l.id
      WHERE ps.user_id = ? AND ps.workspace_id = ?
      ORDER BY ps.date ASC, ps.sort_order ASC
    `).all(req.userId, req.workspaceId);

    res.json(slots);
  } catch (error) {
    console.error('Get planned slots error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת סלוטים מתוכננים' });
  }
});

// Create planned slot (with optional recurrence)
router.post('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { client_id, project_id, lead_id, date, duration, notes, is_recurring, recurrence_type, recurrence_interval, recurrence_end_date } = req.body;

    if (!date || !duration) {
      return res.status(400).json({ error: 'נדרש תאריך ומשך זמן' });
    }
    if (!client_id && !lead_id) {
      return res.status(400).json({ error: 'נדרש לקוח או ליד' });
    }

    if (is_recurring && recurrence_type) {
      if (!recurrence_end_date) {
        return res.status(400).json({ error: 'נדרש תאריך סיום לאירוע חוזר' });
      }

      // Generate multiple slots with shared group ID
      const groupId = uuidv4();
      const interval = recurrence_interval || 1;
      const dates = generateRecurrenceDates(date, recurrence_type, interval, recurrence_end_date);

      const insertStmt = db.prepare(`
        INSERT INTO planned_slots (id, user_id, workspace_id, client_id, project_id, lead_id, date, duration, notes, recurrence_group_id, recurrence_type, recurrence_interval, recurrence_end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const createdIds = [];
      for (const d of dates) {
        const id = uuidv4();
        insertStmt.run(id, req.userId, req.workspaceId, client_id || null, project_id || null, lead_id || null, d, duration, notes || null, groupId, recurrence_type, interval, recurrence_end_date);
        createdIds.push(id);
      }

      // Return all created slots
      const placeholders = createdIds.map(() => '?').join(',');
      const slots = db.prepare(`
        SELECT ps.*, c.name as client_name, p.name as project_name, l.name as lead_name
        FROM planned_slots ps
        LEFT JOIN clients c ON ps.client_id = c.id
        LEFT JOIN projects p ON ps.project_id = p.id
        LEFT JOIN leads l ON ps.lead_id = l.id
        WHERE ps.id IN (${placeholders})
        ORDER BY ps.date ASC
      `).all(...createdIds);

      res.status(201).json(slots);
    } else {
      // Single slot (non-recurring)
      const id = uuidv4();
      db.prepare(`
        INSERT INTO planned_slots (id, user_id, workspace_id, client_id, project_id, lead_id, date, duration, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.userId, req.workspaceId, client_id || null, project_id || null, lead_id || null, date, duration, notes || null);

      const slot = db.prepare(`
        SELECT ps.*, c.name as client_name, p.name as project_name, l.name as lead_name
        FROM planned_slots ps
        LEFT JOIN clients c ON ps.client_id = c.id
        LEFT JOIN projects p ON ps.project_id = p.id
        LEFT JOIN leads l ON ps.lead_id = l.id
        WHERE ps.id = ?
      `).get(id);

      res.status(201).json(slot);
    }
  } catch (error) {
    console.error('Create planned slot error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת סלוט מתוכנן' });
  }
});

// Update planned slot
router.put('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { id } = req.params;
    const { client_id, project_id, lead_id, date, duration, notes, sort_order } = req.body;

    const existing = db.prepare('SELECT * FROM planned_slots WHERE id = ? AND user_id = ? AND workspace_id = ?')
      .get(id, req.userId, req.workspaceId);

    if (!existing) {
      return res.status(404).json({ error: 'סלוט לא נמצא' });
    }

    db.prepare(`
      UPDATE planned_slots
      SET client_id = ?, project_id = ?, lead_id = ?, date = ?, duration = ?, notes = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      client_id !== undefined ? client_id : existing.client_id,
      project_id !== undefined ? project_id : existing.project_id,
      lead_id !== undefined ? lead_id : existing.lead_id,
      date || existing.date,
      duration || existing.duration,
      notes !== undefined ? notes : existing.notes,
      sort_order !== undefined ? sort_order : (existing.sort_order || 0),
      id
    );

    const slot = db.prepare(`
      SELECT ps.*, c.name as client_name, p.name as project_name, l.name as lead_name
      FROM planned_slots ps
      LEFT JOIN clients c ON ps.client_id = c.id
      LEFT JOIN projects p ON ps.project_id = p.id
      LEFT JOIN leads l ON ps.lead_id = l.id
      WHERE ps.id = ?
    `).get(id);

    res.json(slot);
  } catch (error) {
    console.error('Update planned slot error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון סלוט מתוכנן' });
  }
});

// Delete all slots in a recurrence group (must come before /:id route)
router.delete('/group/:groupId', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { groupId } = req.params;

    const existing = db.prepare('SELECT id FROM planned_slots WHERE recurrence_group_id = ? AND user_id = ? AND workspace_id = ?')
      .all(groupId, req.userId, req.workspaceId);

    if (existing.length === 0) {
      return res.status(404).json({ error: 'קבוצת אירועים לא נמצאה' });
    }

    db.prepare('DELETE FROM planned_slots WHERE recurrence_group_id = ? AND user_id = ? AND workspace_id = ?')
      .run(groupId, req.userId, req.workspaceId);

    const deletedIds = existing.map(s => s.id);
    res.json({ success: true, deletedIds });
  } catch (error) {
    console.error('Delete recurrence group error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת סדרת אירועים' });
  }
});

// Delete planned slot
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM planned_slots WHERE id = ? AND user_id = ? AND workspace_id = ?')
      .get(id, req.userId, req.workspaceId);

    if (!existing) {
      return res.status(404).json({ error: 'סלוט לא נמצא' });
    }

    db.prepare('DELETE FROM planned_slots WHERE id = ?').run(id);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete planned slot error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת סלוט מתוכנן' });
  }
});

export default router;
