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
  "sheet",
  "pdf",
  "word",
  "writeJSON",
  "ai",
  "cancelAI",
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
