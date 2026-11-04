// CodeClue preload — the ONLY bridge between the renderer and the OS.
// Deliberately narrow: the renderer never touches Node directly.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeclue', {
  detectTools: () => ipcRenderer.invoke('tools:detect'),
  runLocal: (payload) => ipcRenderer.invoke('run:local', payload),
  getWorkspace: () => ipcRenderer.invoke('fs:getWorkspace'),
  chooseWorkspace: () => ipcRenderer.invoke('fs:chooseWorkspace'),
  listProjects: () => ipcRenderer.invoke('fs:listProjects'),
  createProject: (payload) => ipcRenderer.invoke('fs:createProject', payload),
  pickProjectDir: () => ipcRenderer.invoke('fs:pickProjectDir'),
  readTree: (root) => ipcRenderer.invoke('fs:readTree', root),
  readFile: (p, root) => ipcRenderer.invoke('fs:readFile', p, root),
  writeFile: (p, c, root) => ipcRenderer.invoke('fs:writeFile', p, c, root),
  saveAs: (name, c, root) => ipcRenderer.invoke('fs:saveAs', name, c, root),
  win: {
    toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
    isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    chat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  },
});
