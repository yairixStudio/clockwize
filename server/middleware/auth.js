import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'clockwize-secret-key-change-in-production';

export const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
};

export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'אנא התחבר למערכת' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'טוקן לא תקין' });
  }
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
