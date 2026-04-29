import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const router = Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Encrypt sensitive fields
const encryptCredential = (credential, secretKey) => {
    return {
        ...credential,
        username: credential.username ? encrypt(credential.username, secretKey) : null,
        password: credential.password ? encrypt(credential.password, secretKey) : null,
        notes: credential.notes ? encrypt(credential.notes, secretKey) : null,
    };
};

// Decrypt sensitive fields
const decryptCredential = (credential, secretKey) => {
    if (!credential) return null;
    return {
        ...credential,
        username: credential.username ? decrypt(credential.username, secretKey) : null,
        password: credential.password ? decrypt(credential.password, secretKey) : null,
        notes: credential.notes ? decrypt(credential.notes, secretKey) : null,
    };
};

// Get all credentials for the workspace
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const credentials = db.prepare(`
      SELECT cr.*, c.name as client_name, p.name as project_name
      FROM credentials cr
      LEFT JOIN clients c ON cr.client_id = c.id
      LEFT JOIN projects p ON cr.project_id = p.id
      WHERE cr.workspace_id = ?
      ORDER BY cr.created_at DESC
    `).all(req.workspaceId);

        // Use workspace_id for encryption key
        const decryptedCredentials = credentials.map(cred => decryptCredential(cred, req.workspaceId));
        res.json(decryptedCredentials);
    } catch (error) {
        console.error('Get credentials error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת הסיסמאות' });
    }
});

// Get credentials for a specific client
router.get('/client/:clientId', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);

        // Verify client belongs to workspace
        const client = db.prepare('SELECT * FROM clients WHERE id = ? AND workspace_id = ?').get(req.params.clientId, req.workspaceId);
        if (!client) {
            return res.status(404).json({ error: 'לקוח לא נמצא' });
        }

        const credentials = db.prepare(`
      SELECT cr.*, p.name as project_name
      FROM credentials cr
      LEFT JOIN projects p ON cr.project_id = p.id
      WHERE cr.workspace_id = ? AND cr.client_id = ?
      ORDER BY cr.created_at DESC
    `).all(req.workspaceId, req.params.clientId);

        const decryptedCredentials = credentials.map(cred => decryptCredential(cred, req.workspaceId));
        res.json(decryptedCredentials);
    } catch (error) {
        console.error('Get client credentials error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת הסיסמאות' });
    }
});

// Get credentials for a specific project
router.get('/project/:projectId', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);

        // Verify project belongs to workspace
        const project = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').get(req.params.projectId, req.workspaceId);
        if (!project) {
            return res.status(404).json({ error: 'פרויקט לא נמצא' });
        }

        const credentials = db.prepare(`
      SELECT cr.*
      FROM credentials cr
      WHERE cr.workspace_id = ? AND cr.project_id = ?
      ORDER BY cr.created_at DESC
    `).all(req.workspaceId, req.params.projectId);

        const decryptedCredentials = credentials.map(cred => decryptCredential(cred, req.workspaceId));
        res.json(decryptedCredentials);
    } catch (error) {
        console.error('Get project credentials error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת הסיסמאות' });
    }
});

// Get account-level credentials (not associated with any client/project)
router.get('/account', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const credentials = db.prepare(`
      SELECT cr.*
      FROM credentials cr
      WHERE cr.workspace_id = ? AND cr.client_id IS NULL AND cr.project_id IS NULL
      ORDER BY cr.created_at DESC
    `).all(req.workspaceId);

        const decryptedCredentials = credentials.map(cred => decryptCredential(cred, req.workspaceId));
        res.json(decryptedCredentials);
    } catch (error) {
        console.error('Get account credentials error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת הסיסמאות' });
    }
});

// Create new credential
router.post('/', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const { client_id, project_id, service_name, username, password, url, notes } = req.body;

        if (!service_name) {
            return res.status(400).json({ error: 'שם השירות נדרש' });
        }

        // Verify client belongs to workspace if specified
        if (client_id) {
            const client = db.prepare('SELECT * FROM clients WHERE id = ? AND workspace_id = ?').get(client_id, req.workspaceId);
            if (!client) {
                return res.status(404).json({ error: 'לקוח לא נמצא' });
            }
        }

        // Verify project belongs to workspace if specified
        if (project_id) {
            const project = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').get(project_id, req.workspaceId);
            if (!project) {
                return res.status(404).json({ error: 'פרויקט לא נמצא' });
            }
        }

        const id = uuidv4();
        const encrypted = encryptCredential({ username, password, notes }, req.workspaceId);

        db.prepare(`
      INSERT INTO credentials (id, user_id, workspace_id, client_id, project_id, service_name, username, password, url, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            id,
            req.userId,
            req.workspaceId,
            client_id || null,
            project_id || null,
            service_name,
            encrypted.username,
            encrypted.password,
            url || null,
            encrypted.notes
        );

        const credential = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id);
        res.status(201).json(decryptCredential(credential, req.workspaceId));
    } catch (error) {
        console.error('Create credential error:', error);
        res.status(500).json({ error: 'שגיאה ביצירת הסיסמה' });
    }
});

// Update credential
router.put('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const { service_name, username, password, url, notes } = req.body;

        const existing = db.prepare('SELECT * FROM credentials WHERE id = ? AND workspace_id = ?').get(req.params.id, req.workspaceId);
        if (!existing) {
            return res.status(404).json({ error: 'סיסמה לא נמצאה' });
        }

        const encrypted = encryptCredential({ username, password, notes }, req.workspaceId);

        db.prepare(`
      UPDATE credentials 
      SET service_name = ?, username = ?, password = ?, url = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(
            service_name || existing.service_name,
            encrypted.username,
            encrypted.password,
            url !== undefined ? url : existing.url,
            encrypted.notes,
            req.params.id,
            req.workspaceId
        );

        const credential = db.prepare('SELECT * FROM credentials WHERE id = ?').get(req.params.id);
        res.json(decryptCredential(credential, req.workspaceId));
    } catch (error) {
        console.error('Update credential error:', error);
        res.status(500).json({ error: 'שגיאה בעדכון הסיסמה' });
    }
});

// Delete credential
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const result = db.prepare('DELETE FROM credentials WHERE id = ? AND workspace_id = ?').run(req.params.id, req.workspaceId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'סיסמה לא נמצאה' });
        }

        res.json({ message: 'הסיסמה נמחקה בהצלחה' });
    } catch (error) {
        console.error('Delete credential error:', error);
        res.status(500).json({ error: 'שגיאה במחיקת הסיסמה' });
    }
});

export default router;
