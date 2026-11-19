import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DiskStorage } = require("../../desktop/core.cjs");
test("更换学生根目录后保留旧档案，不再读取越界路径，可切换当前同名学生", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-root-change-"));
  const profile = path.join(tmp, "profile"),
    oldRoot = path.join(tmp, "old"),
    newRoot = path.join(tmp, "new"),
    oldStudent = path.join(oldRoot, "测试学生"),
    newStudent = path.join(newRoot, "测试学生");
  const oldCourse = path.join(oldStudent, "旧课程"),
    newCourse = path.join(newStudent, "新课程");
  await fs.mkdir(oldCourse, { recursive: true });
  await fs.mkdir(newCourse, { recursive: true });
  await fs.writeFile(path.join(newCourse, "新教案.txt"), "教学目标：方程");
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await store.set("sm_path_config_v1", { studentsRoot: oldRoot });
  await store.set("sm_workspace_v1", {
    students: [
      {
        id: "old-id",
        name: "测试学生",
        directoryPath: oldStudent,
        status: "未授课",
        notes: "保留旧档案备注",
      },
    ],
    refs: [{ id: "old-ref", studentId: "old-id", lessonId: "old-lesson" }],
    notes: [
      {
        id: "old-note",
        studentId: "old-id",
        title: "原笔记",
        date: "2026-11-18",
        markdown: "旧记录仍应保留",
      },
    ],
  });
  await store.set("sm_view_state_students", {
    selected: "old-id",
    query: "",
    grade: "",
    status: "active",
    course: oldCourse,
    tab: "overview",
    courseWidth: 232,
  });
  let app;
  try {
    app = await electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
    });
    let stderr = "";
    app.process().stderr.on("data", (data) => (stderr += data.toString()));
    const page = await app.firstWindow();
    await expect(page.locator(".profile-title")).toContainText("测试学生");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "配置中心" })
      .click();
    await page.getByLabel("学生根目录", { exact: true }).fill(newRoot);
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(
      page.getByText("配置已保存，资源目录将重新加载", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "学生管理" })
      .click();
    await expect(page.locator(".student-directory-notice")).toContainText(
      "旧学生目录",
    );
    await expect(page.locator(".student-directory-notice")).toContainText(
      oldStudent,
    );
    await expect(
      page.getByRole("button", { name: "打开学生文件夹" }),
    ).toBeDisabled();
    await page.getByRole("tab", { name: "学习报告", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page
      .getByRole("button", { name: "切换到当前目录的同名学生" })
      .click();
    await expect(page.locator(".student-directory-notice")).toHaveCount(0);
    await expect(page.locator(".course-item")).toContainText("新课程");
    await page.locator(".course-item>button").first().click();
    await expect(page.locator(".file-main")).toContainText("新教案.txt");
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(stderr).not.toContain(
      "Error occurred in handler for 'teaching:list'",
    );
    const saved = await page.evaluate(() => window.services.bootstrap());
    expect(saved.data.students.find((s) => s.id === "old-id").notes).toBe(
      "保留旧档案备注",
    );
    expect(saved.data.notes.find((n) => n.id === "old-note").studentId).toBe(
      "old-id",
    );
    expect(saved.data.refs.find((r) => r.id === "old-ref").studentId).toBe(
      "old-id",
    );
    expect(saved.data.students).toHaveLength(2);
    expect(await fs.readdir(oldStudent)).toContain("旧课程");
  } finally {
    if (app) await app.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
