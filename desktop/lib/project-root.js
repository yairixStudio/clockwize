const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// The desktop app runs the server straight from the Clockwize project folder, so the
// existing database, .env and uploads keep working without any migration.

const isProjectRoot = (dir) => Boolean(dir) && fs.existsSync(path.join(dir, 'server', 'index.js'));

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const userConfigFile = () => path.join(app.getPath('userData'), 'config.json');

// Written into the packaged app at build time (scripts/write-app-config.js)
const readAppConfig = () => ({
  ...(app.isPackaged ? readJson(path.join(process.resourcesPath, 'app-config.json')) : null),
  // Development: CLOCKWIZE_WIDGET_PORT + CLOCKWIZE_WIDGET_SECRET serve the widget feed from `npm start`
  ...(process.env.CLOCKWIZE_WIDGET_SECRET && {
    widgetPort: Number(process.env.CLOCKWIZE_WIDGET_PORT) || 47321,
    widgetSecret: process.env.CLOCKWIZE_WIDGET_SECRET
  })
});

// Order: explicit env override → folder the user picked → folder baked in at build time → dev checkout
function resolveProjectRoot() {
  const candidates = [
    process.env.CLOCKWIZE_PROJECT_ROOT,
    readJson(userConfigFile())?.projectRoot,
    readAppConfig().projectRoot,
    path.join(__dirname, '..', '..')
  ];
  return candidates.find(isProjectRoot) || null;
}

// Per-user app preferences (userData/config.json)
const readUserConfig = () => readJson(userConfigFile()) || {};

function saveUserConfig(changes) {
  const file = userConfigFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...readUserConfig(), ...changes }, null, 2));
}

const saveProjectRoot = (dir) => saveUserConfig({ projectRoot: dir });

module.exports = { isProjectRoot, resolveProjectRoot, saveProjectRoot, readAppConfig, readUserConfig, saveUserConfig };
