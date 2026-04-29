import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbPromise } from './database.js';
import { startBackupScheduler, getLastBackupInfo, triggerManualBackup } from './backup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const START_PORT = process.env.PORT || 3000;
const PORT_FILE = path.join(__dirname, '..', '.server-port');

// Middleware
app.use(cors());
app.use(express.json());

// Wait for database to be ready before starting
async function startServer() {
  // Wait for database initialization
  const db = await dbPromise;

  // Make db available to routes
  app.locals.db = db;

  // Dynamic import routes after db is ready
  const { default: authRoutes } = await import('./routes/auth.js');
  const { default: clientRoutes } = await import('./routes/clients.js');
  const { default: projectRoutes } = await import('./routes/projects.js');
  const { default: taskRoutes } = await import('./routes/tasks.js');
  const { default: timerRoutes } = await import('./routes/timer.js');
  const { default: statsRoutes } = await import('./routes/stats.js');
  const { default: shareRoutes } = await import('./routes/share.js');
  const { default: reminderRoutes } = await import('./routes/reminders.js');
  const { default: adminRoutes } = await import('./routes/admin.js');
  const { default: integrationRoutes } = await import('./routes/integrations.js');
  const { default: paymentsRoutes } = await import('./routes/payments.js');
  const { default: commentRoutes } = await import('./routes/comments.js');
  const { default: clientSourcesRoutes } = await import('./routes/client_sources.js');
  const { default: credentialsRoutes } = await import('./routes/credentials.js');
  const { default: filesRoutes } = await import('./routes/files.js');
  const { default: notesRoutes } = await import('./routes/notes.js');
  const { default: addonsRoutes } = await import('./routes/addons.js');
  const { default: workspacesRoutes } = await import('./routes/workspaces.js');
  const { default: catalogRoutes } = await import('./routes/catalog.js');
  const { default: aiRoutes } = await import('./routes/ai.js');
  const { default: expensesRoutes } = await import('./routes/expenses.js');
  const { default: recurringRoutes } = await import('./routes/recurring.js');
  const { default: alertsRoutes } = await import('./routes/alerts.js');
  const { default: plannedSlotsRoutes } = await import('./routes/planned-slots.js');
  const { default: leadsRoutes } = await import('./routes/leads.js');

  // Routes
  app.use('/api/workspaces', workspacesRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/clients', clientRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/timer', timerRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/share', shareRoutes);
  app.use('/api/reminders', reminderRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/integrations', integrationRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/comments', commentRoutes);
  app.use('/api/client-sources', clientSourcesRoutes);
  app.use('/api/credentials', credentialsRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/notes', notesRoutes);
  app.use('/api/addons', addonsRoutes);
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/expenses', expensesRoutes);
  app.use('/api/recurring', recurringRoutes);
  app.use('/api/alerts', alertsRoutes);
  app.use('/api/planned-slots', plannedSlotsRoutes);
  app.use('/api/leads', leadsRoutes);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Clockwize API is running' });
  });

  // Last backup info
  app.get('/api/backup/status', (req, res) => {
    res.json({ lastBackup: getLastBackupInfo() });
  });

  // Trigger manual backup
  app.post('/api/backup/trigger', (req, res) => {
    const result = triggerManualBackup();
    res.json(result);
  });

  // Start automatic backup scheduler
  startBackupScheduler();

  // Try to find an available port starting from START_PORT
  const tryPort = (port) => {
    const server = app.listen(port, () => {
      // שמירת הפורט לקובץ כדי שהקליינט יידע
      fs.writeFileSync(PORT_FILE, String(port));
      console.log(`🕐 Clockwize server running on http://localhost:${port}`);
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️  Port ${port} is busy, trying ${port + 1}...`);
        tryPort(port + 1);
      } else {
        console.error('Server error:', err);
      }
    });
  };
  
  tryPort(START_PORT);
}

startServer().catch(console.error);
