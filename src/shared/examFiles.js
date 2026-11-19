import { id } from "./domain.js";
export function appendExamFiles(data, examId, subjectId, files) {
  const exam = data.exams.find((e) => e.id === examId);
  if (!exam || exam.archived || !exam.subjects.some((s) => s.id === subjectId))
    throw Error("考试或学科已变更，文件副本已保留，请刷新后重试");
  if (
    files.some(
      (f) =>
        !["paper", "answer"].includes(f.kind) ||
        (f.schoolId && !exam.schoolIds.includes(f.schoolId)),
    )
  )
    throw Error("文件适用学校或类型已变更，请重新选择");
  return {
    ...data,
    exams: data.exams.map((e) =>
      e.id === examId
        ? {
            ...e,
            subjects: e.subjects.map((s) =>
              s.id === subjectId
                ? {
                    ...s,
                    files: [
                      ...(s.files || []),
                      ...files.filter(
                        (f) => !(s.files || []).some((old) => old.id === f.id),
                      ),
                    ],
                  }
                : s,
            ),
          }
        : e,
    ),
  };
}
export async function copyExamFiles({
  root,
  examId,
  subjectId,
  schoolId = "",
  version,
  papers = [],
  answers = [],
  copy,
  cache = new Map(),
  onProgress = () => {},
}) {
  if (!root) throw Error("请先在配置中心设置考试资料根目录");
  if (!version.trim()) throw Error("请填写卷别");
  const selected = [...new Set(papers)]
    .map((source) => ({ source, kind: "paper" }))
    .concat(
      [...new Set(answers)].map((source) => ({ source, kind: "answer" })),
    );
  if (!selected.length) throw Error("请至少选择一份试卷或答案文件");
  const files = [];
  for (const [index, item] of selected.entries()) {
    const key = JSON.stringify([
      root,
      examId,
      subjectId,
      schoolId,
      version.trim(),
      item.kind,
      item.source,
    ]);
    onProgress(index + 1, selected.length);
    let file = cache.get(key);
    if (!file) {
      const fileId = id(),
        name = item.source.split(/[\\/]/).at(-1),
        path =
          root.replace(/[\\/]+$/, "") +
          "/" +
          [examId, subjectId, item.kind, fileId + "_" + name].join("/");
      try {
        await copy(item.source, path);
      } catch (error) {
        throw Error(
          `文件“${name}”保存失败：${error.message}。已选文件保留，可重试；已成功复制的文件不会重复复制。`,
        );
      }
      file = {
        id: fileId,
        name,
        path,
        kind: item.kind,
        schoolId,
        version: version.trim(),
        addedAt: new Date().toISOString(),
      };
      cache.set(key, file);
    }
    files.push(file);
  }
  return files;
}
