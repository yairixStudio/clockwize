import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import { saveLocalSession } from '../utils/localSession.js';

const router = Router();

const RP_NAME = 'Clockwize';
const RP_ID = process.env.RP_ID || 'localhost';
const CONFIGURED_ORIGINS = process.env.RP_ORIGINS
  ? process.env.RP_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : null;

// Without RP_ORIGINS (local use) any http://localhost:<port> is fine: the server picks the next
// free port when 3000 is busy, and Vite / the desktop app / a browser tab all use different ones
const LOCAL_ORIGIN = /^http:\/\/localhost(:\d{1,5})?$/;
const expectedOrigins = (req) => {
  if (CONFIGURED_ORIGINS) return CONFIGURED_ORIGINS;
  const origin = req.headers.origin;
  return origin && LOCAL_ORIGIN.test(origin) ? [origin] : ['http://localhost:3000'];
};

const getDb = (req) => req.app.locals.db;

// Short-lived WebAuthn challenge store: flowId -> { challenge, userId?, pendingUser?, expiresAt }
const FLOW_TTL_MS = 5 * 60 * 1000;
const flows = new Map();

const createFlow = (data) => {
  for (const [id, flow] of flows) {
    if (flow.expiresAt < Date.now()) flows.delete(id);
  }
  const flowId = uuidv4();
  flows.set(flowId, { ...data, expiresAt: Date.now() + FLOW_TTL_MS });
  return flowId;
};

const consumeFlow = (flowId) => {
  const flow = flows.get(flowId);
  if (flow) flows.delete(flowId);
  if (!flow || flow.expiresAt < Date.now()) return null;
  return flow;
};

const deviceNameFromUA = (ua = '') => {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'מכשיר';
};

const parseTransports = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const sanitizePasskey = (row) => ({
  id: row.id,
  name: row.name,
  device_type: row.device_type,
  backed_up: !!row.backed_up,
  created_at: row.created_at,
  last_used_at: row.last_used_at
});

const insertPasskey = (db, { userId, registrationInfo, name }) => {
  const { credential, credentialDeviceType, credentialBackedUp } = registrationInfo;
  const id = uuidv4();
  db.prepare(`
    INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    credential.id,
    Buffer.from(credential.publicKey).toString('base64url'),
    credential.counter,
    JSON.stringify(credential.transports || []),
    credentialDeviceType,
    credentialBackedUp ? 1 : 0,
    name
  );
  return db.prepare('SELECT * FROM passkeys WHERE id = ?').get(id);
};

const getUserWorkspaces = (db, userId) => db.prepare(`
  SELECT w.*, wm.role,
    (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count
  FROM workspaces w
  JOIN workspace_members wm ON w.id = wm.workspace_id
  WHERE wm.user_id = ?
  ORDER BY wm.joined_at ASC
`).all(userId);

const buildAuthResponse = (db, user) => {
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
      is_admin: user.is_admin
    },
    token,
    workspaces,
    currentWorkspace
  };
};

// ===== Passwordless signup (public) =====

router.post('/signup/options', async (req, res) => {
  try {
    const db = getDb(req);
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'שם ואימייל נדרשים' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'כתובת אימייל לא תקינה' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'משתמש עם אימייל זה כבר קיים' });
    }

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: email,
      userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }
    });

    const flowId = createFlow({ challenge: options.challenge, pendingUser: { name, email } });
    res.json({ flowId, options });
  } catch (error) {
    console.error('Passkey signup options error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת Passkey' });
  }
});

router.post('/signup/verify', async (req, res) => {
  try {
    const db = getDb(req);
    const { flowId, response } = req.body;

    const flow = flowId && consumeFlow(flowId);
    if (!flow || !flow.pendingUser) {
      return res.status(400).json({ error: 'תהליך ההרשמה פג תוקף, נסה שוב' });
    }

    const { name, email } = flow.pendingUser;
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'משתמש עם אימייל זה כבר קיים' });
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: flow.challenge,
      expectedOrigin: expectedOrigins(req),
      expectedRPID: RP_ID
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'אימות ה-Passkey נכשל' });
    }

    // Passkey-only account: empty password blocks password login (guarded in auth.js)
    const userId = uuidv4();
    db.prepare('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)')
      .run(userId, email, '', name);

    const workspaceId = uuidv4();
    const slug = `personal-${userId.substring(0, 8)}`;
    db.prepare('INSERT INTO workspaces (id, name, slug, created_by) VALUES (?, ?, ?, ?)')
      .run(workspaceId, name, slug, userId);
    db.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, 'owner')`)
      .run(uuidv4(), workspaceId, userId);

    insertPasskey(db, {
      userId,
      registrationInfo: verification.registrationInfo,
      name: `Passkey – ${deviceNameFromUA(req.headers['user-agent'])}`
    });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.status(201).json(buildAuthResponse(db, user));
  } catch (error) {
    console.error('Passkey signup verify error:', error);
    res.status(500).json({ error: 'שגיאה ברישום עם Passkey' });
  }
});

