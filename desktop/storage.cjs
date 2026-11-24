const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createReadStream } = require("node:fs");
const { WorkspaceDatabase, LocalPreferences } = require("./sqlite.cjs");
const POINTER = "sqlite_location_v1";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const exists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};
async function digest(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function syncDirectory(dir) {
  let h;
  try {
    h = await fs.open(dir, "r");
    await h.sync();
  } catch (e) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(e.code)) throw e;
  } finally {
    await h?.close();
  }
}
class SQLiteStorage {
  constructor(profile, onChange = () => {}) {
    this.profile = path.resolve(profile);
    this.queue = Promise.resolve();
    this.onChange = onChange;
    this.error = "";
    this.candidates = new Map();
    this.epoch = crypto.randomUUID();
  }
  enqueue(fn) {
    if (this.closing)
      return Promise.reject(Error("知序正在退出，请重新打开后保存。"));
    const p = this.queue.then(fn);
    this.queue = p.catch(() => {});
    return p;
  }
  get file() {
    return this.location.file;
  }
  get(key, fallback = null) {
    return key === "sm_workspace_v1"
      ? this.work.get()
      : structuredClone(this.prefs.get(key, fallback));
  }
  state() {
    return {
      datasetId: this.work.datasetId,
      engine: "sqlite",
      file: this.file,
      pending: !!this.error || this.work.dirty,
      error: this.error,
      revision: this.work.revision,
      lastPublished: this.location.lastPublished || "",
      backupError: this.backupError || "",
      migrationBackup: this.prefs.get("sqlite_migration_backup", ""),
      counts: Object.fromEntries(
        Object.keys(require("./sqlite.cjs").COLLECTIONS).map((k) => [
          k,
          (this.work.value[k] || []).length,
        ]),
      ),
    };
  }
  emit() {
    try {
      this.onChange(this.state());
    } catch (error) {
      console.error("Storage status notification failed:", error.message);
    }
  }
  saveLocation(location, extra = {}) {
    this.prefs.setMany({ ...extra, [POINTER]: location });
    this.location = location;
  }
  async newWork(source) {
    const file = path.join(
      this.profile,
      "workspaces",
      crypto.randomUUID() + ".sqlite",
    );
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    if (source) {
      const sourceHash = await digest(source);
      WorkspaceDatabase.inspect(source);
      await fs.copyFile(
        source,
        file,
        require("node:fs").constants.COPYFILE_EXCL,
      );
      if (
        (await digest(source)) !== sourceHash ||
        (await digest(file)) !== sourceHash
      ) {
        await fs.rm(file, { force: true });
        throw Error("数据文件正在变化，请等待同步完成后重试");
      }
    }
    const db = await new WorkspaceDatabase(file).init({ create: !source });
    return db;
  }
  async init() {
    await fs.mkdir(this.profile, { recursive: true, mode: 0o700 });
    this.profile = await fs.realpath(this.profile);
    this.prefs = await new LocalPreferences().init(
      path.join(this.profile, "preferences.sqlite"),
    );
    try {
      const location = this.prefs.get(POINTER);
      if (!location) {
        const legacyFile = path.join(this.profile, "workspace.json");
        let legacy = {};
        if (await exists(legacyFile)) {
          const bytes = await fs.readFile(legacyFile);
          legacy = JSON.parse(bytes.toString("utf8"));
          if (!legacy || typeof legacy !== "object" || Array.isArray(legacy))
            throw Error("旧数据格式无效，已保留原文件");
          const backupFile = path.join(
            this.profile,
            "backups",
            "workspace-json-" + stamp() + ".bak",
          );
          await fs.mkdir(path.dirname(backupFile), {
            recursive: true,
            mode: 0o700,
          });
          await fs.writeFile(backupFile, bytes, { flag: "wx", mode: 0o600 });
          this.prefs.setMany({ sqlite_migration_backup: backupFile });
        }
        this.work = await this.newWork();
        if (legacy.sm_workspace_v1 != null)
          this.work.set(legacy.sm_workspace_v1);
        const file = path.join(this.profile, "workspace.sqlite");
        // An orphan snapshot may remain after an interrupted first migration. Preserve it.
        if (await exists(file))
          await fs.rename(
            file,
            path.join(
              this.profile,
              "workspace-recovered-" + stamp() + ".sqlite",
            ),
          );
        await this.work.snapshot(file);
        const values = Object.fromEntries(
          Object.entries(legacy).filter(
            ([k]) =>
              k !== "sm_workspace_v1" &&
              k !== POINTER &&
              !k.startsWith("sqlite_"),
          ),
        );
        this.prefs.setMany({
          ...values,
          [POINTER]: {
            file,
            work: this.work.file,
            baseline: await digest(file),
            lastPublished: new Date().toISOString(),
          },
        });
        this.location = this.prefs.get(POINTER);
        this.work.markPublished();
      } else {
        this.location = location;
        if (await exists(location.work))
          this.work = await new WorkspaceDatabase(location.work).init();
        else if (await exists(location.file)) {
          this.work = await this.newWork(location.file);
          this.work.markPublished();
          this.saveLocation({
            ...location,
            work: this.work.file,
            baseline: await digest(location.file),
          });
        } else
          throw Error(
            "本机副本和所选数据库均不存在，请恢复数据文件后重新启动。",
          );
        if (!(await exists(this.file)))
          this.error =
            "所选数据文件不可用或已被移走；新改动会先保存在本机。请恢复原文件，或选择新文件夹。";
        else {
          const hash = await digest(this.file);
          if (hash !== this.location.baseline) {
            if (this.work.dirty)
              this.error =
                "所选数据文件已被其他设备或程序修改，本机也有未同步改动。请在数据与备份中选择保留哪份数据。";
            else {
              let imported;
              try {
                await this.localBackup();
                imported = await this.newWork(this.file);
                if ((await digest(this.file)) !== hash)
                  throw Error("所选文件正在同步，请等待同步完成后重新打开");
                imported.markPublished();
                this.saveLocation({
                  ...this.location,
                  work: imported.file,
                  baseline: hash,
                });
                this.work.close();
                this.work = imported;
              } catch (error) {
                imported?.close();
                this.error =
                  "所选数据文件暂时无法加载，已保留本机数据：" + error.message;
              }
            }
          } else if (this.work.dirty) await this.publish();
        }
      }
      await this.dailyBackup();
      return this;
    } catch (e) {
      this.work?.close();
      this.prefs.close();
      throw e;
    }
  }
  set(key, value, epoch) {
    return this.enqueue(async () => {
      if (key !== "sm_workspace_v1") {
        this.prefs.setMany({ [key]: value });
        return;
      }
      if (epoch && epoch !== this.epoch)
        throw Error("数据文件已切换，请刷新页面后重试保存。");
      await this.dailyBackup();
      this.work.set(value);
      if (this.work.dirty) await this.publish();
      return this.state();
    });
  }
  async publish() {
    const file = this.file,
      temp = path.join(
        path.dirname(file),
        ".知序-" + crypto.randomUUID() + ".tmp",
      );
    try {
      if (!(await exists(file)))
        throw Error(
          "所选数据文件不可用或已被移走，请恢复原文件或选择新文件夹。",
        );
      if ((await digest(file)) !== this.location.baseline)
        throw Error(
          "所选数据文件已被其他设备或程序修改，未覆盖它。请在数据与备份中处理冲突。",
        );
      await this.work.snapshot(temp);
      if ((await digest(file)) !== this.location.baseline)
        throw Error("写入前检测到外部数据变化，未覆盖它。请处理数据冲突。");
      await fs.rename(temp, file);
      await syncDirectory(path.dirname(file));
      this.saveLocation({
        ...this.location,
        baseline: await digest(file),
        lastPublished: new Date().toISOString(),
      });
      this.work.markPublished();
      this.error = "";
    } catch (e) {
      this.error = e.message;
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
      this.emit();
    }
  }
  retry() {
    return this.enqueue(async () => {
      await this.publish();
      return this.state();
    });
  }
  async prepare(kind, selected) {
    if (!["move", "open"].includes(kind)) throw Error("不支持的数据操作");
    const resolved = await fs.realpath(selected);
    if (kind === "move" && !(await fs.stat(resolved)).isDirectory())
      throw Error("请选择文件夹");
    const file =
      kind === "move" ? path.join(resolved, "知序数据.sqlite") : resolved;
    if (kind === "move" && (await exists(file)))
      throw Error(
        "该文件夹已有「知序数据.sqlite」，未覆盖。请选择其他文件夹，或使用「打开已有数据库」。",
      );
    if (
      kind === "open" &&
      (file === path.join(this.profile, "preferences.sqlite") ||
        file.startsWith(path.join(this.profile, "workspaces") + path.sep))
    )
      throw Error("不能直接打开本机工作副本或设置库，请选择导出的数据文件。");
    const info =
      kind === "open" ? WorkspaceDatabase.inspect(file) : this.state();
    const token = crypto.randomUUID(),
      candidate = {
        token,
        kind,
        file,
        revision: this.work.revision,
        epoch: this.epoch,
        hash: kind === "open" ? await digest(file) : null,
        counts: info.counts,
      };
    this.candidates.clear();
    this.candidates.set(token, candidate);
    return candidate;
  }
  async dailyBackup() {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const folder = path.join(
      this.profile,
      "backups",
      "daily",
      this.work.datasetId,
    );
    const file = path.join(folder, date + ".sqlite");
    try {
      if (await exists(file)) {
        try {
          WorkspaceDatabase.inspect(file);
        } catch {
          await fs.rename(file, file + ".damaged-" + Date.now());
        }
      }
      if (!(await exists(file))) await this.work.snapshot(file);
      const names = (await fs.readdir(folder))
        .filter((n) => /^\d{4}-\d{2}-\d{2}\.sqlite$/.test(n))
        .sort()
        .reverse();
      for (const name of names.slice(30)) await fs.rm(path.join(folder, name));
      this.backupError = "";
    } catch (e) {
      this.backupError = "自动备份失败，当前数据仍在本机保存：" + e.message;
    }
  }
  backupList() {
    return this.enqueue(async () => {
      const folder = path.join(
        this.profile,
        "backups",
        "daily",
        this.work.datasetId,
      );
      const names = await fs.readdir(folder).catch(() => []),
        rows = [];
      for (const name of names
        .filter((n) => /^\d{4}-\d{2}-\d{2}\.sqlite$/.test(n))
        .sort()
        .reverse()) {
        const file = path.join(folder, name);
        try {
          rows.push({
            name,
            file,
            ...WorkspaceDatabase.inspect(file),
            date: (await fs.stat(file)).mtime.toISOString(),
          });
        } catch (e) {
          rows.push({ name, file, error: e.message });
        }
      }
      const safety = (
        await fs.readdir(path.join(this.profile, "backups")).catch(() => [])
      ).filter((n) => /^知序-[\w.-]+\.sqlite$/.test(n));
      for (const base of safety) {
        const file = path.join(this.profile, "backups", base);
        try {
          rows.push({
            name: "safety:" + base,
            label: "切换前保护备份",
            file,
            ...WorkspaceDatabase.inspect(file),
            date: (await fs.stat(file)).mtime.toISOString(),
          });
        } catch (e) {
          rows.push({
            name: "safety:" + base,
            label: "切换前保护备份",
            file,
            error: e.message,
          });
        }
      }
      return rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    });
  }
  backupPreview(name) {
    return this.enqueue(async () => {
      if (/^safety:知序-[\w.-]+\.sqlite$/.test(name))
        return this.prepare(
          "open",
          path.join(this.profile, "backups", name.slice(7)),
        );
      if (!/^\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)) throw Error("无效备份");
      return this.prepare(
        "open",
        path.join(this.profile, "backups", "daily", this.work.datasetId, name),
      );
    });
  }
  async localBackup() {
    const target = path.join(
      this.profile,
      "backups",
      "知序-" + stamp() + "-" + crypto.randomUUID().slice(0, 8) + ".sqlite",
    );
    await this.work.snapshot(target);
    return target;
  }
  apply(token) {
    return this.enqueue(async () => {
      const c = this.candidates.get(token);
      this.candidates.delete(token);
      if (!c || c.revision !== this.work.revision || c.epoch !== this.epoch)
        throw Error("预览后数据已变化，请重新选择并确认。");
      await this.localBackup();
      if (c.kind === "move") {
        if (await exists(c.file)) throw Error("目标文件已存在，未覆盖");
        // Use an exclusive link to publish the complete file, never overwrite a late arrival.
        const temp = path.join(
          path.dirname(c.file),
          ".知序-" + crypto.randomUUID() + ".tmp",
        );
        try {
          await this.work.snapshot(temp);
          await fs.link(temp, c.file);
          await syncDirectory(path.dirname(c.file));
        } finally {
          await fs.rm(temp, { force: true });
        }
        this.saveLocation({
          file: c.file,
          work: this.work.file,
          baseline: await digest(c.file),
          lastPublished: new Date().toISOString(),
        });
        this.work.markPublished();
      } else {
        if ((await digest(c.file)) !== c.hash)
          throw Error("所选数据库已变化，请重新预览");
        const imported = await this.newWork(c.file);
        try {
          if ((await digest(c.file)) !== c.hash)
            throw Error("所选数据库正在变化，请等待同步完成后重试");
          imported.markPublished();
          this.saveLocation(
            {
              file: c.file,
              work: imported.file,
              baseline: c.hash,
              lastPublished: "",
            },
            c.restoredConfig
              ? { ...c.restoredDrafts, sm_path_config_v1: c.restoredConfig }
              : {},
          );
        } catch (e) {
          imported.close();
          throw e;
        }
        this.work.close();
        this.work = imported;
      }
      this.epoch = crypto.randomUUID();
      this.error = "";
      this.emit();
      return this.state();
    });
  }
  backup(folder) {
    return this.enqueue(async () => {
      const file = path.join(
        await fs.realpath(folder),
        "知序备份-" +
          stamp() +
          "-" +
          crypto.randomUUID().slice(0, 8) +
          ".sqlite",
      );
      await this.work.snapshot(file);
      return { file };
    });
  }
  isPrivatePath(p) {
    return p === this.profile || p.startsWith(this.profile + path.sep);
  }
  isProtectedPath(p) {
    return (
      this.isPrivatePath(p) ||
      this.profile.startsWith(p + path.sep) ||
      p === this.file ||
      this.file.startsWith(p + path.sep) ||
      p === this.file + "-journal" ||
      p === this.file + "-wal" ||
      p === this.file + "-shm"
    );
  }
  async close() {
    this.closing = true;
    await this.queue;
    this.work?.close();
    this.prefs?.close();
  }
}
module.exports = { SQLiteStorage, digest };
