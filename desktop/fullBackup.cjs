const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { WorkspaceDatabase } = require("./sqlite.cjs");
const { digest } = require("./storage.cjs");
const ROOTS = require("../src/shared/configKeys.json").roots;
const within = (p, r) => p === r || p.startsWith(r + path.sep);
function remap(value, mappings) {
  if (typeof value === "string") {
    const m = mappings.find(
      ([from]) => value === from || value.startsWith(from + "/"),
    );
    return m ? m[1] + value.slice(m[0].length) : value;
  }
  if (Array.isArray(value)) return value.map((v) => remap(v, mappings));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, remap(v, mappings)]),
    );
  return value;
}
async function copyTree(from, to, entries, base) {
  const stat = await fs.lstat(from);
  if (stat.isSymbolicLink())
    throw Error("资料含符号链接，请先处理该链接后备份：" + from);
  if (stat.isDirectory()) {
    await fs.mkdir(to, { recursive: true, mode: 0o700 });
    for (const name of await fs.readdir(from))
      await copyTree(path.join(from, name), path.join(to, name), entries, base);
  } else if (stat.isFile()) {
    const before = await digest(from);
    await fs.copyFile(from, to, require("node:fs").constants.COPYFILE_EXCL);
    await fs.chmod(to, 0o600);
    if (before !== (await digest(from)) || before !== (await digest(to)))
      throw Error("文件在备份期间发生变化，请重试：" + from);
    entries.push({
      path: path.relative(base, to).split(path.sep).join("/"),
      hash: before,
      size: stat.size,
    });
  }
}
class FullBackupService {
  constructor(store) {
    this.store = store;
    this.previews = new Map();
  }
  export(folder, keys) {
    return this.store.enqueue(async () => {
      const dest = await fs.realpath(folder),
        config = this.store.get("sm_path_config_v1", {});
      if (!Array.isArray(keys) || keys.some((k) => !ROOTS.includes(k)))
        throw Error("无效资料目录选择");
      const selected = [...new Set(keys)].filter((k) => config[k]),
        sources = [];
      for (const key of selected) {
        const root = await fs.realpath(config[key]);
        if (this.store.isProtectedPath(root) || within(dest, root))
          throw Error(
            "备份位置必须在所选资料目录之外，且不能备份应用内部数据目录",
          );
        sources.push({ key, original: path.resolve(config[key]), root });
      }
      const target = path.join(
        dest,
        "知序完整备份-" +
          new Date().toISOString().replace(/[:.]/g, "-") +
          "-" +
          crypto.randomUUID().slice(0, 6),
      );
      await fs.mkdir(target, { mode: 0o700 });
      try {
        const entries = [],
          roots = [];
        await this.store.work.snapshot(path.join(target, "workspace.sqlite"));
        entries.push({
          path: "workspace.sqlite",
          hash: await digest(path.join(target, "workspace.sqlite")),
        });
        for (const source of sources) {
          const rel = "resources/" + source.key;
          await copyTree(source.root, path.join(target, rel), entries, target);
          roots.push({
            key: source.key,
            original: source.original,
            canonical: source.root,
            path: rel,
          });
        }
        const manifest = {
          format: "zhixu-full-backup",
          version: 1,
          createdAt: new Date().toISOString(),
          datasetId: this.store.work.datasetId,
          counts: this.store.state().counts,
          roots,
          entries,
        };
        await fs.writeFile(
          path.join(target, "manifest.json"),
          JSON.stringify(manifest, null, 2),
          { flag: "wx", mode: 0o600 },
        );
        return { file: target, files: entries.length, roots: roots.length };
      } catch (e) {
        await fs.rm(target, { recursive: true, force: true });
        throw e;
      }
    });
  }
  async inspect(folder) {
    const root = await fs.realpath(folder),
      raw = await fs.readFile(path.join(root, "manifest.json"), "utf8");
    if (raw.length > 30e6) throw Error("备份清单过大");
    const m = JSON.parse(raw);
    if (
      m.format !== "zhixu-full-backup" ||
      m.version !== 1 ||
      !Array.isArray(m.entries) ||
      !Array.isArray(m.roots) ||
      m.roots.some(
        (r) => !ROOTS.includes(r.key) || r.path !== "resources/" + r.key,
      )
    )
      throw Error("不是有效的知序完整备份");
    const seen = new Set();
    for (const entry of m.entries) {
      if (
        typeof entry.path !== "string" ||
        entry.path.includes("\\") ||
        entry.path.split("/").some((s) => !s || s === "." || s === "..") ||
        path.isAbsolute(entry.path) ||
        seen.has(entry.path) ||
        !/^[a-f0-9]{64}$/.test(entry.hash)
      )
        throw Error("备份清单包含无效文件");
      seen.add(entry.path);
      const file = path.join(root, entry.path);
      if (
        !within(await fs.realpath(file), root) ||
        !(await fs.lstat(file)).isFile() ||
        (await digest(file)) !== entry.hash
      )
        throw Error("备份文件缺失或校验失败：" + entry.path);
    }
    if (!seen.has("workspace.sqlite")) throw Error("备份缺少数据库");
    const info = WorkspaceDatabase.inspect(path.join(root, "workspace.sqlite"));
    if (m.datasetId !== info.datasetId) throw Error("备份数据集标识不一致");
    const token = crypto.randomUUID();
    this.previews.clear();
    this.previews.set(token, {
      root,
      m,
      manifestHash: await digest(path.join(root, "manifest.json")),
    });
    return {
      token,
      kind: "full",
      counts: info.counts,
      file: root,
      date: m.createdAt,
      roots: m.roots.map((r) => r.key),
      files: m.entries.length,
    };
  }
  async restore(token, folder) {
    const preview = this.previews.get(token);
    this.previews.delete(token);
    if (!preview) throw Error("备份预览已失效，请重新选择");
    const checked = await this.inspect(preview.root);
    this.previews.delete(checked.token);
    if (
      (await digest(path.join(preview.root, "manifest.json"))) !==
      preview.manifestHash
    )
      throw Error("备份已发生变化，请重新预览");
    const parent = await fs.realpath(folder);
    if (within(parent, preview.root) || this.store.isProtectedPath(parent))
      throw Error("请选择备份及应用数据目录之外的恢复位置");
    const target = path.join(
      parent,
      "知序恢复-" + Date.now() + "-" + crypto.randomUUID().slice(0, 6),
    );
    await fs.mkdir(target, { mode: 0o700 });
    let db;
    try {
      const maps = [],
        config = { ...this.store.get("sm_path_config_v1", {}) };
      for (const key of ROOTS) config[key] = "";
      for (const r of preview.m.roots) {
        const dest = path.join(target, "resources", r.key);
        await fs.mkdir(dest, { recursive: true, mode: 0o700 });
        config[r.key] = dest;
        maps.push([r.original, dest], [r.canonical, dest]);
      }
      for (const entry of preview.m.entries) {
        if (entry.path === "workspace.sqlite") continue;
        if (!preview.m.roots.some((r) => entry.path.startsWith(r.path + "/")))
          throw Error("备份文件不属于已声明资料目录");
        const dest = path.join(target, entry.path);
        await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
        await fs.copyFile(
          path.join(preview.root, entry.path),
          dest,
          require("node:fs").constants.COPYFILE_EXCL,
        );
        await fs.chmod(dest, 0o600);
        if ((await digest(dest)) !== entry.hash)
          throw Error("恢复文件校验失败");
      }
      const file = path.join(target, "知序数据.sqlite");
      await fs.copyFile(
        path.join(preview.root, "workspace.sqlite"),
        file,
        require("node:fs").constants.COPYFILE_EXCL,
      );
      if (
        (await digest(file)) !==
        preview.m.entries.find((e) => e.path === "workspace.sqlite").hash
      )
        throw Error("恢复数据库校验失败");
      db = await new WorkspaceDatabase(file).init();
      maps.sort((a, b) => b[0].length - a[0].length);
      db.set(remap(db.get(), maps));
      db.close();
      db = null;
      const c = await this.store.prepare("open", file);
      c.restoredConfig = config;
      const prefix = "sm_draft_" + preview.m.datasetId + ":";
      c.restoredDrafts = Object.fromEntries(
        this.store.prefs.db
          .prepare("SELECT key,payload FROM preferences")
          .all()
          .filter((r) => r.key.startsWith(prefix))
          .map((r) => [r.key, remap(JSON.parse(r.payload), maps)]),
      );
      await this.store.apply(c.token);
      return { file };
    } catch (e) {
      db?.close();
      if (!this.store.file.startsWith(target + path.sep))
        await fs.rm(target, { recursive: true, force: true });
      throw e;
    }
  }
}
module.exports = { FullBackupService, remap };
