import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = Router();

// Helper to get db
const getDb = (req) => req.app.locals.db;

// Apply auth middleware to all routes
router.use(authMiddleware);
router.use(workspaceMiddleware);

// DEBUG endpoint - Get ALL sources in database (for debugging)
router.get('/debug/all', async (req, res) => {
    try {
        const db = getDb(req);
        const allSources = db.prepare(
            'SELECT * FROM client_sources ORDER BY workspace_id, name'
        ).all();
        
        // Also get client count for each source
        const sourcesWithCounts = allSources.map(source => {
            const clientCount = db.prepare(
                'SELECT COUNT(*) as count FROM clients WHERE source_id = ?'
            ).get(source.id);
            return { ...source, client_count: clientCount.count };
        });
        
        res.json({
            total: allSources.length,
            sources: sourcesWithCounts,
            currentWorkspace: req.workspaceId
        });
    } catch (error) {
        console.error('Debug all sources error:', error);
        res.status(500).json({ error: 'שגיאה' });
    }
});

// Get all client sources for this workspace (including global sources)
router.get('/', async (req, res) => {
    try {
        const db = getDb(req);
        // Get both workspace-specific sources AND global sources (workspace_id IS NULL)
        const sources = db.prepare(
            'SELECT * FROM client_sources WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY name'
        ).all(req.workspaceId);
        res.json(sources);
    } catch (error) {
        console.error('Get client sources error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת מקורות הלקוח' });
    }
});

// Get marketing funnel stats (sources with client counts)
router.get('/stats', async (req, res) => {
    try {
        const db = getDb(req);
        
        // Get all sources with client counts for this workspace (workspace-specific + global)
        const stats = db.prepare(`
            SELECT 
                cs.id,
                cs.name,
                cs.workspace_id,
                COUNT(c.id) as client_count,
                GROUP_CONCAT(c.id) as client_ids
            FROM client_sources cs
            LEFT JOIN clients c ON c.source_id = cs.id AND c.workspace_id = ?
            WHERE cs.workspace_id = ? OR cs.workspace_id IS NULL
            GROUP BY cs.id, cs.name
            ORDER BY client_count DESC
        `).all(req.workspaceId, req.workspaceId);
        
        // Also get clients without a source
        const noSourceClients = db.prepare(`
            SELECT COUNT(*) as count
            FROM clients
            WHERE workspace_id = ? AND (source_id IS NULL OR source_id = '')
        `).get(req.workspaceId);
        
        // Get all clients with their source info for detailed view
        const clientsBySource = db.prepare(`
            SELECT 
                c.id,
                c.name,
                c.source_id,
                c.sub_source,
                c.status,
                c.created_at,
                cs.name as source_name
            FROM clients c
            LEFT JOIN client_sources cs ON c.source_id = cs.id
            WHERE c.workspace_id = ?
            ORDER BY c.created_at DESC
        `).all(req.workspaceId);
        
        res.json({
            sources: stats,
            noSourceCount: noSourceClients.count,
            clients: clientsBySource
        });
    } catch (error) {
        console.error('Get marketing funnel stats error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת נתוני משפכים' });
    }
});

// Assign a global source to current workspace
router.post('/:id/assign-to-workspace', async (req, res) => {
    try {
        const db = getDb(req);
        const source = db.prepare('SELECT * FROM client_sources WHERE id = ?').get(req.params.id);
        
        if (!source) {
            return res.status(404).json({ error: 'מקור לא נמצא' });
        }
        
        // Only allow assigning global sources (workspace_id IS NULL)
        if (source.workspace_id !== null) {
            return res.status(400).json({ error: 'מקור זה כבר משויך ל-workspace' });
        }
        
        // Assign to current workspace
        db.prepare('UPDATE client_sources SET workspace_id = ? WHERE id = ?')
            .run(req.workspaceId, req.params.id);
        
        const updated = db.prepare('SELECT * FROM client_sources WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (error) {
        console.error('Assign source to workspace error:', error);
        res.status(500).json({ error: 'שגיאה בשיוך המקור' });
    }
});

// Create a new client source
router.post('/', async (req, res) => {
    try {
        const db = getDb(req);
        const { name, is_global } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'שם מקור נדרש' });
        }
        
        // Determine workspace_id: NULL for global sources, current workspace otherwise
        const workspaceId = is_global ? null : req.workspaceId;
        
        // Check if source with same name already exists in this workspace
        const existing = db.prepare(
            'SELECT id FROM client_sources WHERE name = ? AND (workspace_id = ? OR (workspace_id IS NULL AND ? IS NULL))'
        ).get(name, workspaceId, workspaceId);
        
        if (existing) {
            return res.status(400).json({ error: 'מקור עם שם זה כבר קיים' });
        }
        
        const id = uuidv4();
        db.prepare(
            'INSERT INTO client_sources (id, name, workspace_id) VALUES (?, ?, ?)'
        ).run(id, name, workspaceId);
        
        const source = db.prepare('SELECT * FROM client_sources WHERE id = ?').get(id);
        res.status(201).json(source);
    } catch (error) {
        console.error('Create client source error:', error);
        res.status(500).json({ error: 'שגיאה ביצירת מקור לקוח' });
    }
});

export default router;
