const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (section, patch) => ipcRenderer.invoke('settings:save', section, patch),
  connect: (platform) => ipcRenderer.invoke('auth:connect', platform),
  disconnect: (platform) => ipcRenderer.invoke('auth:disconnect', platform),
  pickFile: () => ipcRenderer.invoke('file:pick'),
  inspectDropped: (file) => ipcRenderer.invoke('file:inspect', webUtils.getPathForFile(file)),
  post: (job) => ipcRenderer.invoke('post:run', job),
  history: () => ipcRenderer.invoke('history:get'),
  openUrl: (url) => ipcRenderer.invoke('open:url', url),
  onProgress: (fn) => ipcRenderer.on('post:progress', (_e, data) => fn(data))
});
