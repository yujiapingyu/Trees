import test from "node:test";
import assert from "node:assert/strict";
import {
  FOLLOWUP_FIELDS,
  followupSummaryPrompt,
  validateFollowupSummary,
} from "../src/shared/followupSummary.js";
const sample = () =>
  Object.fromEntries(
    FOLLOWUP_FIELDS.map(([key]) => [
      key,
      key === "content" ? "家长反馈最近写作业拖延" : "",
    ]),
  );
test("摘要整理提示词限定九项和当前摘要，不补造家长对方案态度", () => {
  const prompt = followupSummaryPrompt(
    "家长说每天拖到九点才写作业，建议固定时间练习。",
  );
  for (const [key, label] of FOLLOWUP_FIELDS) {
    assert.ok(prompt.includes(key));
    assert.ok(prompt.includes(label));
  }
  assert.match(prompt, /不代表家长已认可/);
  assert.match(prompt, /空字符串/);
  assert.match(prompt, /每天拖到九点/);
  assert.throws(() => followupSummaryPrompt("  "), /先输入/);
  assert.throws(() => followupSummaryPrompt("a".repeat(30001)), /过长/);
});
test("九项结构完整验证，未知留空，额外字段不会覆盖身份和日期", () => {
  const values = validateFollowupSummary({
    ...sample(),
    studentId: "other",
    date: "2000-01-01",
  });
  assert.deepEqual(
    Object.keys(values),
    FOLLOWUP_FIELDS.map(([key]) => key),
  );
  assert.equal(values.parentFeedback, "");
  assert.equal(values.content, "家长反馈最近写作业拖延");
  assert.equal(values.studentId, undefined);
});
test("畸形与不完整响应拦截后再填入，不能静默清空表单", () => {
  for (const result of [
    null,
    [],
    { content: "only" },
    { ...sample(), habits: [] },
    Object.fromEntries(FOLLOWUP_FIELDS.map(([key]) => [key, ""])),
  ])
    assert.throws(() => validateFollowupSummary(result));
});
