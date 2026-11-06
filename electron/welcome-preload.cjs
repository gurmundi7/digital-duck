const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tour", {
  load: () => ipcRenderer.invoke("tour:load"),
  guide: (id) => ipcRenderer.invoke("tour:guide", id),
  check: (id) => ipcRenderer.invoke("tour:check", id),
  addKey: (provider) => ipcRenderer.send("tour:key", provider),
  test: () => ipcRenderer.send("tour:test"),
  copy: (text) => ipcRenderer.invoke("tour:copy", text),
  openUrl: (url) => ipcRenderer.send("tour:open-url", url),
  openTerminal: () => ipcRenderer.send("tour:terminal"),
  act: (name) => ipcRenderer.send("tour:act", name),
  tryPhrase: (text) => ipcRenderer.send("tour:try", text),
  setLogin: (on) => ipcRenderer.invoke("tour:login", on),
  openSettings: () => ipcRenderer.send("tour:settings"),
  done: () => ipcRenderer.send("tour:done"),
  onEvent: (cb) => ipcRenderer.on("tour:event", (_e, name, detail) => cb(name, detail)),
});
