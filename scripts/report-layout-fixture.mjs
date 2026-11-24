// Synthetic fixtures exercise the production report exporter; no user records are read.
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { EMPTY_DATA } from "../src/shared/domain.js";
import { freshReport } from "../src/shared/reports.js";
const require = createRequire(import.meta.url);
const { learningReportBuffer } = require("../desktop/learningReport.cjs");
const out = process.argv[2];
if (!out) throw Error("请指定独立的版式验证输出目录");
await fs.mkdir(out, { recursive: true });
const d = {
  ...structuredClone(EMPTY_DATA),
  students: [
    {
      id: "layout",
      name: "版式验证学生",
      grade: "高中一年级",
      status: "稳定授课",
      reportSettings: {
        completedLessons: 3,
        firstLessonDate: "2026-11-01",
        teacher: "版式验证教师",
      },
    },
  ],
};
for (const type of ["entry", "stage"]) {
  const r = freshReport(d.students[0], d, type, "2026-11-20");
  r.goals.lastScore = "60 / 150";
  r.goals.targetScore = "90 / 150";
  r.goals.motivation = "明确学习目标，逐步形成独立思考和检查步骤的习惯。";
  r.hourBudget = "";
  r.knowledge = Array.from({ length: 5 }, (_, i) => ({
    topic: `知识单元${i + 1}的概念与方法`,
    difficulty: i % 2 ? "难" : "中",
    strengths:
      "本条为版式验证资料，检查多行中文评价在表格中的换行与完整显示。能够在明确条件的情境下使用基础方法，复杂条件需要进一步观察。",
    needs:
      "建议先梳理适用条件，再完成分步练习。需要关注容易混淆的符号和条件，逐步将口头说明转为规范的书面步骤。",
    evidence: "本条使用虚构测试资料，仅验证导出排版。",
  }));
  r.plan = Array.from({ length: 15 }, (_, i) => ({
    topic: `教学单元${i + 1} 概念巩固与综合应用`,
    objectives:
      "1. 明确概念的适用条件，梳理基本方法。\n2. 通过典型例题展示完整步骤，再安排独立练习，检查学生能否说明每一步的理由。",
    keyPoints:
      "重点：条件辨析与方法选择。\n难点：多步推理及过程书写，关注易错环节并及时订正。",
    hours: "1",
  }));
  r.habitPlan = ["计算规范", "错题整理", "课堂笔记"].map((habit) => ({
    habit,
    actions:
      "先独立完成相关练习，保留关键步骤。完成后逐项回查，并标出需要讨论的问题；结合教师反馈补充方法，下一次练习时再次检查。",
    criteria:
      "能够在不直接查看答案的情况下说明主要步骤，并根据反馈独立完成订正；观察结果用于调整方案，不预先断言已达标。",
    support:
      "教师示范方法并检查执行过程；家长提供固定学习空间，提醒按计划完成，不代替学生作答。",
  }));
  r.parentReceipt =
    "建议与家长确认：为孩子保留固定的独立练习时间，关注是否能说明解题步骤；如遇到卡壳，先记录问题再与任课老师沟通。此处仅为沟通参考，不代表家长已经同意或签字。";
  r.comments = {
    attendance: "考勤资料需持续核对。",
    efficiency: "本段用于检查正常中文段落的行间距与跨页显示。",
    homework: "作业质量需以批改结果为依据。",
    overall:
      "我会结合真实课堂资料与学生的独立练习表现，逐项明确薄弱环节，安排对应的学习任务，并根据下一阶段反馈调整方案。本段为格式验证内容，不表示某位真实学生的表现。",
  };
  r.progress =
    type === "stage"
      ? "本阶段回顾根据明确的上期依据和本期记录逐项比较，缺少可比资料时不推断提升幅度。此处用于检查阶段回顾段落和后续表格的布局。"
      : "";
  await fs.writeFile(out + "/" + type + ".docx", await learningReportBuffer(r));
}
console.log("Synthetic admission and stage layout fixtures exported.");
