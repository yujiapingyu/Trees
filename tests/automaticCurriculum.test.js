import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_DATA } from "../src/shared/domain.js";
import {
  inferAutomaticProgress,
  localAutomaticPlan,
  automaticSourceKey,
} from "../src/shared/automaticCurriculum.js";
import { curriculumContext } from "../src/shared/zhejiangCurriculum.js";

const student = { id: "s", name: "自动规划学生", grade: "高中一年级" };
function data() {
  return {
    ...structuredClone(EMPTY_DATA),
    students: [student],
    sessions: [
      {
        id: "c",
        studentId: "s",
        date: "2026-11-22",
        status: "completed",
        topic: "对数运算",
        scope: "真数条件和换底公式",
        nextProgress: "对数函数",
      },
    ],
  };
}
test("零设置从最近授课接课，匹配人教A版且不回退到指数和集合", () => {
  const d = data(),
    p = inferAutomaticProgress(student, d, "2026-11-23"),
    plan = localAutomaticPlan(p);
  assert.equal(p.edition, "人教A版高中数学");
  assert.equal(p.nextTopic, "对数函数");
  assert.equal(plan.plan.length, 15);
  assert.match(plan.plan[0].topic, /对数函数/);
  assert.ok(!plan.plan.some((r) => /指数函数：|集合/.test(r.topic)));
  assert.ok(!JSON.stringify(p).includes("先设置"));
  assert.equal(
    curriculumContext(student, d, "2026-11-23").automaticProgress.nextTopic,
    "对数函数",
  );
});
test("保存较新的授课或文字中的下次安排后自动改变起点，排除未来、缺课和其他学生", () => {
  const d = data();
  d.sessions.push(
    {
      id: "new",
      studentId: "s",
      date: "2026-11-23",
      status: "completed",
      topic: "三角函数",
      nextProgress: "诱导公式",
    },
    {
      id: "future",
      studentId: "s",
      date: "2026-12-01",
      status: "completed",
      topic: "圆锥曲线",
    },
    {
      id: "absent",
      studentId: "s",
      date: "2026-11-23",
      status: "absent",
      topic: "导数",
    },
    {
      id: "other",
      studentId: "other",
      date: "2026-11-23",
      status: "completed",
      topic: "概率",
    },
  );
  assert.equal(
    inferAutomaticProgress(student, d, "2026-11-23").nextTopic,
    "诱导公式",
  );
  d.notes.push({
    id: "n",
    studentId: "s",
    date: "2026-11-24",
    title: "课后观察",
    markdown: "本次完成三角函数；下节课继续三角恒等变换。",
  });
  assert.equal(
    inferAutomaticProgress(student, d, "2026-11-24").nextTopic,
    "三角恒等变换",
  );
});
test("没有课堂记录仍自动匹配浙教版与学期，生成15节建议；空年级也不阻塞", () => {
  const junior = { ...student, grade: "初中二年级" },
    d = { ...structuredClone(EMPTY_DATA), students: [junior] };
  const p = inferAutomaticProgress(junior, d, "2026-11-23"),
    plan = localAutomaticPlan(p);
  assert.equal(p.edition, "浙教版初中数学（新版）");
  assert.equal(p.volume, "八年级上册");
  assert.equal(p.mode, "建议起点待确认");
  assert.equal(plan.plan.length, 15);
  assert.equal(
    localAutomaticPlan(
      inferAutomaticProgress({ ...student, grade: "" }, d, "2026-11-23"),
    ).plan.length,
    15,
  );
});
test("进度缓存随本人记录变化而失效，AI输出、其他学生和凭据不会导致循环重算", () => {
  const d = data(),
    config = { deepseekKey: "secret-a" },
    key = automaticSourceKey(student, d, config, [], "2026-11-23");
  d.analysis["s:自动教学规划"] = {
    planData: localAutomaticPlan(
      inferAutomaticProgress(student, d, "2026-11-23"),
    ),
  };
  d.notes.push({
    id: "other",
    studentId: "other",
    date: "2026-11-23",
    markdown: "其他学生独有内容",
  });
  assert.equal(
    automaticSourceKey(
      student,
      d,
      { deepseekKey: "secret-b" },
      [],
      "2026-11-23",
    ),
    key,
  );
  d.notes.push({
    id: "self",
    studentId: "s",
    date: "2026-11-23",
    markdown: "本人的新观察",
  });
  assert.notEqual(
    automaticSourceKey(student, d, config, [], "2026-11-23"),
    key,
  );
});
