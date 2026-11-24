import { id, today } from "./domain.js";
export const STUDENT_COLLECTIONS = [
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
export function teachingCount(student, data) {
  const baseline = student.reportSettings?.completedLessons;
  const completed = (data.sessions || []).filter(
    (s) => s.studentId === student.id && s.status === "completed",
  );
  const counted = new Set(student.reportSettings?.countedSessionIds || []);
  const current = new Set(completed.map((s) => s.id));
  return baseline == null && !completed.length
    ? null
    : Math.max(
        0,
        Number(baseline || 0) +
          completed.filter((s) => !counted.has(s.id)).length -
          [...counted].filter((s) => !current.has(s)).length,
      );
}
export function saveSession(data, form) {
  const previous = (data.sessions || []).find((s) => s.id === form.id);
  const student = data.students.find((s) => s.id === form.studentId);
  if (!student || student.status === "已停课")
    throw Error("学生不存在或已停课");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(form.date) ||
    new Date(form.date + "T12:00:00+08:00").toISOString().slice(0, 10) !==
      form.date
  )
    throw Error("请填写有效授课日期");
  if (form.status === "completed" && form.date > today())
    throw Error("已完成授课的日期不能晚于今天");
  if (!["completed", "absent", "cancelled"].includes(form.status))
    throw Error("请选择授课状态");
  if (!form.topic?.trim()) throw Error("请填写本次授课主题");
  if (
    form.duration !== "" &&
    (!Number.isFinite(+form.duration) ||
      +form.duration <= 0 ||
      +form.duration > 1440)
  )
    throw Error("授课时长须为1–1440分钟或留空");
  const value = {
    ...form,
    id: form.id || id(),
    duration: form.duration === "" ? "" : +form.duration,
    updatedAt: new Date().toISOString(),
    createdAt:
      (data.sessions || []).find((s) => s.id === form.id)?.createdAt ||
      new Date().toISOString(),
  };
  if (
    previous?.closeout &&
    ["notes", "topic", "scope", "nextProgress", "date", "courseId"].some(
      (k) => form[k] !== previous[k],
    )
  ) {
    value.closeout = {
      ...previous.closeout,
      state: "pending",
      raw: form.notes || previous.closeout.raw,
      version: id(),
      publishedFeedbackId: "",
      supersedesFeedbackId:
        previous.closeout.publishedFeedbackId ||
        previous.closeout.supersedesFeedbackId ||
        "",
      manualFields: Object.fromEntries(
        ["topic", "scope", "nextProgress"].map((k) => [
          k,
          form[k] !== previous[k] || !!previous.closeout.manualFields?.[k],
        ]),
      ),
    };
  }
  return {
    ...data,
    sessions: [
      ...(data.sessions || []).filter((s) => s.id !== value.id),
      value,
    ],
  };
}
export function latestProgress(studentId, data) {
  return [...(data.sessions || [])]
    .filter((s) => s.studentId === studentId && s.status === "completed")
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.createdAt || "").localeCompare(a.createdAt || ""),
    )[0];
}
export function analysisSources(student, data) {
  return {
    student: {
      name: student.name,
      grade: student.grade,
      schoolId: student.schoolId,
      notes: student.notes,
      reportSettings: student.reportSettings,
      mathProgress: student.mathProgress,
    },
    school: (data.schools || []).find((s) => s.id === student.schoolId),
    ...Object.fromEntries(
      [...STUDENT_COLLECTIONS].map((k) => [
        k,
        (data[k] || []).filter((r) => r.studentId === student.id),
      ]),
    ),
    exams: (data.exams || []).filter((e) =>
      (data.examRecords || []).some(
        (r) => r.studentId === student.id && r.examId === e.id,
      ),
    ),
  };
}
export function changedSources(before, student, data) {
  const now = analysisSources(student, data);
  return Object.keys(now).filter(
    (k) => JSON.stringify(before?.[k]) !== JSON.stringify(now[k]),
  );
}
export const SOURCE_LABELS = {
  student: "档案",
  school: "学校",
  refs: "课程引用",
  homework: "作业",
  feedback: "课堂反馈",
  notes: "学生记录",
  followups: "回访",
  wrongQuestions: "错题",
  reports: "学习报告",
  examRecords: "成绩",
  sessions: "授课记录",
  exams: "考试资料",
};
export function freshSession(studentId, courseId = "") {
  return {
    id: id(),
    studentId,
    courseId,
    date: today(),
    topic: "",
    duration: "",
    status: "completed",
    scope: "",
    nextProgress: "",
    notes: "",
  };
}
