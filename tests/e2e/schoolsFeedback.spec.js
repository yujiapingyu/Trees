import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { today } from "../../src/shared/domain.js";
const require = createRequire(import.meta.url);
const {
  DiskStorage,
  FileService,
  DocumentService,
} = require("../../desktop/core.cjs");
test("学校分学段管理、学生关联、两处新引用置顶和讲义事实反馈重启恢复", async () => {
  test.setTimeout(60000);
  const tmp = await fs.mkdtemp(
    path.join(os.tmpdir(), "teaching-schools-feedback-"),
  );
  const profile = path.join(tmp, "profile"),
    students = path.join(tmp, "学生"),
    lessons = path.join(tmp, "讲义"),
    studentPath = path.join(students, "测试学生");
  await fs.mkdir(path.join(studentPath, "原本地课程"), { recursive: true });
  await fs.mkdir(lessons);
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  let requests = [];
  let forceBad = false;
  const payload = {
    theme: "二项分布、超几何分布与正态分布",
    contentPoints: [
      {
        topic: "二项分布",
        details: ["独立重复试验的条件", "概率计算与公式中参数含义"],
      },
      {
        topic: "超几何分布与正态分布",
        details: ["不放回抽样的概率计算", "正态分布的对称性与常见概率性质"],
      },
    ],
    strengths: ["本节课整体学习情况较好，可在这一基础上继续巩固本节知识。"],
    weaknesses: [
      "二项分布部分仍需要加强。",
      "建议重点巩固二项分布与超几何分布的适用条件。",
    ],
    afterClass: ["建议复习二项分布公式，并安排针对练习。"],
  };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const response =
      forceBad || requests.length === 1
        ? {
            ...payload,
            strengths: [
              "本次课内容紧扣主题。",
              "教师能够结合当前分数规划基础巩固。",
              "讲义中的题型有层次。",
            ],
          }
        : payload;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(response) } }],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await store.set("sm_path_config_v1", {
    studentsRoot: students,
    lessonsRoot: lessons,
    deepseekKey: "test-only-key",
    deepseekHost: `http://127.0.0.1:${server.address().port}/v1`,
  });
  await store.set("sm_workspace_v1", {
    students: [
      {
        id: "student-one",
        name: "测试学生",
        directoryPath: studentPath,
        status: "稳定授课",
        grade: "高中二年级",
        phone: "",
        notes: "",
      },
    ],
  });
  await store.set("sm_view_state_students", {
    selected: "student-one",
    query: "",
    grade: "",
    status: "active",
    course: "",
    tab: "overview",
    courseWidth: 232,
  });
  const docs = new DocumentService(new FileService(store));
  for (const name of ["旧讲义", "新讲义", "库中分配讲义"])
    await docs.word(
      path.join(lessons, "高中", "高二", name, "教案.docx"),
      "教学目标：理解二项分布、超几何分布与正态分布\n教学重点：独立重复试验、不放回抽样、正态分布的对称性\n1. 计算二项分布的概率",
    );
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
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "配置中心" })
      .click();
    await page.getByRole("button", { name: "学校管理", exact: true }).click();
    await page.getByLabel("新增学校名称").fill("实验初中");
    await page.getByRole("button", { name: "添加学校", exact: true }).click();
    await expect(page.locator(".school-manager .linked-row")).toContainText(
      "实验初中",
    );
    await page.getByRole("tab", { name: "高中", exact: true }).click();
    await page.getByLabel("新增学校名称").fill("实验高中");
    await page.getByRole("button", { name: "添加学校", exact: true }).click();
    await expect(page.locator(".school-manager .linked-row")).toContainText(
      "实验高中",
    );
    await expect(page.locator(".school-manager .linked-row")).not.toContainText(
      "实验初中",
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "学生管理" })
      .click();
    await page.getByRole("button", { name: "编辑学生档案" }).click();
    await expect(page.getByLabel("学校学段", { exact: true })).toHaveValue(
      "高中",
    );
    await page
      .getByLabel("关联学校", { exact: true })
      .selectOption({ label: "实验高中" });
    await page.getByRole("button", { name: "管理 / 新增学校" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.locator(".profile-meta")).toContainText("实验高中");
    await page
      .getByRole("button", { name: "从讲义库添加", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .locator(".lesson-pick-row")
      .filter({ hasText: "旧讲义" })
      .getByRole("button", { name: "添加引用", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .locator(".lesson-pick-row")
      .filter({ hasText: "新讲义" })
      .getByRole("button", { name: "添加引用", exact: true })
      .click();
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await expect(page.locator(".course-item strong").first()).toHaveText(
      "新讲义",
    );
    await page
      .locator(".course-item")
      .filter({ hasText: "新讲义" })
      .locator("button")
      .first()
      .click();
    await page.getByRole("tab", { name: "课堂反馈", exact: true }).click();
    await expect(page.getByLabel("上课日期", { exact: true })).toHaveValue(
      today(),
    );
    await page
      .getByLabel("本节课记录", { exact: true })
      .fill("本节课整体学得不错，二项分布部分需要加强。");
    await page
      .getByRole("button", { name: "AI 整理家长反馈", exact: true })
      .click();
    await expect(page.getByLabel("家长反馈正文")).toHaveValue(
      /【上课时间】\n\d{4}年\d+月\d+日/,
    );
    await expect(page.getByLabel("家长反馈正文")).toHaveValue(
      /2、建议重点巩固/,
    );
    expect(requests).toHaveLength(2);
    const prompt = requests[0].messages.at(-1).content;
    expect(prompt).toContain("正态分布的对称性");
    expect(prompt).toContain("实验高中");
    expect(prompt).toContain("优点和不足各写 2–3 条");
    expect(requests[1].messages.at(-1).content).toContain(
      "学员表现评价了讲义或教师",
    );
    const goodDraft = await page.getByLabel("家长反馈正文").inputValue();
    expect(goodDraft).not.toContain("教师能够");
    expect(goodDraft).not.toContain("讲义中的题型");
    forceBad = true;
    await page
      .getByRole("button", { name: "AI 整理家长反馈", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "反馈生成未通过检查，原草稿已保留",
    );
    await expect(page.getByLabel("家长反馈正文")).toHaveValue(goodDraft);
    expect(requests).toHaveLength(4);
    forceBad = false;
    await page.getByRole("button", { name: "保存反馈", exact: true }).click();
    await expect(page.getByText("反馈已保存", { exact: true })).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "讲义库", exact: true })
      .click();
    await page.getByRole("tab", { name: "高中", exact: true }).click();
    await page
      .locator(".lesson-list-item")
      .filter({ hasText: "库中分配讲义" })
      .click();
    await page.getByRole("button", { name: "分配学生", exact: true }).click();
    await page.getByRole("button", { name: "分配", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "已分配", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "学生管理" })
      .click();
    await expect(page.locator(".course-item strong").first()).toHaveText(
      "库中分配讲义",
    );
    await page.screenshot({
      path: "test-results/school-feedback-workspace.png",
    });
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await expect(restored.locator(".profile-meta")).toContainText("实验高中");
    await expect(restored.locator(".course-item strong").first()).toHaveText(
      "库中分配讲义",
    );
    const saved = await restored.evaluate(() => window.services.bootstrap());
    expect(saved.data.schools).toHaveLength(2);
    expect(saved.data.students[0].schoolId).toBe(
      saved.data.schools.find((s) => s.name === "实验高中").id,
    );
    expect(saved.data.feedback[0].date).toBe(today());
    expect(saved.data.feedback[0].sourceFiles[0].name).toBe("教案.docx");
    expect(saved.data.feedback[0].content).not.toContain("待补充");
    expect(saved.data.refs).toHaveLength(3);
    expect(
      await restored.evaluate(() => typeof window.services.transcribe),
    ).toBe("undefined");
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
