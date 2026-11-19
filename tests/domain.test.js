import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  followupState,
  validateName,
  validateBlank,
  validateQuestions,
  studentMatches,
  safeStudentContext,
  EMPTY_DATA,
  removeRef,
  uniqueRef,
  timeFilter,
} from "../src/shared/domain.js";
test("14 天回访提醒跨年、逾期、临近、停课规则", () => {
  assert.equal(addDays("2026-12-25", 14), "2027-01-08");
  assert.equal(followupState([], "2026-11-17").label, "从未回访");
  assert.equal(
    followupState([{ date: "2026-11-01" }], "2026-11-17").label,
    "已逾期",
  );
  assert.equal(
    followupState([{ date: "2026-11-05" }], "2026-11-17").label,
    "即将联系",
  );
  assert.equal(
    followupState([{ date: "2026-11-16" }], "2026-11-17").label,
    "已安排",
  );
  assert.equal(followupState([], "2026-11-17", true).due, false);
});
test("搜索涵盖拼音、首字母、电话与备注", () => {
  const s = {
    name: "张三",
    grade: "初中一年级",
    phone: "13800138000",
    notes: "几何需要练习",
  };
  for (const q of ["zhangsan", "zs", "1380", "几何"])
    assert.equal(studentMatches(s, q), true);
  assert.equal(studentMatches(s, "李四"), false);
});
test("名称唯一且阻止路径注入", () => {
  for (const n of ["", "../张三", "a/b", ".隐藏", "张:三"])
    assert.throws(() => validateName(n));
  assert.throws(() => validateName("张三", [{ id: "1", name: "张三" }]));
  assert.equal(
    validateName(" 张三 ", [{ id: "1", name: "张三" }], "1"),
    "张三",
  );
});
test("空白系数、难度与题干校验", () => {
  validateBlank(0.1, 0.5);
  validateBlank(1.5, 1);
  for (const args of [
    [0.09, 0.8],
    [1.6, 0.8],
    [0.7, 1.1],
    ["abc", 0.7],
  ])
    assert.throws(() => validateBlank(...args));
  assert.throws(() =>
    validateQuestions([{ stem: "题目", difficulty: "困难" }]),
  );
  assert.throws(() => validateQuestions([{ stem: "" }]));
  assert.equal(validateQuestions([{ stem: "求 x" }])[0].difficulty, "中等");
});
test("学生 AI 上下文严格隔离", () => {
  const d = structuredClone(EMPTY_DATA);
  for (const k of [
    "refs",
    "homework",
    "feedback",
    "notes",
    "followups",
    "wrongQuestions",
    "reports",
  ])
    d[k] = [
      { studentId: "a", content: "A" },
      { studentId: "b", content: "B" },
    ];
  const ctx = safeStudentContext({ id: "a" }, d);
  assert.ok(!JSON.stringify(ctx).includes('"B"'));
  assert.equal(ctx.notes.length, 1);
});
test("讲义引用去重且被反馈使用时不可移除", () => {
  const refs = [{ lessonId: "a" }, { lessonId: "b" }];
  assert.throws(() => uniqueRef(refs, "a"));
  assert.throws(() => removeRef(refs, "a", [{ lessonId: "a" }]));
  assert.deepEqual(removeRef(refs, "b", [{ lessonId: "a" }]), [
    { lessonId: "a" },
  ]);
});
test("时间筛选以周一为起点、按课程取最近 N 次", () => {
  const q = [
    { createdAt: "2026-11-15", lessonId: "a" },
    { createdAt: "2026-11-16", lessonId: "b" },
    { createdAt: "2026-11-17", lessonId: "c" },
  ];
  assert.equal(timeFilter(q, "week", "2026-11-17").length, 2);
  assert.equal(timeFilter(q, "month", "2026-11-17").length, 3);
  assert.equal(timeFilter(q, "recent", "2026-11-17", 1)[0].lessonId, "c");
});
test("畸形 AI 结构在写入与渲染前被拦截，数字答案归一为文本", () => {
  for (const q of [
    null,
    { stem: 3 },
    { stem: "a", options: [{}] },
    { stem: "a", tags: [{}] },
    { stem: "a", answer: { guess: true } },
  ])
    assert.throws(() => validateQuestions([q]));
  assert.equal(validateQuestions([{ stem: "求解", answer: 3 }])[0].answer, "3");
});
