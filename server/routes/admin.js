import express from 'express';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';

const router = express.Router();

// Helper to get db
const getDb = (req) => req.app.locals.db;

// Middleware to check if user is admin
const adminMiddleware = (req, res, next) => {
  const db = getDb(req);
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.userId);
  
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'אין הרשאת גישה' });
  }
  
  next();
};

router.use(authMiddleware);
router.use(adminMiddleware);

// Get all users
router.get('/users', (req, res) => {
  try {
    const db = getDb(req);
    const users = db.prepare(`
      SELECT id, email, name, created_at, is_active, force_password_reset,
      (SELECT COUNT(*) FROM clients WHERE user_id = users.id) as client_count,
      (SELECT COUNT(*) FROM projects WHERE user_id = users.id) as project_count
      FROM users 
      ORDER BY created_at DESC
    `).all();
    
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת משתמשים' });
  }
});

// Impersonate user
router.post('/impersonate/:userId', (req, res) => {
  try {
    const db = getDb(req);
    const { userId } = req.params;
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }
    
    const token = generateToken(user.id);
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        default_hourly_rate: user.default_hourly_rate,
        is_admin: user.is_admin // Include this so frontend knows
      },
      token
    });
  } catch (error) {
    console.error('Impersonate error:', error);
    res.status(500).json({ error: 'שגיאה בהתחברות למשתמש' });
  }
});

// Force password reset
router.post('/users/:userId/force-password-reset', (req, res) => {
  try {
    const db = getDb(req);
    const { userId } = req.params;
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }
    
    if (user.is_admin) {
      return res.status(403).json({ error: 'לא ניתן לאפס סיסמת אדמין' });
    }
    
    db.prepare('UPDATE users SET force_password_reset = 1 WHERE id = ?').run(userId);
    
    res.json({ message: 'המשתמש יידרש לשנות סיסמה בהתחברות הבאה' });
  } catch (error) {
    console.error('Force password reset error:', error);
    res.status(500).json({ error: 'שגיאה באיפוס סיסמה' });
  }
});

// Set new password for user
router.post('/users/:userId/set-password', async (req, res) => {
  try {
    const db = getDb(req);
    const { userId } = req.params;
    const { password } = req.body;
    
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'סיסמה חייבת להכיל לפחות 4 תווים' });
    }
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }
    
    if (user.is_admin) {
      return res.status(403).json({ error: 'לא ניתן לשנות סיסמת אדמין' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET password = ?, force_password_reset = 0 WHERE id = ?').run(hashedPassword, userId);
    
    res.json({ message: 'סיסמה שונתה בהצלחה' });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ error: 'שגיאה בשינוי סיסמה' });
  }
});

// Toggle user active status
router.post('/users/:userId/toggle-active', (req, res) => {
  try {
    const db = getDb(req);
    const { userId } = req.params;
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }
    
    if (user.is_admin) {
      return res.status(403).json({ error: 'לא ניתן להשהות חשבון אדמין' });
    }
    
    const newStatus = user.is_active ? 0 : 1;
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, userId);
    
    res.json({ 
      message: newStatus ? 'חשבון הופעל בהצלחה' : 'חשבון הושהה בהצלחה',
      is_active: newStatus
    });
  } catch (error) {
    console.error('Toggle active error:', error);
    res.status(500).json({ error: 'שגיאה בשינוי סטטוס חשבון' });
  }
});

// Delete user account
router.delete('/users/:userId', (req, res) => {
  try {
    const db = getDb(req);
    const { userId } = req.params;
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }
    
    if (user.is_admin) {
      return res.status(403).json({ error: 'לא ניתן למחוק חשבון אדמין' });
    }
    
    // Delete user (CASCADE will handle related records)
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    
    res.json({ message: 'חשבון נמחק בהצלחה' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת חשבון' });
  }
});

export default router;

