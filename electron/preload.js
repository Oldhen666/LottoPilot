const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('monitor', {
  check: () => ipcRenderer.invoke('check'),
  update: () => ipcRenderer.invoke('update'),
});
