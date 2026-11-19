import { EMPTY_DATA, id } from "./domain.js";
export const desktop = !!window.services;
const unavailable = async () => {
  throw Error(
    "本功能需要桌面文件服务。请使用 npm run desktop 启动桌面版，并在配置中心设置本地目录。",
  );
};
export const services =
  window.services ||
  Object.fromEntries(
    [
      "study",
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
    ].map((k) => [k, unavailable]),
  );
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
    if (desktop) return services.storageSet(key, value);
    localStorage.setItem(key, JSON.stringify(value));
  },
  async bootstrap() {
    if (desktop) {
      const result = await services.bootstrap();
      return {
        ...result,
        data: { ...structuredClone(EMPTY_DATA), ...(result.data || {}) },
      };
    }
    return {
      config: await this.get("sm_path_config_v1", {}),
      data: await this.get("sm_workspace_v1", structuredClone(EMPTY_DATA)),
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
export function download(name, text, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export async function fileDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(Error("文件读取失败"));
    r.readAsDataURL(file);
  });
}
export const fromBase64 = (s) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toBase64 = (bytes) => {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
};
