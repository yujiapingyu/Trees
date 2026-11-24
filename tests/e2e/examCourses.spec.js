import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DiskStorage } = require("../../desktop/core.cjs");

test("课程引用考试按卷别配对，反馈只读所选试卷，保护来源并在重启后恢复", async () => {
  test.setTimeout(60000);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "exam-course-"));
  const profile = path.join(tmp, "profile"),
    root = path.join(tmp, "考试资料"),
    students = path.join(tmp, "学生"),
    studentPath = path.join(students, "测试学生");
  await fs.mkdir(root);
  await fs.mkdir(path.join(studentPath, "原课程"), { recursive: true });
  const make = async (id, kind, schoolId = "", version = "A卷") => {
    const file = {
      id,
      kind,
      schoolId,
      version,
      name: id + ".txt",
      path: path.join(root, id + ".txt"),
    };
    await fs.writeFile(
      file.path,
      id === "所选试卷"
        ? "所选试卷：第1题，一元二次方程求根公式。"
        : id + "：不应混入反馈",
    );
    return file;
  };
  const files = await Promise.all([
    make("所选试卷", "paper"),
    make("对应答案", "answer"),
    make("其他学校试卷", "paper", "a"),
    make("其他卷别试卷", "paper", "", "B卷"),
  ]);
  const response = {
    theme: "方程试卷讲评",
    contentPoints: [{ topic: "一元二次方程", details: ["求根公式与判别式"] }],
    strengths: ["能理解求根公式", "整体掌握情况不错"],
    weaknesses: ["建议巩固计算", "后续关注符号"],
    afterClass: ["建议复习第1题"],
  };
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(response) } }],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await store.set("sm_path_config_v1", {
    studentsRoot: students,
    examsRoot: root,
    deepseekKey: "test-only-key",
    deepseekHost: `http://127.0.0.1:${server.address().port}/v1`,
  });
  await store.set("sm_workspace_v1", {
    students: [
      {
        id: "s",
        name: "测试学生",
        grade: "高中三年级",
        status: "稳定授课",
        directoryPath: studentPath,
      },
    ],
    schools: [{ id: "a", name: "实验一中", stage: "高中" }],
    exams: [
      {
        id: "e",
        name: "A9联盟11月测试",
        kind: "school",
        schoolIds: ["a"],
        grade: "高中一年级",
        date: "2026-11-02",
        subjects: [{ id: "math", name: "数学", maxScore: 150, files }],
      },
    ],
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
    let page = await app.firstWindow();
    await page.locator(".student-item").click();
    await page.getByRole("button", { name: "引用考试", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "引用考试试卷" });
    await expect(picker).toContainText("公共卷");
    await expect(picker).toContainText("实验一中");
    await picker
      .getByRole("button", {
        name: "引用 A9联盟11月测试 数学 A卷 公共卷",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".course-item").first()).toContainText(
      "A9联盟11月测试",
    );
    await expect(
      page.getByRole("heading", { name: "考试讲评", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".student-detail .file-row")).toHaveCount(2);
    await expect(page.locator(".student-detail")).toContainText("对应答案.txt");
    await expect(page.locator(".student-detail")).not.toContainText(
      "其他学校试卷.txt",
    );
    let saved = await page.evaluate(() => window.services.bootstrap());
    const courseId = "exam:" + saved.data.refs[0].id;
    expect(saved.data.examRecords).toHaveLength(0);
    await page.getByRole("tab", { name: "课堂反馈", exact: true }).click();
    await expect(page.getByLabel("关联讲义", { exact: true })).toHaveValue(
      courseId,
    );
    await page
      .getByLabel("本节课记录", { exact: true })
      .fill("今天只讲第1题，求根公式掌握不错，计算需要巩固。");
    await page
      .getByRole("button", { name: "AI 整理家长反馈", exact: true })
      .click();
    await expect(
      page.getByText("授课内容来源：所选试卷.txt", { exact: true }),
    ).toBeVisible();
    const prompt = requests[0].messages.at(-1).content;
    expect(prompt).toContain("所选试卷：第1题");
    expect(prompt).toContain("不得断言整卷讲完");
    expect(prompt).not.toContain("对应答案：");
    expect(prompt).not.toContain("其他学校试卷：");
    expect(prompt).not.toContain("其他卷别试卷：");
    await page.getByRole("button", { name: "保存反馈", exact: true }).click();
    await expect(page.getByText("反馈已保存", { exact: true })).toBeVisible();
    await page
      .locator(".course-item")
      .first()
      .getByRole("button", { name: "移除引用", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "移除考试课程引用" })
      .getByRole("button", { name: "确认执行" })
      .click();
    await expect(page.getByRole("alert")).toContainText("课堂反馈引用");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    saved = await page.evaluate(() => window.services.bootstrap());
    expect(saved.data.refs[0].type).toBe("exam");
    expect(saved.data.feedback[0].lessonId).toBe(courseId);
    expect(saved.data.examRecords).toHaveLength(0);
    await page.getByRole("tab", { name: "课程概览", exact: true }).click();
    await expect(page.locator(".student-detail .file-row")).toHaveCount(2);
    await page.screenshot({ path: "test-results/exam-course.png" });
    // Remove the feedback first, then detach the course; source exam and files remain.
    await page.getByRole("tab", { name: "课堂反馈", exact: true }).click();
    await page.locator(".record-card summary").click();
    await page
      .locator(".record-card")
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认执行" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .locator(".course-item")
      .first()
      .getByRole("button", { name: "移除引用", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认执行" })
      .click();
    await expect(page.locator(".course-item")).toHaveCount(1);
    saved = await page.evaluate(() => window.services.bootstrap());
    expect(saved.data.refs).toHaveLength(0);
    expect(saved.data.exams).toHaveLength(1);
    expect(await fs.readdir(root)).toHaveLength(4);
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
