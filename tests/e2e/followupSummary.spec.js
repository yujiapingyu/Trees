import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DiskStorage } = require("../../desktop/core.cjs");
test("摘要填入九项、逐项复制、替换保护、失败保留草稿和重启恢复", async () => {
  test.setTimeout(60000);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "followup-summary-")),
    profile = path.join(tmp, "profile");
  const response = {
    purpose: "了解近期学习安排",
    content: "沟通近期作业拖延的问题",
    parentFeedback: "家长反馈最近作业经常拖延",
    habits: "写作业前常玩手机",
    keyInfo: "每天九点后才开始",
    solution: "建议每天七点开始练习",
    solutionFeedback: "家长同意试行一周",
    plan: "下周复盘执行情况",
    notes: "保留原沟通日期",
  };
  let mode = "ok",
    requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                mode === "bad"
                  ? JSON.stringify({ content: "不完整" })
                  : JSON.stringify(response),
            },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await store.set("sm_path_config_v1", {
    deepseekKey: "test-only-key",
    deepseekHost: `http://127.0.0.1:${server.address().port}/v1`,
  });
  await store.set("sm_workspace_v1", {
    students: [
      { id: "s1", name: "测试学生甲", status: "稳定授课", grade: "高中一年级" },
      { id: "s2", name: "测试学生乙", status: "稳定授课", grade: "高中一年级" },
    ],
  });
  let app;
  try {
    const launch = () =>
      electron.launch({
        args: ["."],
        cwd: process.cwd(),
        env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
      });
    app = await launch();
    const page = await app.firstWindow();
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__copiedText = text;
          },
          readText: async () => window.__copiedText || "",
        },
      }),
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "回访管理" })
      .click();
    await page
      .locator(".followup-student")
      .filter({ hasText: "测试学生甲" })
      .click();
    await page.getByLabel("回访日期", { exact: true }).fill("2026-11-18");
    const summary =
      "了解学习安排，家长说最近作业拖延、开始前玩手机、九点后才开始。建议七点练习，家长同意一周，下周复盘。";
    await page.getByLabel("回访内容摘要", { exact: true }).fill(summary);
    await page
      .getByRole("button", { name: "根据摘要生成并填入", exact: true })
      .click();
    for (const [key, label] of [
      ["purpose", "沟通目的"],
      ["content", "沟通内容"],
      ["parentFeedback", "家长反馈"],
      ["habits", "学习习惯"],
      ["keyInfo", "关键信息"],
      ["solution", "解决方案"],
      ["solutionFeedback", "家长对方案反馈"],
      ["plan", "后续安排"],
      ["notes", "备注"],
    ]) {
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(
        response[key],
      );
      await expect(
        page.getByRole("button", { name: "复制" + label, exact: true }),
      ).toBeEnabled();
    }
    await page
      .getByRole("button", { name: "复制沟通目的", exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      response.purpose,
    );
    await expect(page.getByLabel("回访日期", { exact: true })).toHaveValue(
      "2026-11-18",
    );
    expect(requests[0].messages.at(-1).content).toContain(summary);
    expect(requests[0].messages.at(-1).content).not.toContain("测试学生乙");
    await page.getByLabel("沟通内容", { exact: true }).fill("教师手动修订");
    await page
      .getByRole("button", { name: "根据摘要生成并填入", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "预览回访整理结果" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "保留原草稿", exact: true }).click();
    await expect(page.getByLabel("沟通内容", { exact: true })).toHaveValue(
      "教师手动修订",
    );
    await page
      .getByRole("button", { name: "根据摘要生成并填入", exact: true })
      .click();
    await page
      .getByRole("button", { name: "替换并填入九项", exact: true })
      .click();
    await expect(page.getByLabel("沟通内容", { exact: true })).toHaveValue(
      response.content,
    );
    mode = "bad";
    await page
      .getByRole("button", { name: "根据摘要生成并填入", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("字段");
    await expect(page.getByLabel("沟通内容", { exact: true })).toHaveValue(
      response.content,
    );
    await page.getByRole("button", { name: "保存回访", exact: true }).click();
    await expect(page.getByText("回访已保存", { exact: true })).toBeVisible();
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await restored.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__copiedText = text;
          },
          readText: async () => window.__copiedText || "",
        },
      }),
    );
    await expect(restored.locator(".record-card")).toHaveCount(1);
    const saved = await restored.evaluate(() => window.services.bootstrap());
    expect(saved.data.followups).toHaveLength(1);
    expect(saved.data.followups[0].studentId).toBe("s1");
    expect(saved.data.followups[0].date).toBe("2026-11-18");
    expect(saved.data.followups[0].solutionFeedback).toBe(
      response.solutionFeedback,
    );
    await restored.locator(".record-card summary").click();
    await restored
      .getByRole("button", { name: "复制历史家长反馈", exact: true })
      .click();
    expect(await restored.evaluate(() => navigator.clipboard.readText())).toBe(
      response.parentFeedback,
    );
    await restored
      .locator(".followup-student")
      .filter({ hasText: "测试学生乙" })
      .click();
    await expect(
      restored.getByLabel("回访内容摘要", { exact: true }),
    ).toHaveValue("");
    await expect(restored.getByLabel("沟通内容", { exact: true })).toHaveValue(
      "",
    );
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
