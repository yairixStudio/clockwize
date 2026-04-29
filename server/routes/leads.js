import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = Router();

const getDb = (req) => req.app.locals.db;

// Helper: Ensure a lead has an internal (shadow) project for tasks/time tracking
function ensureLeadProject(db, lead, userId, workspaceId) {
  // Check if internal project already exists and is valid
  if (lead.internal_project_id) {
    const existingProject = db.prepare('SELECT id FROM projects WHERE id = ?').get(lead.internal_project_id);
    if (existingProject) return lead.internal_project_id;
  }

  // Determine the client_id for the internal project
  let clientId = lead.client_id; // For opportunities, use the linked client

  if (!clientId) {
    // For new leads, find or create internal container client for this workspace
    let internalClient = db.prepare(
      `SELECT id FROM clients WHERE workspace_id = ? AND is_internal = 1 LIMIT 1`
    ).get(workspaceId);

    if (!internalClient) {
      const internalClientId = uuidv4();
      db.prepare(`
        INSERT INTO clients (id, user_id, workspace_id, name, status, is_internal)
        VALUES (?, ?, ?, ?, 'active', 1)
      `).run(internalClientId, userId, workspaceId, 'לידים (פנימי)');
      clientId = internalClientId;
    } else {
      clientId = internalClient.id;
    }
  }

  // Create the internal project
  const projectId = uuidv4();
  db.prepare(`
    INSERT INTO projects (id, client_id, user_id, workspace_id, name, status, lead_id, is_internal)
    VALUES (?, ?, ?, ?, ?, 'active', ?, 1)
  `).run(projectId, clientId, userId, workspaceId, `ליד: ${lead.name}`, lead.id);

  // Update lead with internal project reference
  db.prepare('UPDATE leads SET internal_project_id = ? WHERE id = ?').run(projectId, lead.id);

  return projectId;
}

// Apply auth middleware to all routes except webhook
router.use((req, res, next) => {
  if (req.path === '/webhook' && req.method === 'POST') {
    return next();
  }
  authMiddleware(req, res, () => workspaceMiddleware(req, res, next));
});

