import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_DATA, safeStudentContext } from "../src/shared/domain.js";
import {
  reportEvidence,
  reportTask,
  saveReportSettings,
} from "../src/shared/reports.js";
import {
  freshSession,
  saveSession,
  teachingCount,
  analysisSources,
  changedSources,
} from "../src/shared/teaching.js";
import { feedbackPrompt } from "../src/shared/feedback.js";
const fixture = () => ({
  ...structuredClone(EMPTY_DATA),
  students: [
    {
      id: "s",
      name: "测试",
      grade: "高中一年级",
      status: "稳定授课",
      directoryPath: "/students/测试",
    },
  ],
});
test("报告读取Markdown正文并兼容旧content，近期上下文按发生日期而非补录顺序取材", () => {
  const d = fixture();
  d.notes = [
    {
      id: "n",
      studentId: "s",
      date: "2026-11-23",
      title: "观察",
      markdown: "计算步骤完整",
    },
    { id: "old", studentId: "s", date: "2026-11-22", content: "旧版正文" },
  ];
  const rows = reportEvidence("s", d, "2026-11-01", "2026-11-30");
  assert.ok(rows.some((r) => r.text.includes("计算步骤完整")));
  assert.ok(rows.some((r) => r.text.includes("旧版正文")));
  for (const key of ["feedback", "notes", "followups"]) {
    d[key] = Array.from({ length: 22 }, (_, i) => ({
      id: String(i),
      studentId: "s",
      date:
        i === 0 ? "2026-11-23" : "2026-10-" + String(i + 1).padStart(2, "0"),
    }));
    assert.equal(
      safeStudentContext(d.students[0], d)[key][0].date,
      "2026-11-23",
    );
  }
});
test("授课独立计次，缺课取消不计次，历史次数校准后新增编辑删除仍正确累计", () => {
  let d = fixture();
  let s = d.students[0];
  for (let i = 0; i < 3; i++)
    d = saveSession(d, {
      ...freshSession("s"),
      topic: "课" + i,
      date: "2026-11-23",
      duration: 90,
    });
  assert.equal(teachingCount(s, d), 3);
  assert.equal(reportTask(s, d).label, "入学报告待制作");
  d = saveSession(d, {
    ...freshSession("s"),
    topic: "缺课",
    date: "2026-11-23",
    duration: "",
    status: "absent",
  });
  assert.equal(teachingCount(s, d), 3);
  d = saveReportSettings(d, "s", {
    completedLessons: 10,
    intervalMonths: 2,
    firstLessonDate: "",
    teacher: "",
    advisor: "",
  });
  s = d.students[0];
  assert.equal(teachingCount(s, d), 10);
  d = saveSession(d, {
    ...freshSession("s"),
    topic: "新课",
    date: "2026-11-23",
    duration: "",
  });
  assert.equal(teachingCount(s, d), 11);
  d = saveSession(d, { ...d.sessions[0], status: "cancelled" });
  assert.equal(teachingCount(s, d), 10);
  assert.throws(
    () =>
      saveSession(d, {
        ...freshSession("s"),
        topic: "坏日期",
        date: "2026-02-30",
      }),
    /日期/,
  );
  assert.throws(
    () =>
      saveSession(d, {
        ...freshSession("s"),
        topic: "坏时长",
        date: "2026-11-23",
        duration: -1,
      }),
    /时长/,
  );
});
test("分析按学生精确检测资料变化，其他学生资料不使本学生分析过期", () => {
  const d = fixture(),
    s = d.students[0],
    snap = analysisSources(s, d);
  assert.deepEqual(changedSources(snap, s, d), []);
  d.notes.push({ id: "n", studentId: "other", markdown: "其他学生" });
  assert.deepEqual(changedSources(snap, s, d), []);
  d.notes.push({ id: "s-note", studentId: "s", markdown: "新观察" });
  assert.deepEqual(changedSources(snap, s, d), ["notes"]);
});
test("实际授课范围作为反馈内容硬边界，授课记录进入报告依据", () => {
  const d = fixture();
  d.sessions = [
    {
      ...freshSession("s"),
      topic: "对数定义",
      date: "2026-11-23",
      scope: "第2页第3题，未讲换底公式",
      nextProgress: "对数运算",
      notes: "概念能复述",
    },
  ];
  const prompt = feedbackPrompt({
    student: d.students[0],
    date: "2026-11-23",
    notes: "概念能复述",
    scope: d.sessions[0].scope,
    lesson: { name: "对数" },
    documents: [{ text: "对数定义及换底公式" }],
  });
  assert.match(prompt, /第2页第3题/);
  assert.match(prompt, /硬边界/);
  assert.ok(
    reportEvidence("s", d, "2026-11-01", "2026-11-30").some(
      (r) => r.kind === "授课记录" && r.text.includes("对数运算"),
    ),
  );
});
