import { today } from "./domain.js";
import { mathTextbook, validateCoursePlan } from "./learningPlan.js";
import { CURRICULUM_OUTLINES } from "./mathCurriculum.js";

export const AUTOMATIC_PLAN_VERSION = 1;
export const automaticPlanKey = (studentId) => studentId + ":自动教学规划";
const dateOf = (r) =>
  String(
    r.date || r.meta?.reportDate || r.reportDate || r.createdAt || "",
  ).slice(0, 10);
const recent = (rows) =>
  [...rows].sort(
    (a, b) =>
      dateOf(b).localeCompare(dateOf(a)) ||
      String(b.updatedAt || b.createdAt || "").localeCompare(
        a.updatedAt || a.createdAt || "",
      ),
  );
const usable = (r, studentId, date) =>
  r.studentId === studentId && dateOf(r) && dateOf(r) <= date;
const clean = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
const nextFromText = (text) =>
  clean(
    text.match(
      /下(?:次|节)(?:课)?\s*(?:继续|从|学习|讲|开始|进入|安排)?\s*[:：]?\s*([^。；;\n]{2,70})/,
    )?.[1] || "",
  );

export function automaticEvidence(student, data, date = today()) {
  const rows = [];
  for (const r of data.sessions || [])
    if (usable(r, student.id, date) && r.status === "completed")
      rows.push({
        id: r.id,
        kind: "授课记录",
        date: dateOf(r),
        topic: clean(r.topic),
        text: clean([r.topic, r.scope, r.notes].filter(Boolean).join("；")),
        next: clean(r.nextProgress),
        priority: 3,
      });
  for (const r of data.feedback || [])
    if (usable(r, student.id, date))
      rows.push({
        id: r.id,
        kind: "课堂反馈",
        date: dateOf(r),
        topic: "",
        text: clean(
          [r.scope, r.teacherNotes || r.content].filter(Boolean).join("；"),
        ),
        next: nextFromText(r.teacherNotes || ""),
        priority: 2,
      });
  for (const r of data.notes || [])
    if (usable(r, student.id, date))
      rows.push({
        id: r.id,
        kind: "学生记录",
        date: dateOf(r),
        topic: clean(r.title),
        text: clean(r.markdown || r.content),
        next: nextFromText(r.markdown || r.content || ""),
        priority: 1,
      });
  return rows
    .sort((a, b) => b.date.localeCompare(a.date) || b.priority - a.priority)
    .slice(0, 30);
}
function inferredGrade(student, data, date) {
  if (student.grade) return { grade: student.grade, source: "学生档案" };
  const exam = recent(
    (data.examRecords || [])
      .filter((r) => r.studentId === student.id)
      .map((r) => (data.exams || []).find((e) => e.id === r.examId))
      .filter((e) => e?.grade && dateOf(e) <= date),
  )[0];
  return exam
    ? { grade: exam.grade, source: "最近关联考试的年级（推断）" }
    : { grade: "", source: "年级尚未记录，先给通用基础建议" };
}
function catalog(stage) {
  return CURRICULUM_OUTLINES.filter((b) => b.stage === stage).flatMap((book) =>
    book.outline.split(/；/).flatMap((part) => {
      const m = part.match(
        /^第[一二三四五六七八九十\d]+章\s*([^：。]+)(?:：([^。]+))?/,
      );
      if (!m) return [];
      const title = m[1].trim(),
        details = (m[2] || "")
          .split(/[、，]/)
          .map((s) => s.replace(/^\d+(?:\.\d+)*\s*/, "").trim())
          .filter((s) => s.length > 1);
      return [{ volume: book.volume, title, details }];
    }),
  );
}
const LOCATORS = [
  [/对数|指数/, "指数函数与对数函数"],
  [/单调|奇偶|幂函数|函数概念/, "函数的概念与性质"],
  [/二项分布|正态分布|超几何|随机变量/, "随机变量及其分布"],
  [/排列|组合|计数原理/, "计数原理"],
  [/椭圆|双曲线|抛物线|圆锥曲线/, "圆锥曲线的方程"],
  [/导数|极值|切线斜率/, "一元函数的导数及其应用"],
  [/等差|等比|数列/, "数列"],
  [/空间向量/, "空间向量与立体几何"],
  [/平面向量/, "平面向量及其应用"],
  [/一次函数/, "一次函数"],
  [/二次函数/, "二次函数"],
  [/相似/, "相似三角形"],
];
function locate(text, chapters) {
  for (const [pattern, title] of LOCATORS)
    if (pattern.test(text)) {
      const i = chapters.findIndex((c) => c.title === title);
      if (i >= 0) return i;
    }
  let score = 0,
    index = -1;
  chapters.forEach((c, i) => {
    const n = [c.title, ...c.details].reduce(
      (s, t) => s + (t.length >= 2 && text.includes(t) ? t.length : 0),
      0,
    );
    if (n > score) {
      score = n;
      index = i;
    }
  });
  return index;
}
export function inferAutomaticProgress(student, data, date = today()) {
  const gradeInfo = inferredGrade(student, data, date),
    textbook = mathTextbook(gradeInfo.grade),
    rows = automaticEvidence(student, data, date),
    chapters = catalog(textbook.stage);
  const month = +date.slice(5, 7),
    semester = month >= 2 && month <= 7 ? "下学期" : "上学期";
  const strongest =
    rows.find((r) => r.next || locate(r.text + " " + r.topic, chapters) >= 0) ||
    rows[0];
  const anchorText = strongest
    ? [strongest.topic, strongest.text].join(" ")
    : "";
  const nextIndex = locate(strongest?.next || "", chapters);
  const currentIndex = locate(anchorText, chapters);
  let index = nextIndex >= 0 ? nextIndex : currentIndex;
  let reason = strongest
    ? `${strongest.date} ${strongest.kind}：${strongest.next ? "下次继续“" + strongest.next + "”" : strongest.topic || strongest.text.slice(0, 110)}`
    : "暂无授课记录，按年级、学期和教材顺序给出建议起点";
  const review =
    /[中高]考|一轮|二轮|三轮|总复习|已完成.*新课/.test(anchorText) ||
    (!strongest &&
      (/高中三|高三/.test(gradeInfo.grade) ||
        (/初中三|初三|九年级/.test(gradeInfo.grade) && semester === "下学期")));
  if (index < 0 && chapters.length) {
    let volume =
      textbook.stage === "初中"
        ? (/一|七|7/.test(gradeInfo.grade)
            ? "七"
            : /二|八|8/.test(gradeInfo.grade)
              ? "八"
              : "九") +
          "年级" +
          (semester === "上学期" ? "上册" : "下册")
        : /一|高一/.test(gradeInfo.grade)
          ? semester === "上学期"
            ? "必修第一册"
            : "必修第二册"
          : /二|高二/.test(gradeInfo.grade)
            ? semester === "上学期"
              ? "选择性必修第一册"
              : "选择性必修第二册"
            : "必修第一册";
    index = chapters.findIndex((c) => c.volume === volume);
    if (index < 0) index = 0;
  }
  const currentTopic =
    !strongest && review
      ? textbook.stage === "高中"
        ? "高中数学专题复习"
        : "初中数学专题复习"
      : (strongest?.kind === "授课记录"
          ? strongest.topic
          : chapters[currentIndex]?.title) ||
        strongest?.topic ||
        (strongest ? strongest.text.slice(0, 80) : chapters[index]?.title) ||
        "基础诊断与查漏补缺";
  const nextTopic =
    !strongest && review
      ? "函数与方程综合诊断"
      : strongest?.next ||
        (strongest
          ? currentTopic
          : chapters[index]?.details[0] || chapters[index]?.title) ||
        "数学基础诊断与巩固";
  return {
    version: AUTOMATIC_PLAN_VERSION,
    date,
    grade: gradeInfo.grade,
    gradeSource: gradeInfo.source,
    edition: textbook.edition,
    stage: textbook.stage,
    semester,
    volume:
      !strongest && review
        ? "中高考复习（建议阶段）"
        : chapters[index]?.volume || "册次由现有材料判断",
    currentTopic,
    nextTopic,
    progressEvidence: reason,
    mode: review ? "中高考复习" : strongest ? "同步推进" : "建议起点待确认",
    confidence: strongest ? "依据已有记录" : "建议起点",
    evidence: rows,
    chapterIndex: index,
    chapters,
    note: "自动建议不代表学校已讲到该章节；学校特殊安排可选补充，不要求逐校逐年级维护。",
  };
}

