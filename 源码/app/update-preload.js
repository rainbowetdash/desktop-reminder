const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('upd', {
  onState: (cb) => ipcRenderer.on('update:progress', (_e, s) => cb(s)),
  ready: () => ipcRenderer.send('update:window-ready'),
  cancel: () => ipcRenderer.send('update:cancel'),
});
