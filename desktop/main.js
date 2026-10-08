const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell, screen, systemPreferences } = require('electron');
const { resolveProjectRoot, saveProjectRoot, isProjectRoot, readAppConfig, readUserConfig, saveUserConfig } = require('./lib/project-root');
const { startServer } = require('./lib/server');
const { createTimerState } = require('./lib/timer-state');
const { createMenuBar } = require('./lib/tray');
const { createWidgetFeed } = require('./lib/widget-feed');

// Clockwize desktop app: a regular Dock app with one window, a menu-bar timer, and the
// API server running in a utility process next to it.

app.setName('Clockwize');

// A development run (`npm start`) gets its own profile, logs and single-instance lock,
// so it can run next to the installed app
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Clockwize Dev'));
  app.setAppLogsPath(path.join(app.getPath('home'), 'Library', 'Logs', 'Clockwize Dev'));
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let serverChild = null;
let serverPort = null;
let projectRoot = null;
let timerState = null;
let menuBar = null;
let quitting = false;

const LOADING_PAGE = path.join(__dirname, 'loading.html');
const serverLogFile = () => path.join(app.getPath('logs'), 'server.log');
const appUrl = () => `http://localhost:${serverPort}`;
const isAppUrl = (url) => {
  if (!serverPort) return false;
  try {
    const { hostname, port } = new URL(url);
    return ['localhost', '127.0.0.1'].includes(hostname) && Number(port) === serverPort;
  } catch {
    return false;
  }
};

// ---------- Window ----------

const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  const fallback = { width: 1360, height: 860 };
  try {
    const state = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
    // Ignore a saved position that is no longer on any connected display
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      state.x >= a.x - 50 && state.y >= a.y - 50 && state.x < a.x + a.width && state.y < a.y + a.height);
    return visible ? state : { ...fallback, width: state.width, height: state.height };
  } catch {
    return fallback;
  }
}

let saveStateTimer = null;
function saveWindowState() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return;
    try {
      fs.writeFileSync(windowStateFile(), JSON.stringify(mainWindow.getNormalBounds()));
    } catch { /* not critical */ }
  }, 400);
}

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 960,
    minHeight: 640,
    title: 'Clockwize',
    show: false,
    backgroundColor: '#0f172a',
    // Unified Mac title bar: content runs under it and the page leaves room for the traffic lights
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  // Automated tests (desktop/tests) keep their windows invisible so they don't flash on screen
  if (process.env.CLOCKWIZE_E2E_INVISIBLE) mainWindow.setOpacity(0);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // Closing the window keeps the app (and the running timer) alive, like other Mac apps.
  // Clicking the Dock icon brings it back; Cmd+Q really quits.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      if (mainWindow.isFullScreen()) {
        mainWindow.once('leave-full-screen', () => mainWindow.hide());
        mainWindow.setFullScreen(false);
      } else {
        mainWindow.hide();
      }
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  // Links to other sites open in the default browser, app links stay in the window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: 'allow' };
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:') || isAppUrl(url)) return;
    event.preventDefault();
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
  });

  // The page title tracks the current screen; keep the window titled after the app
  mainWindow.on('page-title-updated', (event) => event.preventDefault());

  // Electron has no right-click menu by default - give text fields and links the usual one
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template = [];
    for (const suggestion of params.dictionarySuggestions.slice(0, 4)) {
      template.push({ label: suggestion, click: () => mainWindow.webContents.replaceMisspelling(suggestion) });
    }
    if (params.misspelledWord) {
      template.push(
        { label: 'הוסף למילון', click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' }
      );
    }
    if (params.linkURL && !isAppUrl(params.linkURL)) {
      template.push({ label: 'פתח קישור בדפדפן', click: () => shell.openExternal(params.linkURL) }, { type: 'separator' });
    }
    if (params.isEditable) {
      template.push(
        { role: 'cut', label: 'גזור', enabled: params.editFlags.canCut },
        { role: 'copy', label: 'העתק', enabled: params.editFlags.canCopy },
        { role: 'paste', label: 'הדבק', enabled: params.editFlags.canPaste },
        { role: 'selectAll', label: 'בחר הכל' }
      );
    } else if (params.selectionText.trim()) {
      template.push({ role: 'copy', label: 'העתק' });
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    loadCurrentPage();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openInApp(route) {
  showWindow();
  if (serverPort && !needsUnlock()) mainWindow.loadURL(`${appUrl()}${route}`);
}

function showLoading(params = {}) {
  mainWindow?.loadFile(LOADING_PAGE, { query: params });
}

// ---------- Touch ID lock ----------
// The session itself never expires on this computer; instead the app can ask for Touch ID once
// when it starts (Clockwize menu → "נעילה עם Touch ID בפתיחה", on by default).

let unlocked = false;
const touchIdLockEnabled = () => readUserConfig().touchIdLock !== false;
const touchIdAvailable = () =>
  process.platform === 'darwin' && !process.env.CLOCKWIZE_E2E_INVISIBLE && systemPreferences.canPromptTouchID();
const needsUnlock = () => !unlocked && touchIdLockEnabled() && touchIdAvailable();

async function unlockWithTouchId() {
  try {
    await systemPreferences.promptTouchID('לפתוח את Clockwize');
    unlocked = true;
    loadCurrentPage();
    return true;
  } catch {
    showLoading({ locked: '1' });
    return false;
  }
}

function loadCurrentPage() {
  if (!serverPort) return showLoading();
  if (needsUnlock()) {
    showLoading({ locked: '1' });
    unlockWithTouchId();
    return;
  }
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingSession) adoptSession(pendingSession).catch(() => {});
  });
  mainWindow.loadURL(appUrl());
}

