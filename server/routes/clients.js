import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Domain lookup for Chrome extension - MUST BE BEFORE /:id route!
router.get('/lookup/domain', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { domain } = req.query;

    if (!domain) {
      return res.status(400).json({ error: 'domain parameter is required' });
    }

    // Normalize: lowercase, strip protocol/path/port
    let normalizedDomain = domain.toLowerCase().trim();
    try {
      // If it looks like a URL, extract hostname
      if (normalizedDomain.includes('://')) {
        normalizedDomain = new URL(normalizedDomain).hostname;
      }
    } catch (e) {
      // Keep as-is if not a valid URL
    }

    // Get all clients with non-empty domains
    const clients = db.prepare(`
      SELECT id, name, status, domains
      FROM clients
      WHERE workspace_id = ? AND domains IS NOT NULL AND domains != '' AND domains != '[]'
    `).all(req.workspaceId);

    const matches = [];
    for (const client of clients) {
      let clientDomains = [];
      try { clientDomains = JSON.parse(client.domains); } catch (e) { continue; }
      if (!Array.isArray(clientDomains)) continue;

      for (const d of clientDomains) {
        const cd = d.toLowerCase().trim();
        if (normalizedDomain === cd || normalizedDomain.endsWith('.' + cd)) {
          matches.push({
            id: client.id,
            name: client.name,
            status: client.status,
            matched_domain: cd
          });
          break; // One match per client is enough
        }
      }
    }

    res.json({ domain: normalizedDomain, clients: matches });
  } catch (error) {
    console.error('Domain lookup error:', error);
    res.status(500).json({ error: 'שגיאה בחיפוש דומיין' });
  }
});

// Public shared client view - MUST BE BEFORE /:id route!
router.get('/shared/:token', (req, res) => {
  try {
    const db = getDb(req);
    const client = db.prepare(`
      SELECT c.id, c.name, c.share_permissions
      FROM clients c
      WHERE c.share_token = ?
    `).get(req.params.token);

    if (!client) {
      return res.status(404).json({ error: 'לינק לא תקין' });
    }

    // Get projects for this client
    const projects = db.prepare(`
      SELECT p.id, p.name, p.description, p.status, p.pricing_type,
        (SELECT COALESCE(SUM(duration), 0) FROM time_entries WHERE project_id = p.id) as total_time,
        (SELECT COALESCE(SUM(te.duration), 0) FROM time_entries te LEFT JOIN tasks t ON te.task_id = t.id WHERE te.project_id = p.id AND (t.pricing_type IS NULL OR t.pricing_type != 'no_charge')) as billable_time
      FROM projects p
      WHERE p.client_id = ?
    `).all(client.id);

    client.projects = projects;
    res.json(client);
  } catch (error) {
    console.error('Get shared client error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הנתונים' });
  }
});

