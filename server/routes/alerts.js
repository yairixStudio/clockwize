import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = express.Router();

const getDb = (req) => req.app.locals.db;

router.use(authMiddleware);
router.use(workspaceMiddleware);

// Get all alerts (optionally filtered by project_id)
router.get('/', (req, res) => {
  try {
    const db = getDb(req);
    const { project_id } = req.query;
    let query = `
      SELECT a.*, p.name as project_name, c.name as client_name
      FROM project_alerts a
      JOIN projects p ON a.project_id = p.id
      JOIN clients c ON p.client_id = c.id
      WHERE a.workspace_id = ?
    `;
    const params = [req.workspaceId];
    if (project_id) {
      query += ' AND a.project_id = ?';
      params.push(project_id);
    }
    query += ' ORDER BY a.created_at DESC';
    const alerts = db.prepare(query).all(...params);
    res.json(alerts);
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת ההתראות' });
  }
});

// Check thresholds for a project
router.get('/check/:projectId', (req, res) => {
  try {
    const db = getDb(req);
    const { projectId } = req.params;

    const project = db.prepare(`
      SELECT p.*, c.hourly_rate as client_hourly_rate
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      WHERE p.id = ? AND p.workspace_id = ?
    `).get(projectId, req.workspaceId);
    if (!project) return res.status(404).json({ error: 'פרויקט לא נמצא' });

    // Calculate current metrics
    const totalTime = db.prepare(
      'SELECT COALESCE(SUM(duration), 0) as total FROM time_entries WHERE project_id = ?'
    ).get(projectId);
    const totalHours = (totalTime.total || 0) / 3600;

    const hourlyRate = project.hourly_rate || project.client_hourly_rate || 0;
    const totalEarnings = project.pricing_type === 'fixed' ? (project.fixed_price || 0) : totalHours * hourlyRate;

    const totalPayments = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE project_id = ? AND status = 'paid'"
    ).get(projectId);

    // Get all non-dismissed alerts
    const alerts = db.prepare(
      'SELECT * FROM project_alerts WHERE project_id = ? AND is_dismissed = 0'
    ).all(projectId);

    const triggered = [];

    for (const alert of alerts) {
      let isTriggered = false;
      let currentValue = null;

      switch (alert.alert_type) {
        case 'hours':
          currentValue = totalHours;
          isTriggered = totalHours >= alert.threshold_value;
          break;
        case 'budget':
          currentValue = totalEarnings;
          isTriggered = totalEarnings >= alert.threshold_value;
          break;
        case 'payment':
          currentValue = totalPayments.total;
          isTriggered = totalPayments.total >= alert.threshold_value;
          break;
        case 'deadline':
          if (alert.threshold_value) {
            // threshold_value stores a timestamp; threshold_days is days before
            const targetDate = new Date(alert.threshold_value);
            const now = new Date();
            const daysLeft = Math.ceil((targetDate - now) / (1000 * 60 * 60 * 24));
            currentValue = daysLeft;
            isTriggered = daysLeft <= (alert.threshold_days || 0);
          }
          break;
      }

      // Update trigger status if changed
      if (isTriggered && !alert.is_triggered) {
        db.prepare('UPDATE project_alerts SET is_triggered = 1 WHERE id = ?').run(alert.id);
      }

      if (isTriggered) {
        triggered.push({ ...alert, is_triggered: 1, current_value: currentValue });
      }
    }

    // Also get all alerts (including dismissed) for display
    const allAlerts = db.prepare(
      'SELECT * FROM project_alerts WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId);

    res.json({
      alerts: allAlerts,
      triggered,
      metrics: { totalHours, totalEarnings, totalPayments: totalPayments.total }
    });
  } catch (error) {
    console.error('Check alerts error:', error);
    res.status(500).json({ error: 'שגיאה בבדיקת ההתראות' });
  }
});

// Create alert
router.post('/', (req, res) => {
  try {
    const db = getDb(req);
    const { project_id, alert_type, threshold_value, threshold_days, message } = req.body;

    if (!project_id || !alert_type) {
      return res.status(400).json({ error: 'פרויקט וסוג התראה נדרשים' });
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?')
      .get(project_id, req.workspaceId);
    if (!project) return res.status(404).json({ error: 'פרויקט לא נמצא' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO project_alerts (id, project_id, workspace_id, alert_type, threshold_value, threshold_days, message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, project_id, req.workspaceId, alert_type, threshold_value || null, threshold_days || null, message || null);

    const alert = db.prepare('SELECT * FROM project_alerts WHERE id = ?').get(id);
    res.status(201).json(alert);
  } catch (error) {
    console.error('Create alert error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת ההתראה' });
  }
});

// Update alert
router.put('/:id', (req, res) => {
  try {
    const db = getDb(req);
    const existing = db.prepare('SELECT * FROM project_alerts WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);
    if (!existing) return res.status(404).json({ error: 'התראה לא נמצאה' });

    const { alert_type, threshold_value, threshold_days, message, is_dismissed } = req.body;

    const updates = [];
    const values = [];

    if (alert_type !== undefined) { updates.push('alert_type = ?'); values.push(alert_type); }
    if (threshold_value !== undefined) { updates.push('threshold_value = ?'); values.push(threshold_value); }
    if (threshold_days !== undefined) { updates.push('threshold_days = ?'); values.push(threshold_days); }
    if (message !== undefined) { updates.push('message = ?'); values.push(message); }
    if (is_dismissed !== undefined) { updates.push('is_dismissed = ?'); values.push(is_dismissed ? 1 : 0); }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE project_alerts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare('SELECT * FROM project_alerts WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error) {
    console.error('Update alert error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון ההתראה' });
  }
});

// Delete alert
router.delete('/:id', (req, res) => {
  try {
    const db = getDb(req);
    const result = db.prepare('DELETE FROM project_alerts WHERE id = ? AND workspace_id = ?')
      .run(req.params.id, req.workspaceId);
    if (result.changes === 0) return res.status(404).json({ error: 'התראה לא נמצאה' });
    res.json({ message: 'ההתראה נמחקה בהצלחה' });
  } catch (error) {
    console.error('Delete alert error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת ההתראה' });
  }
});

export default router;
