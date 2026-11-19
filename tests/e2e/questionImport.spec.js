import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  DiskStorage,
  FileService,
  DocumentService,
} = require("../../desktop/core.cjs");
test("题库真实 DOCX 转图、OCR 接口编排、配对、编辑保存与重启恢复", async () => {
  test.setTimeout(90000);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-bank-e2e-"));
  const profile = path.join(tmp, "profile");
  const root = path.join(tmp, "题库");
  await fs.mkdir(root);
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    let content;
    if (request.model === "qwen-vl-max") {
      expect(request.messages.at(-1).content[1].image_url.url).toMatch(
        /^data:image\/jpeg;base64,/,
      );
      const text = request.messages.at(-1).content[0].text;
      content = JSON.stringify(
        text.includes("解析版")
          ? [
              {
                number: "1",
                stem: "答案",
                answer: "x=3",
                explanation: "两边同时减2",
                figures: [],
              },
            ]
          : [
              {
                number: "1",
                stem: "解方程 $x+2=5$",
                options: [],
                answer: "",
                explanation: "",
                figures: [],
                uncertain: false,
              },
            ],
      );
    } else {
      const last = request.messages.at(-1).content;
      const list = JSON.parse(last.slice(last.indexOf("\n") + 1));
      content = JSON.stringify(
        list.map((q) => ({
          id: q.id,
          category: "方程",
          tags: ["一元一次方程"],
          difficulty: "基础",
        })),
      );
    }
    calls++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `http://127.0.0.1:${server.address().port}/v1`;
  await store.set("sm_path_config_v1", {
    questionBankRoot: root,
    deepseekKey: "test-key",
    qwenKey: "test-key",
    deepseekHost: host,
    qwenHost: host,
  });
  const docs = new DocumentService(new FileService(store));
  const original = path.join(root, "原试题.docx"),
    answer = path.join(root, "解析版.docx");
  await docs.word(original, "1. 解方程 x+2=5");
  await docs.word(answer, "1. 答案 x=3；解析：两边同时减2");
  let app;
  try {
    const launch = () =>
      electron.launch({
        args: ["."],
        cwd: process.cwd(),
        env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
      });
    app = await launch();
    await app.evaluate(
      ({ dialog }, paths) => {
        let index = 0;
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [paths[index++]],
        });
      },
      [original, answer],
    );
    const page = await app.firstWindow();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "题库管理" })
      .click();
    await page.getByRole("button", { name: "导入试卷", exact: true }).click();
    await page.getByLabel("专题名称", { exact: true }).fill("一元一次方程");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "选择", exact: true })
      .nth(0)
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "选择", exact: true })
      .nth(1)
      .click();
    await page.getByRole("button", { name: "开始导入", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 60000 });
    await expect(page.locator(".question-card")).toHaveCount(1);
    expect(calls).toBe(3);
    await page.locator(".question-card summary").click();
    await expect(page.locator(".question-card")).toContainText("x=3");
    await page
      .locator(".question-card")
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await page.getByLabel("答案", { exact: true }).fill("x = 3（已校对）");
    await page
      .getByRole("button", { name: "应用修改（仍需保存题库）" })
      .click();
    await page.getByRole("button", { name: "保存题库", exact: true }).click();
    await expect(
      page.getByText("题库已写入本地，旧文件已备份", { exact: true }),
    ).toBeVisible();
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await expect(restored.locator(".question-card")).toHaveCount(1);
    await restored.locator(".question-card summary").click();
    await expect(restored.locator(".question-card")).toContainText("已校对");
    const stored = JSON.parse(
      await fs.readFile(path.join(profile, "workspace.json"), "utf8"),
    );
    const bank = JSON.parse(
      await fs.readFile(stored.sm_workspace_v1.banks[0].path, "utf8"),
    );
    expect(bank.questions[0].difficulty).toBe("基础");
    expect(bank.questions[0].answer).toContain("已校对");
    expect(
      await fs.readdir(path.join(path.dirname(bank.path), "images")),
    ).toHaveLength(2);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