// Get all leads with filters
router.get('/', async (req, res) => {
  try {
    const db = getDb(req);
    const { status, priority, assigned_to, search, sort, order, from_date, to_date } = req.query;

    let sql = `
      SELECT l.*,
        u.name as assigned_to_name,
        cs.name as source_name,
        oc.name as opportunity_client_name
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN client_sources cs ON l.source_id = cs.id
      LEFT JOIN clients oc ON l.client_id = oc.id
      WHERE l.workspace_id = ?
    `;
    const params = [req.workspaceId];

    if (status) {
      const statuses = status.split(',');
      sql += ` AND l.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    if (priority) {
      const priorities = priority.split(',');
      sql += ` AND l.priority IN (${priorities.map(() => '?').join(',')})`;
      params.push(...priorities);
    }

    if (assigned_to) {
      sql += ` AND l.assigned_to = ?`;
      params.push(assigned_to);
    }

    if (search) {
      sql += ` AND (l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.company LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    if (from_date) {
      sql += ` AND l.expected_close_date >= ?`;
      params.push(from_date);
    }

    if (to_date) {
      sql += ` AND l.expected_close_date <= ?`;
      params.push(to_date);
    }

    const sortField = sort || 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    const allowedSorts = ['created_at', 'updated_at', 'name', 'status', 'priority', 'expected_value', 'expected_close_date'];
    const safeSortField = allowedSorts.includes(sortField) ? `l.${sortField}` : 'l.created_at';
    sql += ` ORDER BY ${safeSortField} ${sortOrder}`;

    const leads = db.prepare(sql).all(...params);
    res.json(leads);
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת לידים' });
  }
});

// Get leads stats
router.get('/stats', async (req, res) => {
  try {
    const db = getDb(req);

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count, COALESCE(SUM(expected_value), 0) as total_value
      FROM leads WHERE workspace_id = ?
      GROUP BY status
    `).all(req.workspaceId);

    const byPriority = db.prepare(`
      SELECT priority, COUNT(*) as count
      FROM leads WHERE workspace_id = ? AND status NOT IN ('won', 'lost')
      GROUP BY priority
    `).all(req.workspaceId);

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM leads WHERE workspace_id = ?
    `).get(req.workspaceId);

    const activeCount = db.prepare(`
      SELECT COUNT(*) as count FROM leads WHERE workspace_id = ? AND status NOT IN ('won', 'lost')
    `).get(req.workspaceId);

    const wonThisMonth = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(expected_value), 0) as total_value
      FROM leads WHERE workspace_id = ? AND status = 'won'
      AND converted_at >= date('now', 'start of month')
    `).get(req.workspaceId);

    const upcomingCloses = db.prepare(`
      SELECT COUNT(*) as count
      FROM leads WHERE workspace_id = ? AND status NOT IN ('won', 'lost')
      AND expected_close_date IS NOT NULL
      AND expected_close_date <= date('now', '+7 days')
      AND expected_close_date >= date('now')
    `).get(req.workspaceId);

    res.json({
      byStatus,
      byPriority,
      total: total.count,
      active: activeCount.count,
      wonThisMonth: wonThisMonth.count,
      wonThisMonthValue: wonThisMonth.total_value,
      upcomingCloses: upcomingCloses.count
    });
  } catch (error) {
    console.error('Get leads stats error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת סטטיסטיקות' });
  }
});

// Get pipeline data (grouped by status)
router.get('/pipeline', async (req, res) => {
  try {
    const db = getDb(req);
    const leads = db.prepare(`
      SELECT l.*,
        u.name as assigned_to_name,
        cs.name as source_name,
        oc.name as opportunity_client_name
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN client_sources cs ON l.source_id = cs.id
      LEFT JOIN clients oc ON l.client_id = oc.id
      WHERE l.workspace_id = ?
      ORDER BY l.updated_at DESC
    `).all(req.workspaceId);

    const pipeline = {};
    const statuses = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
    statuses.forEach(s => { pipeline[s] = []; });

    leads.forEach(lead => {
      if (pipeline[lead.status]) {
        pipeline[lead.status].push(lead);
      }
    });

    res.json(pipeline);
  } catch (error) {
    console.error('Get pipeline error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת pipeline' });
  }
});

// Get single lead with activities and reminders
router.get('/:id', async (req, res) => {
  try {
    const db = getDb(req);
    const lead = db.prepare(`
      SELECT l.*,
        u.name as assigned_to_name,
        cs.name as source_name,
        c.name as converted_client_name,
        oc.name as opportunity_client_name
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN client_sources cs ON l.source_id = cs.id
      LEFT JOIN clients c ON l.converted_client_id = c.id
      LEFT JOIN clients oc ON l.client_id = oc.id
      WHERE l.id = ? AND l.workspace_id = ?
    `).get(req.params.id, req.workspaceId);

    if (!lead) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }

    const activities = db.prepare(`
      SELECT la.*, u.name as user_name
      FROM lead_activities la
      LEFT JOIN users u ON la.user_id = u.id
      WHERE la.lead_id = ?
      ORDER BY la.created_at DESC
    `).all(req.params.id);

    // Use unified reminders table instead of lead_reminders
    const reminders = db.prepare(`
      SELECT r.*, r.is_read as is_completed
      FROM reminders r
      WHERE r.association_type = 'lead' AND r.association_id = ? AND r.workspace_id = ?
      ORDER BY r.due_date ASC
    `).all(req.params.id, req.workspaceId);

    // Get planned slots associated with this lead
    const plannedSlots = db.prepare(`
      SELECT ps.*, p.name as project_name, c.name as client_name
      FROM planned_slots ps
      LEFT JOIN projects p ON ps.project_id = p.id
      LEFT JOIN clients c ON ps.client_id = c.id
      WHERE ps.lead_id = ? AND ps.workspace_id = ?
      ORDER BY ps.date ASC
    `).all(req.params.id, req.workspaceId);

    // Get tasks and time entries from internal project (if exists)
    let tasks = [];
    let timeEntries = [];
    let totalTimeInvested = 0;
    if (lead.internal_project_id) {
      tasks = db.prepare(`
        SELECT t.*,
          COALESCE((SELECT SUM(duration) FROM time_entries WHERE task_id = t.id), 0) as total_time
        FROM tasks t
        WHERE t.project_id = ?
        ORDER BY t.created_at DESC
      `).all(lead.internal_project_id);

      timeEntries = db.prepare(`
        SELECT te.*, t.name as task_name
        FROM time_entries te
        LEFT JOIN tasks t ON te.task_id = t.id
        WHERE te.project_id = ?
        ORDER BY te.start_time DESC
      `).all(lead.internal_project_id);

      const timeSum = db.prepare(`
        SELECT COALESCE(SUM(duration), 0) as total
        FROM time_entries WHERE project_id = ?
      `).get(lead.internal_project_id);
      totalTimeInvested = timeSum.total;
    }

    res.json({ ...lead, activities, reminders, plannedSlots, tasks, timeEntries, totalTimeInvested });
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת ליד' });
  }
});

// Create lead
router.post('/', async (req, res) => {
  try {
    const db = getDb(req);
    const {
      name, email, phone, company,
      source_type, source_id, source_detail,
      status, priority, expected_value, expected_close_date,
      assigned_to, tags, notes,
      client_id, is_opportunity
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'שם ליד נדרש' });
    }

    const id = uuidv4();
    const opportunityFlag = (client_id || is_opportunity) ? 1 : 0;
    db.prepare(`
      INSERT INTO leads (id, workspace_id, user_id, name, email, phone, company,
        source_type, source_id, source_detail, status, priority,
        expected_value, expected_close_date, assigned_to, tags, notes,
        client_id, is_opportunity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.workspaceId, req.userId,
      name, email || null, phone || null, company || null,
      source_type || 'other', source_id || null, source_detail || null,
      status || 'new', priority || 'warm',
      expected_value || null, expected_close_date || null,
      assigned_to || null, tags ? JSON.stringify(tags) : null, notes || null,
      client_id || null, opportunityFlag
    );

    // Create system activity for lead creation
    const activityContent = client_id ? 'הזדמנות חדשה נוצרה' : 'ליד חדש נוצר';
    db.prepare(`
      INSERT INTO lead_activities (id, lead_id, workspace_id, user_id, activity_type, content)
      VALUES (?, ?, ?, ?, 'system', ?)
    `).run(uuidv4(), id, req.workspaceId, req.userId, activityContent);

    const lead = db.prepare(`
      SELECT l.*, u.name as assigned_to_name, cs.name as source_name, oc.name as opportunity_client_name
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN client_sources cs ON l.source_id = cs.id
      LEFT JOIN clients oc ON l.client_id = oc.id
      WHERE l.id = ?
    `).get(id);

    res.status(201).json(lead);
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת ליד' });
  }
});

