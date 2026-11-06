const { contextBridge, ipcRenderer } = require("electron");

// The window was opened for one provider; it is named in the page's query string.
const provider = new URLSearchParams(globalThis.location?.search ?? "").get("provider") ?? "anthropic";

contextBridge.exposeInMainWorld("keyPrompt", {
  info: () => ipcRenderer.invoke("key:info", provider),
  save: (key) => ipcRenderer.invoke("key:save", provider, key),
  remove: () => ipcRenderer.invoke("key:remove", provider),
  hasKey: () => ipcRenderer.invoke("key:has", provider),
});