export function localAutomaticPlan(progress) {
  const start = Math.max(progress.chapterIndex, 0),
    chapters = progress.chapters.slice(start, start + 5);
  const remaining = chapters.flatMap((c) =>
    c.details.length ? c.details.slice(0, 8) : [c.title],
  );
  let position = remaining.findIndex(
    (t) =>
      t === progress.nextTopic ||
      (t.length >= 3 && progress.nextTopic.includes(t)) ||
      (progress.nextTopic.length >= 3 && t.includes(progress.nextTopic)),
  );
  if (position < 0 && /单调|奇偶/.test(progress.nextTopic))
    position = remaining.findIndex((t) => /基本性质/.test(t));
  const subjects = (
    progress.mode === "中高考复习"
      ? progress.stage === "高中"
        ? [progress.nextTopic, "函数与导数", "数列", "解析几何", "概率与统计"]
        : [
            progress.nextTopic,
            "方程与不等式",
            "函数综合",
            "几何证明",
            "统计与概率",
          ]
      : [
          progress.nextTopic,
          ...remaining.slice(position >= 0 ? position + 1 : 0),
        ]
  ).filter((s, i, all) => s && all.indexOf(s) === i);
  if (!subjects.length)
    subjects.push("基础知识与计算", "方程与函数", "图形与推理");
  const phases = [
    "概念诊断与基础例题",
    "典型方法与分层变式",
    "独立应用与错因订正",
  ];
  const extended = [
    "基础诊断",
    "概念与条件梳理",
    "基本方法示范",
    "单一条件变式",
    "多条件综合",
    "易错点辨析",
    "独立解题",
    "错因归纳与订正",
    "方法对比",
    "实际情境建模",
    "跨知识联系",
    "分层综合训练",
    "限时训练",
    "阶段检测",
    "检测讲评与补缺",
  ];
  const plan = Array.from({ length: 15 }, (_, i) => {
    const topic =
        subjects[
          Math.min(
            Math.floor(i / Math.ceil(15 / Math.min(subjects.length, 5))),
            subjects.length - 1,
          )
        ],
      phase = subjects.length >= 5 ? phases[i % 3] : extended[i];
    return {
      topic: `${topic}：${phase}`,
      objectives: `完成${topic}的${phase}，能独立说明方法和适用条件，并通过对应练习检验。`,
      keyPoints: `围绕${topic}安排${phase}，以实际课堂完成情况调整难度和后续节奏。`,
      hours: "1",
    };
  });
  return validateCoursePlan(
    {
      curriculum: {
        edition: progress.edition,
        volume: progress.volume,
        currentTopic: progress.currentTopic,
        progressEvidence: progress.progressEvidence,
        mode: progress.mode,
      },
      plan,
      planningNotes: `已自动依据${progress.gradeSource}、${progress.semester}教材顺序及现有记录，从“${progress.nextTopic}”起安排15节建议课。${progress.mode === "中高考复习" ? "各主题按复习任务使用。" : ""}这是本地自动基础方案，AI可结合课堂表现进一步细化；无需填写学校进度表。`,
    },
    { meta: { grade: progress.grade } },
  );
}

