import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'clockwize.db');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log('📁 Created backups directory');
  }
}

function getLatestBackupTime() {
  ensureBackupDir();

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('clockwize_backup_') && f.endsWith('.db.gz'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  // Extract date from filename: clockwize_backup_YYYY-MM-DD_HH-mm.db.gz
  const latest = files[0];
  const match = latest.match(/clockwize_backup_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})\.db\.gz/);
  if (!match) return null;

  const [, date, hours, minutes] = match;
  return new Date(`${date}T${hours}:${minutes}:00`);
}

function needsBackup() {
  const lastBackup = getLatestBackupTime();
  if (!lastBackup) return true;

  const elapsed = Date.now() - lastBackup.getTime();
  return elapsed >= BACKUP_MAX_AGE_MS;
}

function performBackup() {
  ensureBackupDir();

  if (!fs.existsSync(DB_PATH)) {
    console.log('⚠️  Database file not found, skipping backup');
    return false;
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const backupName = `clockwize_backup_${dateStr}_${timeStr}.db.gz`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  try {
    const dbBuffer = fs.readFileSync(DB_PATH);
    const compressed = zlib.gzipSync(dbBuffer);
    fs.writeFileSync(backupPath, compressed);

    const originalSize = (dbBuffer.length / 1024).toFixed(1);
    const compressedSize = (compressed.length / 1024).toFixed(1);
    console.log(`💾 Backup created: ${backupName} (${originalSize}KB → ${compressedSize}KB)`);
    return true;
  } catch (e) {
    console.error('❌ Backup failed:', e.message);
    return false;
  }
}

function checkAndBackup() {
  if (needsBackup()) {
    console.log('🔄 No backup in last 24 hours, creating backup...');
    performBackup();
  }
}

let backupInterval = null;

export function startBackupScheduler() {
  // Check immediately on startup
  checkAndBackup();

  // Then check every hour
  backupInterval = setInterval(checkAndBackup, BACKUP_INTERVAL_MS);
  console.log('⏰ Backup scheduler started (checking every hour)');
}

export function getLastBackupInfo() {
  const lastBackup = getLatestBackupTime();
  return lastBackup ? lastBackup.toISOString() : null;
}

export function triggerManualBackup() {
  console.log('🔄 Manual backup triggered');
  const success = performBackup();
  return { success, lastBackup: getLastBackupInfo() };
}

export function stopBackupScheduler() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
}
