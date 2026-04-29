const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (email, password) => ipcRenderer.invoke('login', email, password)
});
