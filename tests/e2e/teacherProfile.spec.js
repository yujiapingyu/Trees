import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { EMPTY_DATA } from "../../src/shared/domain.js";
const require = createRequire(import.meta.url),
  { DiskStorage } = require("../../desktop/core.cjs");

test("左下角个人信息保存、草稿与重启，写入SQLite并自动成为新报告署名", async () => {
  test.setTimeout(60000);
  const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "zhixu-teacher-profile-"),
    ),
    profile = path.join(temp, "profile"),
    root = path.join(temp, "students"),
    directoryPath = path.join(root, "教师资料验证学生");
  await fs.mkdir(directoryPath, { recursive: true });
  const disk = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await disk.set("sm_path_config_v1", { studentsRoot: root });
  await disk.set("sm_workspace_v1", {
    ...structuredClone(EMPTY_DATA),
    students: [
      {
        id: "s",
        name: "教师资料验证学生",
        grade: "高中一年级",
        directoryPath,
        status: "稳定授课",
      },
    ],
  });
  await disk.set("sm_view_state_students", {
    selected: "s",
    query: "",
    grade: "",
    status: "active",
    tab: "reports",
    course: "",
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
    await page
      .getByRole("button", { name: "教师个人信息", exact: true })
      .click();
    await page.getByLabel("教师姓名", { exact: true }).fill("测试教师");
    await page.getByLabel("显示称呼", { exact: true }).fill("测试老师");
    await page.getByLabel("任教学科", { exact: true }).fill("高中数学");
    await page.getByLabel("任教机构", { exact: true }).fill("测试教学工作室");
    await page.getByLabel("联系电话", { exact: true }).fill("0571-12345678");
    await page.getByLabel("微信号", { exact: true }).fill("teacher-test");
    await page
      .getByLabel("个人简介", { exact: true })
      .fill("擅长函数与几何，注重审题和独立思考。");
    await page.getByRole("button", { name: "稍后继续", exact: true }).click();
    await expect(page.locator(".teacher-profile-entry")).toContainText(
      "教师信息",
    );
    await page
      .getByRole("button", { name: "教师个人信息", exact: true })
      .click();
    await expect(page.getByLabel("教师姓名", { exact: true })).toHaveValue(
      "测试教师",
    );
    await page
      .getByRole("button", { name: "保存个人信息", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".teacher-profile-entry")).toContainText(
      "测试老师",
    );
    const b = await page.evaluate(() => window.services.bootstrap());
    expect(b.data.teacherProfile.phone).toBe("0571-12345678");
    expect(b.data.teacherProfile.name).toBe("测试教师");
    expect(b.config.teacherProfile).toBeUndefined();
    await page
      .getByRole("button", { name: "新建入学报告", exact: true })
      .click();
    await expect(page.getByLabel("报告学科教师", { exact: true })).toHaveValue(
      "测试教师",
    );
    await page
      .getByRole("button", { name: "教师个人信息", exact: true })
      .click();
    await page.screenshot({
      path: "test-results/teacher-profile-settings.png",
      fullPage: true,
    });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.locator(".teacher-profile-entry")).toContainText(
      "测试老师",
    );
    await page
      .getByRole("button", { name: "教师个人信息", exact: true })
      .click();
    await expect(page.getByLabel("个人简介", { exact: true })).toHaveValue(
      "擅长函数与几何，注重审题和独立思考。",
    );
    await expect(page.getByLabel("微信号", { exact: true })).toHaveValue(
      "teacher-test",
    );
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
