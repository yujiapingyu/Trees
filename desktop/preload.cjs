const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "desktopState",
  "desktopSave",
  "study",
  "lessonPackOptions",
  "lessonPack",
  "lessonCreateOptions",
  "lessonCreate",
  "lessonPrepare",
  "lessonGenerate",
  "lessonSave",
  "lessonDiscard",
  "bootstrap",
  "storageGet",
  "storageState",
  "studentArchive",
  "studentRestore",
  "storageBackups",
  "storageBackupPreview",
  "fullBackupExport",
  "fullBackupInspect",
  "fullBackupRestore",
  "storageChoose",
  "storageApply",
  "storageRetry",
  "storageReveal",
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
  "learningReport",
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
api.onStorageState = (fn) => {
  const listener = (_, state) => fn(state);
  ipcRenderer.on("teaching:storage-state", listener);
  return () => ipcRenderer.removeListener("teaching:storage-state", listener);
};
contextBridge.exposeInMainWorld("services", api);
