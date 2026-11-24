import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { EMPTY_DATA } from "../../src/shared/domain.js";
const require = createRequire(import.meta.url),
  { DiskStorage } = require("../../desktop/core.cjs"),
  JSZip = require("jszip");
test("讲义按旧规则ZIP打包且保护覆盖，考试按学段年级分类并持久化筛选", async () => {
  test.setTimeout(60000);
  const temp = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-pack-class-ui-")),
    ),
    profile = path.join(temp, "profile"),
    root = path.join(temp, "lessons"),
    folder = path.join(root, "高中/高一/对数");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "对数（教案）.docx"), "教案原内容");
  await fs.writeFile(path.join(folder, "对数（学案）.docx"), "学案原内容");
  const disk = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await disk.set("sm_path_config_v1", { lessonsRoot: root });
  await disk.set("sm_workspace_v1", {
    ...structuredClone(EMPTY_DATA),
    schools: [
      { id: "hs", name: "高中学校", stage: "高中" },
      { id: "js", name: "初中学校", stage: "初中" },
    ],
    lessons: [
      { id: "l", name: "对数", path: folder, stage: "高中", grade: "高一" },
    ],
    exams: [
      {
        id: "e1",
        name: "A9高一联考",
        grade: "高中一年级",
        date: "2026-11-02",
        kind: "alliance",
        organizer: "A9",
        schoolIds: ["hs"],
        subjects: [],
        files: [],
      },
      {
        id: "e2",
        name: "高二独立测试",
        grade: "高中二年级",
        date: "2026-11-20",
        kind: "school",
        schoolIds: ["hs"],
        subjects: [],
        files: [],
      },
      {
        id: "e3",
        name: "初二阶段测试",
        grade: "初中二年级",
        date: "2026-11-10",
        kind: "school",
        schoolIds: ["js"],
        subjects: [],
        files: [],
      },
    ],
  });
  await disk.set("sm_view_state_lessonLibrary", {
    stage: "高中",
    selected: "l",
    query: "",
    tags: [],
    grade: "",
    collection: "",
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
    const nav = (name) =>
      page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
    await nav("讲义库");
    await page.getByRole("button", { name: "打包讲义", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("教材版本", { exact: true })).toHaveValue(
      "人教A版",
    );
    await expect(dialog.getByLabel("打包年级", { exact: true })).toHaveValue(
      "高一",
    );
    await dialog.getByRole("button", { name: "开始打包", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("已打包至");
    const zipPath = path.join(
        folder,
        `人教A版${new Date().getFullYear()}高一数学 对数.zip`,
      ),
      first = await fs.readFile(zipPath),
      zip = await JSZip.loadAsync(first);
    expect(Object.values(zip.files).filter((f) => !f.dir)).toHaveLength(2);
    expect(
      await zip
        .file(Object.keys(zip.files).find((n) => n.includes("（学案）")))
        .async("string"),
    ).toBe("学案原内容");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "打包讲义", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "开始打包", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "开始打包", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("已打包至");
    expect((await fs.readdir(folder)).some((n) => n.endsWith(".bak"))).toBe(
      true,
    );
    await page.screenshot({
      path: "test-results/lesson-standard-zip.png",
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await nav("考试管理");
    await expect(page.locator(".exam-grade-group")).toHaveCount(3);
    await expect(page.locator(".exam-list-entry")).toHaveCount(3);
    await page
      .getByRole("group", { name: "考试学段分类" })
      .getByRole("button", { name: "高中", exact: true })
      .click();
    await expect(page.locator(".exam-grade-group")).toHaveCount(2);
    await page
      .getByRole("group", { name: "考试年级分类" })
      .getByRole("button", { name: "高一（1）", exact: true })
      .click();
    await expect(page.locator(".exam-list-entry")).toHaveCount(1);
    await expect(page.locator(".exam-list-entry")).toContainText("A9高一联考");
    await page.reload();
    await expect(page.locator(".exam-list-entry")).toHaveCount(1);
    await expect(page.getByLabel("筛选考试年级", { exact: true })).toHaveValue(
      "高中一年级",
    );
    await page.screenshot({
      path: "test-results/exam-grade-classification.png",
      fullPage: true,
    });
    await page
      .getByRole("group", { name: "考试学段分类" })
      .getByRole("button", { name: "初中", exact: true })
      .click();
    await expect(page.locator(".exam-list-entry")).toHaveCount(1);
    await expect(page.locator(".exam-list-entry")).toContainText(
      "初二阶段测试",
    );
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
