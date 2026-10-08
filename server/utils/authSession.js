import { generateToken, generatePasswordResetToken } from '../middleware/auth.js';
import { saveLocalSession } from './localSession.js';

// The user's workspaces in the order login picks the default one from (oldest membership first)
export const getUserWorkspaces = (db, userId) => db.prepare(`
  SELECT w.*, wm.role,
    (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count
  FROM workspaces w
  JOIN workspace_members wm ON w.id = wm.workspace_id
  WHERE wm.user_id = ?
  ORDER BY wm.joined_at ASC
`).all(userId);

// A signed-in session: a normal token, the user, their workspaces and the default workspace.
// Also hands the session to the desktop / menu-bar app (local session file).
export const buildAuthResponse = (db, user) => {
  const token = generateToken(user.id);
  const workspaces = getUserWorkspaces(db, user.id);
  const currentWorkspace = workspaces[0] || null;
  if (currentWorkspace) {
    saveLocalSession(token, currentWorkspace.id);
  }
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      default_hourly_rate: user.default_hourly_rate,
      is_admin: user.is_admin || 0,
      // 0 for passkey-only accounts (they confirm account deletion with their email, not a password)
      has_password: user.password ? 1 : 0
    },
    token,
    requiresPasswordReset: false,
    workspaces,
    currentWorkspace
  };
};

// The admin flagged this user for a forced password reset: no session (no token, nothing saved for
// the desktop app) until they set a new password with this short-lived reset token
export const buildPasswordResetRequiredResponse = (user) => ({
  requiresPasswordReset: true,
  resetToken: generatePasswordResetToken(user.id)
});
