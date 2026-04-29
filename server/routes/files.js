import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = `${uuidv4()}${ext}`;
        cb(null, filename);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB max
    }
});

// Get files by entity
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
    const db = req.app.locals.db;
    const { client_id, project_id, task_id } = req.query;

    let query = `
    SELECT f.*, u.name as uploader_name
    FROM files f
    LEFT JOIN users u ON f.user_id = u.id
    WHERE f.workspace_id = ?
  `;
    const params = [req.workspaceId];

    if (client_id) {
        query += ' AND f.client_id = ?';
        params.push(client_id);
    }
    if (project_id) {
        query += ' AND f.project_id = ?';
        params.push(project_id);
    }
    if (task_id) {
        query += ' AND f.task_id = ?';
        params.push(task_id);
    }

    query += ' ORDER BY f.created_at DESC';

    try {
        const files = db.prepare(query).all(...params);
        res.json(files);
    } catch (error) {
        console.error('Error fetching files:', error);
        res.status(500).json({ error: 'Failed to fetch files' });
    }
});

// Upload file
router.post('/upload', authMiddleware, workspaceMiddleware, upload.single('file'), (req, res) => {
    const db = req.app.locals.db;

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const { client_id, project_id, task_id } = req.body;

    // Verify ownership of entities if provided
    if (client_id) {
        const client = db.prepare('SELECT id FROM clients WHERE id = ? AND workspace_id = ?').get(client_id, req.workspaceId);
        if (!client) {
            fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename));
            return res.status(404).json({ error: 'Client not found' });
        }
    }
    if (project_id) {
        const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(project_id, req.workspaceId);
        if (!project) {
            fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename));
            return res.status(404).json({ error: 'Project not found' });
        }
    }
    if (task_id) {
        const task = db.prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?').get(task_id, req.workspaceId);
        if (!task) {
            fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename));
            return res.status(404).json({ error: 'Task not found' });
        }
    }

    const fileId = uuidv4();
    const fileData = {
        id: fileId,
        user_id: req.userId,
        workspace_id: req.workspaceId,
        client_id: client_id || null,
        project_id: project_id || null,
        task_id: task_id || null,
        original_name: req.file.originalname,
        storage_path: req.file.filename,
        mime_type: req.file.mimetype,
        size: req.file.size
    };

    try {
        db.prepare(`
      INSERT INTO files (id, user_id, workspace_id, client_id, project_id, task_id, original_name, storage_path, mime_type, size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            fileData.id,
            fileData.user_id,
            fileData.workspace_id,
            fileData.client_id,
            fileData.project_id,
            fileData.task_id,
            fileData.original_name,
            fileData.storage_path,
            fileData.mime_type,
            fileData.size
        );

        res.json(fileData);
    } catch (error) {
        console.error('Error saving file:', error);
        fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename));
        res.status(500).json({ error: 'Failed to save file' });
    }
});

// Download file
router.get('/:id/download', authMiddleware, workspaceMiddleware, (req, res) => {
    const db = req.app.locals.db;
    const { id } = req.params;

    try {
        const file = db.prepare('SELECT * FROM files WHERE id = ? AND workspace_id = ?').get(id, req.workspaceId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = path.join(UPLOADS_DIR, file.storage_path);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.download(filePath, file.original_name);
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// Delete file
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
    const db = req.app.locals.db;
    const { id } = req.params;

    try {
        const file = db.prepare('SELECT * FROM files WHERE id = ? AND workspace_id = ?').get(id, req.workspaceId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Delete from database
        db.prepare('DELETE FROM files WHERE id = ?').run(id);

        // Delete from disk
        const filePath = path.join(UPLOADS_DIR, file.storage_path);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

export default router;
