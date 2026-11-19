import { pinyin } from "pinyin-pro";
export const STATUSES = ["未授课", "三次课内", "稳定授课", "已停课"];
export const GRADES = [
  "小学一年级",
  "小学二年级",
  "小学三年级",
  "小学四年级",
  "小学五年级",
  "小学六年级",
  "初中一年级",
  "初中二年级",
  "初中三年级",
  "高中一年级",
  "高中二年级",
  "高中三年级",
  "中职",
];
export const SPECIAL_DIRS = [
  "学习力报告",
  "学习报告",
  "错题本",
  "续费管理",
  ".trash",
];
export const id = () => crypto.randomUUID();
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dayDiff(a, b) {
  return Math.round(
    (new Date(`${a}T00:00:00+08:00`) - new Date(`${b}T00:00:00+08:00`)) /
      86400000,
  );
}
export function followupState(records, now = today(), stopped = false) {
  if (stopped) return { label: "已停课 · 只读", type: "muted", due: false };
  const last = [...records].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!last) return { label: "从未回访", type: "warning", due: true };
  const next = last.nextDate || addDays(last.date, 14);
  const delta = dayDiff(next, now);
  return {
    label: delta < 0 ? "已逾期" : delta <= 3 ? "即将联系" : "已安排",
    type: delta < 0 ? "danger" : delta <= 3 ? "warning" : "success",
    due: delta <= 3,
    next,
    delta,
    last: last.date,
  };
}
export function matches(value, query) {
  const str = String(value || "").toLowerCase();
  const q = query.trim().toLowerCase();
  return (
    !q ||
    str.includes(q) ||
    pinyin(str, { toneType: "none", type: "array" }).join("").includes(q) ||
    pinyin(str, { pattern: "first", toneType: "none", type: "array" })
      .join("")
      .includes(q)
  );
}
export function studentMatches(student, q, schools = []) {
  return matches(
    [
      student.name,
      student.grade,
      student.phone,
      student.notes,
      schools.find((s) => s.id === student.schoolId)?.name || "",
    ].join(" "),
    q,
  );
}
export function validateName(name, students = [], excludeId) {
  const n = name.trim();
  if (
    !n ||
    n === "." ||
    n === ".." ||
    /[\\/:*?"<>|\x00-\x1f]/.test(n) ||
    n.startsWith(".")
  )
    throw Error("请输入有效名称，不可包含路径分隔符、系统字符或以点开头");
  if (
    students.some(
      (s) =>
        s.id !== excludeId &&
        s.name.toLocaleLowerCase() === n.toLocaleLowerCase(),
    )
  )
    throw Error("该名称已存在，请使用其他名称");
  return n;
}
export function validateBlank(factor, exponent) {
  if (!Number.isFinite(+factor) || +factor < 0.1 || +factor > 1.5)
    throw Error("空白量系数应为 0.1–1.5");
  if (!Number.isFinite(+exponent) || +exponent < 0.5 || +exponent > 1)
    throw Error("增长指数应为 0.5–1");
}
export function parseJSONResult(text) {
  try {
    return JSON.parse(
      text.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
    );
  } catch {
    throw Error("模型输出不是有效 JSON，请检查输出后重试");
  }
}
export function validateQuestions(items) {
  if (!Array.isArray(items) || !items.length)
    throw Error("没有识别到题目，请检查文件并重试");
  return items.map((q) => {
    if (!q || typeof q.stem !== "string" || !q.stem.trim())
      throw Error("题目缺少有效题干，需人工检查");
    if (
      q.options != null &&
      typeof q.options !== "string" &&
      (!Array.isArray(q.options) ||
        q.options.some((o) => typeof o !== "string"))
    )
      throw Error("题目选项应为文本或文本数组");
    if (
      q.tags != null &&
      (!Array.isArray(q.tags) || q.tags.some((t) => typeof t !== "string"))
    )
      throw Error("题目标签应为文本数组");
    for (const field of ["answer", "explanation"])
      if (q[field] != null && !["string", "number"].includes(typeof q[field]))
        throw Error("题目的答案与解析应为文本");
    if (q.difficulty && !["基础", "中等", "较难"].includes(q.difficulty))
      throw Error("题目难度只能为基础、中等、较难");
    return {
      ...q,
      id: typeof q.id === "string" && q.id ? q.id : id(),
      answer: q.answer == null ? "" : String(q.answer),
      explanation: q.explanation == null ? "" : String(q.explanation),
      difficulty: q.difficulty || "中等",
      tags: Array.isArray(q.tags) ? q.tags : [],
      uncertain: !!q.uncertain,
    };
  });
}
export function uniqueRef(refs, lessonId) {
  if (refs.some((r) => r.lessonId === lessonId))
    throw Error("已关联该讲义，请勿重复添加");
}
export function removeRef(refs, lessonId, feedback) {
  if (feedback.some((f) => f.lessonId === lessonId))
    throw Error("该讲义已被课堂反馈引用，请先处理对应反馈");
  return refs.filter((r) => r.lessonId !== lessonId);
}
export function safeStudentContext(student, data) {
  const take = (key) => data[key].filter((x) => x.studentId === student.id);
  return {
    student: {
      ...student,
      school:
        (data.schools || []).find((s) => s.id === student.schoolId)?.name || "",
    },
    exams: (data.examRecords || [])
      .filter((r) => r.studentId === student.id)
      .map((r) => {
        const exam = (data.exams || []).find((e) => e.id === r.examId);
        return {
          ...r,
          exam: exam
            ? {
                name: exam.name,
                grade: exam.grade,
                date: exam.date,
                subjects: exam.subjects.map((s) => ({
                  id: s.id,
                  name: s.name,
                  maxScore: s.maxScore,
                })),
              }
            : null,
        };
      }),
    lessons: take("refs"),
    homework: take("homework"),
    feedback: take("feedback").slice(-10),
    notes: take("notes").slice(-15),
    followups: take("followups").slice(-8),
    wrongQuestions: take("wrongQuestions"),
    reports: take("reports")
      .slice(-3)
      .map(({ sourceSnapshot, ...report }) => report),
  };
}
export function timeFilter(items, range, now = today(), n = 5) {
  if (range === "all") return items;
  if (range === "recent") {
    const lessons = [
      ...new Set(
        [...items]
          .sort((a, b) =>
            (b.date || b.createdAt).localeCompare(a.date || a.createdAt),
          )
          .map((x) => x.lessonId || "未关联"),
      ),
    ].slice(0, n);
    return items.filter((x) => lessons.includes(x.lessonId || "未关联"));
  }
  const d = new Date(`${now}T12:00:00+08:00`);
  const start =
    range === "month"
      ? now.slice(0, 7) + "-01"
      : addDays(now, -((d.getUTCDay() + 6) % 7));
  return items.filter(
    (x) =>
      (x.date || x.createdAt).slice(0, 10) >= start &&
      (x.date || x.createdAt).slice(0, 10) <= now,
  );
}
export const EMPTY_DATA = {
  schools: [],
  students: [],
  lessons: [],
  refs: [],
  homework: [],
  feedback: [],
  notes: [],
  followups: [],
  wrongQuestions: [],
  reports: [],
  analysis: {},
  videoHistory: [],
  videoNotes: {},
  exams: [],
  examRecords: [],
  favorites: [],
  recent: [],
};
