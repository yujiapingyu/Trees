import test from "node:test";
import assert from "node:assert/strict";
import {
  mathTextbook,
  selectTextbooks,
  coursePlanRules,
  validateCoursePlan,
} from "../src/shared/learningPlan.js";
import { fallbackTextbook } from "../src/shared/mathCurriculum.js";
const report = {
  meta: { grade: "高中一年级" },
  currentProgressOverride: "学校已学到函数单调性，下一节开始奇偶性",
};
const value = () => ({
  curriculum: {
    edition: "错误版本",
    volume: "必修第一册",
    currentTopic: "函数单调性",
    progressEvidence: "最新课堂记录",
    mode: "同步推进",
  },
  plan: Array.from({ length: 15 }, (_, i) => ({
    topic: `具体任务${i + 1}`,
    objectives: "独立解释方法并完成练习",
    keyPoints: "重点条件，难点推理",
    hours: "2",
  })),
  planningNotes: "从函数性质向幂函数与指数函数衔接。",
});
test("高中固定人教A，初中固定浙教新版，教材候选排除旧版与其他版本", () => {
  for (const grade of ["高一", "高中二年级", "高三"])
    assert.equal(mathTextbook(grade).edition, "人教A版高中数学");
  for (const grade of ["初中一年级", "八年级", "初三"])
    assert.equal(mathTextbook(grade).edition, "浙教版初中数学（新版）");
  const files = [
    "8上-浙教版（新版）.pdf",
    "8上-浙教版（旧版）.pdf",
    "人教B版.pdf",
  ].map((name) => ({ name, path: "/" + name }));
  assert.equal(selectTextbooks(files, "八年级").length, 1);
  assert.equal(
    fallbackTextbook("选择性必修第一册.pdf", "高中").volume,
    "选择性必修第一册",
  );
  assert.match(
    fallbackTextbook("8下-浙教版（新版）.pdf", "初中").outline,
    /四分位数与箱线图/,
  );
});
test("15节是15次授课，不按钟点时长合并，进度优先教师与最新记录", () => {
  const p = validateCoursePlan(value(), report);
  assert.equal(p.plan.length, 15);
  assert.ok(p.plan.every((r) => r.hours === "1"));
  assert.equal(p.curriculum.edition, "人教A版高中数学");
  const rules = coursePlanRules(report, { textbooks: [] });
  assert.match(rules, /接下来15节课/);
  assert.match(rules, /最近日期/);
  assert.match(rules, /函数单调性/);
  assert.match(rules, /不能因为学生是高一就自动从集合重教/);
  const junior = validateCoursePlan(value(), { meta: { grade: "初中二年级" } });
  assert.equal(junior.curriculum.edition, "浙教版初中数学（新版）");
});
test("拦截不足15节、超出15节、重复主题和缺少进度依据的AI方案", () => {
  for (const count of [0, 6, 14, 16]) {
    const v = value();
    v.plan = Array.from({ length: count }, () => v.plan[0]);
    assert.throws(() => validateCoursePlan(v, report), /15节课/);
  }
  const duplicate = value();
  duplicate.plan = duplicate.plan.map((r, i) => ({
    ...r,
    topic: `第${i + 1}节 函数练习`,
  }));
  assert.throws(() => validateCoursePlan(duplicate, report), /重复/);
  const missing = value();
  delete missing.curriculum.progressEvidence;
  assert.throws(() => validateCoursePlan(missing, report), /进度/);
});
