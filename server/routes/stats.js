import { Router } from 'express';
import { authMiddleware, workspaceMiddleware, canViewAllTimeEntries } from '../middleware/auth.js';

const router = Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Calculate proportional duration for entries overlapping a period
function calculatePeriodDuration(db, workspaceId, userId, periodStart, periodEnd, canSeeAll) {
  const periodStartISO = periodStart.toISOString();
  const periodEndISO = periodEnd.toISOString();
  const periodStartMs = periodStart.getTime();
  const periodEndMs = periodEnd.getTime();

  // Get all entries that overlap with the period
  let query = `
    SELECT start_time, end_time, duration
    FROM time_entries
    WHERE workspace_id = ?
      AND start_time <= ?
      AND (end_time >= ? OR end_time IS NULL)
  `;
  const params = [workspaceId, periodEndISO, periodStartISO];

  if (!canSeeAll) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  const entries = db.prepare(query).all(...params);
  let totalDuration = 0;

  for (const entry of entries) {
    const entryStartMs = new Date(entry.start_time).getTime();
    const entryEndMs = entry.end_time ? new Date(entry.end_time).getTime() : Date.now();
    const clockSpan = entryEndMs - entryStartMs;
    const entryDuration = entry.duration || 0;

    // Zero-span entry: attribute to start day only
    if (clockSpan <= 0) {
      if (entryStartMs >= periodStartMs && entryStartMs <= periodEndMs) {
        totalDuration += entryDuration;
      }
      continue;
    }

    // Entry fully within period
    if (entryStartMs >= periodStartMs && entryEndMs <= periodEndMs) {
      totalDuration += entryDuration;
      continue;
    }

    // Entry partially overlaps - calculate proportional duration
    const overlapStart = Math.max(entryStartMs, periodStartMs);
    const overlapEnd = Math.min(entryEndMs, periodEndMs);
    const overlapSpan = overlapEnd - overlapStart;
    if (overlapSpan > 0) {
      totalDuration += Math.round(entryDuration * (overlapSpan / clockSpan));
    }
  }

  return totalDuration;
}

// Get dashboard stats
router.get('/dashboard', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const user = db.prepare('SELECT default_hourly_rate FROM users WHERE id = ?').get(req.userId);

    const clientCount = db.prepare('SELECT COUNT(*) as count FROM clients WHERE workspace_id = ? AND (is_internal IS NULL OR is_internal = 0)').get(req.workspaceId).count;
    const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects WHERE workspace_id = ? AND (is_internal IS NULL OR is_internal = 0)').get(req.workspaceId).count;
    const activeProjects = db.prepare("SELECT COUNT(*) as count FROM projects WHERE workspace_id = ? AND status = 'active' AND (is_internal IS NULL OR is_internal = 0)").get(req.workspaceId).count;
    const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ?').get(req.workspaceId).count;
    const completedTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ? AND status = 'completed'").get(req.workspaceId).count;

    // Check if custom date range or specific month/year was requested
    const customStartDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const customEndDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const requestedMonth = req.query.month !== undefined ? parseInt(req.query.month) : null;
    const requestedYear = req.query.year !== undefined ? parseInt(req.query.year) : null;

    // Calculate start and end dates for the selected period (UTC)
    let periodStart, periodEnd;
    const now = new Date();
    let isCustomRange = false;

    if (customStartDate && customEndDate) {
      // Custom date range mode - use UTC boundaries
      periodStart = new Date(customStartDate);
      periodStart.setUTCHours(0, 0, 0, 0);
      periodEnd = new Date(customEndDate);
      periodEnd.setUTCHours(23, 59, 59, 999);
      isCustomRange = true;
    } else if (requestedMonth !== null && requestedYear !== null) {
      // Specific month requested - build in UTC
      periodStart = new Date(Date.UTC(requestedYear, requestedMonth, 1));
      const lastDay = new Date(Date.UTC(requestedYear, requestedMonth + 1, 0)).getUTCDate();
      periodEnd = new Date(Date.UTC(requestedYear, requestedMonth, lastDay, 23, 59, 59, 999));
    } else {
      // Default: current month in UTC
      periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
      periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), lastDay, 23, 59, 59, 999));
    }

    // For time entries, respect role-based visibility
    const canSeeAll = canViewAllTimeEntries(req);

    // Active timers duration
    let activeSecondsPeriod = 0;
    let activeSecondsTotal = 0;

    // Check if period includes today (UTC)
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
    const periodIncludesToday = periodStart <= todayEnd && periodEnd >= todayStart;

    // Always calculate activeSecondsTotal for all-time stat
    const activeTimers = db.prepare('SELECT start_time, accumulated_seconds, is_running FROM active_timers WHERE user_id = ? AND workspace_id = ?').all(req.userId, req.workspaceId);
    const nowMs = Date.now();

    activeTimers.forEach(timer => {
      let timerDuration = timer.accumulated_seconds || 0;
      if (timer.is_running) {
        timerDuration += Math.floor((nowMs - new Date(timer.start_time).getTime()) / 1000);
      }
      activeSecondsTotal += timerDuration;

      // Calculate proportional period attribution for active timers
      if (periodIncludesToday) {
        const timerStartMs = new Date(timer.start_time).getTime();
        const timerEndMs = nowMs;
        const clockSpan = timerEndMs - timerStartMs;

        if (clockSpan <= 0) {
          activeSecondsPeriod += timerDuration;
          return;
        }

        const overlapStart = Math.max(timerStartMs, periodStart.getTime());
        const overlapEnd = Math.min(timerEndMs, periodEnd.getTime());

        if (overlapEnd > overlapStart) {
          activeSecondsPeriod += Math.round(timerDuration * ((overlapEnd - overlapStart) / clockSpan));
        }
      }
    });

    // Time entries - total (all-time) query
    let totalTimeQuery;
    if (canSeeAll) {
      totalTimeQuery = db.prepare('SELECT COALESCE(SUM(duration), 0) as total FROM time_entries WHERE workspace_id = ?').get(req.workspaceId);
    } else {
      totalTimeQuery = db.prepare('SELECT COALESCE(SUM(duration), 0) as total FROM time_entries WHERE workspace_id = ? AND user_id = ?').get(req.workspaceId, req.userId);
    }

    // Period duration - overlap-based with proportional calculation
    const periodTotal = calculatePeriodDuration(db, req.workspaceId, req.userId, periodStart, periodEnd, canSeeAll);

    const totalTime = totalTimeQuery.total + activeSecondsTotal;
    const timePeriod = periodTotal + activeSecondsPeriod;

    // Estimated earnings (based on default hourly rate)
    const hourlyRate = user.default_hourly_rate || 250;
    const estimatedEarnings = (totalTime / 3600) * hourlyRate;
    const earningsPeriod = (timePeriod / 3600) * hourlyRate;

    res.json({
      clients: clientCount,
      projects: {
        total: projectCount,
        active: activeProjects
      },
      tasks: {
        total: taskCount,
        completed: completedTasks
      },
      time: {
        total: totalTime,
        thisMonth: timePeriod // Keeping the key name for backward compatibility
      },
      earnings: {
        total: Math.round(estimatedEarnings),
        thisMonth: Math.round(earningsPeriod) // Keeping the key name for backward compatibility
      },
      selectedPeriod: {
        startDate: periodStart.toISOString(),
        endDate: periodEnd.toISOString(),
        isCustomRange,
        periodIncludesToday
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הסטטיסטיקות' });
  }
});

