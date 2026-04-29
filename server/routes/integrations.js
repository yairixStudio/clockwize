import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Helper to get db
const getDb = (req) => req.app.locals.db;

// Get all integrations
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const integrations = db.prepare('SELECT * FROM integrations WHERE workspace_id = ?').all(req.workspaceId);

        // Don't send sensitive data back to client
        const safeIntegrations = integrations.map(integration => ({
            id: integration.id,
            provider: integration.provider,
            is_active: integration.is_active,
            created_at: integration.created_at,
            updated_at: integration.updated_at
        }));

        res.json(safeIntegrations);
    } catch (error) {
        console.error('Error fetching integrations:', error);
        res.status(500).json({ error: 'Failed to fetch integrations' });
    }
});

// Connect Morning
router.post('/morning/connect', authMiddleware, workspaceMiddleware, async (req, res) => {
    const { apiKey, apiSecret } = req.body;

    if (!apiKey || !apiSecret) {
        return res.status(400).json({ error: 'API Key and Secret are required' });
    }

    try {
        // Validate credentials with Morning API
        const response = await axios.post('https://api.greeninvoice.co.il/api/v1/account/token', {
            id: apiKey,
            secret: apiSecret
        });

        const token = response.data.token || response.data.access_token;
        const expires = response.data.expires || response.data.expires_at;

        if (!token) {
            console.error('Morning token not found in response', response.data);
            return res.status(400).json({ error: 'Failed to obtain token from Morning' });
        }

        const db = getDb(req);
        const integrationId = uuidv4();

        // Check if integration already exists for workspace
        const existing = db.prepare('SELECT * FROM integrations WHERE workspace_id = ? AND provider = ?').get(req.workspaceId, 'morning');

        if (existing) {
            db.prepare(`
        UPDATE integrations 
        SET api_key = ?, api_secret = ?, access_token = ?, expires_at = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(apiKey, apiSecret, token, expires, existing.id);
        } else {
            db.prepare(`
        INSERT INTO integrations (id, user_id, workspace_id, provider, api_key, api_secret, access_token, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(integrationId, req.userId, req.workspaceId, 'morning', apiKey, apiSecret, token, expires);
        }

        res.json({ success: true, message: 'Morning integration connected successfully' });
    } catch (error) {
        console.error('Error connecting to Morning:', error.response?.data || error.message);
        res.status(400).json({ error: 'Failed to connect to Morning. Please check your credentials.' });
    }
});

// Disconnect Morning
router.post('/morning/disconnect', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        db.prepare('DELETE FROM integrations WHERE workspace_id = ? AND provider = ?').run(req.workspaceId, 'morning');
        res.json({ success: true, message: 'Morning integration disconnected' });
    } catch (error) {
        console.error('Error disconnecting Morning:', error);
        res.status(500).json({ error: 'Failed to disconnect Morning' });
    }
});

// Get Morning Clients
router.get('/morning/clients', authMiddleware, workspaceMiddleware, async (req, res) => {
    try {
        const db = getDb(req);
        const integration = db.prepare('SELECT * FROM integrations WHERE workspace_id = ? AND provider = ?').get(req.workspaceId, 'morning');

        if (!integration || !integration.access_token) {
            return res.status(400).json({ error: 'Morning integration not connected' });
        }

        const page = req.query.page || 1;
        const pageSize = req.query.pageSize || 100;

        let response;
        try {
            response = await axios.post('https://api.greeninvoice.co.il/api/v1/clients/search', {
                page,
                pageSize
            }, {
                headers: {
                    Authorization: `Bearer ${integration.access_token}`
                }
            });
        } catch (apiError) {
            if (apiError.response && apiError.response.status === 401) {
                return res.status(401).json({ 
                    error: 'Morning token expired',
                    details: 'החיבור למורנינג פג תוקף. נא ללחוץ על "התנתק" ולהתחבר מחדש.'
                });
            }
            throw apiError;
        }

        const clients = response.data.items || response.data.data || response.data;
        const responseData = Array.isArray(clients) ? clients : [];
        const meta = response.data.meta || { total: responseData.length, page, pageSize };

        res.json({
            data: responseData,
            meta
        });
    } catch (error) {
        console.error('Error fetching Morning clients:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: 'Failed to fetch clients from Morning',
            details: error.response?.data || error.message
        });
    }
});

export default router;