// Update lead
router.put('/:id', async (req, res) => {
  try {
    const db = getDb(req);
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);

    if (!lead) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }

    const {
      name, email, phone, company,
      source_type, source_id, source_detail,
      status, priority, expected_value, expected_close_date,
      assigned_to, tags, notes, lost_reason
    } = req.body;

    // Track status change
    if (status && status !== lead.status) {
      db.prepare(`
        INSERT INTO lead_activities (id, lead_id, workspace_id, user_id, activity_type, content, metadata)
        VALUES (?, ?, ?, ?, 'status_change', ?, ?)
      `).run(
        uuidv4(), lead.id, req.workspaceId, req.userId,
        `סטטוס שונה מ-"${lead.status}" ל-"${status}"`,
        JSON.stringify({ from_status: lead.status, to_status: status })
      );
    }

    // Track assignment change
    if (assigned_to !== undefined && assigned_to !== lead.assigned_to) {
      const assigneeName = assigned_to
        ? db.prepare('SELECT name FROM users WHERE id = ?').get(assigned_to)?.name || 'לא ידוע'
        : null;
      db.prepare(`
        INSERT INTO lead_activities (id, lead_id, workspace_id, user_id, activity_type, content, metadata)
        VALUES (?, ?, ?, ?, 'assignment', ?, ?)
      `).run(
        uuidv4(), lead.id, req.workspaceId, req.userId,
        assigneeName ? `הוקצה ל-${assigneeName}` : 'הוסרה הקצאה',
        JSON.stringify({ assigned_to: assigned_to || null })
      );
    }

    db.prepare(`
      UPDATE leads SET
        name = ?, email = ?, phone = ?, company = ?,
        source_type = ?, source_id = ?, source_detail = ?,
        status = ?, priority = ?, expected_value = ?, expected_close_date = ?,
        assigned_to = ?, tags = ?, notes = ?, lost_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(
      name ?? lead.name, email ?? lead.email, phone ?? lead.phone, company ?? lead.company,
      source_type ?? lead.source_type, source_id ?? lead.source_id, source_detail ?? lead.source_detail,
      status ?? lead.status, priority ?? lead.priority,
      expected_value ?? lead.expected_value, expected_close_date ?? lead.expected_close_date,
      assigned_to !== undefined ? assigned_to : lead.assigned_to,
      tags ? JSON.stringify(tags) : lead.tags, notes ?? lead.notes,
      lost_reason ?? lead.lost_reason,
      req.params.id, req.workspaceId
    );

    const updated = db.prepare(`
      SELECT l.*, u.name as assigned_to_name, cs.name as source_name
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN client_sources cs ON l.source_id = cs.id
      WHERE l.id = ?
    `).get(req.params.id);

    res.json(updated);
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון ליד' });
  }
});

// Quick status update
router.patch('/:id/status', async (req, res) => {
  try {
    const db = getDb(req);
    const { status, lost_reason } = req.body;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);

    if (!lead) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }

    const validStatuses = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'סטטוס לא תקין' });
    }

    db.prepare(`
      UPDATE leads SET status = ?, lost_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, status === 'lost' ? (lost_reason || null) : lead.lost_reason, req.params.id);

    // Auto-log status change
    db.prepare(`
      INSERT INTO lead_activities (id, lead_id, workspace_id, user_id, activity_type, content, metadata)
      VALUES (?, ?, ?, ?, 'status_change', ?, ?)
    `).run(
      uuidv4(), lead.id, req.workspaceId, req.userId,
      `סטטוס שונה מ-"${lead.status}" ל-"${status}"`,
      JSON.stringify({ from_status: lead.status, to_status: status })
    );

    const updated = db.prepare(`
      SELECT l.*, u.name as assigned_to_name, cs.name as source_name
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN client_sources cs ON l.source_id = cs.id
      WHERE l.id = ?
    `).get(req.params.id);

    res.json(updated);
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון סטטוס' });
  }
});

