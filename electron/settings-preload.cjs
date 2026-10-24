const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settings", {
  load: () => ipcRenderer.invoke("settings:load"),
  save: (patch) => ipcRenderer.invoke("settings:save", patch),
  previewVoice: (voice, rate) => ipcRenderer.invoke("settings:preview-voice", voice, rate),
  pickFile: () => ipcRenderer.invoke("settings:pick-file"),
  setLogin: (on) => ipcRenderer.invoke("settings:login", on),
  openKey: () => ipcRenderer.send("settings:key"),
  openRaw: () => ipcRenderer.send("settings:raw"),
});
