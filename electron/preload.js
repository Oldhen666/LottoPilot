const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('monitor', {
  check: () => ipcRenderer.invoke('check'),
  update: () => ipcRenderer.invoke('update'),
  scrapeStatus: () => ipcRenderer.invoke('scrape-status'),
  scrapeLog: () => ipcRenderer.invoke('scrape-log'),
  updateAndWait: () => ipcRenderer.invoke('update-and-wait'),
});