// ---------- Server ----------

async function chooseProjectFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'איפה נמצאת תיקיית Clockwize?',
    message: 'בחרו את תיקיית הפרויקט של Clockwize (זו שמכילה את server ו-client)',
    properties: ['openDirectory']
  });
  const dir = result.filePaths?.[0];
  if (!dir) return false;
  if (!isProjectRoot(dir)) {
    dialog.showErrorBox('Clockwize', 'התיקייה שנבחרה לא מכילה את server/index.js');
    return false;
  }
  saveProjectRoot(dir);
  return true;
}

async function bootServer() {
  serverPort = null;
  showLoading();
  projectRoot = resolveProjectRoot();
  if (!projectRoot) {
    showLoading({ error: 'לא נמצאה תיקיית הפרויקט של Clockwize', canChoose: '1' });
    return;
  }

  try {
    const { port, child } = await startServer({
      projectRoot,
      logFile: serverLogFile(),
      onExit: (code, details) => {
        serverChild = null;
        serverPort = null;
        if (!quitting) showLoading({ error: `השרת נעצר במפתיע (קוד ${code})`, details });
      }
    });
    serverChild = child;
    serverPort = port;
    if (mainWindow) loadCurrentPage();
    timerState?.refresh({ withSummary: true });
  } catch (error) {
    showLoading({ error: error.message, details: error.details || '' });
  }
}

function stopServer() {
  if (serverChild) {
    serverChild.kill();
    serverChild = null;
  }
}

ipcMain.handle('clockwize:retry', () => bootServer());
ipcMain.handle('clockwize:choose-folder', async () => {
  if (await chooseProjectFolder()) await bootServer();
});
ipcMain.handle('clockwize:open-logs', () => shell.openPath(serverLogFile()));
ipcMain.handle('clockwize:unlock', () => unlockWithTouchId());
ipcMain.handle('clockwize:browser-login', () => {
  if (serverPort) shell.openExternal(`${appUrl()}/login?passkey=desktop`);
});

// When the window is signed out and a valid session shows up (passkey sign-in in the browser,
// or an earlier browser login), sign the window in with it and bring the app forward
let pendingSession = null;

async function adoptSession(session) {
  const { token, workspaceId } = session;
  // Not showing the app yet (still starting, or locked): adopt once the app page has loaded
  if (!mainWindow || mainWindow.isDestroyed() || !isAppUrl(mainWindow.webContents.getURL())) {
    pendingSession = session;
    return;
  }
  pendingSession = null;
  const signedIn = await mainWindow.webContents
    .executeJavaScript("Boolean(localStorage.getItem('token'))")
    .catch(() => true);
  if (signedIn) return;
  await mainWindow.webContents.executeJavaScript(
    `localStorage.setItem('token', ${JSON.stringify(token)});` +
    (workspaceId ? `localStorage.setItem('currentWorkspaceId', ${JSON.stringify(workspaceId)});` : '') +
    'true'
  );
  mainWindow.loadURL(appUrl());
  showWindow();
}

// ---------- Menus ----------

