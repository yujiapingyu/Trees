import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DiskStorage } = require("../../desktop/core.cjs");
test("桌面真实文件闭环：创建改名、作业反馈、回访笔记、停课恢复及重启", async () => {
  test.setTimeout(90000);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-e2e-"));
  const root = path.join(tmp, "学生");
  const resources = path.join(tmp, "课本");
  const lessons = path.join(tmp, "讲义库");
  const profile = path.join(tmp, "profile");
  await fs.mkdir(root);
  await fs.mkdir(resources);
  await fs.mkdir(lessons);
  await fs.writeFile(path.join(resources, "方程练习.txt"), "1. x+2=5，求x。");
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await store.set("sm_path_config_v1", {
    studentsRoot: root,
    textbooksJunior: resources,
    lessonsRoot: lessons,
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
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("button", { name: "新增学生", exact: true })
      .first()
      .click();
    await page.getByLabel("学生姓名 *", { exact: true }).fill("测试学生");
    await page.getByLabel("年级", { exact: true }).selectOption("初中一年级");
    await page.getByLabel("家长电话", { exact: true }).fill("13800000000");
    await page.getByRole("button", { name: "创建学生", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".profile-title")).toContainText("测试学生");
    expect(await fs.readdir(root)).toContain("测试学生");
    const personal = path.join(root, "测试学生");
    await fs.writeFile(path.join(personal, "方程练习.txt"), "学生专属作业");
    await fs.writeFile(path.join(personal, "参考答案.txt"), "学生专属答案");
    await page.getByRole("tab", { name: "作业 0" }).click();
    await page.getByRole("button", { name: "添加作业", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByRole("combobox").locator("option:checked"),
    ).toHaveText("测试学生的个人文件夹");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /方程练习/ })
      .click();
    await expect(page.locator(".homework-row")).toHaveCount(1);
    const saved = await page.evaluate(
      async () => (await window.services.bootstrap()).data,
    );
    expect(saved.homework[0].path).toBe(path.join(personal, "方程练习.txt"));
    await page
      .getByRole("button", { name: "关联参考答案", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("combobox").locator("option:checked"),
    ).toHaveText("测试学生的个人文件夹");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /参考答案.txt/ })
      .click();
    await expect(
      page.getByRole("button", { name: "打开答案", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "添加作业", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("combobox")
      .selectOption("textbooksJunior");
    await expect(
      page.getByRole("dialog").getByRole("button", { name: /方程练习/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭弹窗" }).click();

    await page.getByRole("button", { name: "标记已完成", exact: true }).click();
    await expect(page.locator(".homework-row")).toContainText("已完成");
    await page.getByRole("tab", { name: "课堂反馈", exact: true }).click();
    await page
      .getByLabel("本节课记录", { exact: true })
      .fill("已掌握方程基础解法，移项时容易遗漏符号。");
    await page
      .getByRole("button", { name: "使用本地模板", exact: true })
      .click();
    await expect(
      page.getByText("本地模板 / 非 AI 生成", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "保存反馈", exact: true }).click();
    await expect(page.getByText(/历史反馈/)).toBeVisible();
    await page.getByRole("button", { name: "编辑学生档案" }).click();
    await page.getByLabel("学生姓名 *", { exact: true }).fill("测试学生改名");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.locator(".profile-title")).toContainText("测试学生改名");
    expect(await fs.readdir(root)).toEqual(["测试学生改名"]);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "学生记录" })
      .click();
    await page.locator(".student-item").click();
    await page.getByRole("button", { name: "新建记录" }).click();
    await page.getByLabel("标题", { exact: true }).fill("课堂观察");
    await page.getByLabel("正文", { exact: true }).fill("能独立完成 $x+2=5$。");
    await page.getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(page.getByText("课堂观察", { exact: true })).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "回访管理" })
      .click();
    await page.locator(".followup-student").click();
    await page
      .getByLabel("沟通内容", { exact: true })
      .fill("向家长反馈本周学习进展。");
    await page.getByRole("button", { name: "保存回访", exact: true }).click();
    await expect(page.getByText("回访已保存", { exact: true })).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "学生管理" })
      .click();
    await page.getByRole("button", { name: "学生更多操作" }).click();
    await page.getByLabel("授课状态", { exact: true }).selectOption("已停课");
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await expect(page.locator(".student-item")).toHaveCount(0);
    await page.getByLabel("筛选授课状态").selectOption("已停课");
    await expect(page.locator(".student-item")).toHaveCount(1);
    await page.getByRole("button", { name: "学生更多操作" }).click();
    await page.getByLabel("授课状态", { exact: true }).selectOption("稳定授课");
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page.getByLabel("筛选授课状态").selectOption("active");
    await page.locator(".student-item").click();
    await page.getByRole("tab", { name: "作业 1" }).click();
    await expect(page.locator(".homework-row")).toContainText("已完成");
    await page.screenshot({ path: "test-results/desktop-workspace.png" });
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await expect(restored.locator(".profile-title")).toContainText(
      "测试学生改名",
    );
    await expect(restored.locator(".homework-row")).toContainText("已完成");
    const persisted = (
      await restored.evaluate(() => window.services.bootstrap())
    ).data;
    expect(persisted.students).toHaveLength(1);
    expect(persisted.feedback.length).toBe(1);
    expect(persisted.notes.length).toBe(1);
    expect(persisted.followups.length).toBe(1);
    expect(persisted.homework[0].studentId).toBe(persisted.students[0].id);
  } finally {
    if (app) await app.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
