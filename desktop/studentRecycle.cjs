const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const KEYS = [
  "refs",
  "homework",
  "feedback",
  "notes",
  "followups",
  "wrongQuestions",
  "reports",
  "examRecords",
  "sessions",
];
const JOURNAL = "student_move_pending_v1";
const exists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};
class StudentRecycleService {
  constructor(store, files) {
    this.store = store;
    this.files = files;
  }
  async recover() {
    const j = this.store.prefs.get(JOURNAL);
    if (!j) return;
    const source = await exists(j.from),
      dest = await exists(j.to);
    if (source === dest)
      throw Error(
        "学生目录操作尚未完成，原目录与恢复目录状态异常。已保留保护备份，请检查目录后重新打开知序。",
      );
    this.store.work.set(dest ? j.next : j.before);
    this.store.prefs.setMany({ [JOURNAL]: null });
    await this.store.publish();
  }
  async commit(from, to, before, next) {
    await this.store.localBackup();
    this.store.prefs.setMany({ [JOURNAL]: { from, to, before, next } });
    let moved = false;
    try {
      await this.files.rename(from, to);
      moved = true;
      this.store.work.set(next);
      this.store.prefs.setMany({ [JOURNAL]: null });
      await this.store.publish();
      return this.store.work.get();
    } catch (e) {
      try {
        if (moved) await this.files.rename(to, from);
        this.store.work.set(before);
        this.store.prefs.setMany({ [JOURNAL]: null });
        await this.store.publish();
      } catch {
        throw Error(
          "学生目录操作失败，已保留恢复日志与保护备份。请重新打开知序完成恢复。",
        );
      }
      throw e;
    }
  }
  archive(id) {
    return this.store.enqueue(async () => {
      await this.recover();
      const d = this.store.work.get(),
        student = (d.students || []).find((s) => s.id === id);
      if (!student) throw Error("学生档案不存在");
      const root = this.store.get("sm_path_config_v1", {}).studentsRoot;
      if (!root) throw Error("请先配置学生根目录");
      const from = await this.files.guard(student.directoryPath, {
          write: true,
          allowRoot: false,
        }),
        canonicalRoot = await this.files.guard(root);
      if (!from.startsWith(canonicalRoot + path.sep))
        throw Error("该学生不在当前学生目录内");
      const bin = path.join(root, ".zhixu-recycle");
      if (!(await exists(bin))) await this.files.mkdir(bin);
      const to = path.join(bin, crypto.randomUUID());
      const item = {
        id: crypto.randomUUID(),
        kind: "student",
        name: student.name,
        deletedAt: new Date().toISOString(),
        originalPath: student.directoryPath,
        recoveryPath: to,
        student,
        records: {},
        analysis: {},
        courseOrder: d.courseOrders?.[student.id],
      };
      const next = structuredClone(d);
      for (const key of KEYS) {
        item.records[key] = (d[key] || []).filter((r) => r.studentId === id);
        next[key] = (d[key] || []).filter((r) => r.studentId !== id);
      }
      next.students = d.students.filter((s) => s.id !== id);
      next.analysis = { ...d.analysis };
      next.courseOrders = { ...d.courseOrders };
      for (const key of Object.keys(next.analysis))
        if (key.startsWith(id + ":")) {
          item.analysis[key] = next.analysis[key];
          delete next.analysis[key];
        }
      delete next.courseOrders[id];
      next.recycleBin = [...(d.recycleBin || []), item];
      return this.commit(student.directoryPath, to, d, next);
    });
  }
  restore(id) {
    return this.store.enqueue(async () => {
      await this.recover();
      const d = this.store.work.get(),
        item = (d.recycleBin || []).find((r) => r.id === id);
      if (!item) throw Error("回收站记录不存在");
      const root = this.store.get("sm_path_config_v1", {}).studentsRoot;
      if (!root) throw Error("请先配置学生根目录");
      const target = path.join(root, item.name);
      if (
        d.students.some(
          (s) =>
            s.id === item.student.id ||
            s.name.toLowerCase() === item.name.toLowerCase(),
        ) ||
        (await exists(target))
      )
        throw Error("同名学生或目录已存在，未覆盖，请先处理后恢复");
      const remap = (v) =>
        typeof v === "string" &&
        (v === item.originalPath || v.startsWith(item.originalPath + "/"))
          ? target + v.slice(item.originalPath.length)
          : Array.isArray(v)
            ? v.map(remap)
            : v && typeof v === "object"
              ? Object.fromEntries(
                  Object.entries(v).map(([k, x]) => [k, remap(x)]),
                )
              : v;
      const next = {
        ...d,
        students: [
          ...d.students,
          { ...remap(item.student), directoryPath: target, missing: false },
        ],
        recycleBin: d.recycleBin.filter((r) => r.id !== id),
        analysis: { ...d.analysis, ...remap(item.analysis) },
        courseOrders: { ...d.courseOrders },
      };
      for (const key of KEYS) {
        const records = remap(item.records[key] || []);
        if (records.some((r) => (d[key] || []).some((old) => old.id === r.id)))
          throw Error("关联记录已存在，请检查后再恢复");
        next[key] = [...(d[key] || []), ...records];
      }
      if (item.courseOrder)
        next.courseOrders[item.student.id] = item.courseOrder;
      return this.commit(item.recoveryPath, target, d, next);
    });
  }
}
module.exports = { StudentRecycleService, JOURNAL };
