import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { EMPTY_DATA, today } from "../../src/shared/domain.js";
const require = createRequire(import.meta.url),
  { DiskStorage } = require("../../desktop/core.cjs");

test("课后只记一段，跨页面后台整理；备课卡接课，修改反馈学习风格；重启续办且不重复计次", async () => {
  test.setTimeout(120000);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-teaching-flow-")),
    profile = path.join(temp, "profile"),
    root = path.join(temp, "students"),
    lessonRoot = path.join(temp, "lessons"),
    lessonPath = path.join(lessonRoot, "高中/高一/对数函数");
  await Promise.all([
    fs.mkdir(path.join(root, "甲学生"), { recursive: true }),
    fs.mkdir(path.join(root, "乙学生"), { recursive: true }),
    fs.mkdir(lessonPath, { recursive: true }),
  ]);
  await fs.writeFile(
    path.join(lessonPath, "对数函数教案.txt"),
    "对数函数的定义、图象与性质。",
  );
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw),
      prompt = body.messages.at(-1).content;
    requests.push(body);
    let content;
    if (prompt.includes("整理当前学生的一段课后原始记录")) {
      await new Promise((r) => setTimeout(r, 550));
      content = {
        topic: "对数运算",
        scope: "对数运算与换底公式",
        strengths: [{ text: "能够复述定义", quote: "能复述定义" }],
        weaknesses: [{ text: "计算时要检查真数条件", quote: "漏真数条件" }],
        nextProgress: "对数函数",
        nextQuote: "下次继续对数函数",
        homeworkAssigned: [{ text: "讲义第3题", quote: "布置讲义第3题" }],
        homeworkSuggestions: ["建议回看真数条件，再做同类变式。"],
        nextSuggestions: ["建议先检查真数条件，再衔接图象。"],
      };
    } else if (prompt.includes("你是正在给家长反馈")) {
      content = {
        theme: "对数运算",
        contentPoints: [
          {
            topic: "对数运算与换底公式",
            details: [
              "回顾对数定义和指数式互化，计算前检查真数及底数条件。",
              "结合实际练习巩固换底公式，按步骤完成化简。",
            ],
          },
        ],
        strengths: [
          "孩子能够复述对数定义，已经有了一定的概念基础，后续可以通过具体算式继续巩固。",
        ],
        weaknesses: [
          "计算中容易漏真数条件，我会继续提醒先检查条件再做运算，让解题步骤更完整。",
        ],
        afterClass: [
          "按本次明确布置的讲义第3题练习，并回查真数条件。",
          "建议完成后口头复述运算依据，再准备衔接对数函数。",
        ],
      };
    } else {
      content = {
        curriculum: {
          volume: "必修第一册",
          currentTopic: "对数",
          progressEvidence: "课堂记录",
          mode: "同步推进",
        },
        plan: Array.from({ length: 15 }, (_, i) => ({
          topic: "对数训练" + i,
          objectives: "掌握方法",
          keyPoints: "条件检查",
          hours: "1",
        })),
        planningNotes: "结合已有记录推进。",
      };
    }
    if (!res.destroyed) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(content) } }],
        }),
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const disk = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await disk.set("sm_path_config_v1", {
    studentsRoot: root,
    lessonsRoot: lessonRoot,
    deepseekKey: "synthetic-test",
    deepseekHost: `http://127.0.0.1:${server.address().port}`,
  });
  await disk.set("sm_workspace_v1", {
    ...structuredClone(EMPTY_DATA),
    students: ["甲学生", "乙学生"].map((name, i) => ({
      id: i ? "b" : "a",
      name,
      grade: "高中一年级",
      status: "稳定授课",
      directoryPath: path.join(root, name),
    })),
    lessons: [
      {
        id: "lesson",
        path: lessonPath,
        name: "对数函数",
        stage: "高中",
        grade: "高一",
      },
    ],
    homework: [
      {
        id: "h",
        studentId: "a",
        name: "甲的旧作业",
        dueDate: today(),
        completed: false,
      },
      {
        id: "other-homework",
        studentId: "b",
        name: "乙的私有作业",
        completed: false,
      },
    ],
  });
  await disk.set("sm_view_state_students", {
    selected: "a",
    query: "",
    grade: "",
    status: "active",
    tab: "overview",
    course: "",
  });
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
    });
  let app;
  const errors = [];
  const raw =
    "今天讲了对数运算和换底公式。能复述定义，但计算时漏真数条件。布置讲义第3题，下次继续对数函数。";
  try {
    app = await launch();
    let page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.locator(".preparation-card")).toContainText("甲的旧作业");
    await expect(page.locator(".preparation-card")).not.toContainText(
      "乙的私有作业",
    );
    await page
      .getByRole("button", { name: "课后记一段", exact: true })
      .first()
      .click();
    await page.getByLabel("这一节课的原始记录").fill(raw);
    await page
      .getByRole("button", { name: "保存并自动整理", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const first = await page.evaluate(() => window.services.bootstrap());
    expect(first.data.sessions).toHaveLength(1);
    expect(first.data.sessions[0].notes).toBe(raw);
    expect(first.data.feedback).toHaveLength(0);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "回访管理", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.services.bootstrap())).data
            .sessions[0].closeout.state,
      )
      .toBe("ready");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "学生管理", exact: true })
      .click();
    await expect(page.locator(".preparation-card")).toContainText("对数函数");
    await expect(page.locator(".preparation-card")).toContainText(
      "计算时要检查真数条件",
    );
    await expect(page.locator(".prep-resources")).toContainText("对数函数");
    await page.screenshot({
      path: "test-results/teaching-preparation-card.png",
      fullPage: true,
    });
    await page.getByRole("tab", { name: "课堂反馈", exact: true }).click();
    await page.locator(".automatic-feedback-drafts summary").first().click();
    await expect(page.locator(".automatic-feedback-drafts")).toContainText(
      "已明确布置：讲义第3题",
    );
    await expect(page.locator(".automatic-feedback-drafts")).toContainText(
      "建议练习",
    );
    await page
      .getByRole("button", { name: "编辑并保存这份反馈", exact: true })
      .click();
    const edited =
      "【甲学生同学数学课课后反馈】\n甲学生同学家长您好。\n1.我会先巩固真数条件，再讲对数函数。";
    await page.getByLabel("家长反馈正文").fill(edited);
    await page.getByRole("button", { name: "保存反馈", exact: true }).click();
    await expect(
      page.getByText(/已从你保存的 1 次反馈修改中学习/),
    ).toBeVisible();
    const learned = await page.evaluate(() => window.services.bootstrap());
    expect(learned.data.feedback).toHaveLength(1);
    expect(learned.data.feedbackStyle.learnedCount).toBe(1);
    expect(JSON.stringify(learned.data.feedbackStyle)).not.toContain("甲学生");
    expect(JSON.stringify(learned.data.feedbackStyle)).not.toContain(
      "真数条件",
    );
    await page
      .getByRole("button", { name: /乙学生/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "课后记一段", exact: true })
      .first()
      .click();
    await page.getByLabel("这一节课的原始记录").fill(raw);
    await page
      .getByRole("button", { name: "保存并自动整理", exact: true })
      .click();
    await expect
      .poll(
        () =>
          requests.filter((r) =>
            r.messages
              .at(-1)
              .content.includes("整理当前学生的一段课后原始记录"),
          ).length,
      )
      .toBe(2);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() => window.services.bootstrap())
          ).data.sessions.find((s) => s.studentId === "b").closeout.state,
      )
      .toBe("ready");
    const resumed = await page.evaluate(() => window.services.bootstrap());
    expect(resumed.data.sessions).toHaveLength(2);
    expect(
      resumed.data.sessions.find((s) => s.studentId === "b").closeout
        .feedbackDraft.content,
    ).toContain("乙学生同学家长您好");
    const lastPrompt = requests
      .findLast((r) => r.messages.at(-1).content.includes("你是正在给家长反馈"))
      .messages.at(-1).content;
    expect(lastPrompt).toContain("礼貌正式");
    expect(lastPrompt).toContain("教师已保存反馈的表达偏好");
    expect(lastPrompt).not.toContain("甲学生");
    expect(lastPrompt).not.toContain("甲的旧作业");
    await page.evaluate(async () => {
      const b = await window.services.bootstrap();
      delete b.config.deepseekKey;
      await window.services.storageSet("sm_path_config_v1", b.config);
    });
    await page.reload();
    await page
      .getByRole("button", { name: "课后记一段", exact: true })
      .first()
      .click();
    await page
      .getByLabel("这一节课的原始记录")
      .fill("今天复习定义，真数条件不熟，下次继续对数函数。");
    await page
      .getByRole("button", { name: "保存并自动整理", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() => window.services.bootstrap())
          ).data.sessions.filter((s) => s.closeout.state === "ready").length,
      )
      .toBe(3);
    const offline = await page.evaluate(() => window.services.bootstrap());
    expect(offline.data.sessions.at(-1).closeout.feedbackDraft.model).toContain(
      "非 AI",
    );
    expect(
      offline.data.sessions.at(-1).closeout.extraction.weaknesses.length,
    ).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