// ===== Passwordless login (public, usernameless via discoverable credential) =====

router.post('/login/options', async (req, res) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: 'preferred'
    });
    const flowId = createFlow({ challenge: options.challenge });
    res.json({ flowId, options });
  } catch (error) {
    console.error('Passkey login options error:', error);
    res.status(500).json({ error: 'שגיאה בהתחברות עם Passkey' });
  }
});

router.post('/login/verify', async (req, res) => {
  try {
    const db = getDb(req);
    const { flowId, response } = req.body;

    const flow = flowId && consumeFlow(flowId);
    if (!flow) {
      return res.status(400).json({ error: 'תהליך ההתחברות פג תוקף, נסה שוב' });
    }

    const passkey = response?.id
      ? db.prepare('SELECT * FROM passkeys WHERE credential_id = ?').get(response.id)
      : null;
    if (!passkey) {
      return res.status(401).json({ error: 'ה-Passkey אינו מזוהה במערכת' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(passkey.user_id);
    if (!user) {
      return res.status(401).json({ error: 'ה-Passkey אינו מזוהה במערכת' });
    }
    if (user.is_active === 0) {
      return res.status(403).json({ error: 'החשבון הושהה. נא פנה למנהל המערכת' });
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: flow.challenge,
      expectedOrigin: expectedOrigins(req),
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(Buffer.from(passkey.public_key, 'base64url')),
        counter: passkey.counter,
        transports: parseTransports(passkey.transports)
      }
    });

    if (!verification.verified) {
      return res.status(401).json({ error: 'אימות ה-Passkey נכשל' });
    }

    db.prepare('UPDATE passkeys SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(verification.authenticationInfo.newCounter, passkey.id);

    res.json(buildAuthResponse(db, user));
  } catch (error) {
    console.error('Passkey login verify error:', error);
    res.status(500).json({ error: 'שגיאה בהתחברות עם Passkey' });
  }
});

// ===== Management (authenticated) =====

router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const rows = db.prepare('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.userId);
    res.json({ passkeys: rows.map(sanitizePasskey), hasPassword: !!(user && user.password) });
  } catch (error) {
    console.error('List passkeys error:', error);
    res.status(500).json({ error: 'שגיאה בטעינת Passkeys' });
  }
});

router.post('/options', authMiddleware, async (req, res) => {
  try {
    const db = getDb(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    const existing = db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?').all(req.userId);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map(p => ({
        id: p.credential_id,
        transports: parseTransports(p.transports)
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }
    });

    const flowId = createFlow({ challenge: options.challenge, userId: req.userId });
    res.json({ flowId, options });
  } catch (error) {
    console.error('Passkey register options error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת Passkey' });
  }
});

router.post('/verify', authMiddleware, async (req, res) => {
  try {
    const db = getDb(req);
    const { flowId, response, name } = req.body;

    const flow = flowId && consumeFlow(flowId);
    if (!flow || flow.userId !== req.userId) {
      return res.status(400).json({ error: 'תהליך הוספת ה-Passkey פג תוקף, נסה שוב' });
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: flow.challenge,
      expectedOrigin: expectedOrigins(req),
      expectedRPID: RP_ID
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'אימות ה-Passkey נכשל' });
    }

    const trimmedName = typeof name === 'string' ? name.trim().slice(0, 64) : '';
    const row = insertPasskey(db, {
      userId: req.userId,
      registrationInfo: verification.registrationInfo,
      name: trimmedName || `Passkey – ${deviceNameFromUA(req.headers['user-agent'])}`
    });

    res.status(201).json(sanitizePasskey(row));
  } catch (error) {
    console.error('Passkey register verify error:', error);
    res.status(500).json({ error: 'שגיאה בהוספת Passkey' });
  }
});

router.patch('/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 64) : '';
    if (!name) {
      return res.status(400).json({ error: 'שם נדרש' });
    }

    const result = db.prepare('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?')
      .run(name, req.params.id, req.userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Passkey לא נמצא' });
    }

    res.json(sanitizePasskey(db.prepare('SELECT * FROM passkeys WHERE id = ?').get(req.params.id)));
  } catch (error) {
    console.error('Rename passkey error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון Passkey' });
  }
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const passkey = db.prepare('SELECT id FROM passkeys WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!passkey) {
      return res.status(404).json({ error: 'Passkey לא נמצא' });
    }

    // Don't allow locking yourself out: a passkey-only account must keep its last passkey
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.userId);
    const count = db.prepare('SELECT COUNT(*) as c FROM passkeys WHERE user_id = ?').get(req.userId).c;
    if (!user.password && count <= 1) {
      return res.status(400).json({
        error: 'לא ניתן למחוק את ה-Passkey האחרון בחשבון ללא סיסמה — תינעל מחוץ לחשבון'
      });
    }

    db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete passkey error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת Passkey' });
  }
});

export default router;
