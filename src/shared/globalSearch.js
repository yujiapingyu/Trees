import { pinyin } from "pinyin-pro";

export const SEARCH_TYPES = [
  "学生",
  "授课",
  "反馈",
  "回访",
  "记录",
  "作业",
  "错题",
  "报告",
  "考试",
  "成绩",
  "讲义",
  "文件",
];
const text = (v) =>
  typeof v === "string" || typeof v === "number"
    ? String(v)
    : Array.isArray(v)
      ? v.map(text).join(" ")
      : v && typeof v === "object"
        ? Object.values(v).map(text).join(" ")
        : "";
const romanize = (value) => {
  const parts = pinyin(value.slice(0, 180), {
    toneType: "none",
    type: "array",
  });
  return [parts.join(""), parts.map((p) => p[0]).join("")]
    .join(" ")
    .toLowerCase();
};
export function buildSearchIndex(data, files = []) {
  const students = new Map((data.students || []).map((s) => [s.id, s]));
  const schools = new Map((data.schools || []).map((s) => [s.id, s.name]));
  const exams = new Map((data.exams || []).map((e) => [e.id, e]));
  const rows = [];
  const add = (kind, r, title, body, target, extra = "") => {
    const student = r.studentId && students.get(r.studentId);
    if (r.studentId && !student) return; // Archived students and orphan records stay out.
    const subtitle = [
      student?.name,
      student?.grade,
      schools.get(student?.schoolId),
      r.date || r.meta?.reportDate || r.createdAt?.slice(0, 10),
      extra,
    ]
      .filter(Boolean)
      .join(" · ");
    const heading = [title, subtitle].join(" ");
    rows.push({
      key: kind + ":" + r.id,
      kind,
      id: r.id,
      studentId: r.studentId,
      title: String(title || kind),
      subtitle,
      date: r.date || r.meta?.reportDate || r.createdAt?.slice(0, 10) || "",
      body: text(body).slice(0, 24000),
      heading: heading.toLowerCase(),
      roman: romanize(heading),
      target,
    });
  };
  const studentTarget = (r, tab) => ({
    route: "students",
    view: {
      selected: r.studentId,
      tab,
      course: "",
      query: "",
      grade: "",
      status: "all",
    },
    record: true,
  });
  for (const s of students.values())
    add(
      "学生",
      { ...s, studentId: s.id },
      s.name,
      [s.phone, s.notes, s.mathProgress],
      {
        route: "students",
        view: {
          selected: s.id,
          tab: "overview",
          course: "",
          query: "",
          grade: "",
          status: "all",
        },
      },
      s.status,
    );
  for (const r of data.sessions || [])
    add(
      "授课",
      r,
      r.topic || "授课记录",
      [r.scope, r.notes, r.nextProgress],
      studentTarget(r, "sessions"),
      r.status === "completed" ? "已授课" : "未完成",
    );
  for (const r of data.feedback || [])
    add(
      "反馈",
      r,
      "课堂反馈",
      [r.content, r.teacherNotes, r.scope],
      studentTarget(r, "feedback"),
    );
  for (const r of data.followups || [])
    add(
      "回访",
      r,
      r.purpose || "回访记录",
      [
        r.content,
        r.parentFeedback,
        r.habits,
        r.keyInfo,
        r.solution,
        r.solutionFeedback,
        r.plan,
        r.notes,
      ],
      {
        route: "followups",
        view: { selected: r.studentId, query: "", filter: "all" },
        record: true,
      },
    );
  for (const r of data.notes || [])
    add("记录", r, r.title || "学生记录", r.markdown || r.content, {
      route: "studentNotes",
      view: { selected: r.studentId, query: "", expanded: [r.id] },
      record: true,
    });
  for (const r of data.homework || [])
    add(
      "作业",
      r,
      r.title || r.name || "课后作业",
      [r.content, r.description, r.notes, r.status],
      studentTarget(r, "homework"),
    );
  for (const r of data.wrongQuestions || [])
    add(
      "错题",
      r,
      r.title || r.topic || "错题记录",
      [r.stem, r.explanation, r.analysis, r.reason, r.content, r.tags],
      studentTarget(r, "wrong"),
    );
  for (const r of data.reports || [])
    if (r.status !== "void")
      add(
        "报告",
        r,
        (/entry|入学/.test(r.type || r.name || r.path || "")
          ? "入学"
          : "阶段") + "学习力报告",
        [
          r.content,
          r.meta,
          r.goals,
          r.motivationChoices,
          r.observations,
          r.habitPlan,
          r.parentReceipt,
          r.teacherNotes,
          r.knowledge,
          r.habits,
          r.plan,
          r.comments,
          r.planningNotes,
        ],
        studentTarget(r, "reports"),
        r.status === "final" ? "已定稿" : "草稿",
      );
  for (const e of exams.values())
    add(
      "考试",
      e,
      e.name,
      [
        e.organizer,
        e.subjects?.map((s) => [
          s.name,
          (s.files || []).map((f) => [f.name, f.version]),
        ]),
        e.notes,
        (e.schoolIds || []).map((i) => schools.get(i)),
        (e.files || []).map((f) => [f.name, f.subject, f.version]),
      ],
      {
        route: "exams",
        view: {
          selected: e.id,
          stage: "",
          query: "",
          grade: "",
          school: "",
          archived: !!e.archived,
        },
      },
      e.grade,
    );
  for (const r of data.examRecords || [])
    add(
      "成绩",
      r,
      exams.get(r.examId)?.name || "考试成绩",
      [
        r.results?.map((v) => [
          exams.get(r.examId)?.subjects?.find((s) => s.id === v.subjectId)
            ?.name,
          v.status === "scored" ? v.score : v.status,
        ]),
        r.notes,
      ],
      studentTarget(r, "exams"),
    );
  for (const l of data.lessons || [])
    if (!l.missing)
      add(
        "讲义",
        l,
        l.name,
        [l.tags, l.collection, l.grade],
        {
          route: "lessonLibrary",
          view: {
            selected: l.id,
            stage: l.stage,
            query: "",
            grade: "",
            collection: "",
            tags: [],
          },
        },
        [l.stage, l.grade].filter(Boolean).join(" · "),
      );
  for (const f of files)
    add(
      "文件",
      { id: f.path },
      f.name,
      f.relativePath,
      { file: f.path },
      f.rootLabel,
    );
  return rows;
}
export function searchIndex(index, query, kind = "", limit = 80) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  if (!terms.length) return [];
  return index
    .filter((r) => !kind || r.kind === kind)
    .map((r) => {
      const body = r.body.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (r.title.toLowerCase() === term) score += 100;
        else if (r.heading.includes(term)) score += 30;
        else if (/^[a-z]+$/.test(term) && r.roman.includes(term))
          score += r.kind === "学生" ? 18 : 15;
        else if (body.includes(term)) score += 5;
        else return null;
      }
      return { ...r, score, snippet: searchSnippet(r.body, terms) };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.date.localeCompare(a.date) ||
        a.title.localeCompare(b.title, "zh-CN"),
    )
    .slice(0, limit);
}
export function searchSnippet(body, terms) {
  const lower = body.toLowerCase();
  const positions = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 35) : 0;
  return (
    (start ? "…" : "") +
    body.slice(start, start + 170).replace(/\s+/g, " ") +
    (body.length > start + 170 ? "…" : "")
  );
}
