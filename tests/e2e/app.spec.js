import { test, expect } from "@playwright/test";
const names = [
  "学生管理",
  "回访管理",
  "学生记录",
  "错题报告",
  "教学资源",
  "教学视频",
  "讲义库",
  "考试管理",
  "配置中心",
];
test("9 个入口与真实空状态可打开；路由和快捷键恢复", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "学生管理", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("当前为浏览器模式")).toBeVisible();
  for (const name of names) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: new RegExp("^" + name) })
      .click();
    await expect(
      page.getByRole("heading", {
        name: name,
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "配置中心", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("1");
  await expect(
    page.getByRole("heading", { name: "学生管理", exact: true }),
  ).toBeVisible();
  await page.getByPlaceholder("搜索姓名、年级或拼音…").fill("2");
  await expect(
    page.getByRole("heading", { name: "学生管理", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("配置保存、密钥显隐及浏览器文件错误反馈", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "配置中心" })
    .click();
  await page.getByLabel("学生根目录", { exact: true }).fill("/test/students");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByRole("status")).toContainText("配置已保存");
  await page.reload();
  await expect(page.getByLabel("学生根目录", { exact: true })).toHaveValue(
    "/test/students",
  );
  await page.getByRole("button", { name: "AI 模型服务" }).click();
  await page
    .getByLabel("DeepSeek API Key", { exact: true })
    .fill("test-only-key");
  await expect(
    page.getByLabel("DeepSeek API Key", { exact: true }),
  ).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "显示", exact: true }).first().click();
  await expect(
    page.getByLabel("DeepSeek API Key", { exact: true }),
  ).toHaveAttribute("type", "text");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /学生管理/ })
    .click();
  await page.getByRole("button", { name: "刷新目录" }).click();
  await expect(page.getByRole("status")).toContainText("需要桌面文件服务");
});
test("小窗口布局可访问，导航可横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "连接学生目录" }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "配置中心" })
    .click();
  await expect(page.getByRole("button", { name: "保存配置" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("移除模块的旧路由会回到学生页，过期配置不会继续生效", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sm_view_state_route", JSON.stringify("visionDemo"));
    localStorage.setItem(
      "sm_path_config_v1",
      JSON.stringify({
        deepseekKey: "existing-test-key",
        qwenKey: "retired-key",
        whisperPath: "/retired/tool",
        deepseekVisionModel: "retired-model",
      }),
    );
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "学生管理", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("button", { name: "视觉实验" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation").getByRole("button", { name: "试卷分析" }),
  ).toHaveCount(0);
  const config = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("sm_path_config_v1")),
  );
  expect(config).toEqual({ deepseekKey: "existing-test-key" });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "配置中心" })
    .click();
  await expect(
    page.getByRole("button", { name: "学校管理", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "语音与文档", exact: true }),
  ).toHaveCount(0);
});
