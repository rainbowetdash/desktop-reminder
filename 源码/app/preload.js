const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (c) => ipcRenderer.invoke('config:save', c),
  screenSize: () => ipcRenderer.invoke('screen:size'),
  pickBackground: () => ipcRenderer.invoke('bg:pick'),
  applyWallpaper: (bytes) => ipcRenderer.invoke('wallpaper:apply', bytes),
  setLogin: (on) => ipcRenderer.invoke('login:set', on),
  getLogin: () => ipcRenderer.invoke('login:get'),
  fontsInstalled: () => ipcRenderer.invoke('fonts:installed'),
  fontCss: (id) => ipcRenderer.invoke('fonts:css', id),
  downloadFont: (f) => ipcRenderer.invoke('fonts:download', f),
  removeFont: (id) => ipcRenderer.invoke('fonts:remove', id),
  previewCss: (f) => ipcRenderer.invoke('fonts:preview', f),
  fileUrl: (p) => pathToFileURL(p).href,
  onFontProgress: (cb) => ipcRenderer.on('fonts:progress', (_e, d) => cb(d)),
  onAutoApply: (cb) => ipcRenderer.on('auto-apply', (_e, d) => cb(d)),
});
