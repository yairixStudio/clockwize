import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateToken, authMiddleware } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_SESSION_FILE = path.join(__dirname, '..', '..', '.local-session');

const router = Router();

// Helper to save session locally for desktop apps
const saveLocalSession = (token, workspaceId) => {
  try {
    fs.writeFileSync(LOCAL_SESSION_FILE, JSON.stringify({ token, workspaceId }));
  } catch (e) {
    console.error('Failed to save local session:', e);
  }
};

// Helper to clear local session
const clearLocalSession = () => {
  try {
    if (fs.existsSync(LOCAL_SESSION_FILE)) {
      fs.unlinkSync(LOCAL_SESSION_FILE);
    }
  } catch (e) {
    console.error('Failed to clear local session:', e);
  }
};

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Register
router.post('/register', async (req, res) => {
  try {
    const db = getDb(req);
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'כל השדות נדרשים' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'משתמש עם אימייל זה כבר קיים' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    db.prepare(`
      INSERT INTO users (id, email, password, name)
      VALUES (?, ?, ?, ?)
    `).run(userId, email, hashedPassword, name);

    // Create personal workspace for new user
    const workspaceId = uuidv4();
    const slug = `personal-${userId.substring(0, 8)}`;
    
    db.prepare(`
      INSERT INTO workspaces (id, name, slug, created_by)
      VALUES (?, ?, ?, ?)
    `).run(workspaceId, name, slug, userId);

    // Add user as owner
    db.prepare(`
      INSERT INTO workspace_members (id, workspace_id, user_id, role)
      VALUES (?, ?, ?, 'owner')
    `).run(uuidv4(), workspaceId, userId);

    const token = generateToken(userId);

    // Get workspaces
    const workspaces = db.prepare(`
      SELECT w.*, wm.role
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
    `).all(userId);

    res.status(201).json({
      user: { id: userId, email, name, default_hourly_rate: 250 },
      token,
      workspaces,
      currentWorkspace: workspaces[0]
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'שגיאה ברישום' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const db = getDb(req);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'אימייל וסיסמה נדרשים' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    }

    // Check if account is active
    if (user.is_active === 0) {
      return res.status(403).json({ error: 'החשבון הושהה. נא פנה למנהל המערכת' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    }

    const token = generateToken(user.id);

    // Check if password reset is required - allow login but flag it
    const requiresPasswordReset = user.force_password_reset === 1;

    // Get user's workspaces
    const workspaces = db.prepare(`
      SELECT w.*, wm.role,
        (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY wm.joined_at ASC
    `).all(user.id);

    // Save session locally for desktop apps (Menu Bar)
    const currentWorkspace = workspaces[0] || null;
    if (currentWorkspace) {
      saveLocalSession(token, currentWorkspace.id);
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        default_hourly_rate: user.default_hourly_rate,
        is_admin: user.is_admin || 0
      },
      token,
      requiresPasswordReset,
      workspaces,
      currentWorkspace
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'שגיאה בהתחברות' });
  }
});

// Get current user
router.get('/me', authMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const user = db.prepare('SELECT id, email, name, default_hourly_rate, is_admin, created_at FROM users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }

    // Get user's workspaces
    const workspaces = db.prepare(`
      SELECT w.*, wm.role,
        (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY wm.joined_at ASC
    `).all(req.userId);

    res.json({
      ...user,
      workspaces,
      currentWorkspace: workspaces[0] || null
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת המשתמש' });
  }
});

// Update profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const db = getDb(req);
    const { name, email, default_hourly_rate, password, currentPassword } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    
    // If changing password, verify current password
    if (password) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'נדרשת סיסמה נוכחית' });
      }
      const validPassword = await bcrypt.compare(currentPassword, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'סיסמה נוכחית שגויה' });
      }
    }

    // Check if email is taken by another user
    if (email && email !== user.email) {
      const existingUser = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.userId);
      if (existingUser) {
        return res.status(400).json({ error: 'אימייל זה כבר בשימוש' });
      }
    }

    const updates = [];
    const params = [];

    if (name) { updates.push('name = ?'); params.push(name); }
    if (email) { updates.push('email = ?'); params.push(email); }
    if (default_hourly_rate !== undefined) { updates.push('default_hourly_rate = ?'); params.push(default_hourly_rate); }
    if (password) { 
      const hashedPassword = await bcrypt.hash(password, 10);
      updates.push('password = ?'); 
      params.push(hashedPassword); 
    }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.userId);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updatedUser = db.prepare('SELECT id, email, name, default_hourly_rate FROM users WHERE id = ?').get(req.userId);
    res.json(updatedUser);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הפרופיל' });
  }
});

// Delete account
router.delete('/account', authMiddleware, async (req, res) => {
  try {
    const db = getDb(req);
    const { password } = req.body;
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'סיסמה שגויה' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
    res.json({ message: 'החשבון נמחק בהצלחה' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת החשבון' });
  }
});

// Reset password (for forced password reset)
router.post('/reset-password', async (req, res) => {
  try {
    const db = getDb(req);
    const { userId, oldPassword, newPassword } = req.body;

    if (!userId || !oldPassword || !newPassword) {
      return res.status(400).json({ error: 'כל השדות נדרשים' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'סיסמה חייבת להכיל לפחות 4 תווים' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }

    // Verify old password
    const validPassword = await bcrypt.compare(oldPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'סיסמה נוכחית שגויה' });
    }

    // Check if password reset is required
    if (user.force_password_reset !== 1) {
      return res.status(400).json({ error: 'איפוס סיסמה לא נדרש' });
    }

    // Update password and clear force reset flag
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password = ?, force_password_reset = 0 WHERE id = ?').run(hashedPassword, userId);

    const token = generateToken(user.id);

    // Get workspaces
    const workspaces = db.prepare(`
      SELECT w.*, wm.role
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
    `).all(user.id);

    res.json({
      message: 'סיסמה שונתה בהצלחה',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        default_hourly_rate: user.default_hourly_rate,
        is_admin: user.is_admin || 0
      },
      token,
      workspaces,
      currentWorkspace: workspaces[0] || null
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'שגיאה באיפוס סיסמה' });
  }
});

export default router;
