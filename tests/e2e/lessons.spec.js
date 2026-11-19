import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  DiskStorage,
  FileService,
  DocumentService,
} = require("../../desktop/core.cjs");
test("讲义从模板创建、转学案版式预览、学生分配及反馈引用保护", async () => {
  test.setTimeout(60000);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-lesson-e2e-"));
  const profile = path.join(tmp, "profile"),
    root = path.join(tmp, "讲义库"),
    templates = path.join(tmp, "模板"),
    students = path.join(tmp, "学生");
  await Promise.all([fs.mkdir(root), fs.mkdir(templates), fs.mkdir(students)]);
  await fs.mkdir(path.join(students, "测试学生"));
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await store.set("sm_path_config_v1", {
    studentsRoot: students,
    lessonsRoot: root,
    templatesRoot: templates,
  });
  const docs = new DocumentService(new FileService(store));
  await docs.word(
    path.join(templates, "数学教案.docx"),
    "教学目标：理解方程\n1. 解方程 x+2=5\n答案：x=3\n2. 解方程 2x=6",
  );
  let app;
  try {
    app = await electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
    });
    const page = await app.firstWindow();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "讲义库" })
      .click();
    await page.getByRole("button", { name: "新建讲义", exact: true }).click();
    await page.getByLabel("讲义名称", { exact: true }).fill("一元一次方程");
    await page
      .getByLabel("DOC / DOCX 模板", { exact: true })
      .selectOption({ label: "数学教案.docx" });
    await page.getByRole("button", { name: "执行新建讲义" }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "讲义已创建",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.locator(".lesson-list-item").click();
    await page.getByRole("button", { name: "转学案", exact: true }).click();
    await page.getByRole("button", { name: "执行教案转学案" }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "共识别 2 道题",
    );
    await page.getByRole("button", { name: "版式检查 / 分页预览" }).click();
    await expect(page.getByRole("img", { name: "学案第 1 页" })).toBeVisible({
      timeout: 30000,
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await expect(page.locator(".lesson-detail .file-row")).toHaveCount(2);
    await page.getByRole("button", { name: "分配学生", exact: true }).click();
    await page.getByRole("button", { name: "分配", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "已分配", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "学生管理" })
      .click();
    await page.locator(".student-item").click();
    await expect(page.locator(".course-item")).toHaveCount(1);
    await page.locator(".course-item>button").first().click();
    await page.getByRole("tab", { name: "课堂反馈", exact: true }).click();
    await page
      .getByLabel("本节课记录", { exact: true })
      .fill("掌握等式性质，继续巩固移项。");
    await page
      .getByRole("button", { name: "使用本地模板", exact: true })
      .click();
    await page.getByRole("button", { name: "保存反馈", exact: true }).click();
    await expect(page.getByText("反馈已保存", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "移除引用", exact: true }).click();
    await page.getByRole("button", { name: "确认执行", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "已被课堂反馈引用",
    );
    expect(
      await fs.readFile(
        path.join(root, "初中", "初一", "一元一次方程", "数学教案.docx"),
      ),
    ).toBeTruthy();
  } finally {
    if (app) await app.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
