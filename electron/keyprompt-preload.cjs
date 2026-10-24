const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("keyPrompt", {
  save: (key) => ipcRenderer.invoke("key:save", key),
  remove: () => ipcRenderer.invoke("key:remove"),
  hasKey: () => ipcRenderer.invoke("key:has"),
});
