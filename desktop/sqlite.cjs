const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync, backup } = require("node:sqlite");
const APP_ID = 0x5a485831;
const COLLECTIONS = Object.freeze({
  sessions: "teaching_sessions",
  recycleBin: "recycle_bin",
  schools: "schools",
  students: "students",
  lessons: "lessons",
  refs: "course_references",
  homework: "homework",
  feedback: "class_feedback",
  notes: "student_notes",
  followups: "followups",
  wrongQuestions: "wrong_questions",
  reports: "learning_reports",
  videoHistory: "video_history",
  exams: "exams",
  examRecords: "exam_records",
  favorites: "favorites",
  recent: "recent_files",
});
const encode = (v) => {
  const s = JSON.stringify(v);
  if (s === undefined) throw Error("数据不能为undefined");
  return s;
};
function rowsFor(items) {
  const counts = new Map();
  return new Map(
    items.map((item, position) => {
      const payload = encode(item),
        record = item && typeof item === "object" ? item : {};
      const base =
        typeof record.id === "string"
          ? "id:" + record.id
          : "hash:" + crypto.createHash("sha256").update(payload).digest("hex");
      const n = counts.get(base) || 0;
      counts.set(base, n + 1);
      return [
        base + ":" + n,
        {
          payload,
          position,
          id: String(record.id || ""),
          studentId: String(record.studentId || ""),
          name: String(record.name || record.title || ""),
          date: String(
            record.date ||
              record.reportDate ||
              record.createdAt ||
              record.dueDate ||
              "",
          ),
        },
      ];
    }),
  );
}
class WorkspaceDatabase {
  constructor(file) {
    this.file = file;
    this.db = null;
    this.value = {};
    this.serialized = "{}";
  }
  async init({ create = false } = {}) {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    if (!create) await fs.access(this.file);
    this.db = new DatabaseSync(this.file);
    try {
      this.db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE;",
      );
      if (create) {
        this.db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;
          CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE workspace_fields(field TEXT PRIMARY KEY, kind TEXT NOT NULL);
          CREATE TABLE workspace_maps(field TEXT NOT NULL, map_key TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(field,map_key));
          CREATE TABLE workspace_values(field TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));`);
        for (const table of Object.values(COLLECTIONS))
          this.db.exec(
            `CREATE TABLE ${table}(record_key TEXT PRIMARY KEY, id TEXT NOT NULL, student_id TEXT NOT NULL, name TEXT NOT NULL, record_date TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))); CREATE INDEX ${table}_student_date ON ${table}(student_id,record_date); CREATE INDEX ${table}_id ON ${table}(id);`,
          );
        for (const [key, value] of Object.entries({
          dataset_id: crypto.randomUUID(),
          revision: "0",
          published_revision: "0",
          schema_version: "1",
          created_at: new Date().toISOString(),
        }))
          this.db.prepare("INSERT INTO app_meta VALUES(?,?)").run(key, value);
      }
      WorkspaceDatabase.validate(this.db);
      for (const table of ["teaching_sessions", "recycle_bin"])
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS ${table}(record_key TEXT PRIMARY KEY,id TEXT NOT NULL,student_id TEXT NOT NULL,name TEXT NOT NULL,record_date TEXT NOT NULL,position INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload))); CREATE INDEX IF NOT EXISTS ${table}_student_date ON ${table}(student_id,record_date); CREATE INDEX IF NOT EXISTS ${table}_id ON ${table}(id);`,
        );
      this.value = this.read();
      this.serialized = encode(this.value);
      await fs.chmod(this.file, 0o600);
      return this;
    } catch (e) {
      this.db.close();
      this.db = null;
      throw e;
    }
  }
  static validate(db) {
    if (
      db.prepare("PRAGMA application_id").get().application_id !== APP_ID ||
      db.prepare("PRAGMA user_version").get().user_version !== 1
    )
      throw Error("不是知序数据库，或数据库版本较新");
    if (
      db.prepare("PRAGMA journal_mode").get().journal_mode.toLowerCase() !==
      "delete"
    )
      throw Error(
        "请选择知序导出的完整数据库文件，不能打开使用活动日志的数据库",
      );
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw Error("数据库完整性检查未通过，请保留文件并从备份恢复");
    if (!db.prepare("SELECT value FROM app_meta WHERE key='dataset_id'").get())
      throw Error("数据库标识缺失");
  }
  static inspect(file) {
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      WorkspaceDatabase.validate(db);
      const meta = Object.fromEntries(
        db
          .prepare("SELECT key,value FROM app_meta")
          .all()
          .map((r) => [r.key, r.value]),
      );
      const counts = Object.fromEntries(
        Object.entries(COLLECTIONS).map(([key, table]) => [
          key,
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
            ? db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n
            : 0,
        ]),
      );
      return { datasetId: meta.dataset_id, revision: +meta.revision, counts };
    } catch (e) {
      throw Error("数据库无法读取：" + e.message);
    } finally {
      db?.close();
    }
  }
  meta(key) {
    return this.db.prepare("SELECT value FROM app_meta WHERE key=?").get(key)
      ?.value;
  }
  get revision() {
    return +this.meta("revision");
  }
  get dirty() {
    return this.revision > +this.meta("published_revision");
  }
  get datasetId() {
    return this.meta("dataset_id");
  }
  markPublished() {
    this.db
      .prepare("UPDATE app_meta SET value=? WHERE key='published_revision'")
      .run(String(this.revision));
  }
  read() {
    const out = Object.create(null);
    for (const { field, kind } of this.db
      .prepare("SELECT field,kind FROM workspace_fields ORDER BY rowid")
      .all()) {
      if (kind === "collection")
        out[field] = this.db
          .prepare(
            `SELECT payload FROM ${COLLECTIONS[field]} ORDER BY position`,
          )
          .all()
          .map((r) => JSON.parse(r.payload));
      else if (kind === "map")
        out[field] = Object.fromEntries(
          this.db
            .prepare(
              "SELECT map_key,payload FROM workspace_maps WHERE field=? ORDER BY rowid",
            )
            .all(field)
            .map((r) => [r.map_key, JSON.parse(r.payload)]),
        );
      else
        out[field] = JSON.parse(
          this.db
            .prepare("SELECT payload FROM workspace_values WHERE field=?")
            .get(field).payload,
        );
    }
    return { ...out };
  }
  get() {
    return structuredClone(this.value);
  }
  set(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("工作区数据格式无效");
    const serialized = encode(value);
    if (serialized === this.serialized) return false;
    for (const key of Object.keys(COLLECTIONS))
      if (Object.hasOwn(value, key) && !Array.isArray(value[key]))
        throw Error("数据集合格式无效：" + key);
    const previous = this.value;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const field of new Set([
        ...Object.keys(previous),
        ...Object.keys(value),
      ])) {
        const has = Object.hasOwn(value, field),
          next = value[field],
          old = previous[field];
        if (
          has &&
          encode(next) ===
            (Object.hasOwn(previous, field) ? encode(old) : undefined)
        )
          continue;
        const oldKind = this.db
          .prepare("SELECT kind FROM workspace_fields WHERE field=?")
          .get(field)?.kind;
        const kind = Object.hasOwn(COLLECTIONS, field)
          ? "collection"
          : next && typeof next === "object" && !Array.isArray(next)
            ? "map"
            : "value";
        if (!has || (oldKind && oldKind !== kind)) {
          if (oldKind === "collection")
            this.db.exec(`DELETE FROM ${COLLECTIONS[field]}`);
          this.db
            .prepare("DELETE FROM workspace_maps WHERE field=?")
            .run(field);
          this.db
            .prepare("DELETE FROM workspace_values WHERE field=?")
            .run(field);
          this.db
            .prepare("DELETE FROM workspace_fields WHERE field=?")
            .run(field);
        }
        if (!has) continue;
        this.db
          .prepare(
            "INSERT INTO workspace_fields VALUES(?,?) ON CONFLICT(field) DO UPDATE SET kind=excluded.kind",
          )
          .run(field, kind);
        if (kind === "collection") {
          const before = rowsFor(Array.isArray(old) ? old : []),
            after = rowsFor(next),
            table = COLLECTIONS[field];
          const remove = this.db.prepare(
              `DELETE FROM ${table} WHERE record_key=?`,
            ),
            upsert = this.db.prepare(
              `INSERT INTO ${table} VALUES(?,?,?,?,?,?,?) ON CONFLICT(record_key) DO UPDATE SET id=excluded.id,student_id=excluded.student_id,name=excluded.name,record_date=excluded.record_date,position=excluded.position,payload=excluded.payload`,
            );
          for (const key of before.keys()) if (!after.has(key)) remove.run(key);
          for (const [key, row] of after)
            if (
              row.payload !== before.get(key)?.payload ||
              row.position !== before.get(key)?.position
            )
              upsert.run(
                key,
                row.id,
                row.studentId,
                row.name,
                row.date,
                row.position,
                row.payload,
              );
        } else if (kind === "map") {
          const prior =
            old && typeof old === "object" && !Array.isArray(old) ? old : {};
          for (const key of Object.keys(prior))
            if (!Object.hasOwn(next, key))
              this.db
                .prepare(
                  "DELETE FROM workspace_maps WHERE field=? AND map_key=?",
                )
                .run(field, key);
          for (const [key, v] of Object.entries(next))
            if (!Object.hasOwn(prior, key) || encode(prior[key]) !== encode(v))
              this.db
                .prepare(
                  "INSERT INTO workspace_maps VALUES(?,?,?) ON CONFLICT(field,map_key) DO UPDATE SET payload=excluded.payload",
                )
                .run(field, key, encode(v));
        } else
          this.db
            .prepare(
              "INSERT INTO workspace_values VALUES(?,?) ON CONFLICT(field) DO UPDATE SET payload=excluded.payload",
            )
            .run(field, encode(next));
      }
      this.db
        .prepare(
          "UPDATE app_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
        )
        .run();
      this.db.exec("COMMIT");
      this.value = structuredClone(value);
      this.serialized = serialized;
      return true;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async snapshot(file) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      await fs.access(file);
      throw Error("目标文件已存在，禁止覆盖");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    try {
      await backup(this.db, file);
      await fs.chmod(file, 0o600);
      WorkspaceDatabase.inspect(file);
      const handle = await fs.open(file, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      return file;
    } catch (e) {
      await fs.rm(file, { force: true });
      throw e;
    }
  }
  close() {
    this.db?.close();
    this.db = null;
  }
}
class LocalPreferences {
  async init(file) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,payload TEXT NOT NULL CHECK(json_valid(payload)));",
    );
    await fs.chmod(file, 0o600);
    return this;
  }
  get(key, fallback = null) {
    const r = this.db
      .prepare("SELECT payload FROM preferences WHERE key=?")
      .get(key);
    return r ? JSON.parse(r.payload) : fallback;
  }
  setMany(values) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [key, value] of Object.entries(values))
        this.db
          .prepare(
            "INSERT INTO preferences VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
          )
          .run(key, encode(value));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db?.close();
  }
}
module.exports = { WorkspaceDatabase, LocalPreferences, COLLECTIONS };