function stable(value) {
  return Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, stable(value[k])]),
        )
      : value;
}
export function automaticSourceKey(
  student,
  data,
  config = {},
  materials = [],
  date = today(),
) {
  const school = (data.schools || []).find((s) => s.id === student.schoolId);
  const termYear =
      +date.slice(5, 7) >= 8 ? date.slice(0, 4) : String(+date.slice(0, 4) - 1),
    term =
      +date.slice(5, 7) >= 2 && +date.slice(5, 7) <= 7 ? "下学期" : "上学期";
  const value = {
    version: AUTOMATIC_PLAN_VERSION,
    date,
    student: {
      id: student.id,
      name: student.name,
      grade: student.grade,
      notes: student.notes,
      schoolId: student.schoolId,
      mathProgress: student.mathProgress,
    },
    school: {
      name: school?.name,
      plan: school?.mathSchedules?.[[student.grade, termYear, term].join(":")],
    },
    records: Object.fromEntries(
      [
        "sessions",
        "feedback",
        "notes",
        "followups",
        "wrongQuestions",
        "homework",
        "refs",
        "examRecords",
      ].map((k) => [
        k,
        (data[k] || []).filter((r) => r.studentId === student.id),
      ]),
    ),
    exams: (data.exams || []).filter((e) =>
      (data.examRecords || []).some(
        (r) => r.studentId === student.id && r.examId === e.id,
      ),
    ),
    reports: (data.reports || [])
      .filter((r) => r.studentId === student.id && r.status === "final")
      .map((r) => ({
        id: r.id,
        updatedAt: r.updatedAt,
        reportDate: r.reportDate,
        curriculum: r.curriculum,
      })),
    config: {
      junior: config.textbooksJunior,
      senior: config.textbooksSenior,
      model: config.deepseekModel,
      host: config.deepseekHost,
      ai: !!config.deepseekKey,
    },
    materials,
  };
  const text = JSON.stringify(stable(value));
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return (
    (a >>> 0).toString(16) + ":" + (b >>> 0).toString(16) + ":" + text.length
  );
}
