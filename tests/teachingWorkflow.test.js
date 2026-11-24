import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_DATA, today } from "../src/shared/domain.js";
import {
  saveQuickLesson,
  validateLessonExtraction,
  applyLessonCloseout,
  saveFeedbackWithStyle,
} from "../src/shared/lessonCloseout.js";
import { feedbackStylePrompt } from "../src/shared/feedbackStyle.js";
import { preparationCard } from "../src/shared/preparation.js";
const student = {
  id: "s",
  name: "张小明",
  grade: "高中一年级",
  status: "稳定授课",
};
const raw =
  "今天讲了对数运算。能复述定义，但计算时漏真数条件。布置讲义第3题，下次继续对数函数。";
const fixture = () => ({
  ...structuredClone(EMPTY_DATA),
  students: [student, { id: "other", name: "其他学生", grade: "高中一年级" }],
});
test("一次课后记录原文先入库，恢复和重试不重复计次，自动整理有原文证据且不接受虚构引文", () => {
  const d = saveQuickLesson(fixture(), { id: "one", studentId: "s", raw });
  assert.equal(d.sessions[0].notes, raw);
  assert.equal(d.sessions[0].closeout.state, "pending");
  const again = saveQuickLesson(d, { id: "one", studentId: "s", raw });
  assert.equal(again.sessions.length, 1);
  const s = again.sessions[0],
    extracted = validateLessonExtraction(
      {
        topic: "对数运算",
        scope: "对数运算",
        weaknesses: [
          { text: "条件检查要巩固", quote: "漏真数条件" },
          { text: "不认真听讲", quote: "上课不认真" },
        ],
        nextProgress: "对数函数",
        nextQuote: "下次继续对数函数",
        homeworkAssigned: [{ text: "讲义第3题", quote: "布置讲义第3题" }],
      },
      s,
    );
  assert.equal(extracted.weaknesses.length, 1);
  assert.equal(extracted.nextProgress, "对数函数");
  const result = applyLessonCloseout(
    again,
    s.id,
    s.closeout.version,
    { extraction: extracted, feedbackDraft: { content: "草稿" } },
    s.updatedAt,
  );
  assert.equal(result.sessions[0].closeout.state, "ready");
  assert.equal(result.feedback.length, 0);
  assert.equal(result.sessions[0].notes, raw);
  assert.equal(
    applyLessonCloseout(result, s.id, s.closeout.version, {}, s.updatedAt),
    result,
  );
});
test("后台过期结果不覆盖手工修改，不复活删除记录", () => {
  let d = saveQuickLesson(fixture(), { id: "s1", studentId: "s", raw });
  const s = d.sessions[0];
  d.sessions[0] = { ...s, topic: "教师手改", updatedAt: "changed" };
  d = applyLessonCloseout(
    d,
    s.id,
    s.closeout.version,
    { extraction: { topic: "旧AI结果" } },
    s.updatedAt,
  );
  assert.equal(d.sessions[0].topic, "教师手改");
  assert.equal(d.sessions[0].closeout.state, "pending");
  assert.notEqual(d.sessions[0].closeout.version, s.closeout.version);
  assert.equal(
    applyLessonCloseout(
      { ...d, sessions: [] },
      s.id,
      s.closeout.version,
      {},
      s.updatedAt,
    ).sessions.length,
    0,
  );
});
test("保存修改后学习表达统计，不将其他学生的姓名、日期、分数或原文写入风格提示", () => {
  let d = fixture();
  const original =
    "【张小明同学数学课课后反馈】\n张小明同学家长好～我这边对本次课做反馈。\n1、" +
    "能够在提示下完成对数运算，建议孩子接下来继续加强真数条件的检查。".repeat(
      12,
    );
  const edited =
    "【张小明同学数学课课后反馈】\n张小明同学家长您好。\n1.我会先巩固真数条件，再讲对数函数。";
  d = saveFeedbackWithStyle(d, {
    studentId: "s",
    generatedOriginal: original,
    content: edited,
    date: today(),
  });
  assert.equal(d.feedbackStyle.learnedCount, 1);
  assert.equal(d.feedbackStyle.tone, "formal");
  assert.equal(d.feedbackStyle.numbering, "dot");
  const text =
    JSON.stringify(d.feedbackStyle) + feedbackStylePrompt(d.feedbackStyle);
  assert.ok(!text.includes("张小明"));
  assert.ok(!text.includes("对数函数"));
  assert.ok(!text.includes("真数条件"));
  const same = saveFeedbackWithStyle(d, {
    studentId: "s",
    feedbackId: d.feedback[0].id,
    generatedOriginal: original,
    content: edited,
    date: today(),
  });
  assert.equal(same.feedbackStyle.learnedCount, 1);
});
test("备课卡只取本人真实作业与接课点，匹配资料，排除另一学生和缺失资料", () => {
  const d = saveQuickLesson(fixture(), { id: "c", studentId: "s", raw });
  d.homework = [
    {
      id: "h",
      studentId: "s",
      name: "对数练习",
      completed: false,
      dueDate: today(),
    },
    { id: "x", studentId: "other", name: "不得出现的作业", completed: false },
  ];
  d.lessons = [
    {
      id: "l",
      name: "对数函数",
      path: "/lessons/对数",
      stage: "高中",
      grade: "高一",
    },
    {
      id: "m",
      name: "对数函数失效讲义",
      path: "/lessons/missing",
      missing: true,
    },
  ];
  const card = preparationCard(student, d, [], { lessonsRoot: "/lessons" });
  assert.equal(card.target, "对数函数");
  assert.equal(card.homeworkCount, 1);
  assert.equal(card.resources[0].id, "l");
  assert.ok(!JSON.stringify(card).includes("不得出现"));
});