// Assign lead
router.patch('/:id/assign', async (req, res) => {
  try {
    const db = getDb(req);
    const { assigned_to } = req.body;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);

    if (!lead) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }

    db.prepare(`
      UPDATE leads SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(assigned_to || null, req.params.id);

    const assigneeName = assigned_to
      ? db.prepare('SELECT name FROM users WHERE id = ?').get(assigned_to)?.name || 'לא ידוע'
      : null;

    db.prepare(`
      INSERT INTO lead_activities (id, lead_id, workspace_id, user_id, activity_type, content, metadata)
      VALUES (?, ?, ?, ?, 'assignment', ?, ?)
    `).run(
      uuidv4(), lead.id, req.workspaceId, req.userId,
      assigneeName ? `הוקצה ל-${assigneeName}` : 'הוסרה הקצאה',
      JSON.stringify({ assigned_to: assigned_to || null })
    );

    const updated = db.prepare(`
      SELECT l.*, u.name as assigned_to_name, cs.name as source_name
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN client_sources cs ON l.source_id = cs.id
      WHERE l.id = ?
    `).get(req.params.id);

    res.json(updated);
  } catch (error) {
    console.error('Assign lead error:', error);
    res.status(500).json({ error: 'שגיאה בהקצאת ליד' });
  }
});

// Convert lead to client (enhanced with acquisition project & history transfer)
router.post('/:id/convert', async (req, res) => {
  try {
    const db = getDb(req);
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);

    if (!lead) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }

    if (lead.converted_client_id) {
      return res.status(400).json({ error: 'ליד כבר הומר ללקוח' });
    }

    // Safety check: no active timers on internal project
    if (lead.internal_project_id) {
      const activeTimer = db.prepare(
        'SELECT id FROM active_timers WHERE project_id = ? AND workspace_id = ?'
      ).get(lead.internal_project_id, req.workspaceId);
      if (activeTimer) {
        return res.status(400).json({ error: 'יש לעצור את הטיימר לפני המרת הליד' });
      }
    }

    const {
      override_name, override_email, override_phone, override_company,
      create_acquisition_project = true,
      acquisition_project_name = 'רכישת לקוח',
      transfer_history = true
    } = req.body;

    // Step 1: Create or use existing client
    let clientId;
    if (lead.client_id) {
      // Opportunity - use existing client
      clientId = lead.client_id;
    } else {
      // New lead - create new client
      clientId = uuidv4();
      db.prepare(`
        INSERT INTO clients (id, user_id, workspace_id, name, email, phone, address, source_id, sub_source, lead_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(
        clientId, req.userId, req.workspaceId,
        override_name || lead.name,
        override_email || lead.email,
        override_phone || lead.phone,
        override_company || lead.company,
        lead.source_id,
        lead.source_detail,
        lead.id
      );
    }

    // Step 2: Create acquisition project
    let acquisitionProjectId = null;
    if (create_acquisition_project) {
      acquisitionProjectId = uuidv4();
      db.prepare(`
        INSERT INTO projects (id, client_id, user_id, workspace_id, name, description, status, lead_id, is_internal)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0)
      `).run(
        acquisitionProjectId, clientId, req.userId, req.workspaceId,
        acquisition_project_name,
        `פרויקט רכישת לקוח מליד: ${lead.name}. כולל את כל ההיסטוריה מתהליך המכירה.`,
        lead.id
      );
    }

    // Step 3: Transfer history from internal project to acquisition project
    if (transfer_history && acquisitionProjectId && lead.internal_project_id) {
      // Move tasks
      db.prepare('UPDATE tasks SET project_id = ? WHERE project_id = ?')
        .run(acquisitionProjectId, lead.internal_project_id);

      // Move time entries
      db.prepare('UPDATE time_entries SET project_id = ? WHERE project_id = ?')
        .run(acquisitionProjectId, lead.internal_project_id);

      // Move any active timers (shouldn't exist due to safety check, but handle gracefully)
      db.prepare('UPDATE active_timers SET project_id = ? WHERE project_id = ?')
        .run(acquisitionProjectId, lead.internal_project_id);

      // Delete the now-empty internal project
      db.prepare('DELETE FROM projects WHERE id = ?').run(lead.internal_project_id);

      // Clear internal project reference
      db.prepare('UPDATE leads SET internal_project_id = NULL WHERE id = ?').run(lead.id);
    }

    // Step 4: Build activity history content
    let activityLog = '';
    const activities = db.prepare(`
      SELECT la.*, u.name as user_name
      FROM lead_activities la
      LEFT JOIN users u ON la.user_id = u.id
      WHERE la.lead_id = ?
      ORDER BY la.created_at ASC
    `).all(lead.id);

    if (activities.length > 0) {
      activityLog = activities.map(a => {
        const date = new Date(a.created_at).toLocaleDateString('he-IL');
        const typeLabels = { note: 'הערה', call: 'שיחה', meeting: 'פגישה', email: 'אימייל', status_change: 'שינוי סטטוס', assignment: 'הקצאה', system: 'מערכת' };
        const typeLabel = typeLabels[a.activity_type] || a.activity_type;
        return `[${date}] [${typeLabel}] ${a.content || ''} (${a.user_name || ''})`;
      }).join('\n');
    }

    // Build lead summary for embedding
    const leadSummaryParts = [];
    leadSummaryParts.push(`שם ליד: ${lead.name}`);
    if (lead.company) leadSummaryParts.push(`חברה: ${lead.company}`);
    if (lead.email) leadSummaryParts.push(`אימייל: ${lead.email}`);
    if (lead.phone) leadSummaryParts.push(`טלפון: ${lead.phone}`);
    if (lead.expected_value) leadSummaryParts.push(`ערך צפוי: ₪${lead.expected_value}`);
    if (lead.notes) leadSummaryParts.push(`הערות: ${lead.notes}`);
    const leadSummary = leadSummaryParts.join('\n');

    // Step 4a: For opportunities - create "רכישת פרויקט" task with lead data at zero cost
    let acquisitionTaskId = null;
    if (lead.client_id && acquisitionProjectId) {
      acquisitionTaskId = uuidv4();
      const taskDescription = [
        '--- פרטי ליד ---',
        leadSummary,
        '',
        activityLog ? '--- היסטוריית פעילות ---' : '',
        activityLog
      ].filter(Boolean).join('\n');

      db.prepare(`
        INSERT INTO tasks (id, project_id, user_id, workspace_id, name, description, status, hourly_rate, pricing_type)
        VALUES (?, ?, ?, ?, ?, ?, 'completed', 0, 'no_charge')
      `).run(
        acquisitionTaskId, acquisitionProjectId, req.userId, req.workspaceId,
        'רכישת פרויקט',
        taskDescription
      );
    }

    // Step 4b: For new leads - save activity history as note on acquisition project
    if (!lead.client_id && acquisitionProjectId && activityLog) {
      db.prepare(`
        INSERT INTO notes (id, user_id, entity_type, entity_id, title, content)
        VALUES (?, ?, 'project', ?, ?, ?)
      `).run(uuidv4(), req.userId, acquisitionProjectId, 'היסטוריית ליד', activityLog);
    }

    // Step 5: Update lead status
    db.prepare(`
      UPDATE leads SET status = 'won', converted_client_id = ?, converted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(clientId, lead.id);

    // Step 6: Log conversion activity
    db.prepare(`
      INSERT INTO lead_activities (id, lead_id, workspace_id, user_id, activity_type, content, metadata)
      VALUES (?, ?, ?, ?, 'system', ?, ?)
    `).run(
      uuidv4(), lead.id, req.workspaceId, req.userId,
      'ליד הומר ללקוח',
      JSON.stringify({
        client_id: clientId,
        acquisition_project_id: acquisitionProjectId,
        transferred_history: transfer_history && !!lead.internal_project_id,
        was_opportunity: !!lead.client_id
      })
    );

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    const updatedLead = db.prepare(`
      SELECT l.*, u.name as assigned_to_name, cs.name as source_name, c.name as converted_client_name
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN client_sources cs ON l.source_id = cs.id
      LEFT JOIN clients c ON l.converted_client_id = c.id
      WHERE l.id = ?
    `).get(lead.id);

    res.json({ lead: updatedLead, client, acquisition_project_id: acquisitionProjectId, acquisition_task_id: acquisitionTaskId });
  } catch (error) {
    console.error('Convert lead error:', error);
    res.status(500).json({ error: 'שגיאה בהמרת ליד ללקוח' });
  }
});

// Delete lead (also cleans up internal project)
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb(req);
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);

    if (!lead) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }

    // Clean up internal project and its tasks/time entries (CASCADE handles tasks->time_entries)
    if (lead.internal_project_id) {
      db.prepare('DELETE FROM time_entries WHERE project_id = ?').run(lead.internal_project_id);
      db.prepare('DELETE FROM tasks WHERE project_id = ?').run(lead.internal_project_id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(lead.internal_project_id);
    }

    // Clean up unified reminders for this lead
    db.prepare(`DELETE FROM reminders WHERE association_type = 'lead' AND association_id = ?`).run(req.params.id);

    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת ליד' });
  }
});

// === Lead Tasks & Time ===

// Ensure lead has an internal project (called before timer start, etc.)
router.post('/:id/ensure-project', async (req, res) => {
  try {
    const db = getDb(req);
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });

    const projectId = ensureLeadProject(db, lead, req.userId, req.workspaceId);
    res.json({ project_id: projectId });
  } catch (error) {
    console.error('Ensure lead project error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת פרויקט ליד' });
  }
});

// Get lead tasks
router.get('/:id/tasks', async (req, res) => {
  try {
    const db = getDb(req);
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });

    if (!lead.internal_project_id) return res.json([]);

    const tasks = db.prepare(`
      SELECT t.*,
        COALESCE((SELECT SUM(duration) FROM time_entries WHERE task_id = t.id), 0) as total_time
      FROM tasks t
      WHERE t.project_id = ?
      ORDER BY t.created_at DESC
    `).all(lead.internal_project_id);

    res.json(tasks);
  } catch (error) {
    console.error('Get lead tasks error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת משימות ליד' });
  }
});

// Create task on lead
router.post('/:id/tasks', async (req, res) => {
  try {
    const db = getDb(req);
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });

    const { name, description, priority, estimated_hours } = req.body;
    if (!name) return res.status(400).json({ error: 'שם משימה נדרש' });

    const projectId = ensureLeadProject(db, lead, req.userId, req.workspaceId);
    const taskId = uuidv4();

    db.prepare(`
      INSERT INTO tasks (id, project_id, user_id, workspace_id, name, description, status, priority, estimated_hours)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      taskId, projectId, req.userId, req.workspaceId,
      name, description || null, priority || 'normal', estimated_hours || null
    );

    // Log activity
    db.prepare(`
      INSERT INTO lead_activities (id, lead_id, workspace_id, user_id, activity_type, content)
      VALUES (?, ?, ?, ?, 'system', ?)
    `).run(uuidv4(), lead.id, req.workspaceId, req.userId, `משימה חדשה: ${name}`);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    res.status(201).json(task);
  } catch (error) {
    console.error('Create lead task error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת משימה' });
  }
});

