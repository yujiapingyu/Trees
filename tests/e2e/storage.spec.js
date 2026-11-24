import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { EMPTY_DATA } from "../../src/shared/domain.js";
const require = createRequire(import.meta.url);
const { WorkspaceDatabase } = require("../../desktop/sqlite.cjs");
test("旧JSON迁移SQLite，配置中心更换位置、取消与拒绝覆盖，重启后打开已有库并保留本机配置", async () => {
  test.setTimeout(60000);
  const temp = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-storage-ui-")),
    ),
    profile = path.join(temp, "profile"),
    cloud = path.join(temp, "cloud");
  await fs.mkdir(profile);
  await fs.mkdir(cloud);
  const source = JSON.stringify({
    sm_workspace_v1: {
      ...structuredClone(EMPTY_DATA),
      students: [
        {
          id: "old",
          name: "原档案学生",
          grade: "高中一年级",
          status: "稳定授课",
          directoryPath: "/not-mounted",
        },
      ],
    },
    sm_path_config_v1: { deepseekKey: "local-test-only" },
    sm_view_state_settings: "storage",
  });
  await fs.writeFile(path.join(profile, "workspace.json"), source);
  let app;
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
    });
  const pick = async (file) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: !file,
        filePaths: file ? [file] : [],
      });
    }, file);
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "配置中心" })
      .click();
    await page.getByRole("button", { name: "数据与备份", exact: true }).click();
    await expect(page.getByText("SQLite · 数据文件已保存")).toBeVisible();
    await expect(page.locator(".storage-location")).toContainText("学生 1");
    expect(
      await fs.readFile(path.join(profile, "workspace.json"), "utf8"),
    ).toBe(source);
    await pick(null);
    await page.getByRole("button", { name: "更改保存文件夹" }).click();
    await expect(
      page.getByRole("region", { name: "数据文件确认" }),
    ).toHaveCount(0);
    await pick(cloud);
    await page.getByRole("button", { name: "更改保存文件夹" }).click();
    await expect(
      page.getByRole("region", { name: "数据文件确认" }),
    ).toContainText("知序数据.sqlite");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "数据文件确认" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "更改保存文件夹" }).click();
    await Promise.all([
      page.waitForEvent("domcontentloaded"),
      page.getByRole("button", { name: "确认并重新加载" }).click(),
    ]);
    await expect(page.locator(".storage-location")).toContainText(
      cloud + "/知序数据.sqlite",
    );
    const info = await page.evaluate(() => window.services.bootstrap());
    expect(info.storageState.pending).toBe(false);
    expect(info.data.students[0].id).toBe("old");
    expect(WorkspaceDatabase.inspect(info.storagePath).counts.students).toBe(1);
    await page.getByRole("button", { name: "更改保存文件夹" }).click();
    await expect(page.getByText(/该文件夹已有/)).toBeVisible();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator(".storage-location")).toContainText(
      cloud + "/知序数据.sqlite",
    );
    const sourceDB = await new WorkspaceDatabase(
      path.join(temp, "another-work.sqlite"),
    ).init({ create: true });
    sourceDB.set({
      ...structuredClone(EMPTY_DATA),
      students: [
        {
          id: "remote",
          name: "另一台电脑学生",
          grade: "高一",
          status: "稳定授课",
        },
      ],
      followups: [{ id: "follow", studentId: "remote", content: "已有回访" }],
    });
    const portable = path.join(temp, "另一份.sqlite");
    await sourceDB.snapshot(portable);
    sourceDB.close();
    await pick(portable);
    await page.getByRole("button", { name: "打开已有数据库" }).click();
    await expect(
      page.getByRole("region", { name: "数据文件确认" }),
    ).toContainText("回访 1");
    await page.getByRole("button", { name: "确认并重新加载" }).click();
    await expect(page.locator(".storage-location")).toContainText(portable);
    const after = await page.evaluate(() => window.services.bootstrap());
    expect(after.data.students[0].id).toBe("remote");
    expect(after.config.deepseekKey).toBe("local-test-only");
    await fs.writeFile(portable, "broken cloud");
    await page.evaluate(async () => {
      const data = (await window.services.bootstrap()).data;
      data.notes.push({ id: "note", studentId: "remote", content: "本机改动" });
      await window.services.storageSet("sm_workspace_v1", data);
    });
    await expect(
      page.getByRole("alert").filter({ hasText: "改动已保存在本机" }),
    ).toBeVisible();
    expect(
      (await page.evaluate(() => window.services.bootstrap())).data.notes[0].id,
    ).toBe("note");
    expect(await fs.readFile(portable, "utf8")).toBe("broken cloud");
    await page.screenshot({
      path: "test-results/sqlite-storage-settings.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
