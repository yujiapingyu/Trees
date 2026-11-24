import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { EMPTY_DATA } from "../../src/shared/domain.js";
const require = createRequire(import.meta.url),
  { DiskStorage } = require("../../desktop/core.cjs");
test("草稿跨页面与重启、授课反馈进度、分析过期与版本、学生回收站、完整备份恢复及按钮对比度", async () => {
  test.setTimeout(120000);
  const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "zhixu-improvements-ui-"),
    ),
    profile = path.join(temp, "profile"),
    root = path.join(temp, "students"),
    lessonRoot = path.join(temp, "lessons"),
    exports = path.join(temp, "exports"),
    restores = path.join(temp, "restores");
  const studentPath = path.join(root, "测试学生"),
    lessonPath = path.join(lessonRoot, "高中/高一/对数");
  for (const p of [studentPath, lessonPath, exports, restores])
    await fs.mkdir(p, { recursive: true });
  await fs.writeFile(
    path.join(lessonPath, "对数教案.txt"),
    "对数定义与运算、换底公式",
  );
  await fs.writeFile(path.join(studentPath, "原文件.txt"), "需原样恢复");
  const requests = [],
    server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      requests.push(body);
      const prompt = body.messages.at(-1).content;
      const value = prompt.includes("其他报告内容保持不变")
        ? JSON.stringify({
            plan: Array.from({ length: 15 }, (_, i) => ({
              topic: "对数后续训练" + i,
              objectives: "能独立完成基础任务",
              keyPoints: "概念与应用",
              hours: "1",
            })),
            curriculum: {
              volume: "必修一",
              currentTopic: "对数定义",
              progressEvidence: "最新授课记录",
              mode: "同步推进",
            },
            planningNotes: "先巩固对数定义，再推进运算及函数",
          })
        : "基于最新记录的学情分析";
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: value } }] }));
    });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const disk = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await disk.set("sm_path_config_v1", {
    studentsRoot: root,
    lessonsRoot: lessonRoot,
    deepseekKey: "test-only",
    deepseekHost: `http://127.0.0.1:${server.address().port}`,
  });
  await disk.set("sm_workspace_v1", {
    ...structuredClone(EMPTY_DATA),
    students: [
      {
        id: "s",
        name: "测试学生",
        directoryPath: studentPath,
        grade: "高中一年级",
        status: "稳定授课",
      },
    ],
    lessons: [
      { id: "l", name: "对数", path: lessonPath, stage: "高中", grade: "高一" },
    ],
    refs: [{ id: "r", studentId: "s", lessonId: "l" }],
  });
  await disk.set("sm_view_state_students", {
    selected: "s",
    course: "l",
    tab: "sessions",
    query: "",
    grade: "",
    status: "active",
  });
  let app;
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
    });
  let errors = [];
  const nav = async (page, name) =>
    page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
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
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "登记本次课", exact: true }).click();
    await page.getByLabel("授课主题", { exact: true }).fill("对数定义");
    await page
      .getByLabel("实际讲授范围", { exact: true })
      .fill("第2页第3题，未讲换底公式");
    await page.getByLabel("下次继续进度", { exact: true }).fill("对数运算");
    await page
      .getByLabel("课堂表现与观察", { exact: true })
      .fill("能复述定义，真数条件还需提醒");
    await page
      .getByLabel("实际授课时长（分钟，可留空）", { exact: true })
      .fill("90");
    await page.getByLabel("关联讲义 / 考试", { exact: true }).selectOption("l");
    await page.screenshot({
      path: "test-results/improvements-session-draft.png",
      fullPage: true,
    });
    await nav(page, "回访管理");
    await nav(page, "学生管理");
    await expect(page.getByLabel("授课主题", { exact: true })).toHaveValue(
      "对数定义",
    );
    await page
      .getByRole("button", { name: "保存授课记录", exact: true })
      .click();
    await expect(
      page.getByText("已完成授课 1 次", { exact: false }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "学习报告", exact: true }).click();
    await page.getByText("授课次数与报告周期", { exact: true }).click();
    await expect(
      page.getByLabel("已确认授课次数", { exact: true }),
    ).toHaveValue("1");
    await page
      .getByRole("button", { name: "新建入学报告", exact: true })
      .click();
    await page
      .getByLabel("当前学习进度（可选补充）", { exact: true })
      .fill("报告未提交的进度补充");
    await nav(page, "回访管理");
    await nav(page, "学生管理");
    await expect(
      page.getByLabel("当前学习进度（可选补充）", { exact: true }),
    ).toHaveValue("报告未提交的进度补充");
    await page.reload();
    await expect(
      page.getByLabel("当前学习进度（可选补充）", { exact: true }),
    ).toHaveValue("报告未提交的进度补充");
    await page.getByRole("tab", { name: "课堂反馈", exact: true }).click();
    await page
      .getByLabel("关联本次授课记录", { exact: true })
      .selectOption({ index: 1 });
    await expect(
      page.getByLabel("本次实际讲授范围", { exact: true }),
    ).toHaveValue("第2页第3题，未讲换底公式");
    await expect(page.getByLabel("本节课记录", { exact: true })).toHaveValue(
      "能复述定义，真数条件还需提醒",
    );
    await nav(page, "回访管理");
    await page
      .getByRole("button", { name: /测试学生/ })
      .first()
      .click();
    await page
      .getByLabel("沟通内容", { exact: true })
      .fill("回访草稿需跨重启保留");
    await page.getByLabel("回访内容摘要", { exact: true }).fill("摘要草稿");
    await nav(page, "学生记录");
    await page
      .getByRole("button", { name: /测试学生/ })
      .first()
      .click();
    await page.getByRole("button", { name: "新建记录", exact: true }).click();
    await page.getByLabel("标题", { exact: true }).fill("未保存的观察");
    await page.getByLabel("正文", { exact: true }).fill("正文草稿需保留");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.getByLabel("正文", { exact: true })).toHaveValue(
      "正文草稿需保留",
    );
    await page.getByRole("button", { name: "保存记录", exact: true }).click();
    await nav(page, "回访管理");
    await expect(page.getByLabel("沟通内容", { exact: true })).toHaveValue(
      "回访草稿需跨重启保留",
    );
    await expect(page.getByLabel("回访内容摘要", { exact: true })).toHaveValue(
      "摘要草稿",
    );
    await nav(page, "学生管理");
    await expect(page.getByLabel("本节课记录", { exact: true })).toHaveValue(
      "能复述定义，真数条件还需提醒",
    );
    await page.getByRole("tab", { name: "学情分析", exact: true }).click();
    await page
      .getByRole("button", { name: "生成学情分析", exact: true })
      .click();
    await expect(
      page.locator(".markdown").filter({ hasText: "基于最新记录的学情分析" }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const b = await window.services.bootstrap();
      b.data.notes.push({
        id: "new",
        studentId: "s",
        date: "2026-11-23",
        markdown: "新观察",
      });
      await window.services.storageSet("sm_workspace_v1", b.data);
    });
    await page.reload();
    await expect(page.getByText(/分析需要更新：学生记录/)).toBeVisible();
    await page.getByRole("button", { name: "重新生成", exact: true }).click();
    await expect(
      page.getByText("上次分析版本（1）", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "课程规划", exact: true }).click();
    await page
      .getByRole("button", { name: "生成课程规划", exact: true })
      .click();
    await expect(page.locator(".markdown")).toContainText("第15次课");
    expect(requests.at(-1).messages.at(-1).content).toContain("对数运算");
    await page
      .getByRole("button", { name: "学生更多操作", exact: true })
      .click();
    await page
      .getByRole("button", { name: "移入学生回收站", exact: true })
      .click();
    await page.getByRole("dialog").getByRole("textbox").fill("测试学生");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认执行", exact: true })
      .click();
    await expect(page.locator(".student-list-items")).not.toContainText(
      "测试学生",
    );
    await page.getByRole("button", { name: /学生回收站/ }).click();
    await page.getByRole("button", { name: "恢复学生", exact: true }).click();
    await expect(page.getByText("回收站为空", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    expect(
      await fs.readFile(path.join(studentPath, "原文件.txt"), "utf8"),
    ).toBe("需原样恢复");
    await nav(page, "配置中心");
    await page.getByRole("button", { name: "数据与备份", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "预览恢复此备份" }).first(),
    ).toBeVisible();
    await pick(exports);
    await page
      .getByRole("button", { name: "导出完整备份", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "完整备份已保存" }),
    ).toBeVisible();
    const folder = path.join(exports, (await fs.readdir(exports))[0]);
    await pick(folder);
    await page
      .getByRole("button", { name: "从完整备份恢复", exact: true })
      .click();
    await pick(restores);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认执行", exact: true })
      .click();
    await expect(page.locator(".storage-location")).toContainText(restores);
    const after = await page.evaluate(() => window.services.bootstrap());
    expect(after.data.sessions).toHaveLength(1);
    expect(after.data.notes).toHaveLength(2);
    expect(after.data.students[0].directoryPath).not.toBe(studentPath);
    expect(
      await fs.readFile(
        path.join(after.data.students[0].directoryPath, "原文件.txt"),
        "utf8",
      ),
    ).toBe("需原样恢复");
    const button = page.getByRole("button", {
      name: "更改保存文件夹",
      exact: true,
    });
    await button.hover();
    const hoverStyle = () =>
      button.evaluate((el) => {
        const s = getComputedStyle(el);
        return { fg: s.color, bg: s.backgroundColor };
      });
    await expect
      .poll(hoverStyle)
      .toEqual({ bg: "rgb(40, 93, 204)", fg: "rgb(255, 255, 255)" });
    await page.screenshot({
      path: "test-results/improvements-backup-hover.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
