import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware, canViewAllTimeEntries } from '../middleware/auth.js';

const router = Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Get all active timers (user's own timers only)
router.get('/active', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const timers = db.prepare(`
      SELECT at.*, p.name as project_name, t.name as task_name, c.name as client_name
      FROM active_timers at
      LEFT JOIN projects p ON at.project_id = p.id
      LEFT JOIN tasks t ON at.task_id = t.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE at.user_id = ? AND at.workspace_id = ?
      ORDER BY at.start_time DESC
    `).all(req.userId, req.workspaceId);

    res.json(timers);
  } catch (error) {
    console.error('Get active timers error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הטיימרים' });
  }
});

// Get timer for specific project/task
router.get('/active/project/:projectId', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { projectId } = req.params;
    const { taskId } = req.query;

    let query = `
      SELECT at.*, p.name as project_name, t.name as task_name
      FROM active_timers at
      LEFT JOIN projects p ON at.project_id = p.id
      LEFT JOIN tasks t ON at.task_id = t.id
      WHERE at.user_id = ? AND at.workspace_id = ? AND at.project_id = ?
    `;
    const params = [req.userId, req.workspaceId, projectId];

    if (taskId) {
      query += ' AND at.task_id = ?';
      params.push(taskId);
    } else {
      query += ' AND at.task_id IS NULL';
    }

    const timer = db.prepare(query).get(...params);
    res.json(timer || null);
  } catch (error) {
    console.error('Get project timer error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הטיימר' });
  }
});

// Start timer
router.post('/start', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { project_id, task_id } = req.body;

    if (!project_id) {
      return res.status(400).json({ error: 'נדרש פרויקט' });
    }

    // Check if there's already a timer for this project/task
    let existingQuery = 'SELECT * FROM active_timers WHERE user_id = ? AND workspace_id = ? AND project_id = ?';
    const existingParams = [req.userId, req.workspaceId, project_id];

    if (task_id) {
      existingQuery += ' AND task_id = ?';
      existingParams.push(task_id);
    } else {
      existingQuery += ' AND task_id IS NULL';
    }

    const existingTimer = db.prepare(existingQuery).get(...existingParams);
    if (existingTimer) {
      return res.status(400).json({ error: 'כבר יש טיימר פעיל לפרויקט/משימה זו' });
    }

    // Verify project belongs to workspace
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').get(project_id, req.workspaceId);
    if (!project) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    // Verify task if provided
    if (task_id) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(task_id, req.workspaceId);
      if (!task) {
        return res.status(404).json({ error: 'משימה לא נמצאה' });
      }
    }

    const id = uuidv4();
    const startTime = new Date().toISOString();

    db.prepare(`
      INSERT INTO active_timers (id, user_id, workspace_id, project_id, task_id, start_time, accumulated_seconds, is_running)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1)
    `).run(id, req.userId, req.workspaceId, project_id, task_id || null, startTime);

    // Create first interval
    const intervalId = uuidv4();
    db.prepare(`
      INSERT INTO timer_intervals (id, timer_id, user_id, workspace_id, start_time)
      VALUES (?, ?, ?, ?, ?)
    `).run(intervalId, id, req.userId, req.workspaceId, startTime);

    const timer = db.prepare(`
      SELECT at.*, p.name as project_name, t.name as task_name, c.name as client_name
      FROM active_timers at
      LEFT JOIN projects p ON at.project_id = p.id
      LEFT JOIN tasks t ON at.task_id = t.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE at.id = ?
    `).get(id);

    res.status(201).json(timer);
  } catch (error) {
    console.error('Start timer error:', error);
    res.status(500).json({ error: 'שגיאה בהפעלת הטיימר' });
  }
});

