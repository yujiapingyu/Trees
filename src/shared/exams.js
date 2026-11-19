import { id } from "./domain.js";
import { schoolStageForGrade } from "./schools.js";
export const EXAM_GRADES = [
  "初中一年级",
  "初中二年级",
  "初中三年级",
  "高中一年级",
  "高中二年级",
  "高中三年级",
];
export const gradeLabel = (grade) =>
  ({
    初中一年级: "初一",
    初中二年级: "初二",
    初中三年级: "初三",
    高中一年级: "高一",
    高中二年级: "高二",
    高中三年级: "高三",
  })[grade] || grade;
export function saveExam(data, form) {
  const exam = {
    ...form,
    name: form.name.trim(),
    organizer: (form.organizer || "").trim(),
    schoolIds: [...new Set(form.schoolIds)],
    updatedAt: new Date().toISOString(),
  };
  if (!exam.name) throw Error("请填写考试名称");
  if (!EXAM_GRADES.includes(exam.grade)) throw Error("请选择考试年级");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(exam.date) ||
    Number.isNaN(Date.parse(exam.date)) ||
    new Date(exam.date).toISOString().slice(0, 10) !== exam.date
  )
    throw Error("请填写包含年份的有效考试日期");
  if (!["alliance", "school"].includes(exam.kind))
    throw Error("请选择考试类型");
  if (
    !exam.schoolIds.length ||
    exam.schoolIds.some(
      (key) =>
        !data.schools.some(
          (s) => s.id === key && s.stage === schoolStageForGrade(exam.grade),
        ),
    )
  )
    throw Error("请选择对应学段的参与学校");
  if (exam.kind === "school" && exam.schoolIds.length !== 1)
    throw Error("学校独立考试只能选择一所学校");
  if (exam.kind === "alliance" && !exam.organizer)
    throw Error("请填写联盟或组织名称");
  if (
    !exam.subjects.length ||
    exam.subjects.some(
      (s) =>
        !s.name.trim() || !Number.isFinite(+s.maxScore) || +s.maxScore <= 0,
    )
  )
    throw Error("请填写学科名称和大于零的满分");
  if (
    new Set(exam.subjects.map((s) => s.name.trim())).size !==
    exam.subjects.length
  )
    throw Error("考试内学科名称不能重复");
  exam.subjects = exam.subjects.map((s) => ({
    ...s,
    name: s.name.trim(),
    maxScore: +s.maxScore,
  }));
  if (
    data.exams.some(
      (e) =>
        e.id !== exam.id &&
        e.name === exam.name &&
        e.date === exam.date &&
        e.grade === exam.grade &&
        e.kind === exam.kind &&
        (exam.kind === "alliance"
          ? e.organizer === exam.organizer
          : e.schoolIds[0] === exam.schoolIds[0]),
    )
  )
    throw Error("同名、同日期、同年级的考试已存在，请复用现有考试");
  const original = data.exams.find((e) => e.id === exam.id);
  const records = data.examRecords.filter((r) => r.examId === exam.id);
  if (
    original?.subjects.some(
      (s) => s.files?.length && !exam.subjects.some((next) => next.id === s.id),
    )
  )
    throw Error("学科仍有文件关联，请先移除关联后再删除学科");
  if (records.length && original?.grade !== exam.grade)
    throw Error("已有学生关联，不能修改考试年级；请另建考试");
  if (records.some((r) => !exam.schoolIds.includes(r.schoolSnapshot.id)))
    throw Error("不能移除已有成绩记录所属的学校");
  for (const record of records)
    for (const result of record.results) {
      const subject = exam.subjects.find((s) => s.id === result.subjectId);
      if (!subject) throw Error("不能删除已有学生记录的学科");
      if (result.score != null && result.score > subject.maxScore)
        throw Error("满分不能低于已录入成绩");
    }
  for (const subject of exam.subjects)
    if (
      (subject.files || []).some(
        (f) => f.schoolId && !exam.schoolIds.includes(f.schoolId),
      )
    )
      throw Error("请先移除该学校的文件关联，再调整参与学校");
  return {
    ...data,
    exams: original
      ? data.exams.map((e) => (e.id === exam.id ? exam : e))
      : [{ ...exam, createdAt: new Date().toISOString() }, ...data.exams],
  };
}
export function saveExamRecord(data, form) {
  const student = data.students.find((s) => s.id === form.studentId),
    exam = data.exams.find((e) => e.id === form.examId),
    existing = data.examRecords.find((r) => r.id === form.id);
  if (!student || !exam) throw Error("学生或考试不存在");
  if (
    existing &&
    (existing.studentId !== form.studentId || existing.examId !== form.examId)
  )
    throw Error("已有成绩不能更换所属学生或考试，请另建关联");
  if (student.status === "已停课") throw Error("停课学生仅可查看考试历史");
  if (exam.archived) throw Error("考试已归档，恢复后才能修改记录");
  if (
    data.examRecords.some(
      (r) =>
        r.id !== form.id && r.studentId === student.id && r.examId === exam.id,
    )
  )
    throw Error("该学生已关联此考试，请编辑原记录");
  const schoolId =
    existing?.schoolSnapshot.id || form.schoolId || student.schoolId;
  const school = data.schools.find((s) => s.id === schoolId);
  if (!school || !exam.schoolIds.includes(schoolId))
    throw Error("请选择该考试参与学校");
  if (
    !existing &&
    !form.historical &&
    (student.grade !== exam.grade || student.schoolId !== schoolId)
  )
    throw Error("学校或年级不匹配；录入历史考试请明确勾选历史模式");
  const results = exam.subjects.map((subject) => {
    const input = form.results.find((r) => r.subjectId === subject.id) || {
      status: "pending",
      score: null,
    };
    if (!["pending", "scored", "absent"].includes(input.status))
      throw Error("成绩状态无效");
    let score = null;
    if (input.status === "scored") {
      if (
        input.score === "" ||
        (typeof input.score === "string" && !input.score.trim()) ||
        input.score == null ||
        !Number.isFinite(+input.score) ||
        +input.score < 0 ||
        +input.score > subject.maxScore
      )
        throw Error(`${subject.name}成绩应在 0–${subject.maxScore} 分之间`);
      score = +input.score;
    }
    return { subjectId: subject.id, status: input.status, score };
  });
  const record = {
    id: form.id || id(),
    studentId: student.id,
    examId: exam.id,
    schoolSnapshot: existing?.schoolSnapshot || {
      id: school.id,
      name: school.name,
    },
    gradeSnapshot: existing?.gradeSnapshot || exam.grade,
    results,
    notes: (form.notes || "").trim(),
    updatedAt: new Date().toISOString(),
  };
  return {
    ...data,
    examRecords: existing
      ? data.examRecords.map((r) => (r.id === record.id ? record : r))
      : [record, ...data.examRecords],
  };
}
export function deleteExam(data, examId) {
  if (data.examRecords.some((r) => r.examId === examId))
    throw Error("考试已有学生记录，请归档保留历史，不能删除");
  return { ...data, exams: data.exams.filter((e) => e.id !== examId) };
}
export function examTotal(record, exam) {
  const scored = record.results.filter((r) => r.status === "scored");
  return {
    complete: exam.subjects.length === scored.length,
    sum: scored.reduce((n, r) => n + r.score, 0),
    count: scored.length,
    max: exam.subjects.reduce((n, s) => n + s.maxScore, 0),
  };
}
export function paperGroups(subject) {
  const groups = new Map();
  for (const f of subject.files || []) {
    const key = JSON.stringify([f.schoolId || "", f.version || "默认卷"]);
    if (!groups.has(key))
      groups.set(key, {
        schoolId: f.schoolId || "",
        version: f.version || "默认卷",
        paper: [],
        answer: [],
      });
    groups.get(key)[f.kind].push(f);
  }
  return [...groups.values()];
}
