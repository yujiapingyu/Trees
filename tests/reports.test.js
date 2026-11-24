import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EMPTY_DATA } from "../src/shared/domain.js";
import {
  addMonths,
  freshReport,
  reportTask,
  saveReportSettings,
  reportEvidence,
  reportSnapshot,
  reportIssues,
  saveLearningReport,
  reportAIContent,
  reportManualFields,
  validateReportAI,
  learningReportPrompt,
  reportPlainText,
  historicalNameMismatch,
} from "../src/shared/reports.js";
test("旧报告按正文核对姓名，不将文件名当作身份依据", () => {
  assert.equal(
    historicalNameMismatch(
      "学员姓名：    样例甲              年级：七年级",
      "当前乙",
    ),
    "样例甲",
  );
  assert.equal(
    historicalNameMismatch("学员姓名：当前乙   学科教师：教师", "当前乙"),
    "",
  );
  assert.equal(historicalNameMismatch("没有填写姓名的历史摘要", "当前乙"), "");
});
const require = createRequire(import.meta.url);
const { learningReportBuffer } = require("../desktop/learningReport.cjs");
const JSZip = require("jszip");
const setup = () => ({
  ...structuredClone(EMPTY_DATA),
  students: [
    {
      id: "s",
      name: "测试学生",
      grade: "高中一年级",
      status: "稳定授课",
      reportSettings: {
        completedLessons: 3,
        intervalMonths: 2,
        teacher: "测试教师",
        firstLessonDate: "2026-11-01",
      },
    },
    { id: "other", name: "其他学生", status: "稳定授课" },
  ],
  feedback: [
    {
      id: "a",
      studentId: "s",
      date: "2026-11-01",
      content: "方程基本方法已掌握，符号处理待巩固。",
    },
    {
      id: "b",
      studentId: "s",
      date: "2026-11-03",
      content: "能列方程，计算需要回查。",
    },
    {
      id: "x",
      studentId: "other",
      date: "2026-11-03",
      content: "禁止混入其他学生",
    },
  ],
});
export function completeReport(d = setup(), type = "entry") {
  const r = freshReport(d.students[0], d, type, "2026-11-20");
  delete r.planFormat;
  delete r.lessonCount;
  r.knowledge = [
    {
      topic: "方程",
      difficulty: "中",
      strengths: "能建立方程",
      needs: "建议巩固符号处理",
      evidence: "11月课堂反馈",
    },
  ];
  r.plan = [
    {
      topic: "方程复习",
      objectives: "规范解方程步骤",
      keyPoints: "重点：等式性质；难点：符号处理",
      hours: "2",
    },
  ];
  r.habitPlan = [
    {
      habit: "计算规范",
      actions: "逐行写出并回查步骤",
      criteria: "完成后能够独立指出需要检查的步骤",
      support: "教师示范，家长提醒独立完成",
    },
  ];
  r.comments.overall = "我会继续帮助孩子规范步骤，并根据练习调整教学。";
  return r;
}
test("三次课需人工确认，讲义与反馈数量不能冒充授课次数，草稿不更新周期", () => {
  let d = setup();
  delete d.students[0].reportSettings;
  assert.equal(reportTask(d.students[0], d, "2026-11-20").kind, "setup");
  d = saveReportSettings(d, "s", { completedLessons: 2, intervalMonths: 2 });
  assert.equal(reportTask(d.students[0], d).due, false);
  d = saveReportSettings(d, "s", { completedLessons: 3, intervalMonths: 2 });
  assert.equal(reportTask(d.students[0], d).kind, "entry");
  assert.equal(reportTask(d.students[0], d).due, true);
  const r = completeReport(d);
  d = saveLearningReport(d, r);
  assert.equal(reportTask(d.students[0], d).kind, "entry");
  assert.throws(() =>
    saveReportSettings(d, "s", { completedLessons: 2.5, intervalMonths: 2 }),
  );
});
test("阶段周期按日历月处理月末和闰年，只取当前学生有效正式报告", () => {
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2026-12-31", 2), "2027-02-28");
  const d = setup();
  d.reports = [
    {
      id: "r",
      studentId: "s",
      type: "入学报告",
      path: "/entry.docx",
      generatedAt: "2026-08-31T12:00:00Z",
    },
    {
      id: "o",
      studentId: "other",
      status: "final",
      type: "stage",
      reportDate: "2026-11-20",
    },
    {
      id: "v",
      studentId: "s",
      status: "void",
      type: "stage",
      reportDate: "2026-11-20",
    },
  ];
  assert.equal(reportTask(d.students[0], d, "2026-10-30").due, false);
  assert.equal(reportTask(d.students[0], d, "2026-10-31").due, true);
  assert.equal(
    reportTask(d.students[0], d, "2026-12-01").label,
    "阶段报告已逾期",
  );
  d.students[0].reportSettings.intervalMonths = 3;
  assert.equal(reportTask(d.students[0], d, "2026-10-31").due, false);
  assert.equal(reportTask(d.students[0], d, "2026-11-30").due, true);
  d.students[0].status = "已停课";
  assert.equal(reportTask(d.students[0], d).due, false);
});
test("统计期和选定资料隔离学生，考试按考试日期取数，未出分与零分保留", () => {
  const d = setup();
  d.exams = [
    {
      id: "e",
      name: "期中考试",
      date: "2026-10-01",
      subjects: [{ id: "math", name: "数学", maxScore: 150 }],
    },
  ];
  d.examRecords = [
    {
      id: "score",
      studentId: "s",
      examId: "e",
      updatedAt: "2026-11-20",
      results: [{ subjectId: "math", status: "scored", score: 0 }],
    },
  ];
  assert.equal(reportEvidence("s", d, "2026-11-01", "2026-11-20").length, 2);
  assert.match(
    reportEvidence("s", d, "2026-10-01", "2026-11-20").find(
      (r) => r.kind === "考试",
    ).text,
    /0\/150/,
  );
  const r = completeReport(d);
  r.sourceIds = ["课堂反馈:a", "课堂反馈:x"];
  const snap = reportSnapshot(r, d);
  assert.equal(snap.records.length, 1);
  assert.doesNotMatch(JSON.stringify(snap), /禁止混入/);
});
function generatedReport(r) {
  const full = completeReport(setup(), r.type);
  return {
    ...structuredClone(reportAIContent(full)),
    meta: {
      teacher: "AI建议教师（待确认）",
      advisor: "班主任（待确认）",
      studentName: "禁止覆盖身份",
    },
    goals: {
      lastScore: "未记录，待确认",
      lastRank: "未记录，待确认",
      targetScore: "建议先独立完成基础题",
      targetRank: "建议逐步缩小与班级中位水平的差距",
      targetSchool: "建议结合后续成绩与个人意愿确定择校方向",
      motivation: "结合方程学习情况，建立独立检查关键步骤的习惯。",
    },
    motivationChoices: Object.fromEntries(
      Object.keys(r.motivationChoices).map((k) => [k, "建议是（待确认）"]),
    ),
    observations:
      r.type === "entry"
        ? Array.from({ length: 3 }, (_, i) => ({
            date: i < 2 ? `2026-11-0${i + 1}` : "",
            topic: i < 2 ? "方程基本方法" : "待观察课次：符号处理",
            performance: "已有记录能建立方程，建议检查移项符号。",
            homework: "建议独立完成计算并回查。",
          }))
        : [],
    habits: r.habits.map((h) => ({
      ...h,
      rating: "良好",
      evidence: "建议评级：良好；能用基本方法建立方程，复杂情境仍需观察。",
    })),
    comments: {
      attendance: "已有课堂记录，建议继续保持按时到课。",
      efficiency: "能够理解方程的基本方法，需关注符号处理。",
      homework: "建议保留计算过程并独立订正。",
      overall: "我会围绕符号与步骤安排分层练习。",
    },
    teacherNotes: "课堂记录表明基本方法已掌握，符号仍需巩固。",
    planningNotes: "建议用两课时复习计算与检查方法。",
    hourBudget: "",
    curriculum: {
      edition: "错误版本应被系统覆盖",
      volume: "必修第一册",
      currentTopic: "方程与不等式",
      progressEvidence: "2026-11-03课堂反馈",
      mode: "同步推进",
    },
    plan: Array.from({ length: 15 }, (_, i) => ({
      topic: `方程与函数任务${i + 1}`,
      objectives: "独立完成当前教学任务并解释步骤",
      keyPoints: "重点：条件与符号；难点：规范推理",
      hours: "1",
    })),
    parentReceipt: "建议与家长确认：在家独立练习与回查步骤的执行情况。",
  };
}
test("无需手工填表即可生成整份报告，评级和目标可建议，身份与真实课次不由AI改写", () => {
  const d = setup(),
    r = freshReport(d.students[0], d, "entry", "2026-11-20");
  const value = generatedReport(r);
  const content = validateReportAI(value, r);
  assert.equal(content.meta.studentName, r.meta.studentName);
  assert.equal(content.meta.teacher, "测试教师");
  assert.equal(content.meta.advisor, "班主任（待确认）");
  assert.match(content.goals.targetScore, /建议/);
  assert.equal(content.habits[0].rating, "良好");
  value.habits[0].rating = "建议评级：良好（待确认）";
  assert.equal(validateReportAI(value, r).habits[0].rating, "良好");
  assert.equal(content.observations.length, 3);
  assert.equal(
    content.motivationChoices[Object.keys(r.motivationChoices)[0]],
    "建议是（待确认）",
  );
  assert.match(content.parentReceipt, /建议与家长确认/);
  assert.equal(content.plan.length, 15);
  assert.equal(content.curriculum.edition, "人教A版高中数学");
  assert.deepEqual(reportIssues({ ...r, ...content }, true), []);
  assert.equal(content.confirmedLessons, undefined);
  assert.equal(content.studentId, undefined);
  const short = { ...value, plan: value.plan.slice(0, 14) };
  assert.throws(() => validateReportAI(short, r), /15节课/);
  delete value.goals;
  assert.throws(() => validateReportAI(value, r), /动力目标/);
});
test("AI生成后可修改并保留人工修改，也可主动选择重新评估全部建议", () => {
  let r = completeReport();
  r.aiGeneratedAt = "2026-11-20";
  const patch = {
    goals: { ...r.goals, targetScore: "95" },
    habits: r.habits.map((h, i) => (i ? h : { ...h, rating: "及格" })),
  };
  r = { ...r, ...patch, manualFields: reportManualFields(r, patch) };
  const value = generatedReport(r);
  let result = validateReportAI(value, r);
  assert.equal(result.goals.targetScore, "95");
  assert.equal(result.habits[0].rating, "及格");
  assert.match(result.habits[0].evidence, /教师确认评级：及格/);
  assert.equal(result.habits[1].rating, "良好");
  result = validateReportAI(value, r, false);
  assert.match(result.goals.targetScore, /建议/);
  assert.equal(result.habits[0].rating, "良好");
  const legacy = completeReport();
  legacy.goals.targetScore = "88";
  legacy.habits[0].rating = "及格";
  result = validateReportAI(generatedReport(legacy), legacy);
  assert.equal(result.goals.targetScore, "88");
  assert.equal(result.habits[0].rating, "及格");
});
test("完整报告使用档案备注、原始课堂观察、九项回访和课程信息，不混入其他学生", () => {
  const d = setup();
  d.students[0].notes = "希望培养独立计算习惯";
  d.feedback[0].teacherNotes = "学生能讲清等式性质";
  d.followups = [
    {
      id: "f",
      studentId: "s",
      date: "2026-11-04",
      purpose: "商议执行计划",
      solutionFeedback: "家长同意观察一周",
      keyInfo: "每天七点开始",
      notes: "下周沟通",
    },
  ];
  d.lessons = [{ id: "l", name: "方程综合应用", tags: ["应用题"] }];
  d.refs = [{ studentId: "s", lessonId: "l" }];
  const r = freshReport(d.students[0], d, "entry", "2026-11-20");
  const snap = reportSnapshot(r, d),
    prompt = learningReportPrompt(r, snap);
  for (const text of [
    "独立计算习惯",
    "能讲清等式性质",
    "家长同意观察一周",
    "每天七点开始",
    "方程综合应用",
    "完整",
    "建议评级",
  ])
    assert.ok(prompt.includes(text));
  assert.doesNotMatch(prompt, /禁止混入其他学生/);
  const value = generatedReport(r);
  value.observations[0].date = "2099-01-01";
  assert.throws(() => validateReportAI(value, r), /日期/);
  value.observations[0].date = "";
  value.habits[0].rating = "随便写";
  assert.throws(() => validateReportAI(value, r), /评级/);
});
test("阶段报告兼容旧草稿里多余的入学观察，较早考试与无日期记录可作为背景", () => {
  const d = setup();
  d.notes = [
    { id: "n", studentId: "s", title: "补充观察", content: "记录未设置日期" },
  ];
  const r = freshReport(d.students[0], d, "stage", "2026-11-20");
  assert.equal(r.observations.length, 0);
  assert.ok(r.sourceIds.includes("学生记录:n"));
  r.meta.periodStart = "2026-11-02";
  const snap = reportSnapshot(r, d);
  assert.equal(snap.backgroundRecords[0].date, "2026-11-01");
  const value = generatedReport(r);
  value.observations = [{ date: "2026-01-01", topic: "旧版入学观察" }];
  assert.deepEqual(validateReportAI(value, r).observations, []);
});
test("正式导出条件、版本不可覆盖与历史身份保护", () => {
  const d = setup(),
    r = completeReport(d);
  r.confirmedLessons = 2;
  assert.ok(reportIssues(r, true).some((s) => s.includes("3 次课")));
  r.confirmedLessons = 3;
  assert.deepEqual(reportIssues(r, true), []);
  assert.throws(
    () => saveLearningReport(d, { ...r, status: "final" }),
    /Word 导出/,
  );
  const final = { ...r, status: "final", path: "/student/report.docx" };
  const saved = saveLearningReport(d, final);
  assert.throws(
    () =>
      saveLearningReport(saved, {
        ...final,
        comments: { ...final.comments, overall: "重写" },
      }),
    /不可直接改写/,
  );
  assert.throws(
    () =>
      saveLearningReport(d, {
        ...r,
        meta: { ...r.meta, studentName: "另一个姓名" },
      }),
    /姓名/,
  );
  assert.match(reportPlainText(r), /学科核心习惯培养/);
});
test("阶段报告只比较同一学生且不使用未来基线", () => {
  const d = setup();
  d.reports = [
    {
      id: "base",
      studentId: "s",
      type: "entry",
      status: "final",
      reportDate: "2026-09-01",
      content: "上期分析",
      path: "/base.docx",
    },
    {
      id: "other-base",
      studentId: "other",
      type: "stage",
      status: "final",
      reportDate: "2026-09-01",
      content: "他人资料",
    },
  ];
  const r = completeReport(d, "stage");
  assert.equal(reportSnapshot(r, d).baseline.id, "base");
  r.baselineId = "other-base";
  assert.equal(reportSnapshot(r, d).baseline, null);
  r.baselineId = "base";
  r.meta.periodStart = "2026-08-01";
  assert.throws(() => reportSnapshot(r, d), /统计起点/);
});
test("真实Word沿用两份原模板的表格、边框、绘图与包部件，填入当前身份并清除样例内容", async () => {
  const fs = await import("node:fs/promises");
  const X = require("../desktop/lessonXml.cjs");
  for (const type of ["entry", "stage"]) {
    const r = completeReport(setup(), type),
      template = await JSZip.loadAsync(
        await fs.readFile(
          new URL(
            "../assets/report-templates/" + type + ".docx",
            import.meta.url,
          ),
        ),
      ),
      zip = await JSZip.loadAsync(await learningReportBuffer(r));
    const xml = await zip.file("word/document.xml").async("string"),
      doc = X.parse(xml),
      original = X.parse(
        await template.file("word/document.xml").async("string"),
      );
    const tables = X.direct(X.descendants(doc, "body")[0], "tbl"),
      oldTables = X.direct(X.descendants(original, "body")[0], "tbl");
    assert.equal(tables.length, type === "entry" ? 4 : 5);
    assert.equal(
      X.serialize(X.descendants(doc, "sectPr")[0]),
      X.serialize(X.descendants(original, "sectPr")[0]),
    );
    for (let i = 0; i < tables.length; i++)
      assert.equal(
        X.serialize(X.direct(tables[i], "tblPr")[0]),
        X.serialize(X.direct(oldTables[i], "tblPr")[0]),
      );
    for (const name of Object.keys(template.files).filter(
      (n) =>
        !template.files[n].dir &&
        n !== "word/document.xml" &&
        n !== "word/settings.xml",
    ))
      assert.deepEqual(
        await zip.file(name).async("nodebuffer"),
        await template.file(name).async("nodebuffer"),
        name + "必须保留原部件",
      );
    assert.match(
      await zip.file("word/settings.xml").async("string"),
      /updateFields[^>]+true/,
    );
    assert.match(xml, /测试学生/);
    assert.match(xml, /家长签名/);
    assert.match(xml, /w:pgBorders/);
    assert.ok(
      X.descendants(doc, "pict").length + X.descendants(doc, "drawing").length >
        0,
    );
    assert.doesNotMatch(xml, /\{\{\w+\}\}|李政博|何子晨|俞加平|周媛/);
    if (type === "stage") assert.match(xml, /学科教师签名/);
  }
});