// Pause specific timer
router.post('/pause/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const timer = db.prepare('SELECT * FROM active_timers WHERE id = ? AND user_id = ? AND workspace_id = ?').get(req.params.id, req.userId, req.workspaceId);

    if (!timer) {
      return res.status(404).json({ error: 'טיימר לא נמצא' });
    }

    if (!timer.is_running) {
      return res.status(400).json({ error: 'הטיימר כבר מושהה' });
    }

    // Calculate elapsed time since last start
    const now = new Date();
    const endTime = now.toISOString();
    const elapsed = Math.floor((now.getTime() - new Date(timer.start_time).getTime()) / 1000);
    const newAccumulated = timer.accumulated_seconds + elapsed;

    db.prepare(`
      UPDATE active_timers 
      SET is_running = 0, accumulated_seconds = ?
      WHERE id = ?
    `).run(newAccumulated, req.params.id);

    // Close the current interval
    db.prepare(`
      UPDATE timer_intervals 
      SET end_time = ?, duration_seconds = ?
      WHERE timer_id = ? AND end_time IS NULL
    `).run(endTime, elapsed, req.params.id);

    const updatedTimer = db.prepare(`
      SELECT at.*, p.name as project_name, t.name as task_name, c.name as client_name
      FROM active_timers at
      LEFT JOIN projects p ON at.project_id = p.id
      LEFT JOIN tasks t ON at.task_id = t.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE at.id = ?
    `).get(req.params.id);

    res.json(updatedTimer);
  } catch (error) {
    console.error('Pause timer error:', error);
    res.status(500).json({ error: 'שגיאה בהשהיית הטיימר' });
  }
});

// Resume specific timer
router.post('/resume/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const timer = db.prepare('SELECT * FROM active_timers WHERE id = ? AND user_id = ? AND workspace_id = ?').get(req.params.id, req.userId, req.workspaceId);

    if (!timer) {
      return res.status(404).json({ error: 'טיימר לא נמצא' });
    }

    if (timer.is_running) {
      return res.status(400).json({ error: 'הטיימר כבר רץ' });
    }

    const startTime = new Date().toISOString();

    db.prepare(`
      UPDATE active_timers 
      SET is_running = 1, start_time = ?
      WHERE id = ?
    `).run(startTime, req.params.id);

    // Create new interval for this resume
    const intervalId = uuidv4();
    db.prepare(`
      INSERT INTO timer_intervals (id, timer_id, user_id, workspace_id, start_time)
      VALUES (?, ?, ?, ?, ?)
    `).run(intervalId, req.params.id, req.userId, req.workspaceId, startTime);

    const updatedTimer = db.prepare(`
      SELECT at.*, p.name as project_name, t.name as task_name, c.name as client_name
      FROM active_timers at
      LEFT JOIN projects p ON at.project_id = p.id
      LEFT JOIN tasks t ON at.task_id = t.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE at.id = ?
    `).get(req.params.id);

    res.json(updatedTimer);
  } catch (error) {
    console.error('Resume timer error:', error);
    res.status(500).json({ error: 'שגיאה בהמשך הטיימר' });
  }
});

