import { curriculumContext } from "./zhejiangCurriculum";
import { services } from "./services";
import {
  extractDocumentText,
  extractTextbookOutline,
  readLessonDocuments,
} from "./documents";
import { mathTextbook, selectTextbooks } from "./learningPlan";
import { fallbackCurriculum, fallbackTextbook } from "./mathCurriculum";
export async function enrichPlanningSnapshot(
  snapshot,
  draft,
  data,
  courses,
  config,
  check = () => {},
) {
  const student = data.students.find((s) => s.id === draft.studentId) || {
    id: draft.studentId,
    grade: draft.meta.grade,
  };
  // Only attachments belonging to this student's selected classroom records.
  const selected = new Set(draft.sourceIds || []);
  const evidenceIds = new Set([
    ...selected,
    ...(snapshot.backgroundRecords || []).map((r) => r.id),
  ]);
  const inferenceData = {
    ...data,
    ...Object.fromEntries(
      [
        ["sessions", "授课记录"],
        ["feedback", "课堂反馈"],
        ["notes", "学生记录"],
        ["examRecords", "考试"],
      ].map(([key, kind]) => [
        key,
        (data[key] || []).filter(
          (r) =>
            r.studentId === student.id && evidenceIds.has(kind + ":" + r.id),
        ),
      ]),
    ),
  };
  snapshot.regionalCurriculum = curriculumContext(
    { ...student, grade: draft.meta.grade },
    inferenceData,
    draft.meta.periodEnd,
  );
  const attachments = data.feedback
    .filter(
      (f) => f.studentId === student.id && selected.has("课堂反馈:" + f.id),
    )
    .flatMap((f) => f.sourceFiles || []);
  const files = [
    ...new Map(
      attachments
        .filter((f) => /\.(docx?|pdf|txt|md)$/i.test(f.path || ""))
        .map((f) => [f.path, f]),
    ).values(),
  ].slice(0, 6);
  const materials = await Promise.allSettled(
    files.map(async (f) => ({
      name: f.name,
      text: String(await extractDocumentText(f.path)).slice(0, 6000),
    })),
  );
  check();
  snapshot.materials = materials
    .filter((v) => v.status === "fulfilled")
    .map((v) => v.value);
  snapshot.materialWarnings = materials.flatMap((v, i) =>
    v.status === "rejected"
      ? [files[i].name + "正文未读取，使用已有课堂记录"]
      : [],
  );
  // Course text informs knowledge and future plans; it cannot prove attendance.
  const linked = new Set(
    data.feedback
      .filter(
        (f) => f.studentId === student.id && selected.has("课堂反馈:" + f.id),
      )
      .map((f) => f.lessonId),
  );
  for (const session of (data.sessions || []).filter(
    (r) => r.studentId === student.id && selected.has("授课记录:" + r.id),
  ))
    if (session.courseId) linked.add(session.courseId);
  const courseSources = courses
    .filter((c) => !c.missing && (linked.has(c.id) || !linked.size))
    .slice(0, 3);
  const courseText = await Promise.allSettled(
    courseSources.map(async (c) => ({
      name: c.name,
      documents: (await readLessonDocuments(c)).map((f) => ({
        name: f.name,
        text: f.text.slice(0, 6000),
      })),
      note: "讲义/试卷正文仅供知识与方案参考，是否已教以课堂记录为准",
    })),
  );
  check();
  snapshot.courseMaterials = courseText
    .filter((v) => v.status === "fulfilled")
    .map((v) => v.value);
  snapshot.materialWarnings.push(
    ...courseText.flatMap((v, i) =>
      v.status === "rejected"
        ? [courseSources[i].name + "正文未读取，使用已有记录"]
        : [],
    ),
  );
  return enrichTextbookContext(snapshot, draft.meta.grade, config, check);
}

export async function enrichTextbookContext(
  snapshot,
  grade,
  config,
  check = () => {},
) {
  const textbook = mathTextbook(grade);
  snapshot.textbooks = [];
  snapshot.textbookWarnings = [];
  if (textbook.configKey && config[textbook.configKey]) {
    try {
      const books = selectTextbooks(
        await services.list(config[textbook.configKey], true),
        grade,
      );
      for (const book of books) {
        check();
        try {
          const source = await extractTextbookOutline(book),
            fallback = fallbackTextbook(book.name, textbook.stage);
          if (source.outline) snapshot.textbooks.push(source);
          else if (fallback)
            snapshot.textbooks.push({
              name: book.name,
              outline: fallback.outline,
              source: source.source.includes("大体积")
                ? "内置核对目录（大体积教材）"
                : "内置核对目录（本地PDF无文字目录）",
            });
          else
            snapshot.textbookWarnings.push(
              book.name + "无可读取目录，未据此推断章节",
            );
        } catch {
          snapshot.textbookWarnings.push(book.name + "目录未读取");
        }
      }
    } catch {
      snapshot.textbookWarnings.push("课本目录暂不可用，使用内置核对目录");
    }
  }
  if (!snapshot.textbooks.length) {
    snapshot.textbooks = fallbackCurriculum(textbook.stage);
    snapshot.textbookWarnings.push(
      "未提取到本地新版目录，内置摘要仅供建议编排，不代表新版页码或学校进度已核实",
    );
  }
  if (
    textbook.stage === "初中" &&
    !snapshot.textbooks.some((b) => /9下|九年级下|初三下/.test(b.name || ""))
  )
    snapshot.textbookWarnings.push(
      "未读取到九年级下册新版目录，不得用旧版目录冒充新版；涉及该册应标注待核对",
    );
  check();

  return snapshot;
}
