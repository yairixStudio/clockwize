const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');

const POPOVER_WIDTH = 340;
const BLUR_CLICK_GRACE_MS = 250;

const formatClock = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// Menu-bar item: the live timer as its title, a native-feeling popover on click and a
// small context menu on right-click. Also keeps the Dock menu in sync.
function createMenuBar({ state, showWindow, openInApp }) {
  let tray = null;
  let popover = null;
  let lastBlurHideAt = 0;
  let latest = state.snapshot();
  let titleTimer = null;

  const primary = () => latest.timers[0] || null;

  const liveElapsed = (timer) => (timer.isRunning && timer.runningSince
    ? Math.max(0, Math.floor((Date.now() - new Date(timer.runningSince).getTime()) / 1000))
    : timer.elapsedSeconds);

  const renderTitle = () => {
    if (!tray) return;
    const timer = primary();
    tray.setTitle(timer ? `${timer.isRunning ? '' : '⏸ '}${formatClock(liveElapsed(timer))}` : '', { fontType: 'monospacedDigit' });
    tray.setToolTip(timer ? `Clockwize · ${[timer.projectName, timer.taskName].filter(Boolean).join(' · ')}` : 'Clockwize');
  };

  const timerMenuItems = () => {
    const timer = primary();
    if (!timer) return [];
    return [
      timer.isRunning
        ? { label: `השהה · ${timer.projectName}`, click: () => state.act('pause', timer.id) }
        : { label: `המשך · ${timer.projectName}`, click: () => state.act('resume', timer.id) },
      { label: 'עצור ושמור', click: () => state.act('stop', timer.id) }
    ];
  };

  const contextMenu = () => Menu.buildFromTemplate([
    ...timerMenuItems(),
    ...(primary() ? [{ type: 'separator' }] : []),
    { label: 'פתח את Clockwize', click: showWindow },
    { type: 'separator' },
    { label: 'צא מ-Clockwize', role: 'quit' }
  ]);

  // ----- Popover -----

  const createPopover = () => {
    popover = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: 420,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // A non-activating panel: it takes clicks and keys without pulling the main window forward
      type: 'panel',
      transparent: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      roundedCorners: true,
      hasShadow: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'popover-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });
    // No setVisibleOnAllWorkspaces() here: on macOS it flips the app to a UIElement process,
    // which removes the Dock icon. A 'panel' window already shows on every Space.
    if (process.env.CLOCKWIZE_E2E_INVISIBLE) popover.setOpacity(0);
    popover.loadFile(path.join(__dirname, '..', 'popover.html'));
    popover.on('blur', () => {
      if (!popover.webContents.isDevToolsOpened()) {
        lastBlurHideAt = Date.now();
        popover.hide();
      }
    });
    popover.on('closed', () => { popover = null; });
  };

  const positionPopover = () => {
    const trayBounds = tray.getBounds();
    const [width, height] = popover.getSize();
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
    const area = display.workArea;
    let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
    x = Math.max(area.x + 8, Math.min(x, area.x + area.width - width - 8));
    const y = Math.round(trayBounds.y + trayBounds.height + 6);
    popover.setPosition(x, Math.max(y, area.y + 4), false);
  };

  const showPopover = () => {
    if (!popover) createPopover();
    positionPopover();
    popover.webContents.send('popover:state', latest);
    popover.show();
    popover.focus();
    // Fresh numbers whenever it opens
    state.refresh({ withSummary: true });
  };

  const togglePopover = () => {
    if (popover?.isVisible()) {
      popover.hide();
    } else if (Date.now() - lastBlurHideAt > BLUR_CLICK_GRACE_MS) {
      // A click on the icon first blurs (and hides) an open popover - don't reopen it
      showPopover();
    }
  };

  ipcMain.handle('popover:act', (_e, name, payload) => state.act(name, payload));
  ipcMain.handle('popover:open-app', (_e, route) => {
    popover?.hide();
    if (route) openInApp(route);
    else showWindow();
  });
  ipcMain.handle('popover:quit', () => app.quit());
  ipcMain.handle('popover:get-state', () => latest);
  ipcMain.on('popover:resize', (_e, height) => {
    if (!popover) return;
    const clamped = Math.max(160, Math.min(Math.ceil(height), 640));
    if (popover.getSize()[1] !== clamped) {
      popover.setSize(POPOVER_WIDTH, clamped, false);
      if (popover.isVisible()) positionPopover();
    }
  });
  ipcMain.on('popover:close', () => popover?.hide());

  state.on('change', (snapshot) => {
    latest = snapshot;
    renderTitle();
    popover?.webContents.send('popover:state', snapshot);
    app.dock?.setMenu(Menu.buildFromTemplate(timerMenuItems()));
  });

  return {
    start() {
      const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'iconTemplate.png'));
      icon.setTemplateImage(true);
      tray = new Tray(icon);
      tray.setIgnoreDoubleClickEvents(true);
      tray.on('click', togglePopover);
      tray.on('right-click', () => tray.popUpContextMenu(contextMenu()));
      renderTitle();
      titleTimer = setInterval(renderTitle, 1000);
      // Build the popover up front so the first click opens instantly
      createPopover();
    },
    togglePopover,
    stop() {
      clearInterval(titleTimer);
      popover?.destroy();
      tray?.destroy();
      tray = null;
    }
  };
}

module.exports = { createMenuBar };
