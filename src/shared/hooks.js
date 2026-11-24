import { useEffect, useState } from "react";
import { useApp, useView } from "./store";
import { services, basename } from "./services";
import { SPECIAL_DIRS, id } from "./domain";
import { isWithinRoot, studentDirectoryState } from "./paths";
import { examReferenceCourse } from "./examReferences";
export function useFiles(path, recursive = false) {
  const [files, setFiles] = useState([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [tick, setTick] = useState(0),
    [finishedRead, setFinishedRead] = useState("");
  const readKey = JSON.stringify([path || "", recursive, tick]);
  useEffect(() => {
    let live = true;
    setFiles([]);
    setError("");
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    services
      .list(path, recursive)
      .then((v) => live && setFiles(v))
      .catch((e) => live && setError(e.message))
      .finally(() => {
        if (live) {
          setLoading(false);
          setFinishedRead(readKey);
        }
      });
    return () => {
      live = false;
    };
  }, [path, recursive, tick]);
  return {
    files,
    error,
    loading: !!path && (loading || finishedRead !== readKey),
    refresh: () => setTick((v) => v + 1),
  };
}
export function useCourses(student) {
  const { data, config } = useApp();
  const directoryState = studentDirectoryState(student, config.studentsRoot);
  const result = useFiles(
    student && directoryState === "available"
      ? student.directoryPath
      : undefined,
  );
  const refs = data.refs
    .filter((r) => r.studentId === student?.id)
    .map((r) => {
      if (r.type === "exam")
        return examReferenceCourse(data, r, config.examsRoot);
      const lesson = data.lessons.find((l) => l.id === r.lessonId);
      return lesson
        ? {
            ...lesson,
            isRef: true,
            missing:
              lesson.missing || !isWithinRoot(lesson.path, config.lessonsRoot),
          }
        : { id: r.lessonId, name: "讲义来源缺失", missing: true, isRef: true };
    });
  const direct = result.files
    .filter((f) => f.isDirectory && !SPECIAL_DIRS.includes(f.name))
    .map((f) => ({ ...f, id: f.path }));
  const order = data.courseOrders?.[student?.id] || [];
  return {
    ...result,
    directoryState,
    courses: [...direct, ...refs].sort((a, b) => {
      const ai = order.indexOf(a.id),
        bi = order.indexOf(b.id);
      return (ai < 0 ? 1e6 : ai) - (bi < 0 ? 1e6 : bi);
    }),
  };
}
export function useLessonIndex() {
  const { config, data, mutate } = useApp();
  const { files, error, loading, refresh } = useFiles(config.lessonsRoot, true);
  useEffect(() => {
    if (!config.lessonsRoot || loading || error) return;
    const directories = files.filter(
      (f) =>
        f.isDirectory &&
        files.some(
          (child) =>
            !child.isDirectory &&
            child.path.startsWith(f.path + "/") &&
            !child.path.slice(f.path.length + 1).includes("/"),
        ),
    );
    mutate((d) => {
      const outside = d.lessons.filter(
        (l) => !l.path?.startsWith(config.lessonsRoot + "/"),
      );
      const lessons = directories.map((f) => {
        const old = d.lessons.find((l) => l.path === f.path);
        const bits = f.relativePath.split("/");
        return {
          ...f,
          id: old?.id || id(),
          stage: bits[0] || "",
          grade: bits.length > 2 ? bits[1] : "",
          collection: bits.slice(2, -1).join("/"),
          tags: [],
          order: 0,
          ...old,
          missing: false,
        };
      });
      const missing = d.lessons
        .filter(
          (l) =>
            l.path?.startsWith(config.lessonsRoot + "/") &&
            !directories.some((f) => f.path === l.path),
        )
        .map((l) => ({ ...l, missing: true }));
      return { ...d, lessons: [...outside, ...lessons, ...missing] };
    }).catch(() => {});
  }, [files, loading, error, config.lessonsRoot]);
  return {
    lessons: data.lessons.filter(
      (l) =>
        !config.lessonsRoot || l.path?.startsWith(config.lessonsRoot + "/"),
    ),
    error,
    loading,
    refresh,
  };
}
