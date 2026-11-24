import { EMPTY_DATA, id } from "./domain.js";
import configKeys from "./configKeys.json" with { type: "json" };
export function sanitizeConfig(value = {}) {
  return Object.fromEntries(
    [...configKeys.roots, ...configKeys.extras]
      .filter((key) => typeof value[key] === "string")
      .map((key) => [key, value[key]]),
  );
}
export const desktop = !!window.services;
const unavailable = async () => {
  throw Error(
    "本功能需要桌面文件服务。请打开已安装的「知序」桌面应用，并在配置中心设置本地目录。",
  );
};
export const services =
  window.services ||
  Object.fromEntries(
    [
      "desktopState",
      "desktopSave",
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
      "study",
      "lessonPackOptions",
      "lessonPack",
      "lessonCreateOptions",
      "lessonCreate",
      "lessonPrepare",
      "lessonGenerate",
      "lessonSave",
      "lessonDiscard",
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
    ].map((k) => [k, unavailable]),
  );
let storageEpoch;
export const storage = {
  async get(key, fallback) {
    if (desktop) {
      return (await services.storageGet(key)) ?? fallback;
    }
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  async set(key, value) {
    if (desktop) return services.storageSet(key, value, storageEpoch);
    localStorage.setItem(key, JSON.stringify(value));
  },
  async bootstrap() {
    if (desktop) {
      const result = await services.bootstrap();
      storageEpoch = result.storageEpoch;
      return {
        ...result,
        data: { ...structuredClone(EMPTY_DATA), ...(result.data || {}) },
      };
    }
    const oldConfig = await this.get("sm_path_config_v1", {}),
      config = sanitizeConfig(oldConfig);
    if (JSON.stringify(config) !== JSON.stringify(oldConfig))
      await this.set("sm_path_config_v1", config);
    return {
      config,
      data: {
        ...structuredClone(EMPTY_DATA),
        ...(await this.get("sm_workspace_v1", {})),
      },
    };
  },
};
export async function generate(task, extra = {}) {
  return services.ai({ id: id(), task, ...extra });
}
export const join = (...parts) =>
  parts.filter(Boolean).join("/").replace(/\/+/g, "/");
export const basename = (p) => p?.split(/[\\/]/).filter(Boolean).at(-1) || "";
export function parent(p) {
  return p.slice(0, p.lastIndexOf("/")) || "/";
}
export const fromBase64 = (s) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
