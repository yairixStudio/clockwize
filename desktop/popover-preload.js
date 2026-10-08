const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the menu-bar popover (popover.html)
contextBridge.exposeInMainWorld('clockwizePopover', {
  getState: () => ipcRenderer.invoke('popover:get-state'),
  onState: (callback) => ipcRenderer.on('popover:state', (_e, state) => callback(state)),
  act: (name, payload) => ipcRenderer.invoke('popover:act', name, payload),
  openApp: (route) => ipcRenderer.invoke('popover:open-app', route),
  quit: () => ipcRenderer.invoke('popover:quit'),
  resize: (height) => ipcRenderer.send('popover:resize', height),
  close: () => ipcRenderer.send('popover:close')
});
