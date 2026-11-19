const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "study",
  "bootstrap",
  "storageGet",
  "storageSet",
  "list",
  "check",
  "open",
  "mkdir",
  "rename",
  "trash",
  "copy",
  "pick",
  "readText",
  "readBytes",
  "sheet",
  "pdf",
  "word",
  "writeJSON",
  "writeBytes",
  "ai",
  "cancelAI",
  "transcribe",
  "volumes",
  "mediaURL",
];
const api = { environment: "electron" };
for (const name of methods)
  api[name] = (...args) => ipcRenderer.invoke("teaching:" + name, ...args);
api.onCommand = (fn) => {
  const listener = (_, command) => fn(command);
  ipcRenderer.on("teaching:command", listener);
  return () => ipcRenderer.removeListener("teaching:command", listener);
};
contextBridge.exposeInMainWorld("services", api);
