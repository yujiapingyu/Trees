import { today } from "./domain.js";
import { inferAutomaticProgress } from "./automaticCurriculum.js";
import { mathTextbook } from "./learningPlan.js";
import { isWithinRoot } from "./paths.js";
import { examReferenceCourse } from "./examReferences.js";

export function sessionCourse(session, student, data, config) {
  if (!session.courseId) return null;
  const ref = data.refs.find(
    (r) =>
      r.studentId === student.id &&
      r.type === "exam" &&
      "exam:" + r.id === session.courseId,
  );
  if (ref) return examReferenceCourse(data, ref, config.examsRoot);
  const lesson = data.lessons.find((l) => l.id === session.courseId);
  if (
    lesson &&
    !lesson.missing &&
    isWithinRoot(lesson.path, config.lessonsRoot)
  )
    return lesson;
  if (
    isWithinRoot(session.courseId, student.directoryPath) &&
    isWithinRoot(student.directoryPath, config.studentsRoot)
  )
    return {
      id: session.courseId,
      path: session.courseId,
      name: session.courseId.split("/").at(-1),
    };
  return null;
}
const gradeNumber = (grade) =>
  /一|七|7/.test(grade)
    ? 1
    : /二|八|8/.test(grade)
      ? 2
      : /三|九|9/.test(grade)
        ? 3
        : 0;
export function preparationCard(
  student,
  data,
  courses = [],
  config = {},
  date = today(),
) {
  const recent = [...(data.sessions || [])]
    .filter(
      (s) =>
        s.studentId === student.id &&
        s.status === "completed" &&
        s.date <= date,
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        String(b.createdAt || "").localeCompare(a.createdAt || ""),
    );
  const last = recent[0],
    progress = inferAutomaticProgress(student, data, date);
  const homework = (data.homework || [])
    .filter((h) => h.studentId === student.id && !h.completed)
    .sort((a, b) => String(a.dueDate || "").localeCompare(b.dueDate || ""));
  const weaknesses = [
    ...(last?.closeout?.extraction?.weaknesses || []).map((w) => ({
      text: w.text,
      source: last.date + "课堂记录",
      quote: w.quote,
    })),
    ...(data.wrongQuestions || [])
      .filter((w) => w.studentId === student.id)
      .slice(-3)
      .reverse()
      .map((w) => ({
        text: (w.tags || []).join("、") || String(w.stem || "").slice(0, 100),
        source: "已保存错题",
        quote: "",
      })),
  ]
    .filter((w) => w.text)
    .slice(0, 4);
  const target = last?.nextProgress || progress.nextTopic;
  const keywords = [
    ...new Set(
      (target + " " + (last?.topic || "")).match(
        /[\u4e00-\u9fff]{2,}|[a-z]+/gi,
      ) || [],
    ),
  ]
    .flatMap((s) =>
      s.length <= 3
        ? [s]
        : Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)),
    )
    .filter(
      (t) =>
        !["下次", "继续", "本次", "学生", "数学", "讲解", "学习"].includes(t),
    );
  const stage = mathTextbook(progress.grade || student.grade).stage;
  const candidates = [
    ...courses.filter((c) => !c.missing).map((c) => ({ ...c, linked: true })),
    ...data.lessons.filter(
      (l) => !l.missing && isWithinRoot(l.path, config.lessonsRoot),
    ),
    ...(data.exams || [])
      .filter(
        (e) =>
          mathTextbook(e.grade).stage === stage &&
          e.subjects?.some((s) => s.files?.some((f) => f.kind === "paper")),
      )
      .map((e) => ({
        id: "prepExam:" + e.id,
        name: e.name,
        examId: e.id,
        isExam: true,
        grade: e.grade,
        archived: e.archived,
      })),
  ];
  const resources = [
    ...new Map([...candidates].reverse().map((c) => [c.id, c])).values(),
  ]
    .filter((c) => c.isExam || !c.stage || c.stage === stage)
    .map((c) => {
      const text = c.name + " " + (c.tags || []).join(" ");
      const relevance = keywords.reduce(
        (n, k) => n + (text.includes(k) ? k.length : 0),
        0,
      );
      return {
        ...c,
        relevance,
        score:
          relevance * 5 +
          (c.linked ? 2 : 0) +
          (gradeNumber(c.grade || "") ===
          gradeNumber(progress.grade || student.grade || "")
            ? 1
            : 0),
        target: c.isExam
          ? {
              route: "exams",
              view: {
                selected: c.examId,
                stage: "",
                query: "",
                grade: "",
                school: "",
                archived: !!c.archived,
              },
            }
          : data.lessons.some((l) => l.id === c.id)
            ? {
                route: "lessonLibrary",
                view: {
                  selected: c.id,
                  stage: c.stage,
                  query: "",
                  grade: "",
                  collection: "",
                  tags: [],
                },
              }
            : { file: c.path },
      };
    })
    .filter((c) => c.relevance > 0 || c.linked)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return {
    last,
    target,
    homework: homework.slice(0, 4),
    homeworkCount: homework.length,
    weaknesses,
    resources,
    nextSuggestions: last?.closeout?.extraction?.nextSuggestions || [],
    review: last
      ? `先用1—2道题回查“${last.topic}”的掌握情况，再衔接“${target}”。`
      : `先围绕“${target}”做基础诊断，再根据实际表现调整难度。`,
    rawEvidence: last?.notes || "",
  };
}
