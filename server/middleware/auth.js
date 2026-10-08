import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set in the environment and be at least 32 characters long');
}

// iatMs: issue time in ms (the standard iat is whole seconds), compared with users.sessions_valid_after
export const generateToken = (userId) => {
  return jwt.sign({ userId, iatMs: Date.now() }, JWT_SECRET, { expiresIn: '30d' });
};

// A user the admin flagged for a forced password reset gets this instead of a session token: it is
// accepted only by POST /api/auth/reset-password (authMiddleware rejects any token with a purpose)
const PASSWORD_RESET_PURPOSE = 'password-reset';
export const PASSWORD_RESET_TOKEN_TTL = '15m';

export const generatePasswordResetToken = (userId) =>
  jwt.sign({ userId, purpose: PASSWORD_RESET_PURPOSE }, JWT_SECRET, { expiresIn: PASSWORD_RESET_TOKEN_TTL });

// The user id of a valid, unexpired password-reset token, or null
export const verifyPasswordResetToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.purpose === PASSWORD_RESET_PURPOSE && decoded.userId ? decoded.userId : null;
  } catch {
    return null;
  }
};

export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'אנא התחבר למערכת' });
  }

  const token = authHeader.split(' ')[1];
  
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'טוקן לא תקין' });
  }

  // Special-purpose tokens (a password-reset token) are not sessions
  if (decoded.purpose) {
    return res.status(401).json({ error: 'טוקן לא תקין' });
  }

  // A valid signature is not enough: deleted or suspended users lose access right away,
  // not when their 30-day token expires - and so does a user flagged for a forced password
  // reset, until they set the new password. 401 makes the client sign out.
  // Tokens issued before sessions_valid_after (the admin forced a password reset) are revoked.
  const db = req.app?.locals?.db;
  const user = db?.prepare('SELECT is_active, force_password_reset, sessions_valid_after FROM users WHERE id = ?').get(decoded.userId);
  const issuedAt = decoded.iatMs ?? (decoded.iat || 0) * 1000;
  if (db && (!user || user.is_active === 0 || user.force_password_reset === 1 ||
      (user.sessions_valid_after && issuedAt < user.sessions_valid_after))) {
    return res.status(401).json({ error: 'אנא התחבר למערכת' });
  }

  req.userId = decoded.userId;
  next();
};

// Workspace context middleware - adds workspaceId and workspaceRole to request
export const workspaceMiddleware = (req, res, next) => {
  const db = req.app.locals.db;
  const workspaceId = req.headers['x-workspace-id'];
  
  if (!workspaceId) {
    // Try to get user's first/default workspace
    const membership = db.prepare(`
      SELECT wm.workspace_id, wm.role, w.name as workspace_name
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY wm.joined_at ASC
      LIMIT 1
    `).get(req.userId);
    
    if (!membership) {
      return res.status(400).json({ error: 'לא נמצא workspace. אנא צור או הצטרף ל-workspace' });
    }
    
    req.workspaceId = membership.workspace_id;
    req.workspaceRole = membership.role;
    req.workspaceName = membership.workspace_name;
    return next();
  }
  
  // Verify user is member of the specified workspace
  const membership = db.prepare(`
    SELECT wm.role, w.name as workspace_name
    FROM workspace_members wm
    JOIN workspaces w ON w.id = wm.workspace_id
    WHERE wm.workspace_id = ? AND wm.user_id = ?
  `).get(workspaceId, req.userId);
  
  if (!membership) {
    return res.status(403).json({ error: 'אין לך גישה ל-workspace זה' });
  }
  
  req.workspaceId = workspaceId;
  req.workspaceRole = membership.role;
  req.workspaceName = membership.workspace_name;
  next();
};

// Role-based access control middleware factory
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.workspaceRole) {
      return res.status(403).json({ error: 'נדרשת גישה ל-workspace' });
    }
    
    if (!allowedRoles.includes(req.workspaceRole)) {
      return res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
    }
    
    next();
  };
};

// Check if user can see all time entries (owner/admin can see all, member only their own)
export const canViewAllTimeEntries = (req) => {
  return req.workspaceRole === 'owner' || req.workspaceRole === 'admin';
};

// Check if user can manage workspace settings
export const canManageWorkspace = (req) => {
  return req.workspaceRole === 'owner' || req.workspaceRole === 'admin';
};

// Check if user can invite members
export const canInviteMembers = (req) => {
  return req.workspaceRole === 'owner' || req.workspaceRole === 'admin';
};

// Check if user can remove members
export const canRemoveMember = (req, targetRole) => {
  if (req.workspaceRole === 'owner') return true;
  if (req.workspaceRole === 'admin' && targetRole === 'member') return true;
  return false;
};