// Stop specific timer and save time entry
router.post('/stop/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { notes, intervals, project_id, task_id, subtask_id, additional_associations } = req.body;
    const timer = db.prepare('SELECT * FROM active_timers WHERE id = ? AND user_id = ? AND workspace_id = ?').get(req.params.id, req.userId, req.workspaceId);

    if (!timer) {
      return res.status(404).json({ error: 'טיימר לא נמצא' });
    }

    const now = new Date();
    const endTime = now.toISOString();

    // If intervals are provided, update them
    if (intervals && Array.isArray(intervals) && intervals.length > 0) {
      // Get existing interval IDs for this timer
      const existingIntervals = db.prepare(`
        SELECT id FROM timer_intervals WHERE timer_id = ?
      `).all(req.params.id);
      const existingIds = new Set(existingIntervals.map(i => i.id));
      
      // Track which IDs are still present
      const updatedIds = new Set();
      
      for (const interval of intervals) {
        if (interval.id && existingIds.has(interval.id)) {
          // Update existing interval
          const startTime = interval.start_time || (interval.start_date_input && interval.start_time_input 
            ? new Date(`${interval.start_date_input}T${interval.start_time_input}`).toISOString()
            : interval.start_time);
          const endTimeInterval = interval.end_time || (interval.end_date_input && interval.end_time_input 
            ? new Date(`${interval.end_date_input}T${interval.end_time_input}`).toISOString()
            : interval.end_time);
          
          // Calculate duration if not provided
          let durationSeconds = interval.duration_seconds;
          if (!durationSeconds && startTime && endTimeInterval) {
            const start = new Date(startTime);
            const end = new Date(endTimeInterval);
            durationSeconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
          }
          
          db.prepare(`
            UPDATE timer_intervals 
            SET start_time = ?, end_time = ?, duration_seconds = ?
            WHERE id = ?
          `).run(startTime, endTimeInterval, durationSeconds || 0, interval.id);
          updatedIds.add(interval.id);
        } else {
          // Create new interval
          const newId = uuidv4();
          const startTime = interval.start_time || (interval.start_date_input && interval.start_time_input 
            ? new Date(`${interval.start_date_input}T${interval.start_time_input}`).toISOString()
            : new Date().toISOString());
          const endTimeInterval = interval.end_time || (interval.end_date_input && interval.end_time_input 
            ? new Date(`${interval.end_date_input}T${interval.end_time_input}`).toISOString()
            : null);
          
          let durationSeconds = interval.duration_seconds;
          if (!durationSeconds && startTime && endTimeInterval) {
            const start = new Date(startTime);
            const end = new Date(endTimeInterval);
            durationSeconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
          }
          
          db.prepare(`
            INSERT INTO timer_intervals (id, timer_id, user_id, workspace_id, start_time, end_time, duration_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(newId, req.params.id, req.userId, req.workspaceId, startTime, endTimeInterval, durationSeconds || 0);
        }
      }
      
      // Delete intervals that are no longer present
      for (const existingId of existingIds) {
        if (!updatedIds.has(existingId)) {
          db.prepare('DELETE FROM timer_intervals WHERE id = ?').run(existingId);
        }
      }
      
      // Close any remaining active interval if timer is running
      if (timer.is_running) {
        db.prepare(`
          UPDATE timer_intervals 
          SET end_time = ?, duration_seconds = ?
          WHERE timer_id = ? AND end_time IS NULL
        `).run(endTime, Math.floor((now.getTime() - new Date(timer.start_time).getTime()) / 1000), req.params.id);
      }
    } else {
      // Default behavior: calculate total time and close last interval if running
      let totalSeconds = timer.accumulated_seconds;
      if (timer.is_running) {
        const elapsed = Math.floor((now.getTime() - new Date(timer.start_time).getTime()) / 1000);
        totalSeconds += elapsed;

        // Close the current running interval
        db.prepare(`
          UPDATE timer_intervals 
          SET end_time = ?, duration_seconds = ?
          WHERE timer_id = ? AND end_time IS NULL
        `).run(endTime, elapsed, req.params.id);
      }
    }

    // Calculate total duration from all intervals
    const allIntervals = db.prepare(`
      SELECT duration_seconds FROM timer_intervals WHERE timer_id = ?
    `).all(req.params.id);
    let totalSeconds = allIntervals.reduce((sum, interval) => sum + (interval.duration_seconds || 0), 0);

    // Get the first interval's start time for the time entry
    const firstInterval = db.prepare(`
      SELECT start_time FROM timer_intervals 
      WHERE timer_id = ? 
      ORDER BY start_time ASC 
      LIMIT 1
    `).get(req.params.id);

    const entryStartTime = firstInterval ? firstInterval.start_time : timer.start_time;

    // Create time entry
    const entryId = uuidv4();

    // Use provided project/task/subtask IDs if given, otherwise use timer's values
    const finalProjectId = project_id !== undefined ? project_id : timer.project_id;
    const finalTaskId = task_id !== undefined ? task_id : timer.task_id;
    const finalSubtaskId = subtask_id !== undefined ? subtask_id : null;

    db.prepare(`
      INSERT INTO time_entries (id, user_id, workspace_id, project_id, task_id, subtask_id, start_time, end_time, duration, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entryId, req.userId, req.workspaceId, finalProjectId, finalTaskId, finalSubtaskId, entryStartTime, endTime, totalSeconds, notes || null);

    // Link all intervals to the time entry and clear timer_id
    db.prepare(`
      UPDATE timer_intervals 
      SET time_entry_id = ?, timer_id = NULL
      WHERE timer_id = ?
    `).run(entryId, req.params.id);

    // Create additional associations if provided
    if (additional_associations && Array.isArray(additional_associations)) {
      const insertAssoc = db.prepare(`
        INSERT INTO time_entry_associations (id, time_entry_id, project_id, task_id, workspace_id)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      for (const assoc of additional_associations) {
        if (assoc.project_id || assoc.task_id) {
          insertAssoc.run(uuidv4(), entryId, assoc.project_id || null, assoc.task_id || null, req.workspaceId);
        }
      }
    }

    // Delete active timer
    db.prepare('DELETE FROM active_timers WHERE id = ?').run(req.params.id);

    const timeEntry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId);
    
    // Fetch associations
    const associations = db.prepare(`
      SELECT tea.*, p.name as project_name, t.name as task_name
      FROM time_entry_associations tea
      LEFT JOIN projects p ON tea.project_id = p.id
      LEFT JOIN tasks t ON tea.task_id = t.id
      WHERE tea.time_entry_id = ?
    `).all(entryId);

    res.json({ ...timeEntry, additional_associations: associations });
  } catch (error) {
    console.error('Stop timer error:', error);
    res.status(500).json({ error: 'שגיאה בעצירת הטיימר' });
  }
});

// Discard specific timer (without saving)
router.delete('/discard/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    const timer = db.prepare('SELECT * FROM active_timers WHERE id = ? AND workspace_id = ?').get(req.params.id, req.workspaceId);
    
    if (!timer) {
      return res.status(404).json({ error: 'טיימר לא נמצא' });
    }
    
    // Check ownership
    if (timer.user_id !== req.userId) {
      return res.status(403).json({ error: 'אין הרשאה למחוק טיימר זה' });
    }
    
    // Delete intervals associated with this timer
    db.prepare('DELETE FROM timer_intervals WHERE timer_id = ?').run(req.params.id);
    
    db.prepare('DELETE FROM active_timers WHERE id = ?').run(req.params.id);

    res.json({ message: 'הטיימר בוטל' });
  } catch (error) {
    console.error('Discard timer error:', error);
    res.status(500).json({ error: 'שגיאה בביטול הטיימר' });
  }
});

// Update timer start time
router.put('/active/:id/start-time', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { start_time } = req.body;
    
    if (!start_time) {
      return res.status(400).json({ error: 'נדרש זמן התחלה' });
    }
    
    // Check if timer exists and belongs to user
    const timer = db.prepare('SELECT * FROM active_timers WHERE id = ? AND user_id = ? AND workspace_id = ?').get(req.params.id, req.userId, req.workspaceId);
    if (!timer) {
      return res.status(404).json({ error: 'טיימר לא נמצא' });
    }
    
    // Validate start_time format
    const newStartTime = new Date(start_time);
    if (isNaN(newStartTime.getTime())) {
      return res.status(400).json({ error: 'זמן התחלה לא תקין' });
    }
    
    const startTimeISO = newStartTime.toISOString();
    
    // If timer is running, we need to recalculate accumulated_seconds
    // based on the new start time
    let newAccumulated = timer.accumulated_seconds || 0;
    
    if (timer.is_running) {
      // Calculate elapsed time from old start_time to now
      const now = new Date();
      const oldStartTime = new Date(timer.start_time);
      const elapsed = Math.floor((now.getTime() - oldStartTime.getTime()) / 1000);
      
      // Calculate what the elapsed time would be with the new start time
      const newElapsed = Math.floor((now.getTime() - newStartTime.getTime()) / 1000);
      
      // Adjust accumulated_seconds to maintain the same total elapsed time
      // Total should be: accumulated_seconds + elapsed
      // With new start: accumulated_seconds_new + newElapsed = accumulated_seconds + elapsed
      // So: accumulated_seconds_new = accumulated_seconds + elapsed - newElapsed
      newAccumulated = timer.accumulated_seconds + elapsed - newElapsed;
      
      // Ensure accumulated_seconds doesn't go negative
      if (newAccumulated < 0) {
        newAccumulated = 0;
      }
      
      // Update the active interval's start_time
      db.prepare(`
        UPDATE timer_intervals 
        SET start_time = ?
        WHERE timer_id = ? AND end_time IS NULL
      `).run(startTimeISO, req.params.id);
    }
    
    // Update timer start_time
    db.prepare(`
      UPDATE active_timers 
      SET start_time = ?, accumulated_seconds = ?
      WHERE id = ?
    `).run(startTimeISO, newAccumulated, req.params.id);
    
    const updatedTimer = db.prepare(`
      SELECT at.*, p.name as project_name, t.name as task_name, c.name as client_name
      FROM active_timers at
      LEFT JOIN projects p ON at.project_id = p.id
      LEFT JOIN tasks t ON at.task_id = t.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE at.id = ?
    `).get(req.params.id);
    
    res.json(updatedTimer);
  } catch (error) {
    console.error('Update timer start time error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון זמן ההתחלה' });
  }
});

// Get intervals for an active timer
router.get('/active/:id/intervals', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    // Check if timer exists and belongs to user
    const timer = db.prepare('SELECT * FROM active_timers WHERE id = ? AND user_id = ? AND workspace_id = ?').get(req.params.id, req.userId, req.workspaceId);
    if (!timer) {
      return res.status(404).json({ error: 'טיימר לא נמצא' });
    }

    // Get intervals for this timer
    let intervals = db.prepare(`
      SELECT id, start_time, end_time, duration_seconds
      FROM timer_intervals
      WHERE timer_id = ?
      ORDER BY start_time ASC
    `).all(req.params.id);

    // If timer is running, calculate current interval duration
    if (timer.is_running) {
      intervals = intervals.map(interval => {
        if (!interval.end_time) {
          // This is the active interval
          const now = new Date();
          const startTime = new Date(interval.start_time);
          const elapsed = Math.floor((now.getTime() - startTime.getTime()) / 1000);
          return {
            ...interval,
            duration_seconds: elapsed,
            is_active: true
          };
        }
        return interval;
      });
    }

    res.json(intervals);
  } catch (error) {
    console.error('Get timer intervals error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת האינטרוולים' });
  }
});

// Get time entries - respect role-based visibility
router.get('/entries', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { project_id, task_id } = req.query;

    let query = `
      SELECT te.*, p.name as project_name, p.client_id, t.name as task_name, s.title as subtask_title, u.name as user_name
      FROM time_entries te
      LEFT JOIN projects p ON te.project_id = p.id
      LEFT JOIN tasks t ON te.task_id = t.id
      LEFT JOIN subtasks s ON te.subtask_id = s.id
      LEFT JOIN users u ON te.user_id = u.id
      WHERE te.workspace_id = ?
    `;
    const params = [req.workspaceId];

    // Members can only see their own entries
    if (!canViewAllTimeEntries(req)) {
      query += ' AND te.user_id = ?';
      params.push(req.userId);
    }

    if (project_id) {
      query += ' AND te.project_id = ?';
      params.push(project_id);
    }

    if (task_id) {
      query += ' AND te.task_id = ?';
      params.push(task_id);
    }

    query += ' ORDER BY te.created_at DESC';

    const entries = db.prepare(query).all(...params);
    
    // Fetch additional associations and intervals for each entry
    const entriesWithAssociations = entries.map(entry => {
      const associations = db.prepare(`
        SELECT tea.*, p.name as project_name, t.name as task_name
        FROM time_entry_associations tea
        LEFT JOIN projects p ON tea.project_id = p.id
        LEFT JOIN tasks t ON tea.task_id = t.id
        WHERE tea.time_entry_id = ?
      `).all(entry.id);

      const intervals = db.prepare(`
        SELECT id, start_time, end_time, duration_seconds
        FROM timer_intervals
        WHERE time_entry_id = ?
        ORDER BY start_time ASC
      `).all(entry.id);

      return {
        ...entry,
        additional_associations: associations,
        intervals: intervals
      };
    });
    
    res.json(entriesWithAssociations);
  } catch (error) {
    console.error('Get time entries error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת רשומות הזמן' });
  }
});

// Create manual time entry
router.post('/entries', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { project_id, task_id, subtask_id, start_time, end_time, duration, notes, additional_associations } = req.body;

    if (!project_id) {
      return res.status(400).json({ error: 'נדרש פרויקט' });
    }

    // Verify project belongs to workspace
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').get(project_id, req.workspaceId);
    if (!project) {
      return res.status(404).json({ error: 'פרויקט לא נמצא' });
    }

    // Verify task if provided
    if (task_id) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(task_id, req.workspaceId);
      if (!task) {
        return res.status(404).json({ error: 'משימה לא נמצאה' });
      }
    }

    // Verify subtask if provided
    if (subtask_id) {
      const subtask = db.prepare('SELECT * FROM subtasks WHERE id = ? AND task_id = ?').get(subtask_id, task_id);
      if (!subtask) {
        return res.status(404).json({ error: 'תת-משימה לא נמצאה' });
      }
    }

    const id = uuidv4();

    // Calculate duration if not provided
    let calculatedDuration = duration;
    if (calculatedDuration === undefined || calculatedDuration === null || isNaN(calculatedDuration) || calculatedDuration === '') {
      if (start_time && end_time) {
        const start = new Date(start_time).getTime();
        const end = new Date(end_time).getTime();
        if (!isNaN(start) && !isNaN(end)) {
          calculatedDuration = Math.floor((end - start) / 1000);
        } else {
          calculatedDuration = 0;
        }
      } else {
        calculatedDuration = 0;
      }
    }

    // Ensure duration is not negative
    if (calculatedDuration < 0) calculatedDuration = 0;

    db.prepare(`
      INSERT INTO time_entries (id, user_id, workspace_id, project_id, task_id, subtask_id, start_time, end_time, duration, notes, is_manual)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(id, req.userId, req.workspaceId, project_id, task_id || null, subtask_id || null, start_time, end_time, calculatedDuration, notes || null);

    // Create a single interval for manual entries (for consistency with timer-created entries)
    if (start_time && end_time) {
      const intervalId = uuidv4();
      db.prepare(`
        INSERT INTO timer_intervals (id, time_entry_id, user_id, workspace_id, start_time, end_time, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(intervalId, id, req.userId, req.workspaceId, start_time, end_time, calculatedDuration);
    }

    // Create additional associations if provided
    if (additional_associations && Array.isArray(additional_associations)) {
      const insertAssoc = db.prepare(`
        INSERT INTO time_entry_associations (id, time_entry_id, project_id, task_id, workspace_id)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      for (const assoc of additional_associations) {
        if (assoc.project_id || assoc.task_id) {
          insertAssoc.run(uuidv4(), id, assoc.project_id || null, assoc.task_id || null, req.workspaceId);
        }
      }
    }

    const entry = db.prepare(`
      SELECT te.*, p.name as project_name, t.name as task_name, s.title as subtask_title
      FROM time_entries te
      LEFT JOIN projects p ON te.project_id = p.id
      LEFT JOIN tasks t ON te.task_id = t.id
      LEFT JOIN subtasks s ON te.subtask_id = s.id
      WHERE te.id = ?
    `).get(id);

    // Fetch associations
    const associations = db.prepare(`
      SELECT tea.*, p.name as project_name, t.name as task_name
      FROM time_entry_associations tea
      LEFT JOIN projects p ON tea.project_id = p.id
      LEFT JOIN tasks t ON tea.task_id = t.id
      WHERE tea.time_entry_id = ?
    `).all(id);

    res.status(201).json({ ...entry, additional_associations: associations });
  } catch (error) {
    console.error('Create manual time entry error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת רשומת הזמן' });
  }
});

// Update time entry
router.put('/entries/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { start_time, end_time, duration, notes, project_id, task_id, subtask_id, intervals, additional_associations } = req.body;

    // Check if entry exists and belongs to workspace
    const existing = db.prepare('SELECT * FROM time_entries WHERE id = ? AND workspace_id = ?').get(req.params.id, req.workspaceId);
    if (!existing) {
      return res.status(404).json({ error: 'רשומה לא נמצאה' });
    }

    // Only allow editing own entries (unless admin/owner - future enhancement)
    if (existing.user_id !== req.userId && !canViewAllTimeEntries(req)) {
      return res.status(403).json({ error: 'אין הרשאה לערוך רשומה זו' });
    }

    // Calculate duration if not provided
    let calculatedDuration = duration;
    if (calculatedDuration === undefined || calculatedDuration === null || isNaN(calculatedDuration) || calculatedDuration === '') {
      if (start_time && end_time) {
        const start = new Date(start_time).getTime();
        const end = new Date(end_time).getTime();
        if (!isNaN(start) && !isNaN(end)) {
          calculatedDuration = Math.floor((end - start) / 1000);
        } else {
          calculatedDuration = 0;
        }
      } else {
        calculatedDuration = 0;
      }
    }

    if (calculatedDuration < 0) calculatedDuration = 0;

    // Validate: end_time must not be before start_time, and clamp duration
    if (start_time && end_time) {
      const startMs = new Date(start_time).getTime();
      const endMs = new Date(end_time).getTime();
      if (!isNaN(startMs) && !isNaN(endMs) && endMs < startMs) {
        return res.status(400).json({ error: 'זמן סיום לא יכול להיות לפני זמן התחלה' });
      }
      if (!isNaN(startMs) && !isNaN(endMs)) {
        const clockSpanSeconds = Math.floor((endMs - startMs) / 1000);
        if (calculatedDuration > clockSpanSeconds) {
          calculatedDuration = clockSpanSeconds;
        }
      }
    }

    // Validate: no overlapping intervals
    if (intervals && Array.isArray(intervals) && intervals.length > 1) {
      const sorted = [...intervals]
        .filter(i => i.start_time && i.end_time)
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
      for (let i = 1; i < sorted.length; i++) {
        const prevEnd = new Date(sorted[i - 1].end_time).getTime();
        const currStart = new Date(sorted[i].start_time).getTime();
        if (!isNaN(prevEnd) && !isNaN(currStart) && currStart < prevEnd) {
          return res.status(400).json({ error: 'אינטרוולים חופפים זה את זה' });
        }
      }
    }

    const newProjectId = project_id || existing.project_id;
    const newTaskId = task_id !== undefined ? (task_id || null) : existing.task_id;
    const newSubtaskId = subtask_id !== undefined ? (subtask_id || null) : existing.subtask_id;

    db.prepare(`
      UPDATE time_entries
      SET start_time = ?, end_time = ?, duration = ?, notes = ?, project_id = ?, task_id = ?, subtask_id = ?, is_edited = 1
      WHERE id = ?
    `).run(start_time, end_time, calculatedDuration, notes || null, newProjectId, newTaskId, newSubtaskId, req.params.id);

    // Handle intervals update if provided
    if (intervals && Array.isArray(intervals)) {
      // Get existing interval IDs for this entry
      const existingIntervals = db.prepare(`
        SELECT id FROM timer_intervals WHERE time_entry_id = ?
      `).all(req.params.id);
      const existingIds = new Set(existingIntervals.map(i => i.id));
      
      // Track which IDs are still present
      const updatedIds = new Set();
      
      for (const interval of intervals) {
        if (interval.id && existingIds.has(interval.id)) {
          // Update existing interval
          db.prepare(`
            UPDATE timer_intervals 
            SET start_time = ?, end_time = ?, duration_seconds = ?
            WHERE id = ?
          `).run(interval.start_time, interval.end_time, interval.duration_seconds || 0, interval.id);
          updatedIds.add(interval.id);
        } else {
          // Create new interval
          const newId = uuidv4();
          db.prepare(`
            INSERT INTO timer_intervals (id, time_entry_id, user_id, workspace_id, start_time, end_time, duration_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(newId, req.params.id, req.userId, req.workspaceId, interval.start_time, interval.end_time, interval.duration_seconds || 0);
        }
      }
      
      // Delete intervals that are no longer present
      for (const existingId of existingIds) {
        if (!updatedIds.has(existingId)) {
          db.prepare('DELETE FROM timer_intervals WHERE id = ?').run(existingId);
        }
      }
    }

    // Handle additional associations update if provided
    if (additional_associations !== undefined && Array.isArray(additional_associations)) {
      // Delete existing associations
      db.prepare('DELETE FROM time_entry_associations WHERE time_entry_id = ?').run(req.params.id);
      
      // Insert new associations
      const insertAssoc = db.prepare(`
        INSERT INTO time_entry_associations (id, time_entry_id, project_id, task_id, workspace_id)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      for (const assoc of additional_associations) {
        if (assoc.project_id || assoc.task_id) {
          insertAssoc.run(uuidv4(), req.params.id, assoc.project_id || null, assoc.task_id || null, req.workspaceId);
        }
      }
    }

    const entry = db.prepare(`
      SELECT te.*, p.name as project_name, t.name as task_name, s.title as subtask_title
      FROM time_entries te
      LEFT JOIN projects p ON te.project_id = p.id
      LEFT JOIN tasks t ON te.task_id = t.id
      LEFT JOIN subtasks s ON te.subtask_id = s.id
      WHERE te.id = ?
    `).get(req.params.id);

    // Fetch associations
    const associations = db.prepare(`
      SELECT tea.*, p.name as project_name, t.name as task_name
      FROM time_entry_associations tea
      LEFT JOIN projects p ON tea.project_id = p.id
      LEFT JOIN tasks t ON tea.task_id = t.id
      WHERE tea.time_entry_id = ?
    `).all(req.params.id);

    res.json({ ...entry, additional_associations: associations });
  } catch (error) {
    console.error('Update time entry error:', error);
    res.status(500).json({ error: `שגיאה בעדכון רשומת הזמן: ${error.message}` });
  }
});

// Get intervals for a time entry
router.get('/entries/:id/intervals', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    // Check if entry exists and belongs to workspace
    const entry = db.prepare('SELECT * FROM time_entries WHERE id = ? AND workspace_id = ?').get(req.params.id, req.workspaceId);
    if (!entry) {
      return res.status(404).json({ error: 'רשומה לא נמצאה' });
    }

    // Check permission
    if (entry.user_id !== req.userId && !canViewAllTimeEntries(req)) {
      return res.status(403).json({ error: 'אין הרשאה לצפות ברשומה זו' });
    }

    const intervals = db.prepare(`
      SELECT id, start_time, end_time, duration_seconds
      FROM timer_intervals
      WHERE time_entry_id = ?
      ORDER BY start_time ASC
    `).all(req.params.id);

    res.json(intervals);
  } catch (error) {
    console.error('Get intervals error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת האינטרוולים' });
  }
});

// Delete time entry
router.delete('/entries/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    // Check if entry exists and belongs to workspace
    const existing = db.prepare('SELECT * FROM time_entries WHERE id = ? AND workspace_id = ?').get(req.params.id, req.workspaceId);
    if (!existing) {
      return res.status(404).json({ error: 'רשומה לא נמצאה' });
    }

    // Only allow deleting own entries (unless admin/owner)
    if (existing.user_id !== req.userId && !canViewAllTimeEntries(req)) {
      return res.status(403).json({ error: 'אין הרשאה למחוק רשומה זו' });
    }

    // Delete associated intervals
    db.prepare('DELETE FROM timer_intervals WHERE time_entry_id = ?').run(req.params.id);

    db.prepare('DELETE FROM time_entries WHERE id = ?').run(req.params.id);

    res.json({ message: 'הרשומה נמחקה בהצלחה' });
  } catch (error) {
    console.error('Delete time entry error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת הרשומה' });
  }
});

export default router;
