import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { getLastBackupInfo, triggerManualBackup } from './backup.js';
import { CLIENT_DIST_DIR } from './paths.js';

// Builds the Express app around an initialised database. Kept separate from index.js
// (which listens on a port) so tests can drive the API in-process with supertest.
export async function createApp(db) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.locals.db = db;

  // One-time migration of data encrypted with the old hard-coded secret / user-id salt
  const { migrateLegacyEncryption } = await import('./utils/crypto.js');
  migrateLegacyEncryption(db);

  // Dynamic imports so routes load only after the env (secrets) is in place
  const { authMiddleware } = await import('./middleware/auth.js');
  const routes = {
    workspaces: './routes/workspaces.js',
    auth: './routes/auth.js',
    passkeys: './routes/passkeys.js',
    clients: './routes/clients.js',
    projects: './routes/projects.js',
    tasks: './routes/tasks.js',
    timer: './routes/timer.js',
    stats: './routes/stats.js',
    share: './routes/share.js',
    reminders: './routes/reminders.js',
    admin: './routes/admin.js',
    integrations: './routes/integrations.js',
    payments: './routes/payments.js',
    comments: './routes/comments.js',
    'client-sources': './routes/client_sources.js',
    credentials: './routes/credentials.js',
    files: './routes/files.js',
    notes: './routes/notes.js',
    addons: './routes/addons.js',
    catalog: './routes/catalog.js',
    ai: './routes/ai.js',
    expenses: './routes/expenses.js',
    recurring: './routes/recurring.js',
    alerts: './routes/alerts.js',
    'planned-slots': './routes/planned-slots.js',
    leads: './routes/leads.js',
    desktop: './routes/desktop.js'
  };

  for (const [mount, modulePath] of Object.entries(routes)) {
    const { default: router } = await import(modulePath);
    app.use(`/api/${mount}`, router);
  }

  // Health check - the desktop app also uses it to recognise an already-running server
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Clockwize API is running' });
  });

  // Last backup info
  app.get('/api/backup/status', authMiddleware, (req, res) => {
    res.json({ lastBackup: getLastBackupInfo() });
  });

  // Trigger manual backup
  app.post('/api/backup/trigger', authMiddleware, (req, res) => {
    const result = triggerManualBackup();
    res.json(result);
  });

  // Unknown API routes answer JSON, never the SPA page
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'נתיב לא נמצא' });
  });

  // Serve the built client (desktop app / production). In development Vite serves it instead.
  const indexHtml = path.join(CLIENT_DIST_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(CLIENT_DIST_DIR, { index: false }));
    app.get('*', (req, res) => res.sendFile(indexHtml));
  }

  return app;
}
