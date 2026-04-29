import initSqlJs from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, 'clockwize.db');

let db = null;

// Wrapper to provide better-sqlite3 like API
class Database {
  constructor(sqlJsDb) {
    this.db = sqlJsDb;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        try {
          const stmt = self.db.prepare(sql);
          stmt.run(params);
          stmt.free();
          self.save();
          return { changes: self.db.getRowsModified() };
        } catch (e) {
          console.error('SQL Error:', e.message, sql);
          throw e;
        }
      },
      get(...params) {
        try {
          const stmt = self.db.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        } catch (e) {
          console.error('SQL Error:', e.message, sql);
          throw e;
        }
      },
      all(...params) {
        try {
          const results = [];
          const stmt = self.db.prepare(sql);
          stmt.bind(params);
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return results;
        } catch (e) {
          console.error('SQL Error:', e.message, sql);
          throw e;
        }
      }
    };
  }

  exec(sql) {
    try {
      this.db.run(sql);
      this.save();
    } catch (e) {
      console.error('SQL Exec Error:', e.message);
      throw e;
    }
  }

  pragma(statement) {
    try {
      this.db.run(`PRAGMA ${statement}`);
    } catch (e) {
      console.error('Pragma Error:', e.message);
    }
  }

  columnExists(table, column) {
    try {
      const info = this.prepare(`PRAGMA table_info(${table})`).all();
      return info.some(col => col.name === column);
    } catch (e) {
      return false;
    }
  }

  addColumn(table, column, type = 'TEXT') {
    if (!this.columnExists(table, column)) {
      try {
        this.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

async function initDatabase() {
  const SQL = await initSqlJs();

  let sqlJsDb;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    sqlJsDb = new SQL.Database(buffer);
  } else {
    sqlJsDb = new SQL.Database();
  }

  db = new Database(sqlJsDb);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Initialize database schema
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      default_hourly_rate REAL DEFAULT 250,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Clients table
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      bank_name TEXT,
      bank_account TEXT,
      bank_branch TEXT,
      tax_id TEXT,
      notes TEXT,
      hourly_rate REAL,
      status TEXT DEFAULT 'active',
      is_favorite INTEGER DEFAULT 0,
      share_token TEXT UNIQUE,
      share_permissions TEXT DEFAULT 'view',
      morning_id TEXT,
      aliases TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Projects table
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      pricing_type TEXT DEFAULT 'hourly',
      fixed_price REAL,
      hourly_rate REAL,
      status TEXT DEFAULT 'active',
      share_token TEXT UNIQUE,
      share_permissions TEXT DEFAULT 'view',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Tasks table
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      hourly_rate REAL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Time entries table (for tracking work intervals)
    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      task_id TEXT,
      start_time DATETIME NOT NULL,
      end_time DATETIME,
      duration INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    -- Active timers table
    CREATE TABLE IF NOT EXISTS active_timers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      task_id TEXT,
      start_time DATETIME NOT NULL,
      accumulated_seconds INTEGER DEFAULT 0,
      is_running INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    -- Timer intervals table (stores work segments for time entries)
    CREATE TABLE IF NOT EXISTS timer_intervals (
      id TEXT PRIMARY KEY,
      timer_id TEXT,
      time_entry_id TEXT,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      start_time DATETIME NOT NULL,
      end_time DATETIME,
      duration_seconds INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (timer_id) REFERENCES active_timers(id) ON DELETE CASCADE,
      FOREIGN KEY (time_entry_id) REFERENCES time_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Shared links table (for managing shared access)
    CREATE TABLE IF NOT EXISTS shared_links (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      share_token TEXT UNIQUE NOT NULL,
      share_type TEXT DEFAULT 'public',
      share_password TEXT,
      allowed_email TEXT,
      is_active INTEGER DEFAULT 1,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Shared link access log (for email-verified access)
    CREATE TABLE IF NOT EXISTS shared_link_access (
      id TEXT PRIMARY KEY,
      shared_link_id TEXT NOT NULL,
      accessed_by_email TEXT,
      accessed_by_user_id TEXT,
      verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shared_link_id) REFERENCES shared_links(id) ON DELETE CASCADE,
      FOREIGN KEY (accessed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Reminders table
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      notes TEXT,
      due_date DATETIME,
      is_read INTEGER DEFAULT 0,
      association_type TEXT DEFAULT 'general',
      association_id TEXT,
      is_recurring INTEGER DEFAULT 0,
      recurrence_interval TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    -- Subtasks table
    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    -- Comments table (for forum/chat)
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      parent_id TEXT,
      client_id TEXT,
      project_id TEXT,
      task_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    -- Integrations table
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      api_key TEXT,
      api_secret TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expires_at DATETIME,
      settings TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, provider)
    );

    -- Payments table
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      amount REAL NOT NULL,
      date DATETIME NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Credentials table (for storing encrypted service credentials)
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      client_id TEXT,
      project_id TEXT,
      service_name TEXT NOT NULL,
      username TEXT,
      password TEXT,
      url TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Files table (for storing uploaded file metadata)
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      client_id TEXT,
      project_id TEXT,
      task_id TEXT,
      original_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    -- Notes table (rich text notes for entities)
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      title TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- User Addons table (stores which addons are enabled/disabled per user)
    CREATE TABLE IF NOT EXISTS user_addons (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      addon_id TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, addon_id)
    );

    -- Comment read status table (tracks when user last viewed comments for each context)
    CREATE TABLE IF NOT EXISTS comment_read_status (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      context_type TEXT NOT NULL,
      context_id TEXT,
      last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, context_type, context_id)
    );

    -- Workspaces table (organizations/companies)
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Workspace members table (links users to workspaces with roles)
    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(workspace_id, user_id)
    );

    -- Workspace invites table (invitation links)
    CREATE TABLE IF NOT EXISTS workspace_invites (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      expires_at DATETIME,
      max_uses INTEGER,
      used_count INTEGER DEFAULT 0,
      created_by TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Migration: Add share columns to projects table if they don't exist
  // Migration: Add client_sources table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS client_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`);
  } catch (e) {
    // ignore if exists
  }
  
  // Migration: Add workspace_id to client_sources if it doesn't exist
  db.addColumn('client_sources', 'workspace_id', 'TEXT');
  
  // Remove the UNIQUE constraint on name (if possible) by recreating the table
  // For now, we'll handle unique per workspace in application logic
  // Migration: Add source_id column to clients table
  db.addColumn('clients', 'source_id', 'TEXT');
  // Add foreign key constraint (SQLite doesn't support adding FK after table creation easily, so ensure reference in queries)

  db.addColumn('projects', 'share_token', 'TEXT');
  db.addColumn('projects', 'share_permissions', "TEXT DEFAULT 'view'");

  // Migration: Add notes column to projects and tasks
  db.addColumn('projects', 'notes', 'TEXT');
  db.addColumn('tasks', 'notes', 'TEXT');

  // Migration: Add paid_amount column to projects and tasks
  db.addColumn('projects', 'paid_amount', 'REAL DEFAULT 0');
  db.addColumn('tasks', 'paid_amount', 'REAL DEFAULT 0');

  // Migration: Add is_edited columns to time_entries
  db.addColumn('time_entries', 'is_manual', 'INTEGER DEFAULT 0');
  db.addColumn('time_entries', 'is_edited', 'INTEGER DEFAULT 0');
  
  if (!db.columnExists('time_entries', 'updated_at')) {
    try {
      db.exec(`ALTER TABLE time_entries ADD COLUMN updated_at DATETIME`);
      // Set initial updated_at for existing rows that don't have it
      db.exec(`UPDATE time_entries SET updated_at = created_at WHERE updated_at IS NULL`);
    } catch (e) {
      // Column already exists
    }
  }

  // Migration: Add subtask_id column to time_entries
  db.addColumn('time_entries', 'subtask_id', 'TEXT');

  // Migration: Add is_admin column to users
  db.addColumn('users', 'is_admin', 'INTEGER DEFAULT 0');

  // Migration: Add is_active column to users
  db.addColumn('users', 'is_active', 'INTEGER DEFAULT 1');

  // Migration: Add force_password_reset column to users
  db.addColumn('users', 'force_password_reset', 'INTEGER DEFAULT 0');

  // Migration: Add status column to clients
  db.addColumn('clients', 'status', "TEXT DEFAULT 'active'");

  // Migration: Add is_favorite column to clients
  db.addColumn('clients', 'is_favorite', 'INTEGER DEFAULT 0');

  // Migration: Add morning_id column to clients
  db.addColumn('clients', 'morning_id', 'TEXT');

  // Migration: Add aliases column to clients (JSON array of nicknames for search)
  db.addColumn('clients', 'aliases', 'TEXT');

  // Migration: Add sub_source column to clients (for "who referred" etc.)
  db.addColumn('clients', 'sub_source', 'TEXT');

  // Migration: Add domains column to clients (JSON array of domains for Chrome extension auto-detection)
  db.addColumn('clients', 'domains', 'TEXT');

  // Migration: Add estimated_hours column to projects
  db.addColumn('projects', 'estimated_hours', 'REAL');

  // Migration: Add estimated_hours column to tasks
  db.addColumn('tasks', 'estimated_hours', 'REAL');

  // Migration: Add is_favorite column to projects
  db.addColumn('projects', 'is_favorite', 'INTEGER DEFAULT 0');

  // Migration: Add priority column to tasks (low, normal, high)
  db.addColumn('tasks', 'priority', "TEXT DEFAULT 'normal'");

  // Migration: Add pricing_type column to tasks (hourly, no_charge - inherits from project if null)
  db.addColumn('tasks', 'pricing_type', 'TEXT');

  // Migration: Add priority column to projects (low, normal, high)
  db.addColumn('projects', 'priority', "TEXT DEFAULT 'normal'");

  // Migration: Add task_id column to files table if it doesn't exist
  db.addColumn('files', 'task_id', 'TEXT');

  // Migration: Add notes column to reminders table
  db.addColumn('reminders', 'notes', 'TEXT');

  // Migration: Add is_archived column to reminders table (separate from is_read/handled)
  db.addColumn('reminders', 'is_archived', 'INTEGER DEFAULT 0');

  // Migration: Add new subtask fields (due_date, description, priority)
  db.addColumn('subtasks', 'due_date', 'TEXT');
  db.addColumn('subtasks', 'description', 'TEXT');
  db.addColumn('subtasks', 'priority', "TEXT DEFAULT 'normal'");

  // Migration: Add communication_platforms column to projects, tasks, subtasks (JSON array)
  db.addColumn('projects', 'communication_platforms', 'TEXT');
  db.addColumn('tasks', 'communication_platforms', 'TEXT');
  db.addColumn('subtasks', 'communication_platforms', 'TEXT');

  // Migration: Add workspace_id to all relevant tables
  const tablesNeedingWorkspaceId = [
    'clients', 'projects', 'tasks', 'time_entries', 'active_timers',
    'reminders', 'credentials', 'files', 'notes', 'user_addons',
    'comments', 'integrations', 'shared_links', 'payments'
  ];
  
  for (const table of tablesNeedingWorkspaceId) {
    db.addColumn(table, 'workspace_id', 'TEXT');
  }

  // Migration: Create personal workspace for existing users who don't have one
  try {
    const usersWithoutWorkspace = db.prepare(`
      SELECT u.id, u.name, u.email 
      FROM users u 
      WHERE NOT EXISTS (
        SELECT 1 FROM workspace_members wm WHERE wm.user_id = u.id
      )
    `).all();

    for (const user of usersWithoutWorkspace) {
      const workspaceId = uuidv4();
      const slug = `personal-${user.id.substring(0, 8)}`;
      const workspaceName = user.name ? `${user.name}` : 'הWorkspace שלי';

      // Create personal workspace
      db.prepare(`
        INSERT INTO workspaces (id, name, slug, created_by)
        VALUES (?, ?, ?, ?)
      `).run(workspaceId, workspaceName, slug, user.id);

      // Add user as owner
      db.prepare(`
        INSERT INTO workspace_members (id, workspace_id, user_id, role)
        VALUES (?, ?, ?, 'owner')
      `).run(uuidv4(), workspaceId, user.id);

      // Update all user's data to belong to this workspace
      const tablesToUpdate = [
        'clients', 'projects', 'tasks', 'time_entries', 'active_timers',
        'reminders', 'credentials', 'files', 'notes', 'user_addons',
        'comments', 'integrations', 'shared_links'
      ];

      for (const table of tablesToUpdate) {
        try {
          db.prepare(`UPDATE ${table} SET workspace_id = ? WHERE user_id = ? AND workspace_id IS NULL`).run(workspaceId, user.id);
        } catch (e) {
          // Table might not have user_id column (like payments)
        }
      }

      // Handle payments separately (linked via project)
      try {
        db.prepare(`
          UPDATE payments SET workspace_id = ? 
          WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?) 
          AND workspace_id IS NULL
        `).run(workspaceId, user.id);
      } catch (e) {
        // Ignore errors
      }

      console.log(`✅ Created personal workspace for user: ${user.email}`);
    }
  } catch (e) {
    console.error('Migration error (workspaces):', e.message);
  }

  // Seed Admin User
  try {
    const adminEmail = 'admin';
    const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

    if (!existingAdmin) {
      console.log('Creating admin user...');
      const adminId = uuidv4();
      const hashedPassword = await bcrypt.hash('admin', 10);

      db.prepare(`
        INSERT INTO users (id, email, password, name, is_admin)
        VALUES (?, ?, ?, ?, 1)
      `).run(adminId, adminEmail, hashedPassword, 'Admin');

      console.log('✅ Admin user created (user: admin, pass: admin)');
    }
  } catch (e) {
    console.error('Error seeding admin user:', e);
  }

  // Migration: Create addon_settings table (for storing addon-specific settings like API keys)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS addon_settings (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      addon_id TEXT NOT NULL,
      setting_key TEXT NOT NULL,
      setting_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      UNIQUE(workspace_id, addon_id, setting_key)
    )`);
  } catch (e) {
    // Table already exists
  }

  // Migration: Create catalog_items table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS catalog_items (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL,
      pricing_type TEXT DEFAULT 'fixed',
      unit TEXT,
      category TEXT,
      is_active INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`);
  } catch (e) {
    // Table already exists
  }

  // Migration: Assign orphaned client_sources to workspaces
  try {
    // Step 1: Find client_sources with NULL workspace_id that are actually used by clients
    const orphanedSources = db.prepare(`
      SELECT DISTINCT cs.id, cs.name, c.workspace_id
      FROM client_sources cs
      INNER JOIN clients c ON c.source_id = cs.id
      WHERE cs.workspace_id IS NULL AND c.workspace_id IS NOT NULL
    `).all();

    for (const source of orphanedSources) {
      db.prepare(`
        UPDATE client_sources 
        SET workspace_id = ? 
        WHERE id = ?
      `).run(source.workspace_id, source.id);
      console.log(`✅ Migrated client_source "${source.name}" (${source.id}) to workspace ${source.workspace_id}`);
    }

    if (orphanedSources.length > 0) {
      console.log(`✅ Migrated ${orphanedSources.length} used client sources to workspaces`);
    }

    // Step 2: Find client_sources with NULL workspace_id that are NOT used by any clients
    // These might be old sources that should be kept as global or deleted
    const unusedSources = db.prepare(`
      SELECT cs.id, cs.name
      FROM client_sources cs
      WHERE cs.workspace_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.source_id = cs.id)
    `).all();

    if (unusedSources.length > 0) {
      console.log(`⚠️  Found ${unusedSources.length} unused client sources with NULL workspace_id:`);
      unusedSources.forEach(s => console.log(`   - "${s.name}" (${s.id})`));
      console.log('   These sources are kept as GLOBAL (available to all workspaces)');
    }
  } catch (e) {
    console.error('Migration error (client_sources workspace assignment):', e.message);
  }

  // Migration: Add new payment fields for smart payment management
  db.addColumn('payments', 'type', "TEXT DEFAULT 'income'");
  db.addColumn('payments', 'status', "TEXT DEFAULT 'paid'");
  db.addColumn('payments', 'task_id', 'TEXT');
  db.addColumn('payments', 'due_date', 'DATETIME');
  db.addColumn('payments', 'paid_date', 'DATETIME');
  db.addColumn('payments', 'payment_method', 'TEXT');
  db.addColumn('payments', 'recurring_id', 'TEXT');

  // Migration: Create recurring_payments table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS recurring_payments (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      project_id TEXT,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT DEFAULT 'income',
      amount REAL NOT NULL,
      interval TEXT DEFAULT 'monthly',
      day_of_month INTEGER DEFAULT 1,
      start_date DATETIME,
      end_date DATETIME,
      is_active INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
  } catch (e) {
    // Table already exists
  }

  // Migration: Create expense_categories table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS expense_categories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      icon TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`);
  } catch (e) {
    // Table already exists
  }

  // Migration: Add category_id to payments for expenses
  db.addColumn('payments', 'category_id', 'TEXT');

  // Migration: Update existing payments to have status='paid' and type='income'
  try {
    db.prepare(`UPDATE payments SET status = 'paid' WHERE status IS NULL`).run();
    db.prepare(`UPDATE payments SET type = 'income' WHERE type IS NULL`).run();
    // Set paid_date to date for existing payments
    db.prepare(`UPDATE payments SET paid_date = date WHERE paid_date IS NULL AND status = 'paid'`).run();
  } catch (e) {
    console.error('Migration error (updating existing payments):', e.message);
  }

  // Migration: Create time_entry_associations table for multiple project/task associations
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS time_entry_associations (
      id TEXT PRIMARY KEY,
      time_entry_id TEXT NOT NULL,
      project_id TEXT,
      task_id TEXT,
      workspace_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (time_entry_id) REFERENCES time_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )`);
    
    // Create index for faster queries
    db.exec(`CREATE INDEX IF NOT EXISTS idx_time_entry_associations_entry ON time_entry_associations(time_entry_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_time_entry_associations_project ON time_entry_associations(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_time_entry_associations_task ON time_entry_associations(task_id)`);
  } catch (e) {
    // Table/indexes already exist
  }

  // Migration: Create payment_associations table for multiple project/task associations
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS payment_associations (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      project_id TEXT,
      task_id TEXT,
      workspace_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )`);

    // Create index for faster queries
    db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_associations_payment ON payment_associations(payment_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_associations_project ON payment_associations(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_associations_task ON payment_associations(task_id)`);
  } catch (e) {
    // Table/indexes already exist
  }

  // Migration: Create reminder_associations table for multiple project associations
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS reminder_associations (
      id TEXT PRIMARY KEY,
      reminder_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      workspace_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`);

    // Create indexes for faster queries
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reminder_associations_reminder ON reminder_associations(reminder_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reminder_associations_project ON reminder_associations(project_id)`);
  } catch (e) {
    // Table/indexes already exist
  }

  // Migration: Create project_alerts table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS project_alerts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workspace_id TEXT,
      alert_type TEXT NOT NULL,
      threshold_value REAL,
      threshold_days INTEGER,
      message TEXT,
      is_triggered INTEGER DEFAULT 0,
      is_dismissed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_project_alerts_project ON project_alerts(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_project_alerts_workspace ON project_alerts(workspace_id)`);
  } catch (e) {
    // Table/indexes already exist
  }

  // Migration: Create planned_slots table (for scheduling future work)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS planned_slots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      client_id TEXT,
      project_id TEXT,
      date TEXT NOT NULL,
      duration INTEGER NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_planned_slots_date ON planned_slots(date, user_id, workspace_id)`);
  } catch (e) {
    // Table/indexes already exist
  }

  // Migration: Add recurrence columns to planned_slots
  db.addColumn('planned_slots', 'recurrence_group_id', 'TEXT');
  db.addColumn('planned_slots', 'recurrence_type', 'TEXT');
  db.addColumn('planned_slots', 'recurrence_interval', 'INTEGER DEFAULT 1');
  db.addColumn('planned_slots', 'recurrence_end_date', 'TEXT');
  db.addColumn('planned_slots', 'sort_order', 'INTEGER DEFAULT 0');

  // Migration: Create leads table (Lead Management System)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      source_type TEXT DEFAULT 'other',
      source_id TEXT,
      source_detail TEXT,
      status TEXT DEFAULT 'new',
      priority TEXT DEFAULT 'warm',
      expected_value REAL,
      expected_close_date TEXT,
      assigned_to TEXT,
      tags TEXT,
      converted_client_id TEXT,
      converted_at DATETIME,
      lost_reason TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES client_sources(id) ON DELETE SET NULL,
      FOREIGN KEY (converted_client_id) REFERENCES clients(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_workspace ON leads(workspace_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(workspace_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_close_date ON leads(expected_close_date)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_converted ON leads(converted_client_id)`);
  } catch (e) {
    // Table/indexes already exist
  }

  // Migration: Create lead_activities table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS lead_activities (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      content TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_lead_activities_workspace ON lead_activities(workspace_id)`);
  } catch (e) {
    // Table/indexes already exist
  }

  // Migration: Create lead_reminders table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS lead_reminders (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      due_date DATETIME NOT NULL,
      is_completed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_lead_reminders_lead ON lead_reminders(lead_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_lead_reminders_due ON lead_reminders(due_date, is_completed)`);
  } catch (e) {
    // Table/indexes already exist
  }

  // Migration: Add lead_id to clients and files tables
  db.addColumn('clients', 'lead_id', 'TEXT');
  db.addColumn('files', 'lead_id', 'TEXT');

  // Migration: Add client_id to leads (for opportunities from existing clients)
  db.addColumn('leads', 'client_id', 'TEXT');

  // Migration: Rename marketing_funnels addon to leads_management
  try {
    db.prepare(`UPDATE user_addons SET addon_id = 'leads_management' WHERE addon_id = 'marketing_funnels'`).run();
  } catch (e) {
    // Ignore if already migrated
  }

  // === Leads-CRM Integration Migrations ===

  // Migration: Add lead_id and is_internal to projects (shadow project support)
  db.addColumn('projects', 'lead_id', 'TEXT');
  db.addColumn('projects', 'is_internal', 'INTEGER DEFAULT 0');

  // Migration: Add internal_project_id to leads (shadow project reference)
  db.addColumn('leads', 'internal_project_id', 'TEXT');

  // Migration: Add is_opportunity flag to leads
  db.addColumn('leads', 'is_opportunity', 'INTEGER DEFAULT 0');

  // Migration: Add is_internal to clients (for internal leads container client)
  db.addColumn('clients', 'is_internal', 'INTEGER DEFAULT 0');

  // Migration: Add lead_id to planned_slots (schedule leads support)
  db.addColumn('planned_slots', 'lead_id', 'TEXT');

  // Migration: Mark existing leads with client_id as opportunities
  try {
    db.prepare(`UPDATE leads SET is_opportunity = 1 WHERE client_id IS NOT NULL AND (is_opportunity IS NULL OR is_opportunity = 0)`).run();
  } catch (e) {
    // Column might not exist yet on first run
  }

  // Migration: Copy lead_reminders to reminders table (unification)
  try {
    const existingLeadReminders = db.prepare(`
      SELECT lr.* FROM lead_reminders lr
      WHERE NOT EXISTS (
        SELECT 1 FROM reminders r
        WHERE r.association_type = 'lead'
        AND r.association_id = lr.lead_id
        AND r.content = lr.content
        AND r.due_date = lr.due_date
      )
    `).all();

    if (existingLeadReminders.length > 0) {
      const insertStmt = db.prepare(`
        INSERT INTO reminders (id, user_id, workspace_id, content, due_date, is_read, is_archived, association_type, association_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, 'lead', ?, ?, CURRENT_TIMESTAMP)
      `);

      for (const lr of existingLeadReminders) {
        insertStmt.run(
          uuidv4(),
          lr.user_id, lr.workspace_id, lr.content, lr.due_date,
          lr.is_completed ? 1 : 0,
          lr.lead_id, lr.created_at
        );
      }
      console.log(`Migrated ${existingLeadReminders.length} lead reminders to unified reminders table`);
    }
  } catch (e) {
    // lead_reminders table might not have data or reminders table might not support it yet
    if (!e.message.includes('no such table')) {
      console.error('Lead reminders migration note:', e.message);
    }
  }

  // Migration: Make payments.project_id nullable (SQLite requires table rebuild)
  try {
    const colInfo = db.prepare("PRAGMA table_info(payments)").all();
    const projectIdCol = colInfo.find(c => c.name === 'project_id');
    if (projectIdCol && projectIdCol.notnull === 1) {
      console.log('🔄 Migrating payments table: making project_id nullable...');
      const cols = colInfo.map(c => c.name);
      const colsList = cols.join(', ');
      db.exec(`ALTER TABLE payments RENAME TO payments_old`);
      db.exec(`
        CREATE TABLE payments (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          amount REAL NOT NULL,
          date DATETIME NOT NULL,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          workspace_id TEXT,
          type TEXT DEFAULT 'income',
          status TEXT DEFAULT 'paid',
          task_id TEXT,
          due_date DATETIME,
          paid_date DATETIME,
          payment_method TEXT,
          recurring_id TEXT,
          category_id TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
      db.exec(`INSERT INTO payments (${colsList}) SELECT ${colsList} FROM payments_old`);
      db.exec(`DROP TABLE payments_old`);
      console.log('✅ Payments table migrated successfully');
    }
  } catch (e) {
    console.error('Migration error (payments project_id nullable):', e.message);
  }

  console.log('✅ Database initialized');
  return db;
}

// Export a promise that resolves to the database
export const dbPromise = initDatabase();
export default dbPromise;
