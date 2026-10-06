const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('iphub', {
  call: (action, a, b) => ipcRenderer.invoke('call', action, a, b),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s)),
});
