import { id } from "./domain.js";
import { paperGroups } from "./exams.js";
import { isWithinRoot } from "./paths.js";

export const referenceCourseId = (reference) =>
  reference.type === "exam" ? `exam:${reference.id}` : reference.lessonId;

export function matchesExamGroup(reference, examId, subjectId, group) {
  return (
    reference.type === "exam" &&
    reference.examId === examId &&
    reference.subjectId === subjectId &&
    (reference.schoolId || "") === (group.schoolId || "") &&
    (reference.version || "默认卷") === (group.version || "默认卷")
  );
}

export function addExamReference(data, studentId, examId, subjectId, group) {
  const student = data.students.find((s) => s.id === studentId);
  const exam = data.exams.find((e) => e.id === examId);
  const subject = exam?.subjects.find((s) => s.id === subjectId);
  const source =
    subject &&
    paperGroups(subject).find(
      (g) =>
        g.schoolId === (group.schoolId || "") &&
        g.version === (group.version || "默认卷"),
    );
  if (!student || !exam || !source?.paper.length)
    throw Error("学生、考试或试卷已变更，请重新选择");
  if (student.status === "已停课") throw Error("停课学生仅可查看课程历史");
  if (
    data.refs.some(
      (r) =>
        r.studentId === studentId &&
        matchesExamGroup(r, examId, subjectId, source),
    )
  )
    throw Error("已引用这份试卷，请勿重复添加");
  const reference = {
    id: id(),
    type: "exam",
    studentId,
    examId,
    subjectId,
    schoolId: source.schoolId,
    version: source.version,
    name: `${exam.name} · ${subject.name} · ${source.version} · ${source.schoolId ? data.schools.find((s) => s.id === source.schoolId)?.name || "原学校" : "公共卷"}`,
    createdAt: new Date().toISOString(),
  };
  return {
    ...data,
    refs: [reference, ...data.refs],
    courseOrders: {
      ...data.courseOrders,
      [studentId]: [
        referenceCourseId(reference),
        ...(data.courseOrders?.[studentId] || []),
      ],
    },
  };
}

export function examReferenceCourse(data, reference, examsRoot) {
  const exam = data.exams.find((e) => e.id === reference.examId);
  const subject = exam?.subjects.find((s) => s.id === reference.subjectId);
  const group =
    subject &&
    paperGroups(subject).find(
      (g) =>
        g.schoolId === (reference.schoolId || "") &&
        g.version === (reference.version || "默认卷"),
    );
  const files = [...(group?.paper || []), ...(group?.answer || [])].map(
    (f) => ({ ...f, unavailable: !isWithinRoot(f.path, examsRoot) }),
  );
  const schoolName = reference.schoolId
    ? data.schools.find((s) => s.id === reference.schoolId)?.name || "原学校"
    : "公共卷";
  return {
    id: referenceCourseId(reference),
    isRef: true,
    isExam: true,
    name:
      exam && subject
        ? `${exam.name} · ${subject.name} · ${reference.version} · ${schoolName}`
        : reference.name || "考试来源缺失",
    examId: reference.examId,
    subjectId: reference.subjectId,
    subjectName: subject?.name,
    examDate: exam?.date,
    grade: exam?.grade,
    archived: exam?.archived,
    version: reference.version,
    schoolId: reference.schoolId,
    schoolName,
    files,
    missing:
      !group?.paper.length ||
      !files.some((f) => f.kind === "paper" && !f.unavailable),
  };
}

export function removeCourseReference(data, studentId, courseId) {
  if (
    data.feedback.some(
      (f) => f.studentId === studentId && f.lessonId === courseId,
    )
  )
    throw Error("该课程已被课堂反馈引用，请先处理对应反馈");
  return {
    ...data,
    refs: data.refs.filter(
      (r) => r.studentId !== studentId || referenceCourseId(r) !== courseId,
    ),
    courseOrders: {
      ...data.courseOrders,
      [studentId]: (data.courseOrders?.[studentId] || []).filter(
        (key) => key !== courseId,
      ),
    },
  };
}
