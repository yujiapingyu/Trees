const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { SQLiteStorage } = require("../desktop/storage.cjs");
const { FullBackupService } = require("../desktop/fullBackup.cjs");
const { WorkspaceDatabase } = require("../desktop/sqlite.cjs");
const { DatabaseSync } = require("node:sqlite");
test("每日备份按数据集去重，保留30日且可预览恢复，旧SQLite自动增加授课回收站表", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-daily-"));
  let store;
  try {
    store = await new SQLiteStorage(path.join(temp, "profile")).init();
    await store.set("sm_workspace_v1", {
      students: [{ id: "s" }],
      sessions: [{ id: "c", studentId: "s" }],
    });
    let rows = await store.backupList();
    assert.equal(rows.length, 1);
    const folder = path.dirname(rows[0].file);
    for (let i = 1; i <= 31; i++)
      await store.work.snapshot(
        path.join(folder, `2020-01-${String(i).padStart(2, "0")}.sqlite`),
      );
    await store.dailyBackup();
    assert.equal((await store.backupList()).length, 30);
    const preview = await store.backupPreview(rows[0].name);
    assert.equal(preview.counts.students, 0);
    await store.apply(preview.token);
    assert.equal(store.get("sm_workspace_v1").students, undefined);
    assert.ok(
      (await fs.readdir(path.join(temp, "profile/backups"))).some((n) =>
        n.startsWith("知序-"),
      ),
    );
    await store.close();
    store = null;
    const old = path.join(temp, "old.sqlite"),
      w = await new WorkspaceDatabase(old).init({ create: true });
    w.set({ students: [] });
    w.close();
    const db = new DatabaseSync(old);
    db.exec("DROP TABLE teaching_sessions; DROP TABLE recycle_bin");
    db.close();
    assert.equal(WorkspaceDatabase.inspect(old).counts.sessions, 0);
    const upgraded = await new WorkspaceDatabase(old).init();
    upgraded.set({ sessions: [{ id: "c" }], recycleBin: [{ id: "r" }] });
    assert.equal(WorkspaceDatabase.inspect(old).counts.recycleBin, 1);
    upgraded.close();
  } finally {
    if (store) await store.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
test("完整备份校验资料、恢复重定位、不泄露密钥且不覆盖现有资料，拒绝损坏与嵌套备份位置", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-bundle-"));
  let store;
  try {
    const students = path.join(temp, "students"),
      lessons = path.join(temp, "lessons"),
      dest = path.join(temp, "export"),
      restore = path.join(temp, "restore");
    for (const p of [students, lessons, dest, restore]) await fs.mkdir(p);
    await fs.mkdir(path.join(students, "测试"));
    await fs.writeFile(path.join(students, "测试/报告.docx"), "原报告");
    await fs.writeFile(path.join(lessons, "教案.docx"), "模板内容");
    store = await new SQLiteStorage(path.join(temp, "profile")).init();
    await store.set("sm_path_config_v1", {
      studentsRoot: students,
      lessonsRoot: lessons,
      deepseekKey: "do-not-export-secret",
      deepseekModel: "test-model",
    });
    await store.set("sm_workspace_v1", {
      students: [
        { id: "s", name: "测试", directoryPath: path.join(students, "测试") },
      ],
      lessons: [{ id: "l", path: path.join(lessons, "教案.docx") }],
      reports: [
        {
          id: "r",
          studentId: "s",
          path: path.join(students, "测试/报告.docx"),
        },
      ],
    });
    const draftKey = "sm_draft_" + store.work.datasetId + ":report-editor:s";
    await store.set(draftKey, { path: path.join(students, "测试/报告.docx") });
    const service = new FullBackupService(store);
    await assert.rejects(service.export(students, ["studentsRoot"]), /之外/);
    const result = await service.export(dest, ["studentsRoot", "lessonsRoot"]);
    const manifest = await fs.readFile(
      path.join(result.file, "manifest.json"),
      "utf8",
    );
    assert.ok(!manifest.includes("do-not-export-secret"));
    const preview = await service.inspect(result.file);
    assert.equal(preview.counts.students, 1);
    assert.equal(preview.roots.length, 2);
    const restored = await service.restore(preview.token, restore),
      config = store.get("sm_path_config_v1"),
      data = store.get("sm_workspace_v1");
    assert.equal(config.deepseekKey, "do-not-export-secret");
    assert.ok(store.get(draftKey).path.startsWith(path.dirname(restored.file)));
    assert.ok(
      data.students[0].directoryPath.startsWith(path.dirname(restored.file)),
    );
    assert.equal(await fs.readFile(data.reports[0].path, "utf8"), "原报告");
    assert.equal(
      await fs.readFile(path.join(students, "测试/报告.docx"), "utf8"),
      "原报告",
    );
    assert.equal(config.videosRoot, "");
    await fs.writeFile(
      path.join(result.file, "resources/lessonsRoot/教案.docx"),
      "tampered",
    );
    await assert.rejects(service.inspect(result.file), /校验失败/);
  } finally {
    if (store) await store.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("学生回收站在文件移动后异常中断仍按日志恢复，数据库写入失败回滚目录且不覆盖同名文件", async () => {
  const {
    StudentRecycleService,
    JOURNAL,
  } = require("../desktop/studentRecycle.cjs");
  const { FileService } = require("../desktop/core.cjs");
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "zhixu-recycle-journal-"),
  );
  let store;
  try {
    const root = path.join(temp, "students"),
      original = path.join(root, "测试");
    await fs.mkdir(original, { recursive: true });
    await fs.writeFile(path.join(original, "作业.txt"), "原作业");
    store = await new SQLiteStorage(path.join(temp, "profile")).init();
    await store.set("sm_path_config_v1", { studentsRoot: root });
    await store.set("sm_workspace_v1", {
      students: [{ id: "s", name: "测试", directoryPath: original }],
      feedback: [{ id: "f", studentId: "s", content: "原反馈" }],
    });
    let service = new StudentRecycleService(store, new FileService(store));
    const before = store.work.get(),
      after = await service.archive("s"),
      item = after.recycleBin[0];
    assert.equal(after.students.length, 0);
    assert.equal(after.feedback.length, 0);
    assert.equal(
      await fs.readFile(path.join(item.recoveryPath, "作业.txt"), "utf8"),
      "原作业",
    );
    await service.restore(item.id);
    assert.equal(store.work.get().feedback.length, 1);
    // Simulate termination after atomic file move but before SQLite commit.
    await fs.rename(original, item.recoveryPath);
    store.prefs.setMany({
      [JOURNAL]: { from: original, to: item.recoveryPath, before, next: after },
    });
    await store.close();
    store = await new SQLiteStorage(path.join(temp, "profile")).init();
    service = new StudentRecycleService(store, new FileService(store));
    await service.recover();
    assert.equal(store.work.get().recycleBin.length, 1);
    assert.equal(store.work.get().students.length, 0);
    assert.equal(store.prefs.get(JOURNAL), null);
    await fs.mkdir(original);
    await assert.rejects(service.restore(item.id), /已存在/);
    await fs.rmdir(original);
    await service.restore(item.id);
    const actualSet = store.work.set.bind(store.work);
    let fail = true;
    store.work.set = (value) => {
      if (fail) {
        fail = false;
        throw Error("模拟数据库写入失败");
      }
      return actualSet(value);
    };
    await assert.rejects(service.archive("s"), /模拟数据库/);
    assert.equal(
      await fs.readFile(path.join(original, "作业.txt"), "utf8"),
      "原作业",
    );
    assert.equal(store.work.get().students.length, 1);
    assert.equal(store.prefs.get(JOURNAL), null);
  } finally {
    if (store) await store.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
