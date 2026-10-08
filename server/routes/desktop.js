import { Router } from 'express';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = Router();

const getDb = (req) => req.app.locals.db;

const startOfToday = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate());
// Week starts on Sunday, like the rest of the app
const startOfWeek = (now) => {
  const day = startOfToday(now);
  day.setDate(day.getDate() - day.getDay());
  return day;
};

// Compact snapshot for the desktop app's menu-bar popover and Notification Center widget:
// the user's own logged time today and this week, plus the last things they worked on.
// Running timers are not included - callers add them from /api/timer/active.
router.get('/summary', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const now = new Date();

    const totalSince = (date) => db.prepare(`
      SELECT COALESCE(SUM(duration), 0) as seconds, COUNT(*) as entries
      FROM time_entries
      WHERE user_id = ? AND workspace_id = ? AND datetime(start_time) >= datetime(?)
    `).get(req.userId, req.workspaceId, date.toISOString());

    const recent = db.prepare(`
      SELECT te.project_id, te.task_id, p.name as project_name, t.name as task_name, c.name as client_name,
        MAX(datetime(te.start_time)) as last_worked
      FROM time_entries te
      JOIN projects p ON p.id = te.project_id
      LEFT JOIN tasks t ON t.id = te.task_id
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE te.user_id = ? AND te.workspace_id = ? AND COALESCE(p.status, 'active') = 'active'
      GROUP BY te.project_id, te.task_id
      ORDER BY last_worked DESC
      LIMIT 5
    `).all(req.userId, req.workspaceId);

    res.json({
      today: totalSince(startOfToday(now)),
      week: totalSince(startOfWeek(now)),
      recent,
      generated_at: now.toISOString()
    });
  } catch (error) {
    console.error('Desktop summary error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הסיכום' });
  }
});

export default router;