// Get all clients
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    // Simpler query to fetch data, sorting will be enhanced in JS
    const clients = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM projects WHERE client_id = c.id) as project_count,
        (SELECT COALESCE(SUM(te.duration), 0) FROM time_entries te
         JOIN projects p ON te.project_id = p.id
         WHERE p.client_id = c.id) as total_time,
        (SELECT COALESCE(SUM(te.duration), 0) FROM time_entries te
         JOIN projects p ON te.project_id = p.id
         LEFT JOIN tasks t ON te.task_id = t.id
         WHERE p.client_id = c.id AND (p.pricing_type IS NULL OR p.pricing_type != 'no_charge') AND (t.pricing_type IS NULL OR t.pricing_type != 'no_charge')) as billable_time,
        (SELECT MAX(updated_at) FROM projects WHERE client_id = c.id) as last_project_update,
        (SELECT MAX(t.updated_at) FROM tasks t JOIN projects p ON t.project_id = p.id WHERE p.client_id = c.id) as last_task_update,
        (SELECT MAX(te.created_at) FROM time_entries te JOIN projects p ON te.project_id = p.id WHERE p.client_id = c.id) as last_entry_create,
        (SELECT MAX(te.start_time) FROM time_entries te JOIN projects p ON te.project_id = p.id WHERE p.client_id = c.id) as last_entry_start
      FROM clients c
      WHERE c.workspace_id = ? AND (c.is_internal IS NULL OR c.is_internal = 0)
    `).all(req.workspaceId);

    // Calculate last interaction and sort in JS
    clients.forEach(client => {
      const timestamps = [
        client.created_at,
        client.updated_at,
        client.last_project_update,
        client.last_task_update,
        client.last_entry_create,
        client.last_entry_start
      ].filter(t => t); // Filter out nulls/undefined/empty strings

      // Sort strings to find max (ISO strings sort correctly lexicographically)
      timestamps.sort();
      client.last_interaction = timestamps.length > 0 ? timestamps[timestamps.length - 1] : client.created_at;
    });

    // Sort by favorite first, then last interaction
    clients.sort((a, b) => {
      if (a.is_favorite !== b.is_favorite) {
        return b.is_favorite - a.is_favorite; // Favorites first (1 > 0)
      }
      // Sort by last_interaction descending
      if (a.last_interaction > b.last_interaction) return -1;
      if (a.last_interaction < b.last_interaction) return 1;
      return 0;
    });

    // Parse aliases and domains JSON for each client
    clients.forEach(client => {
      if (client.aliases) {
        try { client.aliases = JSON.parse(client.aliases); } catch (e) { client.aliases = []; }
      } else {
        client.aliases = [];
      }
      if (client.domains) {
        try { client.domains = JSON.parse(client.domains); } catch (e) { client.domains = []; }
      } else {
        client.domains = [];
      }
    });

    res.json(clients);
  } catch (error) {
    console.error('Get clients error:', error);
    // Log error to file for debugging
    try {
        fs.writeFileSync('server_error.log', error.toString() + '\n' + error.stack);
    } catch (e) { console.error('Failed to write error log', e); }
    res.status(500).json({ error: 'שגיאה בטעינת הלקוחות' });
  }
});

// Get single client
router.get('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const client = db.prepare(`
      SELECT c.*, cs.name as source_name,
        (SELECT COUNT(*) FROM projects WHERE client_id = c.id) as project_count,
        (SELECT COALESCE(SUM(te.duration), 0) FROM time_entries te
         JOIN projects p ON te.project_id = p.id
         WHERE p.client_id = c.id) as total_time,
        (SELECT COALESCE(SUM(te.duration), 0) FROM time_entries te
         JOIN projects p ON te.project_id = p.id
         LEFT JOIN tasks t ON te.task_id = t.id
         WHERE p.client_id = c.id AND (p.pricing_type IS NULL OR p.pricing_type != 'no_charge') AND (t.pricing_type IS NULL OR t.pricing_type != 'no_charge')) as billable_time
      FROM clients c
      LEFT JOIN client_sources cs ON c.source_id = cs.id
      WHERE c.id = ? AND (c.workspace_id = ? OR c.workspace_id IS NULL) AND c.user_id = ?
    `).get(req.params.id, req.workspaceId, req.userId);

    if (!client) {
      return res.status(404).json({ error: 'לקוח לא נמצא' });
    }

    // Parse aliases JSON
    if (client.aliases) {
      try { client.aliases = JSON.parse(client.aliases); } catch (e) { client.aliases = []; }
    } else {
      client.aliases = [];
    }
    // Parse domains JSON
    if (client.domains) {
      try { client.domains = JSON.parse(client.domains); } catch (e) { client.domains = []; }
    } else {
      client.domains = [];
    }

    res.json(client);
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הלקוח' });
  }
});

// Create client
router.post('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { name, address, phone, email, bank_name, bank_account, bank_branch, tax_id, notes, hourly_rate, status, is_favorite, morning_id, source_id, sub_source, aliases, domains } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'שם לקוח נדרש' });
    }

    const id = uuidv4();
    // Store aliases and domains as JSON strings
    const aliasesJson = aliases && Array.isArray(aliases) ? JSON.stringify(aliases) : null;
    const domainsJson = domains && Array.isArray(domains) ? JSON.stringify(domains) : null;

    db.prepare(`
      INSERT INTO clients (id, user_id, workspace_id, name, address, phone, email, bank_name, bank_account, bank_branch, tax_id, notes, hourly_rate, status, is_favorite, morning_id, source_id, sub_source, aliases, domains)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.userId, req.workspaceId, name, address || null, phone || null, email || null, bank_name || null, bank_account || null, bank_branch || null, tax_id || null, notes || null, hourly_rate || null, status || 'active', is_favorite ? 1 : 0, morning_id || null, source_id || null, sub_source || null, aliasesJson, domainsJson);

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    // Parse aliases and domains back to arrays for response
    if (client.aliases) {
      try { client.aliases = JSON.parse(client.aliases); } catch (e) { client.aliases = []; }
    } else {
      client.aliases = [];
    }
    if (client.domains) {
      try { client.domains = JSON.parse(client.domains); } catch (e) { client.domains = []; }
    } else {
      client.domains = [];
    }
    res.status(201).json(client);
  } catch (error) {
    console.error('Create client error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת הלקוח' });
  }
});

