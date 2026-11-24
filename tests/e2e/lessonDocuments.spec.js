import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { DiskStorage } = require("../../desktop/core.cjs"),
  { lessonFixture, content } = require("../helpers/lessonFixture.cjs"),
  { openBuffer } = require("../../desktop/lessonDocuments.cjs"),
  X = require("../../desktop/lessonXml.cjs");
test("复刻教案完善的题目分配、保留章节和原版式，学案原样复制、整段去解析、参数记忆及分页预览", async () => {
  test.setTimeout(90000);
  const tmp = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-lesson-ui-")),
    ),
    profile = path.join(tmp, "profile"),
    root = path.join(tmp, "讲义"),
    folder = path.join(root, "高中", "高一", "对数"),
    source = path.join(folder, "对数（教案）.docx");
  await fs.mkdir(folder, { recursive: true });
  const original = await lessonFixture();
  await fs.writeFile(source, original);
  const calls = [];
  let bad = false;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(
                bad || calls.length === 1
                  ? {
                      ...content,
                      summary: ["缺少知识点", "无法生成", "信息不足"],
                    }
                  : content,
              ),
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
    lessonsRoot: root,
    deepseekKey: "fictional-test-key",
    deepseekHost: "http://127.0.0.1:" + server.address().port,
  });
  let app;
  try {
    app = await electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
    });
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "讲义库" })
      .click();
    await page.getByRole("tab", { name: "高中", exact: true }).click();
    await page.locator(".lesson-list-item").filter({ hasText: "对数" }).click();
    await page.getByRole("button", { name: "教案完善", exact: true }).click();
    await expect(
      page.getByLabel("整理题目与随堂练习", { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel("重新生成趣味导入", { exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByLabel("重新生成翻转总结", { exact: true }),
    ).not.toBeChecked();
    await expect(page.getByRole("region", { name: "题目分配" })).toContainText(
      "原有 4 题",
    );
    await page.getByLabel("题型 1 正文题数", { exact: true }).fill("1");
    await page.getByLabel("题型 1 练习题数", { exact: true }).fill("1");
    await page
      .locator(".lesson-question-row")
      .nth(1)
      .getByRole("checkbox")
      .uncheck();
    await page.screenshot({ path: "test-results/lesson-enrichment-plan.png" });
    await page
      .getByRole("button", { name: "生成完善草稿", exact: true })
      .click();
    await expect(page.getByLabel("教学目标 1", { exact: true })).toHaveValue(
      /理解对数/,
    );
    expect(calls).toHaveLength(2);
    expect(calls[0].messages.at(-1).content).toContain("TYPE1_Q1");
    expect(calls[0].messages.at(-1).content).not.toContain("TYPE2_Q1");
    expect(calls[0].messages.at(-1).content).not.toContain("TYPE1_Q2");
    await page
      .getByLabel("教学目标 1", { exact: true })
      .fill("人工校对目标：理解 $a^x=N$ 与对数式的互化。");
    bad = true;
    await page
      .getByRole("button", { name: "生成完善草稿", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("占位内容");
    await expect(page.getByLabel("教学目标 1", { exact: true })).toHaveValue(
      "人工校对目标：理解 $a^x=N$ 与对数式的互化。",
    );
    expect(await fs.readFile(source)).toEqual(original);
    bad = false;
    await page
      .getByRole("button", { name: "备份并保存教案", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "正文保留 1 题",
    );
    let current = await openBuffer(await fs.readFile(source));
    expect(X.text(current.doc)).toContain("人工校对目标");
    expect(X.text(current.doc)).toContain("原有趣味导入第一段");
    expect(X.text(current.doc)).toContain("原有总结第一条");
    expect(X.text(current.doc)).not.toContain("TYPE2_Q1");
    expect(X.descendants(current.doc, "f", X.M).length).toBeGreaterThan(0);
    expect(
      await fs.readFile(path.join(folder, "对数（原始题目）.docx")),
    ).toEqual(original);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "教案完善", exact: true }).click();
    await expect(page.getByRole("region", { name: "题目分配" })).toContainText(
      "原有 4 题",
    );
    await page.getByLabel("整理题目与随堂练习", { exact: true }).uncheck();
    await page.getByLabel("重新生成趣味导入", { exact: true }).check();
    await page
      .getByRole("button", { name: "生成完善草稿", exact: true })
      .click();
    await expect(page.getByLabel("趣味导入 1", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "备份并保存教案", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "题目与随堂练习保持原样",
    );
    current = await openBuffer(await fs.readFile(source));
    expect(X.text(current.doc)).toContain("数量会很快扩大");
    expect(X.text(current.doc)).not.toContain("TYPE1_Q2");
    expect(X.text(current.doc)).toContain("原有总结第一条");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "转学案", exact: true }).click();
    await page.getByRole("button", { name: "仅复制", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "已原样复制",
    );
    const target = path.join(folder, "对数（学案）.docx");
    expect(await fs.readFile(target)).toEqual(await fs.readFile(source));
    await page
      .getByLabel("同名学案已存在，确认备份后覆盖", { exact: true })
      .check();
    await page
      .getByLabel("空白量系数（0.1–1.5）", { exact: true })
      .fill("0.35");
    await page.getByLabel("增长指数（0.5–1）", { exact: true }).fill("0.8");
    await page.getByRole("button", { name: "复制并处理", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      /删除 [1-9]\d* 个答案解析段落/,
    );
    const study = await openBuffer(await fs.readFile(target));
    expect(X.text(study.doc)).not.toContain("解析后续段落");
    expect(X.text(study.doc)).not.toContain("【答案】");
    expect(X.text(study.doc)).toContain("TYPE1_Q1");
    await page
      .getByRole("button", { name: "版式检查 / 分页预览", exact: true })
      .click();
    await expect(page.getByRole("img", { name: "学案第 1 页" })).toBeVisible({
      timeout: 30000,
    });
    await page.screenshot({ path: "test-results/lesson-study-preview.png" });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "转学案", exact: true }).click();
    await expect(
      page.getByLabel("空白量系数（0.1–1.5）", { exact: true }),
    ).toHaveValue("0.35");
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