// Get client stats
router.get('/client/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const client = db.prepare('SELECT * FROM clients WHERE id = ? AND workspace_id = ?').get(req.params.id, req.workspaceId);
    if (!client) {
      return res.status(404).json({ error: 'לקוח לא נמצא' });
    }

    const user = db.prepare('SELECT default_hourly_rate FROM users WHERE id = ?').get(req.userId);
    const hourlyRate = client.hourly_rate || user.default_hourly_rate || 250;

    const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects WHERE client_id = ?').get(req.params.id).count;
    const activeProjects = db.prepare("SELECT COUNT(*) as count FROM projects WHERE client_id = ? AND status = 'active'").get(req.params.id).count;
    
    const totalTime = db.prepare(`
      SELECT COALESCE(SUM(te.duration), 0) as total
      FROM time_entries te
      JOIN projects p ON te.project_id = p.id
      WHERE p.client_id = ?
    `).get(req.params.id).total;

    const billableTime = db.prepare(`
      SELECT COALESCE(SUM(te.duration), 0) as total
      FROM time_entries te
      JOIN projects p ON te.project_id = p.id
      LEFT JOIN tasks t ON te.task_id = t.id
      WHERE p.client_id = ? AND (p.pricing_type IS NULL OR p.pricing_type != 'no_charge') AND (t.pricing_type IS NULL OR t.pricing_type != 'no_charge')
    `).get(req.params.id).total;

    const estimatedEarnings = (billableTime / 3600) * hourlyRate;

    res.json({
      projects: {
        total: projectCount,
        active: activeProjects
      },
      time: {
        total: totalTime
      },
      earnings: {
        total: Math.round(estimatedEarnings),
        hourlyRate
      }
    });
  } catch (error) {
    console.error('Get client stats error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הסטטיסטיקות' });
  }
});

// Get project stats
router.get('/project/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const project = db.prepare(`
      SELECT p.*, c.hourly_rate as client_hourly_rate
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      WHERE p.id = ? AND p.workspace_id = ?
    `).get(req.params.id, req.workspaceId);
    
    if (!project) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    const user = db.prepare('SELECT default_hourly_rate FROM users WHERE id = ?').get(req.userId);
    const hourlyRate = project.hourly_rate || project.client_hourly_rate || user.default_hourly_rate || 250;

    const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?').get(req.params.id).count;
    const completedTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE project_id = ? AND status = 'completed'").get(req.params.id).count;
    
    const totalTime = db.prepare(`
      SELECT COALESCE(SUM(duration), 0) as total
      FROM time_entries
      WHERE project_id = ?
    `).get(req.params.id).total;

    const billableTime = db.prepare(`
      SELECT COALESCE(SUM(te.duration), 0) as total
      FROM time_entries te
      LEFT JOIN tasks t ON te.task_id = t.id
      WHERE te.project_id = ? AND (t.pricing_type IS NULL OR t.pricing_type != 'no_charge')
    `).get(req.params.id).total;

    let earnings, costPerHour;
    if (project.pricing_type === 'no_charge') {
      earnings = 0;
      costPerHour = 0;
    } else if (project.pricing_type === 'fixed') {
      earnings = project.fixed_price || 0;
      costPerHour = totalTime > 0 ? (project.fixed_price / (totalTime / 3600)) : 0;
    } else {
      earnings = (billableTime / 3600) * hourlyRate;
      costPerHour = hourlyRate;
    }

    res.json({
      tasks: {
        total: taskCount,
        completed: completedTasks
      },
      time: {
        total: totalTime
      },
      earnings: {
        total: Math.round(earnings),
        costPerHour: Math.round(costPerHour),
        hourlyRate,
        pricingType: project.pricing_type,
        fixedPrice: project.fixed_price
      }
    });
  } catch (error) {
    console.error('Get project stats error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הסטטיסטיקות' });
  }
});

export default router;
