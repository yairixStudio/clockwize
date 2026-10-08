import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { generateToken, authMiddleware, verifyPasswordResetToken } from '../middleware/auth.js';
import { createRateLimiter, ipAnd } from '../middleware/rateLimit.js';
import { saveLocalSession, clearLocalSession } from '../utils/localSession.js';
import { buildAuthResponse, buildPasswordResetRequiredResponse } from '../utils/authSession.js';
import { deleteUserAccount } from './workspaces.js';

const router = Router();

// Failed sign-in / reset attempts per IP + account; a successful one clears the count
const loginLimiter = createRateLimiter({ max: 10, failuresOnly: true, key: ipAnd((req) => req.body?.email) });
// The account is read from the reset token without verifying it (that happens in the route): garbage
// tokens all share one bucket, so they can't lock real users out of their reset
const resetTokenUserId = (req) => {
  try {
    return jwt.decode(req.body?.resetToken)?.userId || '';
  } catch {
    return '';
  }
};
const resetLimiter = createRateLimiter({ max: 10, failuresOnly: true, key: ipAnd(resetTokenUserId) });

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
router.post('/login', loginLimiter, async (req, res) => {
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

    // Passkey-only accounts have no password
    if (!user.password) {
      return res.status(401).json({ error: 'חשבון זה משתמש ב-Passkey בלבד — התחבר עם Passkey' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    }

    // Flagged by the admin: no session until the new password is set (POST /reset-password)
    if (user.force_password_reset === 1) {
      return res.json(buildPasswordResetRequiredResponse(user));
    }

    // Also saves the session locally for the desktop apps (Menu Bar)
    res.json(buildAuthResponse(db, user));
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'שגיאה בהתחברות' });
  }
});

// Hand an existing browser session to the desktop app (it reads the local session file).
// Used when the desktop app sends the user to the browser for a passkey sign-in but the
// browser is already signed in.
router.post('/desktop-handoff', authMiddleware, (req, res) => {
  const db = getDb(req);
  const token = req.headers.authorization.split(' ')[1];
  const requested = req.body?.workspaceId;
  const membership = requested
    ? db.prepare('SELECT workspace_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(requested, req.userId)
    : db.prepare('SELECT workspace_id FROM workspace_members WHERE user_id = ? ORDER BY joined_at ASC LIMIT 1').get(req.userId);
  if (!membership) {
    return res.status(400).json({ error: 'לא נמצא workspace' });
  }
  saveLocalSession(token, membership.workspace_id);
  res.json({ ok: true });
});

// Get current user
router.get('/me', authMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    // has_password: 0 for passkey-only accounts (they confirm destructive actions with their email)
    const user = db.prepare(`
      SELECT id, email, name, default_hourly_rate, is_admin, created_at,
        CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END AS has_password
      FROM users WHERE id = ?
    `).get(req.userId);
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
    
    // Changing the password needs the current one - except on a passkey-only account (no stored
    // password), which sets its first password here
    if (password) {
      if (user.password) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'נדרשת סיסמה נוכחית' });
        }
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
          return res.status(401).json({ error: 'סיסמה נוכחית שגויה' });
        }
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
      // A new password signs out every other session (tokens issued before now, middleware/auth.js)
      updates.push('sessions_valid_after = ?');
      params.push(Date.now());
    }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.userId);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updatedUser = db.prepare(`
      SELECT id, email, name, default_hourly_rate,
        CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END AS has_password
      FROM users WHERE id = ?
    `).get(req.userId);

    if (!password) {
      return res.json(updatedUser);
    }

    // ... but keeps this one: a fresh token for the client, and for the desktop / menu-bar app
    const token = generateToken(req.userId);
    const requested = req.headers['x-workspace-id'];
    const membership = (requested && db.prepare('SELECT workspace_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(requested, req.userId))
      || db.prepare('SELECT workspace_id FROM workspace_members WHERE user_id = ? ORDER BY joined_at ASC LIMIT 1').get(req.userId);
    if (membership) {
      saveLocalSession(token, membership.workspace_id);
    }
    res.json({ ...updatedUser, token });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הפרופיל' });
  }
});

// Delete account
router.delete('/account', authMiddleware, async (req, res) => {
  try {
    const db = getDb(req);
    const { password, confirmEmail } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);

    if (user.password) {
      if (!password) {
        return res.status(400).json({ error: 'נדרשת סיסמה' });
      }
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'סיסמה שגויה' });
      }
    } else {
      // Passkey-only account (no password stored): the user confirms by typing the account's email
      if (!confirmEmail) {
        return res.status(400).json({ error: 'לאישור המחיקה יש להקליד את כתובת האימייל של החשבון' });
      }
      if (String(confirmEmail).toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(401).json({ error: 'כתובת האימייל אינה תואמת לחשבון' });
      }
    }

    // Personal workspaces go with the account; what the user created in shared workspaces stays there
    deleteUserAccount(db, req.userId);
    res.json({ message: 'החשבון נמחק בהצלחה' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת החשבון' });
  }
});

// Forced password reset: the login (password or passkey) of a flagged user returned a short-lived
// resetToken instead of a session. Setting the new password with it clears the flag and signs in.
router.post('/reset-password', resetLimiter, async (req, res) => {
  try {
    const db = getDb(req);
    const { resetToken, newPassword } = req.body || {};

    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'כל השדות נדרשים' });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 4) {
      return res.status(400).json({ error: 'סיסמה חייבת להכיל לפחות 4 תווים' });
    }

    const userId = verifyPasswordResetToken(resetToken);
    if (!userId) {
      return res.status(401).json({ error: 'תוקף האיפוס פג. התחבר שוב כדי להגדיר סיסמה חדשה' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }
    if (user.is_active === 0) {
      return res.status(403).json({ error: 'החשבון הושהה. נא פנה למנהל המערכת' });
    }

    // Also makes the token single-use: once the flag is cleared it can't set another password
    if (user.force_password_reset !== 1) {
      return res.status(400).json({ error: 'איפוס סיסמה לא נדרש' });
    }

    if (user.password && await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ error: 'הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password = ?, force_password_reset = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(hashedPassword, userId);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.json({ message: 'סיסמה שונתה בהצלחה', ...buildAuthResponse(db, updated) });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'שגיאה באיפוס סיסמה' });
  }
});

export default router;
