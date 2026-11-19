import test from "node:test";
import assert from "node:assert/strict";
globalThis.window = {};
const { mergeFragments, pairAnswers } =
  await import("../src/shared/questionPipeline.js");
test("跨页接续题干合并且保留图片和不确定标记", () => {
  const result = mergeFragments([
    {
      questions: [
        { number: "1", stem: "已知函数", images: ["page1"], uncertain: false },
      ],
    },
    {
      questions: [
        { number: "1", stem: "求其最大值", images: ["page2"], uncertain: true },
        { number: "2", stem: "第二题" },
      ],
    },
  ]);
  assert.equal(result.length, 2);
  assert.match(result[0].stem, /已知函数\n求其最大值/);
  assert.deepEqual(result[0].images, ["page1", "page2"]);
  assert.equal(result[0].uncertain, true);
});
test("答案按题号配对，缺失与重复答案标记待人工校对", () => {
  const questions = [
    { number: "1", stem: "A" },
    { number: "2", stem: "B" },
    { number: "3", stem: "C" },
  ];
  const answers = [
    { number: 1, answer: "x=3" },
    { number: 2, answer: "a" },
    { number: 2, answer: "b" },
  ];
  const result = pairAnswers(questions, answers);
  assert.equal(result[0].answer, "x=3");
  assert.equal(result[0].uncertain, false);
  assert.equal(result[1].answer, "");
  assert.equal(result[1].uncertain, true);
  assert.equal(result[2].uncertain, true);
});
