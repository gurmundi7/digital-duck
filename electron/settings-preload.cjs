const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settings", {
  load: () => ipcRenderer.invoke("settings:load"),
  save: (patch) => ipcRenderer.invoke("settings:save", patch),
  previewVoice: (voice, rate) => ipcRenderer.invoke("settings:preview-voice", voice, rate),
  setLogin: (on) => ipcRenderer.invoke("settings:login", on),
  openKey: (provider) => ipcRenderer.send("settings:key", provider),
  openRaw: () => ipcRenderer.send("settings:raw"),
});