// Get lead time entries
router.get('/:id/time-entries', async (req, res) => {
  try {
    const db = getDb(req);
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });

    if (!lead.internal_project_id) return res.json([]);

    const entries = db.prepare(`
      SELECT te.*, t.name as task_name
      FROM time_entries te
      LEFT JOIN tasks t ON te.task_id = t.id
      WHERE te.project_id = ?
      ORDER BY te.start_time DESC
    `).all(lead.internal_project_id);

    res.json(entries);
  } catch (error) {
    console.error('Get lead time entries error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת רשומות זמן' });
  }
});

// === Activities ===

// Get lead activities
router.get('/:id/activities', async (req, res) => {
  try {
    const db = getDb(req);
    const activities = db.prepare(`
      SELECT la.*, u.name as user_name
      FROM lead_activities la
      LEFT JOIN users u ON la.user_id = u.id
      WHERE la.lead_id = ? AND la.workspace_id = ?
      ORDER BY la.created_at DESC
    `).all(req.params.id, req.workspaceId);

    res.json(activities);
  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת פעילויות' });
  }
});

// Add activity
router.post('/:id/activities', async (req, res) => {
  try {
    const db = getDb(req);
    const { activity_type, content } = req.body;

    if (!activity_type || !content) {
      return res.status(400).json({ error: 'סוג פעילות ותוכן נדרשים' });
    }

    const lead = db.prepare('SELECT id FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);
    if (!lead) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO lead_activities (id, lead_id, workspace_id, user_id, activity_type, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, req.workspaceId, req.userId, activity_type, content);

    // Update lead's updated_at
    db.prepare('UPDATE leads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);

    const activity = db.prepare(`
      SELECT la.*, u.name as user_name
      FROM lead_activities la
      LEFT JOIN users u ON la.user_id = u.id
      WHERE la.id = ?
    `).get(id);

    res.status(201).json(activity);
  } catch (error) {
    console.error('Add activity error:', error);
    res.status(500).json({ error: 'שגיאה בהוספת פעילות' });
  }
});

// Delete activity
router.delete('/:id/activities/:activityId', async (req, res) => {
  try {
    const db = getDb(req);
    db.prepare('DELETE FROM lead_activities WHERE id = ? AND lead_id = ? AND workspace_id = ?')
      .run(req.params.activityId, req.params.id, req.workspaceId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete activity error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת פעילות' });
  }
});

// === Reminders (unified with main reminders system) ===

// Get lead reminders (from unified reminders table)
router.get('/:id/reminders', async (req, res) => {
  try {
    const db = getDb(req);
    const reminders = db.prepare(`
      SELECT r.*, r.is_read as is_completed
      FROM reminders r
      WHERE r.association_type = 'lead' AND r.association_id = ? AND r.workspace_id = ?
      ORDER BY r.due_date ASC
    `).all(req.params.id, req.workspaceId);

    res.json(reminders);
  } catch (error) {
    console.error('Get reminders error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת תזכורות' });
  }
});

// Create reminder (in unified reminders table)
router.post('/:id/reminders', async (req, res) => {
  try {
    const db = getDb(req);
    const { content, due_date, notes, is_recurring, recurrence_interval } = req.body;

    if (!content || !due_date) {
      return res.status(400).json({ error: 'תוכן ותאריך נדרשים' });
    }

    const lead = db.prepare('SELECT id FROM leads WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.workspaceId);
    if (!lead) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO reminders (id, user_id, workspace_id, content, notes, due_date, association_type, association_id, is_recurring, recurrence_interval)
      VALUES (?, ?, ?, ?, ?, ?, 'lead', ?, ?, ?)
    `).run(id, req.userId, req.workspaceId, content, notes || null, due_date, req.params.id,
      is_recurring ? 1 : 0, recurrence_interval || null);

    const reminder = db.prepare(`SELECT r.*, r.is_read as is_completed FROM reminders r WHERE r.id = ?`).get(id);
    res.status(201).json(reminder);
  } catch (error) {
    console.error('Create reminder error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת תזכורת' });
  }
});

// Update reminder (in unified reminders table)
router.put('/:id/reminders/:reminderId', async (req, res) => {
  try {
    const db = getDb(req);
    const { content, due_date, is_completed } = req.body;

    // Map is_completed to is_read in unified reminders table
    const isRead = is_completed !== undefined ? is_completed : undefined;

    db.prepare(`
      UPDATE reminders
      SET content = COALESCE(?, content),
          due_date = COALESCE(?, due_date),
          is_read = COALESCE(?, is_read),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND association_type = 'lead' AND association_id = ? AND workspace_id = ?
    `).run(content, due_date, isRead, req.params.reminderId, req.params.id, req.workspaceId);

    const reminder = db.prepare(`SELECT r.*, r.is_read as is_completed FROM reminders r WHERE r.id = ?`).get(req.params.reminderId);
    res.json(reminder);
  } catch (error) {
    console.error('Update reminder error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון תזכורת' });
  }
});

// Delete reminder (from unified reminders table)
router.delete('/:id/reminders/:reminderId', async (req, res) => {
  try {
    const db = getDb(req);
    db.prepare(`DELETE FROM reminders WHERE id = ? AND association_type = 'lead' AND association_id = ? AND workspace_id = ?`)
      .run(req.params.reminderId, req.params.id, req.workspaceId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete reminder error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת תזכורת' });
  }
});

// === Webhook (stub for future use) ===
router.post('/webhook', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const db = req.app.locals.db;
    const setting = db.prepare(`
      SELECT workspace_id FROM addon_settings
      WHERE addon_id = 'leads_management' AND setting_key = 'webhook_api_key' AND setting_value = ?
    `).get(apiKey);

    if (!setting) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    const { name, email, phone, company, source_type, source_detail } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Get workspace owner as the user
    const owner = db.prepare(`
      SELECT user_id FROM workspace_members WHERE workspace_id = ? AND role = 'owner' LIMIT 1
    `).get(setting.workspace_id);

    const id = uuidv4();
    db.prepare(`
      INSERT INTO leads (id, workspace_id, user_id, name, email, phone, company, source_type, source_detail, status, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'warm')
    `).run(id, setting.workspace_id, owner.user_id, name, email || null, phone || null, company || null, source_type || 'website', source_detail || null);

    db.prepare(`
      INSERT INTO lead_activities (id, lead_id, workspace_id, user_id, activity_type, content)
      VALUES (?, ?, ?, ?, 'system', ?)
    `).run(uuidv4(), id, setting.workspace_id, owner.user_id, 'ליד נוצר דרך webhook');

    res.status(201).json({ id, status: 'created' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
