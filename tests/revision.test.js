import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_DATA,
  studentMatches,
  safeStudentContext,
} from "../src/shared/domain.js";
import {
  saveSchool,
  deleteSchool,
  validateStudentSchool,
  schoolNameForStudent,
} from "../src/shared/schools.js";
import { addLessonReference } from "../src/shared/lessonReferences.js";
import {
  feedbackPrompt,
  formatFeedback,
  feedbackDate,
  validateFeedback,
} from "../src/shared/feedback.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { sanitizeConfig } = require("../desktop/core.cjs");
const sample = {
  theme: "二项分布、超几何分布与正态分布",
  contentPoints: [
    {
      topic: "二项分布",
      details: ["独立重复试验的条件", "二项概率公式与参数含义"],
    },
    { topic: "超几何分布", details: ["不放回抽样与概率计算"] },
  ],
  strengths: ["本节课整体学习情况较好。", "建议继续保持对本节知识的学习投入。"],
  weaknesses: [
    "二项分布部分需要加强。",
    "建议重点巩固二项分布与超几何分布的适用条件。",
  ],
  afterClass: ["建议复习二项分布公式并安排针对练习。"],
};
test("自定义初高中学校、学段内重名校验和学生关联保护", () => {
  let d = structuredClone(EMPTY_DATA);
  d = saveSchool(d, { name: "实验中学", stage: "初中" });
  d = saveSchool(d, { name: "实验中学", stage: "高中" });
  assert.equal(d.schools.length, 2);
  assert.throws(
    () => saveSchool(d, { name: "实验中学", stage: "初中" }),
    /同名/,
  );
  const school = d.schools[0];
  d.students.push({
    id: "s",
    name: "学生",
    grade: "初中一年级",
    schoolId: school.id,
  });
  validateStudentSchool(d.students[0], d);
  assert.throws(
    () => validateStudentSchool({ ...d.students[0], grade: "高中一年级" }, d),
    /不一致/,
  );
  assert.throws(() => deleteSchool(d, school.id), /关联学生/);
  d = saveSchool(d, { ...school, name: "新实验中学" });
  assert.equal(schoolNameForStudent(d.students[0], d), "新实验中学");
  assert.equal(studentMatches(d.students[0], "新实验", d.schools), true);
  assert.equal(
    safeStudentContext(d.students[0], d).student.school,
    "新实验中学",
  );
});
test("新引用始终置顶，已有拖拽顺序和原引用仍保留", () => {
  let d = structuredClone(EMPTY_DATA);
  d.courseOrders = { s: ["manual-course"] };
  d = addLessonReference(d, "s", "a");
  d = addLessonReference(d, "s", "b");
  assert.deepEqual(d.courseOrders.s, ["b", "a", "manual-course"]);
  assert.deepEqual(
    d.refs.map((r) => r.lessonId),
    ["b", "a"],
  );
  assert.throws(() => addLessonReference(d, "s", "b"), /重复/);
  assert.equal(d.refs[0].studentId, "s");
});
test("家长反馈固定日期、分点正文、优缺点各2至3条且只使用当前学生", () => {
  const student = { name: "测试学生", grade: "高中二年级" };
  const prompt = feedbackPrompt({
    student,
    date: "2026-11-19",
    notes: "整体学得不错，二项分布需要加强",
    lesson: { name: "概率分布" },
    documents: [
      { name: "教案.docx", text: "二项分布概率公式、超几何分布不放回抽样" },
    ],
    school: "实验高中",
  });
  assert.match(prompt, /二项分布概率公式/);
  assert.match(prompt, /2026年11月19日/);
  assert.match(prompt, /2–3 条/);
  const text = formatFeedback(sample, { student, date: "2026-11-19" });
  assert.match(text, /【上课时间】\n2026年11月19日/);
  assert.ok(!text.includes("待补充"));
  assert.ok(!text.includes("\\"));
  assert.match(text, /1、二项分布/);
  assert.throws(
    () => validateFeedback({ ...sample, strengths: ["仅一条"] }),
    /2–3/,
  );
  assert.throws(() => feedbackDate("2026-02-30"), /无效/);
  assert.throws(
    () =>
      feedbackPrompt({
        student,
        date: "2026-11-19",
        notes: "表现好",
        lesson: null,
        documents: [],
      }),
    /讲义/,
  );
});
test("配置白名单保留有效文本服务与文档路径，移除退役凭据和工具", () => {
  const cleaned = sanitizeConfig({
    deepseekKey: "keep",
    deepseekModel: "deepseek-chat",
    studentsRoot: "/students",
    libreofficePath: "/office",
    qwenKey: "remove",
    deepseekVisionHost: "remove",
    whisperPath: "/remove",
    classAudioRoot: "/remove",
  });
  assert.deepEqual(cleaned, {
    studentsRoot: "/students",
    libreofficePath: "/office",
    deepseekKey: "keep",
    deepseekModel: "deepseek-chat",
  });
});
