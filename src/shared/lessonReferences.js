import { id, uniqueRef } from "./domain.js";
export function addLessonReference(data, studentId, lessonId) {
  uniqueRef(
    data.refs.filter((r) => r.studentId === studentId),
    lessonId,
  );
  const reference = {
    id: id(),
    studentId,
    lessonId,
    createdAt: new Date().toISOString(),
  };
  return {
    ...data,
    refs: [reference, ...data.refs],
    courseOrders: {
      ...data.courseOrders,
      [studentId]: [
        lessonId,
        ...(data.courseOrders?.[studentId] || []).filter(
          (key) => key !== lessonId,
        ),
      ],
    },
  };
}
