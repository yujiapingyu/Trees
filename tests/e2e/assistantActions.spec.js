import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { EMPTY_DATA, today } from "../../src/shared/domain.js";
const require = createRequire(import.meta.url),
  { DiskStorage } = require("../../desktop/core.cjs");
test("助手直接办事：批量引用、卷别澄清、真实回执、登记与安排、取消、重启撤销", async () => {
  test.setTimeout(120000);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-actions-ui-")),
    profile = path.join(temp, "profile"),
    root = path.join(temp, "students"),
    lessons = path.join(temp, "lessons"),
    exams = path.join(temp, "exams");
  await Promise.all([
    fs.mkdir(path.join(root, "张小明"), { recursive: true }),
    fs.mkdir(path.join(root, "李小红"), { recursive: true }),
    fs.mkdir(path.join(lessons, "对数"), { recursive: true }),
    fs.mkdir(exams),
  ]);
  await fs.writeFile(path.join(lessons, "对数/对数.txt"), "对数定义与运算");
  await fs.writeFile(path.join(exams, "paper.pdf"), "test only");
  await fs.writeFile(path.join(exams, "answer.pdf"), "test only");
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const prompt = body.messages.at(-1).content;
    let content = "教学建议，不会自动保存。";
    if (prompt.includes("办事指令解释器")) {
      const q = prompt.split("用户本轮指令：").at(-1);
      const type = q.includes("记一条")
        ? "add_note"
        : q.includes("课堂记录")
          ? "record_lesson"
          : q.includes("回访")
            ? "schedule_followup"
            : q.includes("作业")
              ? "complete_homework"
              : q.includes("试卷")
                ? "reference_exam"
                : "reference_lesson";
      content = JSON.stringify({
        actions: [
          {
            type,
            lessonId: type === "reference_lesson" ? "l" : undefined,
            examId: type === "reference_exam" ? "e" : undefined,
            sourceQuote: q.includes("：")
              ? q.split("：").slice(1).join("：")
              : undefined,
            title: "课堂观察",
          },
        ],
      });
      if (q.includes("取消测试")) {
        setTimeout(() => {
          if (!res.destroyed)
            res.end(JSON.stringify({ choices: [{ message: { content } }] }));
        }, 1800);
        return;
      }
    } else if (prompt.includes("整理当前学生的一段课后原始记录")) {
      content = JSON.stringify({
        topic: "对数",
        scope: "",
        strengths: [],
        weaknesses: [],
      });
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const disk = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await disk.set("sm_path_config_v1", {
    studentsRoot: root,
    lessonsRoot: lessons,
    examsRoot: exams,
    deepseekKey: "test-only",
    deepseekHost: `http://127.0.0.1:${server.address().port}`,
  });
  await disk.set("sm_workspace_v1", {
    ...structuredClone(EMPTY_DATA),
    schools: [{ id: "hs", name: "测试高中", stage: "高中" }],
    students: [
      {
        id: "s",
        name: "张小明",
        schoolId: "hs",
        grade: "高中一年级",
        status: "稳定授课",
        directoryPath: path.join(root, "张小明"),
      },
      {
        id: "b",
        name: "李小红",
        schoolId: "hs",
        grade: "高中一年级",
        status: "稳定授课",
        directoryPath: path.join(root, "李小红"),
      },
    ],
    lessons: [
      {
        id: "l",
        name: "对数",
        grade: "高一",
        stage: "高中",
        path: path.join(lessons, "对数"),
      },
    ],
    exams: [
      {
        id: "e",
        name: "A9联盟11月测试",
        grade: "高中一年级",
        date: today(),
        kind: "alliance",
        organizer: "A9",
        schoolIds: ["hs"],
        subjects: [
          {
            id: "math",
            name: "数学",
            maxScore: 150,
            files: [
              {
                id: "pA",
                kind: "paper",
                version: "A卷",
                schoolId: "",
                path: path.join(exams, "paper.pdf"),
              },
              {
                id: "pB",
                kind: "paper",
                version: "B卷",
                schoolId: "",
                path: path.join(exams, "paper.pdf"),
              },
              {
                id: "aB",
                kind: "answer",
                version: "B卷",
                schoolId: "",
                path: path.join(exams, "answer.pdf"),
              },
            ],
          },
        ],
      },
    ],
    homework: [
      { id: "h", studentId: "s", name: "对数作业", completed: false },
      { id: "hb", studentId: "b", name: "另一份作业", completed: false },
    ],
  });
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
    });
  let app;
  const errors = [];
  try {
    app = await launch();
    let page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    const open = async () => {
      await page.getByRole("button", { name: "AI 助手", exact: true }).click();
      await expect(page.getByLabel("助手资料范围")).toHaveValue("workspace");
    };
    const state = () =>
      page.evaluate(async () => (await window.services.bootstrap()).data);
    const send = async (q) => {
      await page.getByLabel("向助手提问").fill(q);
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "发送", exact: true }),
      ).toBeVisible();
    };
    await open();
    await send("给高一学生引用对数讲义");
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "已办理",
    );
    expect((await state()).refs).toHaveLength(2);
    await page
      .locator(".chat-message.assistant")
      .last()
      .getByRole("button", { name: "撤销这次操作" })
      .click();
    await expect.poll(async () => (await state()).refs.length).toBe(0);
    await send("给张小明引用A9联盟11月测试试卷");
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "多个卷别",
    );
    await page
      .locator(".chat-message.assistant")
      .last()
      .getByRole("button", { name: /B卷/ })
      .click();
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "试卷1份、答案1份",
    );
    expect((await state()).refs[0].version).toBe("B卷");
    await expect(page.locator(".toast.danger")).toHaveCount(0);
    await send("给张小明记一条观察：计算需要检查符号。");
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "保存学生记录",
    );
    expect((await state()).notes[0].markdown).toBe("计算需要检查符号。");
    await page
      .locator(".chat-message.assistant")
      .last()
      .locator(".assistant-sources summary")
      .click();
    await page
      .locator(".chat-message.assistant")
      .last()
      .locator(".assistant-sources button")
      .click();
    await expect(
      page.getByRole("heading", { name: "学生记录", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-search-key^="记录:"]').first(),
    ).toContainText("计算需要检查符号。");
    await open();

    await send("下周五回访张小明");
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "已安排张小明",
    );
    expect((await state()).followups).toHaveLength(0);
    await send("把张小明的对数作业标记完成");
    expect((await state()).homework.find((h) => h.id === "h").completed).toBe(
      true,
    );
    expect((await state()).homework.find((h) => h.id === "hb").completed).toBe(
      false,
    );
    await page.screenshot({
      path: "test-results/assistant-actions-receipts.png",
      fullPage: true,
    });
    await page.getByLabel("向助手提问").fill("给张小明记一条观察：取消测试");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消请求" })).toBeVisible();
    await page.getByRole("button", { name: "取消请求" }).click();
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeVisible();
    await send("整理本周需要回访的学生");
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "需要跟进",
    );
    expect((await state()).notes).toHaveLength(1);
    await page.getByLabel("助手资料范围").selectOption("general");
    await send("给张小明引用对数讲义");
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "切换",
    );
    expect((await state()).refs).toHaveLength(1);
    await page.getByLabel("助手资料范围").selectOption("workspace");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await open();
    await expect(page.locator(".assistant-recent-actions")).toContainText(
      "作业标记完成",
    );
    await send("撤销上一次操作");
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "已撤销",
    );
    expect((await state()).homework.find((h) => h.id === "h").completed).toBe(
      false,
    );
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "回访管理", exact: true })
      .click();
    await page
      .locator(".followup-sidebar")
      .getByRole("button", { name: "全部", exact: true })
      .click();
    await page.getByText("张小明", { exact: true }).first().click();
    await expect(page.locator(".followup-detail")).toContainText(
      "下次联系计划",
    );
    await expect(page.locator(".followup-dates")).toContainText(
      "最近回访 暂无",
    );
    expect(errors).toEqual([]);
    expect(
      requests.some((r) =>
        r.messages.at(-1).content.includes("办事指令解释器"),
      ),
    ).toBe(true);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
