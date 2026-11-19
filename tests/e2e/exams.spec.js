import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DiskStorage } = require("../../desktop/core.cjs");
test("联盟考试多校共用、试卷答案导入、学生空分与零分及重启恢复", async () => {
  test.setTimeout(60000);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-exam-")),
    profile = path.join(tmp, "profile"),
    students = path.join(tmp, "学生"),
    root = path.join(tmp, "考试资料"),
    studentPath = path.join(students, "测试学生");
  await fs.mkdir(studentPath, { recursive: true });
  await fs.mkdir(root);
  const paper = path.join(tmp, "数学试卷.txt"),
    answer = path.join(tmp, "数学答案.txt"),
    extra = path.join(tmp, "试卷附页.txt"),
    supplement = path.join(tmp, "答案补充.txt");
  await fs.writeFile(extra, "试卷附页");
  await fs.writeFile(supplement, "答案补充");
  await fs.writeFile(paper, "考试试卷");
  await fs.writeFile(answer, "参考答案");
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await store.set("sm_path_config_v1", {
    studentsRoot: students,
    examsRoot: root,
  });
  await store.set("sm_workspace_v1", {
    students: [
      {
        id: "s",
        name: "测试学生",
        directoryPath: studentPath,
        grade: "高中一年级",
        schoolId: "a",
        status: "稳定授课",
      },
    ],
    schools: [
      { id: "a", name: "实验一中", stage: "高中" },
      { id: "b", name: "实验二中", stage: "高中" },
    ],
  });
  let app;
  try {
    const launch = () =>
      electron.launch({
        args: ["."],
        cwd: process.cwd(),
        env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
      });
    app = await launch();
    await app.evaluate(
      ({ dialog }, paths) => {
        let index = 0;
        dialog.showOpenDialog = async (_window, options) => {
          if (!options.properties.includes("multiSelections"))
            throw Error("应启用多文件选择");
          return { canceled: false, filePaths: paths[index++] };
        };
      },
      [[paper, extra], [paper], [answer], [supplement]],
    );
    const page = await app.firstWindow();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "考试管理" })
      .click();
    await page.getByRole("button", { name: "新建考试", exact: true }).click();
    await page.getByLabel("考试名称", { exact: true }).fill("A9联盟11月测试");
    await page.getByLabel("联盟 / 组织名称", { exact: true }).fill("A9联盟");
    await page.getByLabel("考试日期", { exact: true }).fill("2026-11-02");
    await page.getByLabel("实验一中", { exact: true }).check();
    await page.getByLabel("实验二中", { exact: true }).check();
    await page.getByRole("button", { name: "保存考试", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByText("参与学校：实验一中、实验二中", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "添加文件", exact: true }).click();
    await page
      .getByRole("button", { name: "选择试卷（可多选）", exact: true })
      .click();
    await page
      .getByRole("button", { name: "选择试卷（可多选）", exact: true })
      .click();
    await page
      .getByRole("button", { name: "选择答案（可多选）", exact: true })
      .click();
    await expect(page.locator(".exam-selected-file")).toHaveCount(3);
    await page
      .getByRole("button", { name: "保存文件关联", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "补充本组试卷 / 答案", exact: true })
      .click();
    await expect(page.getByLabel("卷别 / 版本", { exact: true })).toHaveValue(
      "默认卷",
    );
    await page
      .getByRole("button", { name: "选择答案（可多选）", exact: true })
      .click();
    await page
      .getByRole("button", { name: "保存文件关联", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".exam-paper-group .file-row")).toHaveCount(4);
    await expect(
      page.getByText("试卷 / 答案已配对", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关联学生", exact: true }).click();
    await page.getByLabel("关联学生", { exact: true }).selectOption("s");
    await page
      .getByRole("button", { name: "保存考试关联", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".linked-row")).toContainText("数学 未出分");
    await page.getByRole("button", { name: "编辑成绩", exact: true }).click();
    await page.getByLabel("数学状态", { exact: true }).selectOption("scored");
    await page.getByLabel("数学成绩（满分 150）", { exact: true }).fill("0");
    await page
      .getByRole("button", { name: "保存考试关联", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "学生管理" })
      .click();
    await page.locator(".student-item").click();
    await page.getByRole("tab", { name: "考试成绩", exact: true }).click();
    await expect(
      page.getByText("数学：0 / 150", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("总分：0 / 150", { exact: true }),
    ).toBeVisible();
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await expect(
      restored.getByText("数学：0 / 150", { exact: true }),
    ).toBeVisible();
    const data = await restored.evaluate(() => window.services.bootstrap());
    expect(data.data.exams).toHaveLength(1);
    expect(data.data.exams[0].schoolIds).toHaveLength(2);
    expect(data.data.examRecords[0].results[0].score).toBe(0);
    expect(data.data.exams[0].subjects[0].files).toHaveLength(4);
    expect(
      data.data.exams[0].subjects[0].files.filter((f) => f.kind === "paper"),
    ).toHaveLength(2);
    expect(
      data.data.exams[0].subjects[0].files.filter((f) => f.kind === "answer"),
    ).toHaveLength(2);
    expect(
      new Set(data.data.exams[0].subjects[0].files.map((f) => f.path)).size,
    ).toBe(4);
    for (const f of data.data.exams[0].subjects[0].files)
      expect((await fs.readFile(f.path, "utf8")).length).toBeGreaterThan(0);
    expect(await fs.readFile(paper, "utf8")).toBe("考试试卷");
    await restored
      .getByRole("navigation")
      .getByRole("button", { name: "考试管理" })
      .click();
    await restored
      .getByRole("button", { name: "删除考试", exact: true })
      .click();
    await restored
      .getByRole("button", { name: "确认执行", exact: true })
      .click();
    await expect(restored.getByRole("dialog").getByRole("alert")).toContainText(
      "归档",
    );
    await restored.getByRole("button", { name: "取消", exact: true }).click();
    await restored
      .getByRole("button", { name: "归档考试", exact: true })
      .click();
    await expect(
      restored.getByRole("button", { name: "恢复考试", exact: true }),
    ).toBeVisible();
  } finally {
    if (app) await app.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
