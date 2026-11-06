const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tour", {
  load: () => ipcRenderer.invoke("tour:load"),
  useBrain: (id) => ipcRenderer.invoke("tour:use-brain", id),
  act: (name) => ipcRenderer.send("tour:act", name),
  tryPhrase: (text) => ipcRenderer.send("tour:try", text),
  setLogin: (on) => ipcRenderer.invoke("tour:login", on),
  openSettings: () => ipcRenderer.send("tour:settings"),
  done: () => ipcRenderer.send("tour:done"),
  onEvent: (cb) => ipcRenderer.on("tour:event", (_e, name) => cb(name)),
});
