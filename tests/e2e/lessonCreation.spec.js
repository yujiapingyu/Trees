import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { DiskStorage } = require("../../desktop/core.cjs"),
  { lessonFixture } = require("../helpers/lessonFixture.cjs");
test("参照旧项目新建：继承学段、选择标准/扩展年级、默认模板、标题命名、自动选中、同名保护及中职直建", async () => {
  test.setTimeout(60000);
  const tmp = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-create-ui-")),
    ),
    profile = path.join(tmp, "profile"),
    root = path.join(tmp, "讲义库"),
    alias = path.join(tmp, "讲义库入口"),
    templates = path.join(tmp, "模板");
  await fs.mkdir(path.join(root, "高中", "总复习"), { recursive: true });
  await fs.mkdir(path.join(root, "高中", "高一（同步）"));
  await fs.symlink(root, alias);
  await fs.mkdir(templates);
  const bytes = await lessonFixture(),
    a = path.join(templates, "1.默认模板.docx"),
    b = path.join(templates, "2.备用模板.docx");
  await fs.writeFile(a, bytes);
  const second = await lessonFixture({ empty: true });
  await fs.writeFile(b, second);
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await store.set("sm_path_config_v1", {
    lessonsRoot: alias,
    templatesRoot: templates,
  });
  let app;
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
    });
  try {
    app = await launch();
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "讲义库" })
      .click();
    await page.getByRole("tab", { name: "高中", exact: true }).click();
    await page.getByPlaceholder("搜索标题、年级、路径…").fill("不存在的筛选");
    await page.getByRole("button", { name: "新建讲义", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("新建讲义（高中）");
    await expect(dialog.getByLabel("年级", { exact: true })).toHaveValue(
      "高一",
    );
    await expect(dialog.getByLabel("讲义模板", { exact: true })).toHaveValue(a);
    await expect(
      dialog.getByLabel("年级", { exact: true }).locator("option"),
    ).toHaveText(["高一", "高二", "高三", "高一（同步）", "总复习"]);
    await dialog.getByLabel("年级", { exact: true }).selectOption("总复习");
    await dialog.getByLabel("讲义名称", { exact: true }).fill("三角函数专题");
    await expect(
      dialog.getByRole("region", { name: "创建位置" }),
    ).toContainText("三角函数专题（教案）.docx");
    await page.screenshot({ path: "test-results/create-lesson-reference.png" });
    await dialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".lesson-detail-header h2")).toHaveText(
      "三角函数专题",
    );
    expect(
      await fs.readFile(
        path.join(
          root,
          "高中",
          "总复习",
          "三角函数专题",
          "三角函数专题（教案）.docx",
        ),
      ),
    ).toEqual(bytes);
    expect(await fs.readFile(a)).toEqual(bytes);
    expect(
      (
        await page.evaluate(() => window.services.bootstrap())
      ).data.lessons.filter((l) => l.name === "三角函数专题"),
    ).toHaveLength(1);
    await page.getByRole("button", { name: "新建讲义", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("年级", { exact: true }).selectOption("总复习");
    await dialog.getByLabel("讲义名称", { exact: true }).fill("三角函数专题");
    await dialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("同名讲义");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("tab", { name: "中职", exact: true }).click();
    await page.getByRole("button", { name: "新建讲义", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("年级", { exact: true })).toHaveCount(0);
    await dialog.getByLabel("讲义模板", { exact: true }).selectOption(b);
    await dialog.getByLabel("讲义名称", { exact: true }).fill("函数入门");
    await dialog.getByLabel("讲义名称", { exact: true }).press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".lesson-detail-header h2")).toHaveText(
      "函数入门",
    );
    expect(
      await fs.readFile(
        path.join(root, "中职", "函数入门", "函数入门（教案）.docx"),
      ),
    ).toEqual(second);
    await expect(page.locator(".lesson-list-item")).toHaveCount(1);
    await fs.rm(a);
    await fs.rm(b);
    await page.getByRole("tab", { name: "初中", exact: true }).click();
    await page.getByRole("button", { name: "新建讲义", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "模板目录为空",
    );
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "创建", exact: true }),
    ).toBeDisabled();
    await expect(fs.access(path.join(root, "初中"))).rejects.toBeDefined();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await page.getByRole("tab", { name: "高中", exact: true }).click();
    await page
      .locator(".lesson-list-item")
      .filter({ hasText: "三角函数专题" })
      .click();
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await expect(restored.locator(".lesson-detail-header h2")).toHaveText(
      "三角函数专题",
    );
    const saved = await restored.evaluate(() => window.services.bootstrap());
    expect(
      saved.data.lessons.filter((l) => l.name === "三角函数专题"),
    ).toHaveLength(1);
    expect(saved.data.lessons.find((l) => l.name === "三角函数专题").path).toBe(
      path.join(alias, "高中", "总复习", "三角函数专题"),
    );
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
