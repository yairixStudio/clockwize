const { contextBridge, ipcRenderer } = require('electron');

// Small bridge for the loading / error page, and a flag the web app can use to know
// it is running inside the desktop app.
contextBridge.exposeInMainWorld('clockwizeDesktop', {
  isDesktop: true,
  retry: () => ipcRenderer.invoke('clockwize:retry'),
  chooseFolder: () => ipcRenderer.invoke('clockwize:choose-folder'),
  openLogs: () => ipcRenderer.invoke('clockwize:open-logs'),
  unlock: () => ipcRenderer.invoke('clockwize:unlock'),
  // Passkeys need the browser's native sheet - sign in there, the app adopts the session
  openBrowserLogin: () => ipcRenderer.invoke('clockwize:browser-login')
});
