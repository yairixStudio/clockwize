// Builds the client and the desktop app, then installs it as /Applications/Clockwize.app.
// The previous app bundle goes to the Trash, and the database is backed up first.
//   npm --prefix desktop run install-app            (from the project root)
//   npm --prefix desktop run install-app -- --no-open
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DESKTOP_DIR = path.join(__dirname, '..');
const ROOT = path.join(DESKTOP_DIR, '..');
const TARGET = '/Applications/Clockwize.app';
const BUNDLE_ID = 'com.yairix.clockwize';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const step = (msg) => console.log(`\n▶ ${msg}`);
const stamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
};

if (process.platform !== 'darwin') {
  console.error('The desktop app installer is macOS only.');
  process.exit(1);
}

step('Building the web client');
run('npm', ['run', 'build'], { cwd: path.join(ROOT, 'client') });

// Notification Center widget + menu-bar control (desktop/widget). Needs Xcode and a signing
// identity; without them build.sh prints "skipped" and the app installs without the widget.
// The widget reads the app's local feed with a per-install secret (see lib/widget-feed.js)
const widgetEnv = {
  ...process.env,
  CLOCKWIZE_WIDGET_PORT: process.env.CLOCKWIZE_WIDGET_PORT || '47321',
  CLOCKWIZE_WIDGET_SECRET: crypto.randomBytes(32).toString('hex')
};
let widget = null;
if (!process.argv.includes('--no-widget')) {
  step('Building the Notification Center widget');
  const widgetOut = path.join(os.tmpdir(), 'clockwize-widget-out');
  const output = execFileSync('bash', [path.join(DESKTOP_DIR, 'widget', 'build.sh'), widgetOut], {
    encoding: 'utf8',
    env: widgetEnv,
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const team = output.match(/^TEAM_ID=(\S+)\s*$/m)?.[1];
  const appex = path.join(widgetOut, 'ClockwizeWidget.appex');
  const helper = path.join(widgetOut, 'clockwize-widget-reload');
  if (team && fs.existsSync(appex) && fs.existsSync(helper)) {
    widget = { team, appex, helper };
    console.log(`  built for team ${team}`);
  } else {
    console.log(`  ${output.trim().split('\n').pop()}`);
  }
}

// The app is signed by the same team as the widget, so WidgetKit treats them as one app
const signingIdentity = (team) => {
  if (process.env.CLOCKWIZE_SIGN_IDENTITY) return process.env.CLOCKWIZE_SIGN_IDENTITY;
  const lines = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(`(${team})`));
  const pick = lines.find((line) => line.includes('Developer ID Application')) || lines[0];
  return pick?.match(/\b([0-9A-F]{40})\b/)?.[1] || null;
};

step('Packaging Clockwize.app');
// Build outside iCloud Drive: it adds extended attributes that break code signing,
// and there is no point syncing a 250MB bundle anyway
const outDir = path.join(os.tmpdir(), 'clockwize-desktop-build');
fs.rmSync(outDir, { recursive: true, force: true });
run('node', ['scripts/write-app-config.js'], { cwd: DESKTOP_DIR, env: widget ? widgetEnv : process.env });
run('npx', ['electron-builder', '--mac', '--dir', `--config.directories.output=${outDir}`], { cwd: DESKTOP_DIR });
const built = fs.readdirSync(outDir)
  .filter((dir) => dir.startsWith('mac'))
  .map((dir) => path.join(outDir, dir, 'Clockwize.app'))
  .find((app) => fs.existsSync(app));
if (!built) throw new Error('electron-builder did not produce Clockwize.app');

run('xattr', ['-cr', built]);
const identity = widget && signingIdentity(widget.team);
if (widget && identity) {
  step(`Signing with your certificate (team ${widget.team}) and embedding the widget`);
  const sign = (target, deep) => run('codesign', [
    '--force', ...(deep ? ['--deep'] : []), '--timestamp=none', '--sign', identity, target
  ]);
  // 1. Electron and its helpers, 2. drop in the already-signed widget + reload helper,
  // 3. re-seal only the outer bundle so the widget keeps its own sandbox entitlements
  sign(built, true);
  fs.mkdirSync(path.join(built, 'Contents', 'PlugIns'), { recursive: true });
  run('ditto', [widget.appex, path.join(built, 'Contents', 'PlugIns', 'ClockwizeWidget.appex')]);
  run('ditto', [widget.helper, path.join(built, 'Contents', 'MacOS', 'clockwize-widget-reload')]);
  sign(built, false);
} else {
  if (widget) console.log('  no matching signing identity - installing without the widget');
  step('Signing (ad-hoc)');
  run('codesign', ['--force', '--deep', '--sign', '-', built]);
}
run('codesign', ['--verify', '--deep', '--strict', built]);

step('Quitting a running Clockwize');
try {
  execFileSync('osascript', ['-e', `if application id "${BUNDLE_ID}" is running then tell application id "${BUNDLE_ID}" to quit`]);
} catch { /* not running */ }
// Give the app a moment to stop its server and release the database lock
execFileSync('sleep', ['2']);

const db = path.join(ROOT, 'server', 'clockwize.db');
if (fs.existsSync(db)) {
  step('Backing up the database');
  const backupDir = path.join(ROOT, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const copy = path.join(backupDir, `before-app-install_${stamp()}.db`);
  fs.copyFileSync(db, copy);
  console.log(`  ${copy}`);
  // Keep the five most recent install-time copies
  fs.readdirSync(backupDir)
    .filter((name) => name.startsWith('before-app-install_') && name.endsWith('.db'))
    .sort()
    .slice(0, -5)
    .forEach((name) => fs.rmSync(path.join(backupDir, name)));
}

if (fs.existsSync(TARGET)) {
  // A previous build of this desktop app can simply be replaced; anything else
  // (e.g. the old shell-script launcher) goes to the Trash so it can be recovered
  const isOurBuild = fs.existsSync(path.join(TARGET, 'Contents', 'Resources', 'app-config.json'));
  if (isOurBuild) {
    step('Removing the previous build');
    fs.rmSync(TARGET, { recursive: true, force: true });
  } else {
    step('Moving the previous Clockwize.app to the Trash');
    const trashed = path.join(os.homedir(), '.Trash', `Clockwize (previous ${stamp()}).app`);
    fs.renameSync(TARGET, trashed);
    console.log(`  ${trashed}`);
  }
}

step(`Installing to ${TARGET}`);
run('ditto', [built, TARGET]);
run(LSREGISTER, ['-f', TARGET]);
if (widget && identity) {
  // Make the widget show up in the widget gallery and in Control Center right away
  try { execFileSync('pluginkit', ['-a', path.join(TARGET, 'Contents', 'PlugIns', 'ClockwizeWidget.appex')]); } catch { /* registered on first launch anyway */ }
}

if (!process.argv.includes('--no-open')) {
  step('Opening Clockwize');
  run('open', [TARGET]);
}
console.log('\n✅ Clockwize is installed.');