// Update client
router.patch('/:id/favorite', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { is_favorite } = req.body;

    const existing = db.prepare('SELECT * FROM clients WHERE id = ? AND (workspace_id = ? OR workspace_id IS NULL) AND user_id = ?').get(req.params.id, req.workspaceId, req.userId);
    if (!existing) {
      return res.status(404).json({ error: 'לקוח לא נמצא' });
    }

    db.prepare(`
      UPDATE clients 
      SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(is_favorite ? 1 : 0, req.params.id, req.workspaceId);

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    res.json(client);
  } catch (error) {
    console.error('Update client favorite error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הלקוח' });
  }
});

router.put('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { name, address, phone, email, bank_name, bank_account, bank_branch, tax_id, notes, hourly_rate, status, is_favorite, morning_id, source_id, sub_source, aliases, domains } = req.body;

    const existing = db.prepare('SELECT * FROM clients WHERE id = ? AND (workspace_id = ? OR workspace_id IS NULL) AND user_id = ?').get(req.params.id, req.workspaceId, req.userId);
    if (!existing) {
      return res.status(404).json({ error: 'לקוח לא נמצא' });
    }

    // Handle aliases and domains - store as JSON strings
    const aliasesJson = aliases !== undefined
      ? (Array.isArray(aliases) ? JSON.stringify(aliases) : null)
      : existing.aliases;
    const domainsJson = domains !== undefined
      ? (Array.isArray(domains) ? JSON.stringify(domains) : null)
      : existing.domains;

    db.prepare(`
      UPDATE clients
      SET name = ?, address = ?, phone = ?, email = ?, bank_name = ?, bank_account = ?,
          bank_branch = ?, tax_id = ?, notes = ?, hourly_rate = ?, status = ?, is_favorite = ?, morning_id = ?, source_id = ?, sub_source = ?, aliases = ?, domains = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(
      name || existing.name,
      address || null,
      phone || null,
      email || null,
      bank_name || null,
      bank_account || null,
      bank_branch || null,
      tax_id || null,
      notes || null,
      hourly_rate || null,
      status || existing.status || 'active',
      is_favorite !== undefined ? (is_favorite ? 1 : 0) : existing.is_favorite,
      morning_id !== undefined ? morning_id : existing.morning_id,
      source_id !== undefined ? source_id : existing.source_id,
      sub_source !== undefined ? sub_source : existing.sub_source,
      aliasesJson,
      domainsJson,
      req.params.id,
      req.workspaceId
    );

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    // Parse aliases and domains back to arrays for response
    if (client.aliases) {
      try { client.aliases = JSON.parse(client.aliases); } catch (e) { client.aliases = []; }
    } else {
      client.aliases = [];
    }
    if (client.domains) {
      try { client.domains = JSON.parse(client.domains); } catch (e) { client.domains = []; }
    } else {
      client.domains = [];
    }
    res.json(client);
  } catch (error) {
    console.error('Update client error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הלקוח' });
  }
});

// Delete client
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    // First check if the client exists and belongs to this workspace
    const client = db.prepare('SELECT * FROM clients WHERE id = ? AND (workspace_id = ? OR workspace_id IS NULL) AND user_id = ?').get(req.params.id, req.workspaceId, req.userId);
    
    if (!client) {
      return res.status(404).json({ error: 'לקוח לא נמצא' });
    }
    
    // Delete the client (CASCADE will handle related entities)
    const result = db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'לקוח לא נמצא' });
    }

    res.json({ message: 'הלקוח נמחק בהצלחה' });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת הלקוח' });
  }
});

// Generate share link
router.post('/:id/share', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { permissions = 'view' } = req.body;
    const shareToken = uuidv4();

    const result = db.prepare(`
      UPDATE clients SET share_token = ?, share_permissions = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(shareToken, permissions, req.params.id, req.workspaceId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'לקוח לא נמצא' });
    }

    res.json({ share_token: shareToken, permissions });
  } catch (error) {
    console.error('Generate share link error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת הלינק' });
  }
});

// Remove share link
router.delete('/:id/share', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const result = db.prepare(`
      UPDATE clients SET share_token = NULL, share_permissions = 'view', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(req.params.id, req.workspaceId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'לקוח לא נמצא' });
    }

    res.json({ message: 'הלינק הוסר בהצלחה' });
  } catch (error) {
    console.error('Remove share link error:', error);
    res.status(500).json({ error: 'שגיאה בהסרת הלינק' });
  }
});

export default router;
