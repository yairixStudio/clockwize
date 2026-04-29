import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Get all recurring payments
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { client_id, project_id, is_active } = req.query;

    let query = `
      SELECT rp.*, 
        c.name as client_name,
        p.name as project_name
      FROM recurring_payments rp
      LEFT JOIN clients c ON rp.client_id = c.id
      LEFT JOIN projects p ON rp.project_id = p.id
      WHERE rp.workspace_id = ?
    `;
    const params = [req.workspaceId];

    if (client_id) {
      query += ' AND rp.client_id = ?';
      params.push(client_id);
    }

    if (project_id) {
      query += ' AND rp.project_id = ?';
      params.push(project_id);
    }

    if (is_active !== undefined) {
      query += ' AND rp.is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }

    query += ' ORDER BY rp.day_of_month ASC, rp.created_at DESC';

    const recurringPayments = db.prepare(query).all(...params);
    res.json(recurringPayments);
  } catch (error) {
    console.error('Error fetching recurring payments:', error);
    res.status(500).json({ error: 'Failed to fetch recurring payments' });
  }
});

// Get single recurring payment
router.get('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    const recurringPayment = db.prepare(`
      SELECT rp.*, 
        c.name as client_name,
        p.name as project_name
      FROM recurring_payments rp
      LEFT JOIN clients c ON rp.client_id = c.id
      LEFT JOIN projects p ON rp.project_id = p.id
      WHERE rp.id = ? AND rp.workspace_id = ?
    `).get(req.params.id, req.workspaceId);

    if (!recurringPayment) {
      return res.status(404).json({ error: 'Recurring payment not found' });
    }

    res.json(recurringPayment);
  } catch (error) {
    console.error('Error fetching recurring payment:', error);
    res.status(500).json({ error: 'Failed to fetch recurring payment' });
  }
});

// Create recurring payment
router.post('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { 
      client_id, 
      project_id, 
      type = 'income',
      amount, 
      interval = 'monthly',
      day_of_month = 1,
      start_date,
      end_date,
      notes 
    } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    if (!client_id && !project_id) {
      return res.status(400).json({ error: 'Either client_id or project_id is required' });
    }

    const id = uuidv4();
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO recurring_payments (
        id, client_id, project_id, workspace_id, user_id, type, amount, 
        interval, day_of_month, start_date, end_date, is_active, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      id,
      client_id || null,
      project_id || null,
      req.workspaceId,
      req.user.id,
      type,
      amount,
      interval,
      day_of_month,
      start_date || null,
      end_date || null,
      notes || null,
      createdAt,
      createdAt
    );

    const recurringPayment = db.prepare(`
      SELECT rp.*, 
        c.name as client_name,
        p.name as project_name
      FROM recurring_payments rp
      LEFT JOIN clients c ON rp.client_id = c.id
      LEFT JOIN projects p ON rp.project_id = p.id
      WHERE rp.id = ?
    `).get(id);

    res.status(201).json(recurringPayment);
  } catch (error) {
    console.error('Error creating recurring payment:', error);
    res.status(500).json({ error: 'Failed to create recurring payment' });
  }
});

// Update recurring payment
router.put('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { 
      client_id, 
      project_id, 
      type,
      amount, 
      interval,
      day_of_month,
      start_date,
      end_date,
      is_active,
      notes 
    } = req.body;

    const existing = db.prepare(`
      SELECT * FROM recurring_payments WHERE id = ? AND workspace_id = ?
    `).get(req.params.id, req.workspaceId);

    if (!existing) {
      return res.status(404).json({ error: 'Recurring payment not found' });
    }

    const updatedAt = new Date().toISOString();

    db.prepare(`
      UPDATE recurring_payments
      SET client_id = ?, project_id = ?, type = ?, amount = ?, interval = ?,
          day_of_month = ?, start_date = ?, end_date = ?, is_active = ?, notes = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `).run(
      client_id !== undefined ? client_id : existing.client_id,
      project_id !== undefined ? project_id : existing.project_id,
      type !== undefined ? type : existing.type,
      amount !== undefined ? amount : existing.amount,
      interval !== undefined ? interval : existing.interval,
      day_of_month !== undefined ? day_of_month : existing.day_of_month,
      start_date !== undefined ? start_date : existing.start_date,
      end_date !== undefined ? end_date : existing.end_date,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      notes !== undefined ? notes : existing.notes,
      updatedAt,
      req.params.id,
      req.workspaceId
    );

    const recurringPayment = db.prepare(`
      SELECT rp.*, 
        c.name as client_name,
        p.name as project_name
      FROM recurring_payments rp
      LEFT JOIN clients c ON rp.client_id = c.id
      LEFT JOIN projects p ON rp.project_id = p.id
      WHERE rp.id = ?
    `).get(req.params.id);

    res.json(recurringPayment);
  } catch (error) {
    console.error('Error updating recurring payment:', error);
    res.status(500).json({ error: 'Failed to update recurring payment' });
  }
});

// Delete recurring payment
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    const existing = db.prepare(`
      SELECT * FROM recurring_payments WHERE id = ? AND workspace_id = ?
    `).get(req.params.id, req.workspaceId);

    if (!existing) {
      return res.status(404).json({ error: 'Recurring payment not found' });
    }

    db.prepare(`
      DELETE FROM recurring_payments WHERE id = ? AND workspace_id = ?
    `).run(req.params.id, req.workspaceId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting recurring payment:', error);
    res.status(500).json({ error: 'Failed to delete recurring payment' });
  }
});

// Toggle active status
router.patch('/:id/toggle', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    const existing = db.prepare(`
      SELECT * FROM recurring_payments WHERE id = ? AND workspace_id = ?
    `).get(req.params.id, req.workspaceId);

    if (!existing) {
      return res.status(404).json({ error: 'Recurring payment not found' });
    }

    const newStatus = existing.is_active ? 0 : 1;
    const updatedAt = new Date().toISOString();

    db.prepare(`
      UPDATE recurring_payments SET is_active = ?, updated_at = ? WHERE id = ?
    `).run(newStatus, updatedAt, req.params.id);

    const recurringPayment = db.prepare(`
      SELECT rp.*, 
        c.name as client_name,
        p.name as project_name
      FROM recurring_payments rp
      LEFT JOIN clients c ON rp.client_id = c.id
      LEFT JOIN projects p ON rp.project_id = p.id
      WHERE rp.id = ?
    `).get(req.params.id);

    res.json(recurringPayment);
  } catch (error) {
    console.error('Error toggling recurring payment:', error);
    res.status(500).json({ error: 'Failed to toggle recurring payment' });
  }
});

// Get upcoming recurring payments (for reminders)
router.get('/upcoming/reminders', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { days = 7 } = req.query;

    const today = new Date();
    const currentDay = today.getDate();
    const daysAhead = parseInt(days);

    // Get active recurring payments that are due within the specified days
    const recurringPayments = db.prepare(`
      SELECT rp.*, 
        c.name as client_name,
        p.name as project_name
      FROM recurring_payments rp
      LEFT JOIN clients c ON rp.client_id = c.id
      LEFT JOIN projects p ON rp.project_id = p.id
      WHERE rp.workspace_id = ? 
        AND rp.is_active = 1
        AND (rp.end_date IS NULL OR rp.end_date >= date('now'))
        AND (rp.start_date IS NULL OR rp.start_date <= date('now'))
      ORDER BY rp.day_of_month ASC
    `).all(req.workspaceId);

    // Filter to those due within the next X days
    const upcoming = recurringPayments.filter(rp => {
      const dayOfMonth = rp.day_of_month;
      const daysUntilDue = dayOfMonth >= currentDay 
        ? dayOfMonth - currentDay 
        : (new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - currentDay) + dayOfMonth;
      
      return daysUntilDue <= daysAhead;
    }).map(rp => {
      const dayOfMonth = rp.day_of_month;
      const daysUntilDue = dayOfMonth >= currentDay 
        ? dayOfMonth - currentDay 
        : (new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - currentDay) + dayOfMonth;
      
      return {
        ...rp,
        days_until_due: daysUntilDue,
        due_date: new Date(today.getFullYear(), today.getMonth() + (dayOfMonth >= currentDay ? 0 : 1), dayOfMonth).toISOString()
      };
    });

    res.json(upcoming);
  } catch (error) {
    console.error('Error fetching upcoming recurring payments:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming recurring payments' });
  }
});

// Generate payment from recurring (manual trigger)
router.post('/:id/generate', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    const recurring = db.prepare(`
      SELECT * FROM recurring_payments WHERE id = ? AND workspace_id = ?
    `).get(req.params.id, req.workspaceId);

    if (!recurring) {
      return res.status(404).json({ error: 'Recurring payment not found' });
    }

    const paymentId = uuidv4();
    const createdAt = new Date().toISOString();
    const paymentDate = req.body.date || createdAt;

    db.prepare(`
      INSERT INTO payments (
        id, project_id, workspace_id, amount, date, notes, type, status, recurring_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      paymentId,
      recurring.project_id,
      req.workspaceId,
      recurring.amount,
      paymentDate,
      recurring.notes,
      recurring.type,
      recurring.id,
      createdAt
    );

    const payment = db.prepare(`
      SELECT p.*, 
        pr.name as project_name,
        c.name as client_name
      FROM payments p
      LEFT JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN clients c ON pr.client_id = c.id
      WHERE p.id = ?
    `).get(paymentId);

    res.status(201).json(payment);
  } catch (error) {
    console.error('Error generating payment from recurring:', error);
    res.status(500).json({ error: 'Failed to generate payment' });
  }
});

export default router;
