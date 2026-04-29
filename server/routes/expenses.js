import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Get all expense categories
router.get('/categories', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const categories = db.prepare(`
      SELECT * FROM expense_categories
      WHERE workspace_id = ?
      ORDER BY name ASC
    `).all(req.workspaceId);

    res.json(categories);
  } catch (error) {
    console.error('Error fetching expense categories:', error);
    res.status(500).json({ error: 'Failed to fetch expense categories' });
  }
});

// Create expense category
router.post('/categories', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { name, color, icon } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const id = uuidv4();
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO expense_categories (id, workspace_id, name, color, icon, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.workspaceId, name, color || null, icon || null, createdAt);

    const category = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating expense category:', error);
    res.status(500).json({ error: 'Failed to create expense category' });
  }
});

// Update expense category
router.put('/categories/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { name, color, icon } = req.body;

    const existing = db.prepare(`
      SELECT * FROM expense_categories WHERE id = ? AND workspace_id = ?
    `).get(req.params.id, req.workspaceId);

    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    db.prepare(`
      UPDATE expense_categories
      SET name = ?, color = ?, icon = ?
      WHERE id = ? AND workspace_id = ?
    `).run(
      name || existing.name,
      color !== undefined ? color : existing.color,
      icon !== undefined ? icon : existing.icon,
      req.params.id,
      req.workspaceId
    );

    const category = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(req.params.id);
    res.json(category);
  } catch (error) {
    console.error('Error updating expense category:', error);
    res.status(500).json({ error: 'Failed to update expense category' });
  }
});

// Delete expense category
router.delete('/categories/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    const existing = db.prepare(`
      SELECT * FROM expense_categories WHERE id = ? AND workspace_id = ?
    `).get(req.params.id, req.workspaceId);

    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Remove category reference from payments
    db.prepare(`
      UPDATE payments SET category_id = NULL WHERE category_id = ?
    `).run(req.params.id);

    db.prepare(`
      DELETE FROM expense_categories WHERE id = ? AND workspace_id = ?
    `).run(req.params.id, req.workspaceId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting expense category:', error);
    res.status(500).json({ error: 'Failed to delete expense category' });
  }
});

// Get all expenses (payments with type='expense')
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { project_id, client_id, category_id, start_date, end_date } = req.query;

    let query = `
      SELECT p.*, 
        pr.name as project_name,
        c.name as client_name,
        ec.name as category_name,
        ec.color as category_color,
        ec.icon as category_icon
      FROM payments p
      LEFT JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN clients c ON pr.client_id = c.id
      LEFT JOIN expense_categories ec ON p.category_id = ec.id
      WHERE p.workspace_id = ? AND p.type = 'expense'
    `;
    const params = [req.workspaceId];

    if (project_id) {
      query += ' AND p.project_id = ?';
      params.push(project_id);
    }

    if (client_id) {
      query += ' AND pr.client_id = ?';
      params.push(client_id);
    }

    if (category_id) {
      query += ' AND p.category_id = ?';
      params.push(category_id);
    }

    if (start_date) {
      query += ' AND p.date >= ?';
      params.push(start_date);
    }

    if (end_date) {
      query += ' AND p.date <= ?';
      params.push(end_date);
    }

    query += ' ORDER BY p.date DESC';

    const expenses = db.prepare(query).all(...params);
    res.json(expenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// Create expense
router.post('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { project_id, amount, date, notes, category_id, payment_method } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const id = uuidv4();
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO payments (id, project_id, workspace_id, amount, date, notes, type, status, category_id, payment_method, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'expense', 'paid', ?, ?, ?)
    `).run(
      id,
      project_id || null,
      req.workspaceId,
      amount,
      date || createdAt,
      notes || null,
      category_id || null,
      payment_method || null,
      createdAt
    );

    const expense = db.prepare(`
      SELECT p.*, 
        pr.name as project_name,
        c.name as client_name,
        ec.name as category_name,
        ec.color as category_color
      FROM payments p
      LEFT JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN clients c ON pr.client_id = c.id
      LEFT JOIN expense_categories ec ON p.category_id = ec.id
      WHERE p.id = ?
    `).get(id);

    res.status(201).json(expense);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// Update expense
router.put('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { project_id, amount, date, notes, category_id, payment_method } = req.body;

    const existing = db.prepare(`
      SELECT * FROM payments WHERE id = ? AND workspace_id = ? AND type = 'expense'
    `).get(req.params.id, req.workspaceId);

    if (!existing) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    db.prepare(`
      UPDATE payments
      SET project_id = ?, amount = ?, date = ?, notes = ?, category_id = ?, payment_method = ?
      WHERE id = ? AND workspace_id = ?
    `).run(
      project_id !== undefined ? project_id : existing.project_id,
      amount !== undefined ? amount : existing.amount,
      date !== undefined ? date : existing.date,
      notes !== undefined ? notes : existing.notes,
      category_id !== undefined ? category_id : existing.category_id,
      payment_method !== undefined ? payment_method : existing.payment_method,
      req.params.id,
      req.workspaceId
    );

    const expense = db.prepare(`
      SELECT p.*, 
        pr.name as project_name,
        c.name as client_name,
        ec.name as category_name,
        ec.color as category_color
      FROM payments p
      LEFT JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN clients c ON pr.client_id = c.id
      LEFT JOIN expense_categories ec ON p.category_id = ec.id
      WHERE p.id = ?
    `).get(req.params.id);

    res.json(expense);
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

// Delete expense
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);

    const existing = db.prepare(`
      SELECT * FROM payments WHERE id = ? AND workspace_id = ? AND type = 'expense'
    `).get(req.params.id, req.workspaceId);

    if (!existing) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    db.prepare(`
      DELETE FROM payments WHERE id = ? AND workspace_id = ?
    `).run(req.params.id, req.workspaceId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

// Get expense summary
router.get('/summary', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { start_date, end_date } = req.query;

    let dateFilter = '';
    const params = [req.workspaceId];

    if (start_date && end_date) {
      dateFilter = ' AND p.date >= ? AND p.date <= ?';
      params.push(start_date, end_date);
    }

    // Total expenses
    const totalResult = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM payments p
      WHERE p.workspace_id = ? AND p.type = 'expense'${dateFilter}
    `).get(...params);

    // By category
    const byCategory = db.prepare(`
      SELECT 
        ec.id,
        ec.name,
        ec.color,
        ec.icon,
        COALESCE(SUM(p.amount), 0) as total
      FROM expense_categories ec
      LEFT JOIN payments p ON p.category_id = ec.id AND p.type = 'expense'${dateFilter.replace('p.workspace_id', 'ec.workspace_id')}
      WHERE ec.workspace_id = ?
      GROUP BY ec.id
      ORDER BY total DESC
    `).all(req.workspaceId);

    // Uncategorized
    const uncategorized = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM payments p
      WHERE p.workspace_id = ? AND p.type = 'expense' AND p.category_id IS NULL${dateFilter}
    `).get(...params);

    res.json({
      total: totalResult.total,
      byCategory,
      uncategorized: uncategorized.total
    });
  } catch (error) {
    console.error('Error fetching expense summary:', error);
    res.status(500).json({ error: 'Failed to fetch expense summary' });
  }
});

export default router;
