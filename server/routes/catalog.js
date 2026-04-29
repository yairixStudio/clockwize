import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Helper to get db
const getDb = (req) => req.app.locals.db;

// קבלת כל הפריטים בקטלוג
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { category, active_only } = req.query;
    
    let query = `
      SELECT * FROM catalog_items 
      WHERE workspace_id = ?
    `;
    const params = [req.workspaceId];
    
    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }
    
    if (active_only === 'true') {
      query += ` AND is_active = 1`;
    }
    
    query += ` ORDER BY category, name`;
    
    const items = db.prepare(query).all(...params);
    res.json(items);
  } catch (error) {
    console.error('Error fetching catalog items:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הקטלוג' });
  }
});

// קבלת פריט בודד
router.get('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const item = db.prepare(`
      SELECT * FROM catalog_items 
      WHERE id = ? AND workspace_id = ?
    `).get(req.params.id, req.workspaceId);
    
    if (!item) {
      return res.status(404).json({ error: 'פריט לא נמצא' });
    }
    
    res.json(item);
  } catch (error) {
    console.error('Error fetching catalog item:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הפריט' });
  }
});

// יצירת פריט חדש
router.post('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { name, description, price, pricing_type, unit, category, notes } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'שם הפריט הוא שדה חובה' });
    }
    
    const id = uuidv4();
    
    db.prepare(`
      INSERT INTO catalog_items (id, workspace_id, user_id, name, description, price, pricing_type, unit, category, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.workspaceId, req.userId, name, description || null, price || null, pricing_type || 'fixed', unit || null, category || null, notes || null);
    
    const item = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id);
    res.status(201).json(item);
  } catch (error) {
    console.error('Error creating catalog item:', error);
    res.status(500).json({ error: 'שגיאה ביצירת הפריט' });
  }
});

// עדכון פריט
router.put('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { name, description, price, pricing_type, unit, category, is_active, notes } = req.body;
    
    // בדיקה שהפריט שייך ל-workspace
    const existing = db.prepare(`
      SELECT id FROM catalog_items WHERE id = ? AND workspace_id = ?
    `).get(req.params.id, req.workspaceId);
    
    if (!existing) {
      return res.status(404).json({ error: 'פריט לא נמצא' });
    }
    
    db.prepare(`
      UPDATE catalog_items 
      SET name = ?, description = ?, price = ?, pricing_type = ?, unit = ?, category = ?, is_active = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
    `).run(
      name, 
      description || null, 
      price || null, 
      pricing_type || 'fixed', 
      unit || null, 
      category || null, 
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      notes || null,
      req.params.id, 
      req.workspaceId
    );
    
    const item = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(req.params.id);
    res.json(item);
  } catch (error) {
    console.error('Error updating catalog item:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הפריט' });
  }
});

// מחיקת פריט
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    // בדיקה שהפריט שייך ל-workspace
    const existing = db.prepare(`
      SELECT id FROM catalog_items WHERE id = ? AND workspace_id = ?
    `).get(req.params.id, req.workspaceId);
    
    if (!existing) {
      return res.status(404).json({ error: 'פריט לא נמצא' });
    }
    
    db.prepare('DELETE FROM catalog_items WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting catalog item:', error);
    res.status(500).json({ error: 'שגיאה במחיקת הפריט' });
  }
});

// קבלת רשימת הקטגוריות הקיימות
router.get('/meta/categories', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    const categories = db.prepare(`
      SELECT DISTINCT category FROM catalog_items 
      WHERE workspace_id = ? AND category IS NOT NULL AND category != ''
      ORDER BY category
    `).all(req.workspaceId);
    
    res.json(categories.map(c => c.category));
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הקטגוריות' });
  }
});

export default router;
