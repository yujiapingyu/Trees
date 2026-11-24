import { id } from "./domain.js";
export const SCHOOL_STAGES = ["初中", "高中"];
export function schoolStageForGrade(grade = "") {
  return grade.startsWith("高中")
    ? "高中"
    : grade.startsWith("初中")
      ? "初中"
      : "";
}
export function schoolForStudent(student, data) {
  return (data.schools || []).find((s) => s.id === student?.schoolId);
}
export function schoolNameForStudent(student, data) {
  return schoolForStudent(student, data)?.name || "";
}
export function saveSchool(data, form) {
  const name = form.name.trim(),
    stage = form.stage;
  if (!name) throw Error("请输入学校名称");
  if (!SCHOOL_STAGES.includes(stage)) throw Error("学校学段只能为初中或高中");
  if (
    data.schools.some(
      (s) => s.id !== form.id && s.stage === stage && s.name === name,
    )
  )
    throw Error("该学段已存在同名学校");
  const existing = data.schools.find((s) => s.id === form.id);
  if (
    existing &&
    existing.stage !== stage &&
    (data.students.some((s) => s.schoolId === existing.id) ||
      (data.exams || []).some((e) => e.schoolIds.includes(existing.id)))
  )
    throw Error("已有学生或考试关联该学校，不能直接更改学段");
  const school = { ...existing, id: form.id || id(), name, stage };
  return {
    ...data,
    schools: existing
      ? data.schools.map((s) => (s.id === school.id ? school : s))
      : [...data.schools, school],
  };
}
export function deleteSchool(data, schoolId) {
  if (
    data.students.some((s) => s.schoolId === schoolId) ||
    (data.exams || []).some((e) => e.schoolIds.includes(schoolId))
  )
    throw Error("该学校仍有关联学生或考试，请先处理关联");
  return { ...data, schools: data.schools.filter((s) => s.id !== schoolId) };
}
export function validateStudentSchool(form, data) {
  if (!form.schoolId) return;
  const school = schoolForStudent(form, data);
  if (!school) throw Error("关联学校不存在，请重新选择");
  const gradeStage = schoolStageForGrade(form.grade);
  if (gradeStage && school.stage !== gradeStage)
    throw Error("学校学段与学生年级不一致，请重新选择学校");
}