function buildAppMenu() {
  const template = [
    {
      label: 'Clockwize',
      submenu: [
        { role: 'about', label: 'אודות Clockwize' },
        { type: 'separator' },
        {
          label: 'נעילה עם Touch ID בפתיחה',
          type: 'checkbox',
          checked: touchIdLockEnabled(),
          enabled: process.platform === 'darwin' && systemPreferences.canPromptTouchID(),
          click: (item) => saveUserConfig({ touchIdLock: item.checked })
        },
        { type: 'separator' },
        { label: 'פתח את קובץ הלוג של השרת', click: () => shell.openPath(serverLogFile()) },
        { label: 'הצג את תיקיית הפרויקט', click: () => projectRoot && shell.openPath(projectRoot) },
        { type: 'separator' },
        { role: 'services', label: 'שירותים' },
        { type: 'separator' },
        { role: 'hide', label: 'הסתר את Clockwize' },
        { role: 'hideOthers', label: 'הסתר אחרים' },
        { role: 'unhide', label: 'הצג הכל' },
        { type: 'separator' },
        { role: 'quit', label: 'צא מ-Clockwize' }
      ]
    },
    {
      label: 'עריכה',
      submenu: [
        { role: 'undo', label: 'בטל' },
        { role: 'redo', label: 'בצע שוב' },
        { type: 'separator' },
        { role: 'cut', label: 'גזור' },
        { role: 'copy', label: 'העתק' },
        { role: 'paste', label: 'הדבק' },
        { role: 'pasteAndMatchStyle', label: 'הדבק והתאם סגנון' },
        { role: 'delete', label: 'מחק' },
        { role: 'selectAll', label: 'בחר הכל' }
      ]
    },
    {
      label: 'תצוגה',
      submenu: [
        { role: 'reload', label: 'טען מחדש' },
        { role: 'forceReload', label: 'טען מחדש בכוח' },
        { role: 'toggleDevTools', label: 'כלי מפתחים' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'גודל רגיל' },
        { role: 'zoomIn', label: 'הגדל' },
        { role: 'zoomOut', label: 'הקטן' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'מסך מלא' }
      ]
    },
    {
      label: 'ניווט',
      submenu: [
        { label: 'אחורה', accelerator: 'CmdOrCtrl+[', click: () => mainWindow?.webContents.navigationHistory.goBack() },
        { label: 'קדימה', accelerator: 'CmdOrCtrl+]', click: () => mainWindow?.webContents.navigationHistory.goForward() },
        { type: 'separator' },
        { label: 'לוח בקרה', accelerator: 'CmdOrCtrl+Shift+H', click: () => serverPort && mainWindow?.loadURL(appUrl()) }
      ]
    },
    {
      label: 'חלון',
      submenu: [
        { role: 'minimize', label: 'מזער' },
        { role: 'zoom', label: 'הגדל חלון' },
        { role: 'close', label: 'סגור חלון' },
        { type: 'separator' },
        { role: 'front', label: 'הבא הכל לחזית' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Lifecycle ----------

app.on('second-instance', showWindow);

app.on('activate', showWindow);

app.on('before-quit', () => {
  quitting = true;
});

// The main window only hides on close and the popover is a panel; never let a closed
// window quit the app (Cmd+Q does that)
app.on('window-all-closed', () => {});

app.on('will-quit', () => {
  menuBar?.stop();
  timerState?.stop();
  stopServer();
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  // A packaged app gets its icon from the bundle; in development show the real one too
  if (!app.isPackaged) {
    app.dock?.setIcon(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')));
  }
  app.setAboutPanelOptions({
    applicationName: 'Clockwize',
    applicationVersion: app.getVersion(),
    copyright: 'ניהול זמן וחיוב לפרילנסרים'
  });

  buildAppMenu();
  createWindow();

  timerState = createTimerState({
    getPort: () => serverPort,
    getSessionFile: () => process.env.CLOCKWIZE_SESSION_FILE || path.join(projectRoot || '', '.local-session')
  });
  timerState.on('session', (session) => adoptSession(session).catch(() => {}));
  // Let the open page re-sync its timer state right away (TimerSyncProvider listens to focus)
  timerState.on('acted', () => {
    mainWindow?.webContents.executeJavaScript("window.dispatchEvent(new Event('focus'))").catch(() => {});
  });

  menuBar = createMenuBar({ state: timerState, showWindow, openInApp });
  menuBar.start();
  // Development aid: open the popover on launch (screenshots, UI work)
  if (!app.isPackaged && process.env.CLOCKWIZE_SHOW_POPOVER) setTimeout(() => menuBar.togglePopover(), 3000);

  // Notification Center widget / Control Center control, when one was built into the app
  const { widgetPort, widgetSecret } = readAppConfig();
  if (widgetPort && widgetSecret) {
    const feed = createWidgetFeed({
      port: widgetPort,
      secret: widgetSecret,
      state: timerState,
      reloadHelper: path.join(path.dirname(app.getPath('exe')), 'clockwize-widget-reload')
    });
    feed.start();
    app.on('will-quit', () => feed.stop());
  }

  timerState.start();

  bootServer();
});
