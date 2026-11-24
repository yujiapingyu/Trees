import { today, GRADES } from "./domain.js";
import { CURRICULUM_OUTLINES } from "./mathCurriculum.js";
import { inferAutomaticProgress } from "./automaticCurriculum.js";

export const CURRICULUM_MODES = [
  "同步巩固",
  "查漏补缺",
  "适度预习",
  "阶段复习",
  "中高考复习",
];
export const CURRICULUM_SOURCES = [
  {
    title: "教育部：义务教育课程方案和课程标准（2022年版）",
    url: "https://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html",
  },
  {
    title: "高中数学课程标准（2017年版2020年修订，人教社发布）",
    url: "https://www.pep.com.cn/xw/zt/rjwy/gzkb2020/202205/P020220517519489596282.pdf",
  },
  {
    title: "浙江省教育厅：2023学年教学用书目录（版本背景，非当前进度）",
    url: "https://jyt.zj.gov.cn/module/download/downfile.jsp?classid=0&filename=0f7705da383c486c96fb7f519d8cf2e0.pdf",
  },
  {
    title: "人教社：高中数学A版配套资源",
    url: "https://www.pep.com.cn/jxzy/tbjl/xkl/gz/",
  },
];
export function academicTerm(date = today()) {
  const year = +date.slice(0, 4),
    month = +date.slice(5, 7);
  return {
    schoolYear: String(month >= 8 ? year : year - 1),
    semester: month >= 2 && month <= 7 ? "下学期" : "上学期",
  };
}
export function gradeStage(grade = "") {
  return /高中|高[一二三123]|十[一二]?年级/.test(grade)
    ? "高中"
    : /初中|初[一二三123]|[七八九789]年级/.test(grade)
      ? "初中"
      : "";
}
export function curriculumVolumes(grade) {
  const stage = gradeStage(grade);
  const rows = CURRICULUM_OUTLINES.filter((r) => r.stage === stage).map(
    ({ volume, outline }) => ({ volume, outline }),
  );
  // A missing new-edition volume is visible, but no unverified old-edition chapters are substituted.
  if (stage === "初中")
    rows.push({
      volume: "九年级下册",
      outline:
        "新版目录尚未内置，请以本地新版课本或学校实际安排核对；不使用旧版目录替代。",
    });
  return rows;
}
export function suggestedVolume(grade, semester) {
  if (gradeStage(grade) !== "初中") return "";
  const n = /一|七|7/.test(grade) ? "七" : /二|八|8/.test(grade) ? "八" : "九";
  return n + "年级" + (semester === "下学期" ? "下册" : "上册");
}
export function schoolScheduleKey(grade, term) {
  return [grade, term.schoolYear, term.semester].join(":");
}
export function validProgress(p, grade, term) {
  return (
    !!p &&
    p.grade === grade &&
    p.schoolYear === term.schoolYear &&
    p.semester === term.semester
  );
}
export function curriculumContext(student, data, date = today()) {
  const { chapters, evidence, ...automatic } = inferAutomaticProgress(
    student,
    data,
    date,
  );
  const term = academicTerm(date),
    stage = gradeStage(student?.grade);
  const school = (data.schools || []).find((s) => s.id === student?.schoolId);
  const storedPlan =
    school?.mathSchedules?.[schoolScheduleKey(student?.grade, term)];
  const schoolPlan =
    storedPlan &&
    school.stage === stage &&
    validProgress(storedPlan, student?.grade, term) &&
    (!storedPlan.confirmedDate || storedPlan.confirmedDate <= date)
      ? storedPlan
      : null;
  const individual =
    validProgress(student?.mathProgress, student?.grade, term) &&
    (!student.mathProgress.confirmedDate ||
      student.mathProgress.confirmedDate <= date)
      ? student.mathProgress
      : null;
  const schoolProgress =
    individual?.volume || individual?.chapter ? individual : schoolPlan || null;
  const actual = [...(data.sessions || [])]
    .filter(
      (s) =>
        s.studentId === student?.id &&
        s.status === "completed" &&
        s.date <= date,
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    )[0];
  return {
    region: "浙江",
    ...term,
    grade: student?.grade || "未设置",
    school: school?.name || "未关联学校",
    edition:
      stage === "初中"
        ? "浙教版初中数学（依据2022课标修订的新版）"
        : stage === "高中"
          ? "人教A版高中数学（2017课标2020修订）"
          : "教材待确认",
    schoolProgress: schoolProgress
      ? {
          ...schoolProgress,
          source:
            individual?.volume || individual?.chapter
              ? "教师为当前学生确认的学校进度"
              : "本校同年级同学期共用进度",
        }
      : null,
    mode: individual?.mode || schoolPlan?.mode || "同步巩固",
    notes: individual?.notes || schoolPlan?.notes || "",
    tutoringProgress: actual
      ? {
          date: actual.date,
          topic: actual.topic,
          scope: actual.scope,
          nextProgress: actual.nextProgress,
        }
      : null,
    suggestedVolume: suggestedVolume(student?.grade, term.semester),
    automaticProgress: { ...automatic, evidence: evidence.slice(0, 6) },
    staleStudentProgress: !!student?.mathProgress && !individual,
    rules:
      "默认使用automaticProgress自动判断教材、教学起点和后续衔接，并结合现有课堂资料主动生成15节课。学校进度是可选的特殊情况修正，禁止把设置学校、册次、章节或辅导方向作为生成前提。学校进度与辅导实际起点分开表达。先补必要基础再衔接后续章节；按教材先修顺序，不跨版本、不倒退重教。无课堂资料时按年级学期给建议起点并做诊断，不伪称已掌握或已学过，也不把日期推测冒充学校实际进度。",
  };
}
export function saveStudentProgress(data, studentId, form) {
  const student = data.students.find((s) => s.id === studentId);
  if (!student) throw Error("学生不存在");
  const value = validateProgress(form, student.grade);
  return {
    ...data,
    students: data.students.map((s) =>
      s.id === studentId ? { ...s, mathProgress: value } : s,
    ),
  };
}
export function validateProgress(form, grade) {
  if (!gradeStage(grade)) throw Error("请先设置初中或高中年级");
  if (
    !/^20\d{2}$/.test(form.schoolYear) ||
    !["上学期", "下学期"].includes(form.semester)
  )
    throw Error("请选择有效学年与学期");
  if (
    form.volume &&
    !curriculumVolumes(grade).some((v) => v.volume === form.volume)
  )
    throw Error("教材册次与学段不一致");
  if (!CURRICULUM_MODES.includes(form.mode)) throw Error("请选择辅导方向");
  for (const key of ["chapter", "notes"])
    if (typeof form[key] !== "string" || form[key].length > 4000)
      throw Error("进度文字过长或无效");
  return {
    grade,
    schoolYear: form.schoolYear,
    semester: form.semester,
    volume: form.volume || "",
    chapter: form.chapter.trim(),
    mode: form.mode,
    notes: form.notes.trim(),
    confirmedDate: today(),
  };
}
export function saveSchoolProgress(data, schoolId, grade, form) {
  if (!GRADES.includes(grade)) throw Error("请选择学校下的具体年级");
  const school = data.schools.find((s) => s.id === schoolId);
  if (!school || school.stage !== gradeStage(grade))
    throw Error("学校与年级学段不一致");
  const value = validateProgress(form, grade),
    key = schoolScheduleKey(grade, value);
  return {
    ...data,
    schools: data.schools.map((s) =>
      s.id === schoolId
        ? { ...s, mathSchedules: { ...s.mathSchedules, [key]: value } }
        : s,
    ),
  };
}
