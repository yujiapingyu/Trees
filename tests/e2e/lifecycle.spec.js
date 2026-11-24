import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

test("关闭窗口仍保留草稿，重复启动唤起原窗口，快捷键设置可持久化", async () => {
  test.setTimeout(60000);
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "teaching-lifecycle-"),
  );
  const env = { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile };
  let app;
  const launch = () =>
    electron.launch({ args: ["."], cwd: process.cwd(), env });
  try {
    app = await launch();
    const page = await app.firstWindow();
    // Capture the registered OS callback without sending keystrokes to the user's desktop.
    await app.evaluate(({ globalShortcut }) => {
      const register = globalShortcut.register.bind(globalShortcut);
      globalShortcut.register = (accelerator, callback) => {
        globalThis.__shortcutCallback = callback;
        return register(accelerator, callback);
      };
    });
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "配置中心" })
      .click();
    await page
      .getByRole("button", { name: "启动与快捷键", exact: true })
      .click();
    await expect(page.getByLabel("全局唤起快捷键")).toHaveValue(
      "CommandOrControl+Shift+J",
    );
    await page
      .getByLabel("全局唤起快捷键")
      .fill("CommandOrControl+Alt+Shift+Y");
    await page.getByRole("button", { name: "保存桌面设置" }).click();
    await expect(
      page.getByText("桌面设置已保存", { exact: true }),
    ).toBeVisible();
    expect(
      await app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("CommandOrControl+Alt+Shift+Y"),
      ),
    ).toBe(true);
    await page.getByLabel("全局唤起快捷键").fill("Control+Shift+U");
    const toggled = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const nativeFocus = win.isFocused;
      try {
        // Other concurrent test windows may take native focus. Pin only this input
        // while exercising the real registered callback and native hide/show methods.
        win.isFocused = () => true;
        globalThis.__shortcutCallback();
        const hidden = !win.isVisible();
        globalThis.__shortcutCallback();
        const restored = win.isVisible();
        win.isFocused = () => false;
        globalThis.__shortcutCallback();
        return { hidden, restored, unfocusedRestored: win.isVisible() };
      } finally {
        win.isFocused = nativeFocus;
      }
    });
    expect(toggled).toEqual({
      hidden: true,
      restored: true,
      unfocusedRestored: true,
    });
    await expect(page.getByLabel("全局唤起快捷键")).toHaveValue(
      "Control+Shift+U",
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    expect(
      await app.evaluate(({ BrowserWindow }) => ({
        count: BrowserWindow.getAllWindows().length,
        visible: BrowserWindow.getAllWindows()[0].isVisible(),
      })),
    ).toEqual({ count: 1, visible: false });
    const second = spawn(require("electron"), ["."], {
      cwd: process.cwd(),
      env,
      stdio: "ignore",
    });
    const closed = new Promise((resolve, reject) => {
      second.on("error", reject);
      second.on("exit", resolve);
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible(),
        ),
      )
      .toBe(true);
    expect(await closed).toBe(0);
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    await expect(page.getByLabel("全局唤起快捷键")).toHaveValue(
      "Control+Shift+U",
    );
    await page.getByLabel("全局唤起快捷键").fill("");
    await page.getByRole("button", { name: "保存桌面设置" }).click();
    await expect(
      page.getByText("桌面设置已保存", { exact: true }),
    ).toBeVisible();
    expect(
      await app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("CommandOrControl+Alt+Shift+Y"),
      ),
    ).toBe(false);
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await restored
      .getByRole("navigation")
      .getByRole("button", { name: "配置中心" })
      .click();
    await restored
      .getByRole("button", { name: "启动与快捷键", exact: true })
      .click();
    await expect(restored.getByLabel("全局唤起快捷键")).toHaveValue("");
    const state = await restored.evaluate(() => window.services.desktopState());
    expect(state.openAtLogin).toBe(false);
    expect(state.registered).toBe(false);
  } finally {
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
