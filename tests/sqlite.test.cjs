const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { WorkspaceDatabase } = require("../desktop/sqlite.cjs");
const { SQLiteStorage, digest } = require("../desktop/storage.cjs");
const { FileService } = require("../desktop/core.cjs");
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-sqlite-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return fs.realpath(dir);
}
const records = {
  students: [{ id: "s1", name: "学生一", grade: "高一" }],
  schools: [{ id: "school", name: "学校" }],
  refs: [
    { studentId: "s1", lessonId: "l1" },
    { studentId: "s1", lessonId: "l1" },
  ],
  feedback: [{ id: "f1", studentId: "s1", strengths: "表现很好" }],
  reports: [
    {
      id: "r1",
      studentId: "s1",
      plan: [{ topic: "集合" }],
      comments: { overall: "报告内容" },
    },
  ],
  exams: [
    {
      id: "e1",
      subjects: [
        {
          id: "math",
          files: [
            { path: "/original/paper.pdf", kind: "paper" },
            { path: "/original/answer.pdf", kind: "answer" },
          ],
        },
      ],
    },
  ],
  examRecords: [{ id: "x", studentId: "s1", score: 0 }],
  followups: [{ id: "fu", studentId: "s1", content: "回访正文" }],
  favorites: ["a", "a", "b"],
  analysis: { "s1:x": { value: 1 } },
  courseOrders: { s1: ["a", "b"] },
  unknown: { nested: [1, null, "字"] },
  scalar: null,
};
test("SQLite按记录和映射保存，兼容重复引用、未知字段、空值、零分及事务回滚", async (t) => {
  const dir = await fixture(t),
    db = await new WorkspaceDatabase(path.join(dir, "work.sqlite")).init({
      create: true,
    });
  t.after(() => db.close());
  db.set(records);
  assert.deepEqual(db.get(), records);
  assert.deepEqual(db.read(), records);
  assert.equal(db.db.prepare("SELECT count(*) n FROM students").get().n, 1);
  assert.equal(
    db.db.prepare("SELECT count(*) n FROM course_references").get().n,
    2,
  );
  const rev = db.revision;
  assert.equal(db.set(structuredClone(records)), false);
  assert.equal(db.revision, rev);
  const next = structuredClone(records);
  next.students[0].name = "修改";
  next.favorites = ["b", "a"];
  delete next.scalar;
  next.unknown = { replacement: true };
  db.set(next);
  assert.deepEqual(db.read(), next);
  db.db.exec(
    "CREATE TRIGGER reject_student BEFORE INSERT ON students BEGIN SELECT RAISE(ABORT,'test rejection'); END;",
  );
  assert.throws(
    () =>
      db.set({
        ...next,
        students: [...next.students, { id: "new" }],
        followups: [],
      }),
    /test rejection/,
  );
  assert.deepEqual(db.get(), next);
  assert.deepEqual(db.read(), next);
  const backup = path.join(dir, "backup.sqlite");
  await db.snapshot(backup);
  assert.equal(WorkspaceDatabase.inspect(backup).counts.reports, 1);
  assert.equal(
    (await fs.readFile(backup)).subarray(0, 16).toString(),
    "SQLite format 3\0",
  );
});
test("首次启动完整迁移旧JSON，原文和额外备份不变，凭据不进入便携数据库，重启不回读旧JSON", async (t) => {
  const dir = await fixture(t),
    source = JSON.stringify({
      sm_workspace_v1: records,
      sm_path_config_v1: { deepseekKey: "test-secret", studentsRoot: "/test" },
      sm_view_state_route: "followups",
      sm_desktop_preferences_v1: { shortcut: "", openAtLogin: false },
    });
  await fs.writeFile(path.join(dir, "workspace.json"), source);
  let store = await new SQLiteStorage(dir).init();
  assert.deepEqual(store.get("sm_workspace_v1"), records);
  assert.equal(store.get("sm_path_config_v1").deepseekKey, "test-secret");
  assert.equal(
    await fs.readFile(store.state().migrationBackup, "utf8"),
    source,
  );
  assert.equal(
    await fs.readFile(path.join(dir, "workspace.json"), "utf8"),
    source,
  );
  assert.equal(
    (await fs.readFile(store.file)).includes(Buffer.from("test-secret")),
    false,
  );
  const before = await digest(store.file);
  await store.set("sm_view_state_test", { draft: "未提交" });
  assert.equal(await digest(store.file), before);
  await store.set("sm_workspace_v1", { ...records, students: [{ id: "s2" }] });
  assert.equal(store.state().pending, false);
  await store.close();
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    "broken legacy is ignored",
  );
  store = await new SQLiteStorage(dir).init();
  assert.deepEqual(store.get("sm_workspace_v1").students, [{ id: "s2" }]);
  await store.close();
});
test("更改保存位置、备份和重启；拒绝已有目标、过期预览和旧页面保存", async (t) => {
  const dir = await fixture(t),
    cloud = path.join(dir, "cloud");
  await fs.mkdir(cloud);
  let store = await new SQLiteStorage(path.join(dir, "profile")).init();
  await store.set("sm_workspace_v1", records);
  const old = store.file,
    epoch = store.epoch;
  let c = await store.prepare("move", cloud);
  await store.set("sm_workspace_v1", { ...records, recent: ["x"] });
  await assert.rejects(store.apply(c.token), /数据已变化/);
  c = await store.prepare("move", cloud);
  await store.apply(c.token);
  assert.equal(store.file, path.join(cloud, "知序数据.sqlite"));
  assert.equal(WorkspaceDatabase.inspect(old).counts.students, 1);
  await assert.rejects(
    store.set("sm_workspace_v1", {}, epoch),
    /数据文件已切换/,
  );
  await assert.rejects(store.prepare("move", cloud), /已有/);
  const backup = await store.backup(cloud);
  assert.equal(WorkspaceDatabase.inspect(backup.file).counts.students, 1);
  const current = store.file;
  await store.close();
  store = await new SQLiteStorage(path.join(dir, "profile")).init();
  assert.equal(store.file, current);
  assert.deepEqual(store.get("sm_workspace_v1").recent, ["x"]);
  await store.close();
});
test("云盘文件不可用时仍保存本机、重启保留未发布改动，恢复文件后可重试", async (t) => {
  const dir = await fixture(t);
  let store = await new SQLiteStorage(dir).init();
  const file = store.file;
  await fs.rename(file, file + ".away");
  await store.set("sm_workspace_v1", records);
  assert.equal(store.state().pending, true);
  assert.deepEqual(store.get("sm_workspace_v1"), records);
  await store.close();
  store = await new SQLiteStorage(dir).init();
  assert.deepEqual(store.get("sm_workspace_v1"), records);
  assert.equal(store.state().pending, true);
  await fs.rename(file + ".away", file);
  await store.retry();
  assert.equal(store.state().pending, false);
  assert.equal(WorkspaceDatabase.inspect(file).counts.students, 1);
  await store.close();
});
test("外部文件变化不覆盖，本机变更保留并能另存；重新打开前自动备份本机版本", async (t) => {
  const dir = await fixture(t),
    other = await new WorkspaceDatabase(path.join(dir, "other.sqlite")).init({
      create: true,
    });
  other.set({ students: [{ id: "remote" }] });
  const external = path.join(dir, "external.sqlite");
  await other.snapshot(external);
  other.close();
  let store = await new SQLiteStorage(path.join(dir, "profile")).init();
  const file = store.file;
  await fs.copyFile(external, file);
  const hash = await digest(file);
  await store.set("sm_workspace_v1", records);
  assert.equal(store.state().pending, true);
  assert.equal(await digest(file), hash);
  await store.close();
  store = await new SQLiteStorage(path.join(dir, "profile")).init();
  assert.equal(store.state().pending, true);
  assert.deepEqual(store.get("sm_workspace_v1"), records);
  const cloud = path.join(dir, "save-local");
  await fs.mkdir(cloud);
  const move = await store.prepare("move", cloud);
  await store.apply(move.token);
  assert.deepEqual(store.get("sm_workspace_v1"), records);
  await store.set("sm_path_config_v1", { deepseekKey: "keep-local" });
  const open = await store.prepare("open", external);
  await store.apply(open.token);
  assert.deepEqual(store.get("sm_workspace_v1").students, [{ id: "remote" }]);
  assert.equal(store.get("sm_path_config_v1").deepseekKey, "keep-local");
  const backups = await fs.readdir(path.join(dir, "profile", "backups"));
  assert.ok(backups.length >= 2);
  const backup = path.join(dir, "profile", "backups", backups.at(-1));
  assert.equal(WorkspaceDatabase.inspect(backup).counts.reports, 1);
  const recovery = await store.prepare("open", backup);
  await store.apply(recovery.token);
  assert.deepEqual(store.get("sm_workspace_v1"), records);
  await store.close();
});
test("无本机未同步修改时，重启载入另一台设备的完整数据；损坏外部文件继续使用本机版本", async (t) => {
  const dir = await fixture(t);
  let store = await new SQLiteStorage(dir).init();
  await store.set("sm_workspace_v1", records);
  const file = store.file;
  await store.close();
  const db = await new WorkspaceDatabase(path.join(dir, "other.sqlite")).init({
    create: true,
  });
  db.set({ students: [{ id: "new-device" }] });
  const copy = path.join(dir, "copy.sqlite");
  await db.snapshot(copy);
  db.close();
  await fs.copyFile(copy, file);
  store = await new SQLiteStorage(dir).init();
  assert.deepEqual(store.get("sm_workspace_v1").students, [
    { id: "new-device" },
  ]);
  assert.equal(store.state().pending, false);
  await store.close();
  await fs.writeFile(file, "corrupt external");
  store = await new SQLiteStorage(dir).init();
  assert.deepEqual(store.get("sm_workspace_v1").students, [
    { id: "new-device" },
  ]);
  assert.equal(store.state().pending, true);
  await store.close();
});
test("拒绝损坏JSON和无关SQLite，不静默清空；保护数据库免遭资源文件操作", async (t) => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, "workspace.json"), "{broken");
  await assert.rejects(new SQLiteStorage(dir).init());
  assert.equal(
    await fs.readFile(path.join(dir, "workspace.json"), "utf8"),
    "{broken",
  );
  await fs.rm(path.join(dir, "workspace.json"));
  const store = await new SQLiteStorage(dir).init();
  const old = store.file;
  const bad = path.join(dir, "bad.sqlite");
  const sql = new DatabaseSync(bad);
  sql.exec("CREATE TABLE other(x)");
  sql.close();
  await assert.rejects(store.prepare("open", bad), /不是知序数据库/);
  assert.equal(store.file, old);
  await store.set("sm_path_config_v1", { studentsRoot: path.dirname(dir) });
  const files = new FileService(store);
  await assert.rejects(files.guard(old, { write: true }), /受保护/);
  await assert.rejects(files.guard(dir, { write: true }), /受保护/);
  await store.close();
});
