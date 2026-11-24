import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { EMPTY_DATA, today } from "../../src/shared/domain.js";
const require = createRequire(import.meta.url),
  { DiskStorage } = require("../../desktop/core.cjs");

test("不设置学校、册次和章节，打开即自动生成15节课；重启复用，新授课自动更新，无AI也有完整方案", async () => {
  test.setTimeout(90000);
  const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "zhixu-auto-curriculum-"),
    ),
    profile = path.join(temp, "profile"),
    root = path.join(temp, "students"),
    directoryPath = path.join(root, "自动学生");
  await fs.mkdir(directoryPath, { recursive: true });
  const requests = [],
    server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      requests.push(body);
      const next = body.messages.at(-1).content.includes("新增三角课")
        ? "诱导公式"
        : "对数函数";
      const result = {
        curriculum: {
          volume: "必修第一册",
          currentTopic: next,
          progressEvidence: "根据最近已完成授课与下次继续记录自动判断",
          mode: "同步推进",
        },
        plan: Array.from({ length: 15 }, (_, i) => ({
          topic: `${next}自动任务${i + 1}`,
          objectives: `独立完成任务${i + 1}`,
          keyPoints: "条件、方法与订正",
          hours: "1",
        })),
        planningNotes: "系统自动从现有记录接课，不需要设置学校进度表。",
      };
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(result) } }],
        }),
      );
    });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const disk = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await disk.set("sm_path_config_v1", {
    studentsRoot: root,
    deepseekKey: "synthetic-only",
    deepseekHost: `http://127.0.0.1:${server.address().port}`,
  });
  await disk.set("sm_workspace_v1", {
    ...structuredClone(EMPTY_DATA),
    students: [
      {
        id: "s",
        name: "自动学生",
        grade: "高中一年级",
        status: "稳定授课",
        directoryPath,
      },
    ],
    sessions: [
      {
        id: "c",
        studentId: "s",
        date: today(),
        topic: "对数运算",
        nextProgress: "对数函数",
        scope: "已讲对数定义",
        status: "completed",
      },
    ],
  });
  await disk.set("sm_view_state_route", "settings");
  await disk.set("sm_view_state_settings", "curriculum");
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
    await expect(page.locator(".auto-plan-row")).toHaveCount(15);
    await expect(page.locator(".auto-plan-row").first()).toContainText(
      "对数函数自动任务1",
    );
    await expect(page.getByText("已自动保存", { exact: true })).toBeVisible();
    await expect(page.getByLabel("学校当前教材册次")).not.toBeVisible();
    expect(requests).toHaveLength(1);
    const prompt = requests[0].messages.at(-1).content;
    expect(prompt).toContain("对数函数");
    expect(prompt).toContain("不向教师索取设置");
    const before = await page.evaluate(() => window.services.bootstrap());
    expect(before.data.students[0].mathProgress).toBeUndefined();
    expect(before.data.schools).toEqual([]);
    expect(before.data.analysis["s:自动教学规划"].planData.plan).toHaveLength(
      15,
    );
    await page.screenshot({
      path: "test-results/automatic-curriculum-no-forms.png",
      fullPage: true,
    });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.getByText("已自动保存", { exact: true })).toBeVisible();
    expect(requests).toHaveLength(1);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "学生管理", exact: true })
      .click();
    await page
      .getByRole("button", { name: /自动学生/ })
      .first()
      .click();
    await page.getByRole("tab", { name: "授课记录", exact: true }).click();
    await page.getByRole("button", { name: "登记本次课", exact: true }).click();
    await page.getByLabel("授课主题", { exact: true }).fill("新增三角课");
    await page
      .getByLabel("实际讲授范围", { exact: true })
      .fill("三角函数概念和图象");
    await page.getByLabel("下次继续进度", { exact: true }).fill("诱导公式");
    await page
      .getByRole("button", { name: "保存授课记录", exact: true })
      .click();
    await page.getByRole("tab", { name: "教材进度", exact: true }).click();
    await expect(page.locator(".auto-plan-row").first()).toContainText(
      "诱导公式自动任务1",
    );
    await expect(page.getByText("已自动保存", { exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
    await page.evaluate(async () => {
      const b = await window.services.bootstrap();
      delete b.config.deepseekKey;
      await window.services.storageSet("sm_path_config_v1", b.config);
    });
    await page.reload();
    await expect(page.locator(".auto-plan-row")).toHaveCount(15);
    await expect(page.getByText("已自动保存", { exact: true })).toBeVisible();
    await expect(page.locator(".automatic-curriculum")).toContainText(
      "本地自动规划",
    );
    expect(requests).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
