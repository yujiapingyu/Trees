import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { EMPTY_DATA, today } from "../../src/shared/domain.js";
import {
  academicTerm,
  schoolScheduleKey,
} from "../../src/shared/zhejiangCurriculum.js";
const require = createRequire(import.meta.url),
  { DiskStorage } = require("../../desktop/core.cjs");

test("全局搜索跨模块定位、拼音与文件名；助手隔离引用、取消和历史；浙江学校共用与学生覆盖接入规划", async () => {
  test.setTimeout(120000);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-assistant-ui-")),
    profile = path.join(temp, "profile"),
    root = path.join(temp, "students"),
    lessons = path.join(temp, "lessons"),
    folder = path.join(lessons, "高中/高一/对数"),
    textbooks = path.join(temp, "textbooks");
  await Promise.all([
    fs.mkdir(path.join(root, "王品越"), { recursive: true }),
    fs.mkdir(path.join(root, "隔离学生"), { recursive: true }),
    fs.mkdir(folder, { recursive: true }),
    fs.mkdir(path.join(root, "高二测试学生"), { recursive: true }),
    fs.mkdir(textbooks),
  ]);
  await fs.writeFile(path.join(folder, "对数教案.txt"), "对数定义和运算");
  await fs.writeFile(
    path.join(textbooks, "必修一.txt"),
    "目录 第一章 集合与逻辑 第三章 函数 第四章 指数函数与对数函数 第五章 三角函数",
  );
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const prompt = body.messages.at(-1).content;
    if (prompt.includes("取消测试")) {
      setTimeout(() => {
        if (!res.destroyed)
          res.end(
            JSON.stringify({
              choices: [{ message: { content: "不应写入的迟到回答" } }],
            }),
          );
      }, 3500);
      return;
    }
    const content = prompt.includes("其他报告内容保持不变")
      ? JSON.stringify({
          curriculum: {
            volume: "必修第一册",
            currentTopic: "对数函数",
            progressEvidence: "最近授课与学校安排",
            mode: "同步推进",
          },
          plan: Array.from({ length: 15 }, (_, i) => ({
            topic: "对数到函数衔接" + i,
            objectives: "完成对应任务",
            keyPoints: "条件与运算",
            hours: "1",
          })),
          planningNotes: "先补对数，再衔接学校三角函数",
        })
      : "我会先巩固对数运算，再衔接学校进度。记录显示需要注意真数条件。[S1]";
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const disk = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await disk.set("sm_path_config_v1", {
    studentsRoot: root,
    lessonsRoot: lessons,
    textbooksSenior: textbooks,
    deepseekKey: "test-only",
    deepseekHost: `http://127.0.0.1:${server.address().port}`,
  });
  await disk.set("sm_workspace_v1", {
    ...structuredClone(EMPTY_DATA),
    schools: [
      {
        id: "hs",
        name: "浙江测试高中",
        stage: "高中",
        mathSchedules: {
          [schoolScheduleKey("高中三年级", academicTerm())]: {
            ...academicTerm(),
            grade: "高中三年级",
            volume: "选择性必修第三册",
            chapter: "高三一轮复习",
            mode: "中高考复习",
            notes: "保留原安排",
            confirmedDate: today(),
          },
        },
      },
    ],
    students: [
      {
        id: "senior2",
        name: "高二测试学生",
        grade: "高中二年级",
        schoolId: "hs",
        directoryPath: path.join(root, "高二测试学生"),
        status: "稳定授课",
      },
      {
        id: "s",
        name: "王品越",
        grade: "高中一年级",
        schoolId: "hs",
        directoryPath: path.join(root, "王品越"),
        status: "稳定授课",
      },
      {
        id: "other",
        name: "隔离学生",
        grade: "初中一年级",
        directoryPath: path.join(root, "隔离学生"),
        status: "稳定授课",
      },
    ],
    lessons: [
      { id: "l", name: "对数", stage: "高中", grade: "高一", path: folder },
    ],
    refs: [{ id: "ref", studentId: "s", lessonId: "l" }],
    sessions: [
      {
        id: "session",
        studentId: "s",
        date: today(),
        topic: "对数",
        scope: "对数定义与运算",
        notes: "真数条件需要提醒",
        nextProgress: "对数函数",
        status: "completed",
        courseId: "l",
      },
    ],
    notes: [
      {
        id: "n",
        studentId: "s",
        title: "换底观察",
        date: today(),
        markdown: "换底独特观察内容",
      },
      {
        id: "other-note",
        studentId: "other",
        title: "独有隐私",
        date: today(),
        markdown: "隔离专属内容",
      },
    ],
    followups: [
      {
        id: "f",
        studentId: "s",
        date: today(),
        purpose: "复习沟通",
        content: "家长希望加强复习",
        nextDate: today(),
      },
    ],
    exams: [
      {
        id: "e",
        name: "A9联盟11月测试",
        grade: "高中一年级",
        date: today(),
        kind: "alliance",
        organizer: "A9",
        schoolIds: ["hs"],
        subjects: [],
        archived: true,
      },
    ],
  });
  let app;
  const errors = [];
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    const search = async (q) => {
      await page.getByRole("button", { name: "全局搜索", exact: true }).click();
      await page.getByLabel("全局搜索内容").fill(q);
    };
    await search("wpy");
    await page.getByLabel("全局搜索内容").press("Enter");
    await expect(page.locator(".profile-title")).toContainText("王品越");
    await search("换底独特");
    await page.getByLabel("全局搜索内容").press("Enter");
    await expect(page.locator('[data-search-key="记录:n"]')).toHaveClass(
      /search-highlight/,
    );
    await expect(page.locator('[data-search-key="记录:n"]')).toHaveAttribute(
      "open",
      "",
    );
    await search("复习沟通");
    await page.getByLabel("全局搜索内容").press("Enter");
    await expect(page.locator('[data-search-key="回访:f"]')).toHaveClass(
      /search-highlight/,
    );
    await search("A9联盟");
    await page.getByLabel("全局搜索内容").press("Enter");
    await expect(
      page.getByRole("heading", { name: "A9联盟11月测试", exact: true }),
    ).toBeVisible();
    await search("对数教案");
    await page
      .getByRole("button", { name: "刷新资源文件名", exact: true })
      .click();
    await expect(page.locator(".global-search-results")).toContainText(
      "对数教案.txt",
    );
    await page.screenshot({
      path: "test-results/workspace-global-search.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await search("王品越");
    await page.getByLabel("搜索类别").selectOption("学生");
    await page.getByLabel("全局搜索内容").press("Enter");
    await page.getByRole("tab", { name: "教材进度", exact: true }).click();
    await page.locator(".optional-curriculum-correction > summary").click();
    await page
      .getByLabel("学校当前教材册次", { exact: true })
      .selectOption("必修第一册");
    await page
      .getByLabel("学校当前章节或近期考试范围")
      .fill("学校在讲对数函数");
    await page
      .getByRole("button", { name: "保存教材进度", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("学生教材进度已保存");
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await page.getByLabel("助手资料范围").selectOption("s");
    await page
      .getByLabel("向助手提问")
      .fill("结合浙江教材与学校进度，给我下次课的建议");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".chat-message.assistant")).toContainText(
      "巩固对数",
    );
    const first = JSON.stringify(
      requests.findLast((r) =>
        r.messages.at(-1).content.startsWith("本轮范围："),
      ),
    );
    expect(first).toContain("学校在讲对数函数");
    expect(first).toContain("换底独特观察内容");
    expect(first).toContain("本地教材目录");
    expect(first).not.toContain("隔离专属内容");
    expect(first).not.toContain("test-only");
    await page.locator(".assistant-sources summary").click();
    await page.screenshot({
      path: "test-results/workspace-assistant-sources.png",
      fullPage: true,
    });
    await page
      .locator(".assistant-sources button")
      .filter({ hasText: "换底观察" })
      .click();
    await expect(page.locator('[data-search-key="记录:n"]')).toHaveClass(
      /search-highlight/,
    );
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await expect(page.locator(".chat-message.assistant")).toContainText(
      "巩固对数",
    );
    await page.getByLabel("助手资料范围").selectOption("other");
    await expect(page.locator(".chat-message")).toHaveCount(0);
    await page.getByLabel("向助手提问").fill("取消测试");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect
      .poll(
        () =>
          requests.filter((r) =>
            r.messages.at(-1).content.includes("教师问题：取消测试"),
          ).length,
      )
      .toBe(1);
    await page.getByRole("button", { name: "取消请求" }).click();
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("向助手提问")).toHaveValue("取消测试");
    await page.getByLabel("助手资料范围").selectOption("general");
    await expect(page.locator(".chat-message")).toHaveCount(0);
    await page.getByLabel("向助手提问").fill("给我沟通建议");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".chat-message.assistant")).toBeVisible();
    expect(
      JSON.stringify(
        requests.findLast((r) =>
          r.messages.at(-1).content.startsWith("本轮范围："),
        ),
      ),
    ).not.toContain("王品越");
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "配置中心", exact: true })
      .click();
    await page
      .getByRole("button", { name: "浙江教材与进度", exact: true })
      .click();
    await page.locator(".optional-curriculum-correction > summary").click();
    await page.getByLabel("共用安排的学校").selectOption("hs");
    const schoolRows = page.locator("[data-curriculum-grade]");
    await expect(schoolRows).toHaveCount(3);
    await expect(
      page.locator('[data-curriculum-grade="高中三年级"]'),
    ).toContainText("高三一轮复习");
    await page
      .getByRole("button", { name: "编辑高一进度", exact: true })
      .click();
    await page.getByLabel("学校当前教材册次").selectOption("必修第一册");
    await page
      .getByLabel("学校当前章节或近期考试范围")
      .fill("本校统一三角函数");
    await page
      .getByRole("button", { name: "保存高一进度", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("本校高一进度已保存");
    await page
      .getByRole("button", { name: "编辑高二进度", exact: true })
      .click();
    await page.getByLabel("学校当前教材册次").selectOption("选择性必修第一册");
    await page.getByLabel("学校当前章节或近期考试范围").fill("高二圆锥曲线");
    await page
      .getByRole("button", { name: "保存高二进度", exact: true })
      .click();
    await expect(
      page.locator('[data-curriculum-grade="高中一年级"]'),
    ).toContainText("本校统一三角函数");
    await expect(
      page.locator('[data-curriculum-grade="高中二年级"]'),
    ).toContainText("高二圆锥曲线");
    await expect(
      page.locator('[data-curriculum-grade="高中三年级"]'),
    ).toContainText("高三一轮复习");
    await page
      .getByRole("button", { name: "编辑高一进度", exact: true })
      .click();
    await expect(page.getByLabel("学校当前章节或近期考试范围")).toHaveValue(
      "本校统一三角函数",
    );
    await page.getByLabel("教材安排学期").selectOption("下学期");
    await expect(
      page.locator('[data-curriculum-grade="高中二年级"]'),
    ).toContainText("尚未设置");
    await page
      .getByRole("button", { name: "编辑高二进度", exact: true })
      .click();
    await page.getByLabel("学校当前教材册次").selectOption("选择性必修第二册");
    await page
      .getByLabel("学校当前章节或近期考试范围")
      .fill("高二下学期数列与导数");
    await page
      .getByRole("button", { name: "保存高二进度", exact: true })
      .click();
    await expect(
      page.locator('[data-curriculum-grade="高中二年级"]'),
    ).toContainText("高二下学期数列与导数");
    await page.getByLabel("教材安排学期").selectOption("上学期");
    await expect(
      page.locator('[data-curriculum-grade="高中二年级"]'),
    ).toContainText("高二圆锥曲线");
    await page.getByRole("button", { name: "收起年级编辑" }).click();
    await page.screenshot({
      path: "test-results/workspace-school-all-grades.png",
      fullPage: true,
    });
    await search("高二测试学生");
    await page.getByLabel("全局搜索内容").press("Enter");
    await page.getByRole("tab", { name: "教材进度", exact: true }).click();
    await page.locator(".optional-curriculum-correction > summary").click();
    await expect(page.locator(".curriculum-current")).toContainText(
      "高二圆锥曲线",
    );
    await expect(page.locator(".curriculum-current")).not.toContainText(
      "本校统一三角函数",
    );
    await search("隔离学生");
    await page.getByLabel("全局搜索内容").press("Enter");
    await page.getByRole("tab", { name: "教材进度", exact: true }).click();
    await page.locator(".optional-curriculum-correction > summary").click();
    await expect(page.locator(".curriculum-panel")).not.toContainText(
      "浙江测试高中",
    );
    await expect(page.locator(".curriculum-form .info-banner")).toHaveCount(0);
    await search("王品越");
    await page.getByLabel("全局搜索内容").press("Enter");
    await page.getByRole("tab", { name: "教材进度", exact: true }).click();
    await page.locator(".optional-curriculum-correction > summary").click();
    await page.getByRole("button", { name: "清除学生单独安排" }).click();
    await expect(page.locator(".curriculum-current")).toContainText(
      "本校统一三角函数",
    );
    await page.screenshot({
      path: "test-results/workspace-zhejiang-curriculum.png",
      fullPage: true,
    });
    await page.getByRole("tab", { name: "学情分析", exact: true }).click();
    await page.getByRole("tab", { name: "课程规划", exact: true }).click();
    await page
      .getByRole("button", { name: "生成课程规划", exact: true })
      .click();
    await expect(page.locator(".student-detail .markdown")).toContainText(
      "第15次课",
    );
    expect(JSON.stringify(requests.at(-1))).toContain("本校统一三角函数");
    expect(JSON.stringify(requests.at(-1))).toContain("对数函数");
    const boot = await page.evaluate(() => window.services.bootstrap());
    expect(
      boot.data.schools[0].mathSchedules[
        schoolScheduleKey("高中一年级", academicTerm())
      ].chapter,
    ).toBe("本校统一三角函数");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await page.getByLabel("助手资料范围").selectOption("s");
    await expect(page.locator(".chat-message.assistant")).toContainText(
      "巩固对数",
    );
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
