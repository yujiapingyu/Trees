import test from "node:test";
import assert from "node:assert/strict";
import {
  feedbackPrompt,
  formatFeedback,
  validateFeedback,
  isOffTargetAssessment,
  generateFeedbackDraft,
} from "../src/shared/feedback.js";
const student = {
  name: "虚构测试学生",
  grade: "高一",
  notes: "上月基础测试69/150分，仅作背景",
};
const context = { student, date: "2026-11-21" };
const sample = {
  theme: "对数",
  contentPoints: [
    {
      topic: "对数定义与条件",
      details: ["指数式与对数式互化", "底数与真数条件"],
    },
  ],
  strengths: ["孩子能够复述对数定义，对概念已有初步认识。"],
  weaknesses: ["计算时容易漏真数条件，建议孩子先标明条件再进行化简。"],
  afterClass: ["建议孩子练习互化与条件检查。"],
};
test("用户提供的三条错误评价被拦截，真正描述学生的句子保留", () => {
  for (const text of [
    "本次课内容紧扣“对数”主题，概念、运算、换底公式和实际应用形成完整主线。",
    "教师能够结合当前约69分的起点，优先规划基础巩固。",
    "讲义中的题型有层次，从概念理解到综合应用，便于学生建立信心。",
  ]) {
    assert.equal(isOffTargetAssessment(text), true);
    assert.throws(
      () => validateFeedback({ ...sample, strengths: [text] }),
      /讲义或教师/,
    );
    assert.throws(
      () => validateFeedback({ ...sample, weaknesses: [text] }),
      /讲义或教师/,
    );
  }
  for (const text of [
    "孩子能说清讲义中的对数定义，但计算时还要注意条件。",
    "我的观察是，孩子能够复述定义。",
    "孩子在教师提示后能够补全步骤。",
    "后续可重点练习讲义中的互化基础题。",
  ])
    assert.equal(isOffTargetAssessment(text), false);
  assert.throws(
    () =>
      validateFeedback({ ...sample, strengths: ["建议继续保持学习投入。"] }),
    /优点不能只写建议/,
  );
});
test("分数与讲义不能充当学生表现的依据，缺少优点仍能生成完整反馈，不强编", () => {
  const prompt = feedbackPrompt({
    ...context,
    notes: "当前69分，满分150分，本节讲对数。",
    lesson: { name: "对数" },
    documents: [{ name: "教案", text: "讲义有层次，包含对数与指数互化" }],
  });
  assert.match(prompt, /学生本人是评价对象/);
  assert.match(prompt, /strengths 返回 \[\]/);
  assert.match(prompt, /69\/150分/);
  assert.match(prompt, /本次课堂成绩/);
  const text = formatFeedback({ ...sample, strengths: [] }, context);
  assert.match(text, /学习与巩固方向/);
  assert.ok(!text.includes("优点："));
  assert.match(text, /建议孩子先标明条件/);
  assert.ok(!text.includes("讲义题型有层次"));
  assert.equal(
    validateFeedback({ ...sample, strengths: ["孩子能够复述定义。"] }).strengths
      .length,
    1,
  );
});
test("跑偏结果自动修正一次，保留实际模型信息并只输出通过检查的反馈", async () => {
  const calls = [];
  const result = await generateFeedbackDraft({
    ...context,
    prompt: "当前学生事实",
    request: async (task) => {
      calls.push(task);
      return {
        model: "text-model",
        text: JSON.stringify(
          calls.length === 1
            ? { ...sample, strengths: ["讲义中的题型有层次。"] }
            : sample,
        ),
      };
    },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /当前学生事实/);
  assert.match(calls[1], /学员表现评价了讲义或教师/);
  assert.match(result.feedback, /孩子能够复述对数定义/);
  assert.equal(result.model, "text-model");
  assert.ok(!result.feedback.includes("讲义中的题型有层次"));
});
test("修正仍失败会明确报错；网络错误不重复请求", async () => {
  let count = 0;
  await assert.rejects(
    generateFeedbackDraft({
      ...context,
      prompt: "提示",
      request: async () => {
        count++;
        return {
          text: JSON.stringify({
            ...sample,
            strengths: ["教师能够规划基础巩固。"],
          }),
        };
      },
    }),
    /原草稿已保留/,
  );
  assert.equal(count, 2);
  count = 0;
  await assert.rejects(
    generateFeedbackDraft({
      ...context,
      prompt: "提示",
      request: async () => {
        count++;
        throw Error("network failure");
      },
    }),
    /network failure/,
  );
  assert.equal(count, 1);
});
