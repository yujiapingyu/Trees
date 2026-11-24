import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DiskStorage } = require("../../desktop/core.cjs");
const { Document, Packer, Paragraph } = require("docx");
test("学习力报告课次提醒、资料隔离、AI预览、草稿重启、Word导出和历史对比", async () => {
  test.setTimeout(90000);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "learning-reports-")),
    profile = path.join(tmp, "profile"),
    root = path.join(tmp, "学生"),
    studentPath = path.join(root, "测试学生"),
    reports = path.join(studentPath, "学习力报告");
  await fs.mkdir(reports, { recursive: true });
  const lessonRoot = path.join(tmp, "讲义库"),
    lessonPath = path.join(lessonRoot, "方程专题");
  await fs.mkdir(lessonPath, { recursive: true });
  const sourcePath = path.join(lessonPath, "方程教案.txt");
  await fs.writeFile(
    sourcePath,
    "讲义正文验证：等式两边同乘或同除以同一个非零数，等式仍成立。",
  );
  const oldPath = path.join(reports, "测试学生阶段学习力报告2026.08.docx");
  await fs.writeFile(
    oldPath,
    await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph("学员姓名：测试学生"),
              new Paragraph("历史学习起点：方程计算步骤需要引导。"),
            ],
          },
        ],
      }),
    ),
  );
  const textbookRoot = path.join(tmp, "课本");
  await fs.mkdir(textbookRoot);
  await fs.writeFile(
    path.join(textbookRoot, "人教A版必修一目录.txt"),
    "目录 第三章 函数的概念与性质：3.1函数概念，3.2函数基本性质，3.3幂函数，3.4函数应用。第四章 指数函数与对数函数。 第五章 三角函数。",
  );
  await fs.writeFile(
    path.join(textbookRoot, "人教B版旧教材.txt"),
    "不应采用的旧版教材特征",
  );
  let bad = true;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    requests.push(data);
    const prompt = data.messages.at(-1).content;
    const planOnly = prompt.includes("其他报告内容保持不变");
    const r = planOnly
      ? {
          meta: {},
          goals: {},
          habits: [],
          motivationChoices: {},
          requirements: "",
        }
      : JSON.parse(
          prompt
            .split("教师填写与当前草稿：")[1]
            .split("\n本次选定的学生资料快照：")[0],
        );
    const value = {
      knowledge: [
        {
          topic: "方程与符号处理",
          difficulty: "中",
          strengths: "从课堂记录看，能用基本方法解方程。",
          needs: "建议重点巩固移项符号并回查步骤。",
          evidence: "统计期课堂反馈与教师观察。",
        },
      ],
      habits: r.habits.map((h) => ({
        ...h,
        rating: "良好",
        evidence: "建议评级：良好；基本方法已掌握，符号检查仍需加强。",
      })),
      plan: Array.from({ length: 15 }, (_, i) => ({
        topic: `函数后续专题${i + 1}`,
        objectives: "掌握当前任务，独立说明解题步骤。",
        keyPoints: "重点：概念与条件；难点：数形结合。",
        hours: "1",
      })),
      curriculum: {
        edition: "人教B版应被纠正",
        volume: "必修第一册",
        currentTopic: "函数单调性",
        progressEvidence: "最近课堂记录与教师补充",
        mode: "同步推进",
      },
      habitPlan: [
        {
          habit: "计算规范",
          actions: "建议先独立完成，完成后逐行回查符号。",
          criteria: "能够说明每个关键步骤并完成订正。",
          support: "教师示范，家长提醒独立完成。",
        },
      ],
      comments: {
        attendance: "本周期未记录考勤细节，需继续了解。",
        efficiency: "根据已有课堂记录，能跟上基本方法。",
        homework: "已登记的完成状态不能直接说明正确率。",
        overall: "我会围绕符号处理和步骤规范安排后续练习，并根据实际表现调整。",
      },
      progress:
        r.type === "stage"
          ? "历史学习起点需要引导，本周期能用基本方法解方程；缺乏可比测试，不能确定提升幅度。"
          : "",
      requirements: r.requirements,
      meta: {
        studentName: "不应覆盖的姓名",
        teacher: r.meta.teacher || "任课教师（待确认）",
        advisor: "班主任（待确认）",
      },
      goals: {
        lastScore: "未记录，待确认",
        lastRank: "未记录，待确认",
        targetScore: "建议逐步稳定基础题得分",
        targetRank: "建议逐步提升班级相对位置",
        targetSchool: "建议结合后续学业表现确定目标学校",
        motivation: "以方程基础为起点，建立独立计算与检查意识。",
      },
      motivationChoices: Object.fromEntries(
        Object.keys(r.motivationChoices).map((k) => [k, "建议是（待确认）"]),
      ),
      observations:
        r.type === "entry"
          ? Array.from({ length: 3 }, (_, i) => ({
              date: i === 0 ? "2026-11-01" : "",
              topic: i === 0 ? "方程基本方法" : "待观察课次：符号处理",
              performance: "依据课堂记录，基本方法已掌握，符号处理需要巩固。",
              homework: "建议完成计算并逐行回查。",
            }))
          : [],
      teacherNotes: "基本方法已掌握，符号处理需要回查。",
      planningNotes: "建议四课时复习基础计算与综合应用。",
      hourBudget: r.hourBudget || "4",
      parentReceipt: "建议与家长确认：在家练习与检查步骤的执行情况。",
    };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(bad ? { knowledge: [] } : value),
            },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await store.set("sm_path_config_v1", {
    studentsRoot: root,
    lessonsRoot: lessonRoot,
    textbooksSenior: textbookRoot,
    deepseekKey: "test-only-key",
    deepseekHost: `http://127.0.0.1:${server.address().port}/v1`,
  });
  await store.set("sm_workspace_v1", {
    students: [
      {
        id: "s",
        name: "测试学生",
        grade: "高中一年级",
        status: "稳定授课",
        directoryPath: studentPath,
      },
      { id: "other", name: "其他学生", status: "稳定授课" },
    ],
    feedback: [
      {
        id: "a",
        studentId: "s",
        date: "2026-11-01",
        content: "方程基本方法已经掌握，符号处理需巩固。",
        lessonId: "一",
        sourceFiles: [
          { name: "方程教案.txt", path: sourcePath },
          {
            name: "不可用旧讲义.txt",
            path: path.join(tmp, "配置外", "旧讲义.txt"),
          },
        ],
      },
      {
        id: "x",
        studentId: "other",
        date: "2026-11-02",
        content: "其他学生的秘密资料",
      },
    ],
    refs: [
      { studentId: "s", lessonId: "一" },
      { studentId: "s", lessonId: "二" },
      { studentId: "s", lessonId: "三" },
    ],
    lessons: [{ id: "一", name: "方程专题", path: lessonPath }],
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
    await page.locator(".student-item").filter({ hasText: "测试学生" }).click();
    await page.getByRole("tab", { name: "学习报告", exact: true }).click();
    await expect(
      page.getByText("待确认授课次数", { exact: true }),
    ).toBeVisible();
    // No settings, teacher name, goals, ratings or observations need filling first.
    await page
      .getByRole("button", { name: "AI 生成入学报告", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("15节课");
    await expect(
      page.getByLabel("下次考试目标成绩", { exact: true }),
    ).toHaveValue("");
    bad = false;
    await page
      .getByRole("button", { name: "AI 重新生成整份报告", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "核对 AI 报告草稿" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "使用整份报告并保存草稿", exact: true })
      .click();
    await expect(
      page.getByText("完整报告已生成并保存草稿，可直接预览、修改或导出", {
        exact: true,
      }),
    ).toBeVisible();
    const auto = await page.evaluate(() => window.services.bootstrap());
    const automatic = auto.data.reports[0];
    expect(automatic.aiGeneratedAt).toBeTruthy();
    expect(Object.values(automatic.goals).every(Boolean)).toBe(true);
    expect(automatic.habits.every((h) => h.rating === "良好")).toBe(true);
    expect(automatic.observations).toHaveLength(3);
    expect(automatic.parentReceipt).toContain("建议与家长确认");
    expect(automatic.meta.teacher).toContain("待确认");
    expect(automatic.plan).toHaveLength(15);
    expect(automatic.curriculum.edition).toBe("人教A版高中数学");
    expect(automatic.sourceSnapshot.textbooks[0].outline).toContain(
      "函数的概念与性质",
    );
    expect(JSON.stringify(automatic.sourceSnapshot)).not.toContain(
      "不应采用的旧版教材特征",
    );
    expect(automatic.meta.studentName).toBe("测试学生");
    expect(automatic.sourceSnapshot.materials[0].text).toContain(
      "讲义正文验证",
    );
    expect(
      automatic.sourceSnapshot.courseMaterials[0].documents[0].text,
    ).toContain("讲义正文验证");
    expect(automatic.sourceSnapshot.materialWarnings.length).toBeGreaterThan(0);
    await page.getByRole("tab", { name: "编辑报告", exact: true }).click();
    await page
      .getByLabel("教师综合观察与补充事实", { exact: true })
      .fill(
        "前三次课能理解方程基本方法，移项符号仍需回查；课堂笔记需持续观察。",
      );
    await page.getByLabel("下次考试目标成绩", { exact: true }).fill("95");
    await page
      .getByLabel("核心学科习惯分析 1 评级", { exact: true })
      .selectOption("及格");
    bad = true;
    await page
      .getByRole("button", { name: "AI 重新生成整份报告", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("15节课");
    await expect(
      page.getByLabel("下次考试目标成绩", { exact: true }),
    ).toHaveValue("95");
    bad = false;
    await page
      .getByRole("button", { name: "AI 重新生成整份报告", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "核对 AI 报告草稿" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "使用整份报告并保存草稿", exact: true })
      .click();
    await page
      .getByRole("button", { name: "保存报告草稿", exact: true })
      .click();
    await expect(
      page.getByText("报告草稿已保存", { exact: true }),
    ).toBeVisible();
    expect(requests.at(-1).messages.at(-1).content).not.toContain(
      "其他学生的秘密资料",
    );
    const beforePlan = (await page.evaluate(() => window.services.bootstrap()))
      .data.reports[0];
    await page.getByRole("tab", { name: "编辑报告", exact: true }).click();
    await page
      .getByLabel("当前学习进度（可选补充）", { exact: true })
      .fill("学校已学到函数单调性，下一节从奇偶性开始");
    bad = true;
    await page
      .getByRole("button", { name: "AI 重新规划15节课", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("15节课");
    await expect(
      page.getByLabel("下次考试目标成绩", { exact: true }),
    ).toHaveValue("95");
    bad = false;
    await page
      .getByRole("button", { name: "AI 重新规划15节课", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "核对15节课方案", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "使用15节课方案并保存", exact: true })
      .click();
    await expect(
      page.getByText("15节课方案已更新并保存草稿，其余报告内容保留", {
        exact: true,
      }),
    ).toBeVisible();
    const afterPlan = (await page.evaluate(() => window.services.bootstrap()))
      .data.reports[0];
    expect(afterPlan.plan).toHaveLength(15);
    expect(afterPlan.goals).toEqual(beforePlan.goals);
    expect(afterPlan.habits).toEqual(beforePlan.habits);
    expect(afterPlan.comments).toEqual(beforePlan.comments);
    expect(afterPlan.currentProgressOverride).toContain("奇偶性");
    expect(afterPlan.planSourceSnapshot.textbooks[0].outline).toContain("函数");
    expect(requests.at(-1).messages.at(-1).content).toContain(
      "下一节从奇偶性开始",
    );
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "继续编辑草稿", exact: true })
      .click();
    await expect(
      page.getByLabel("下次考试目标成绩", { exact: true }),
    ).toHaveValue("95");
    await expect(
      page.getByLabel("核心学科习惯分析 1 评级", { exact: true }),
    ).toHaveValue("及格");
    await page.getByRole("tab", { name: "预览报告", exact: true }).click();
    await page
      .getByLabel(/已核对学生信息、成绩、评级与建议/, {
        exact: false,
      })
      .check();
    await page
      .getByRole("button", { name: "完成并导出 Word", exact: true })
      .click();
    await expect(
      page.getByText("学习力报告已导出，报告周期已更新", { exact: true }),
    ).toBeVisible();
    let saved = await page.evaluate(() => window.services.bootstrap());
    let entry = saved.data.reports.find((r) => r.schemaVersion === 2);
    expect(entry.status).toBe("final");
    expect(entry.sourceSnapshot.records).toHaveLength(1);
    expect(entry.meta.studentName).toBe("测试学生");
    const text = await page.evaluate(
      (p) => window.services.readText(p),
      entry.path,
    );
    expect(text).toContain("家长回执");
    expect(text).toContain(entry.plan[14].topic);
    expect(entry.plan).toHaveLength(15);
    expect(text).toContain("建议是（待确认）");
    expect(text).toContain("前三次课课堂表现");
    expect(entry.confirmedLessons).toBe(3);
    expect(entry.goals.targetScore).toBe("95");
    expect(text).toContain("测试学生");
    expect(text).not.toContain("不应覆盖的姓名");
    await fs.mkdir("test-results", { recursive: true });
    await fs.copyFile(entry.path, "test-results/入学报告导出验证.docx");
    await page
      .getByRole("button", { name: "登记历史报告", exact: true })
      .click();
    await page.getByLabel("历史报告日期", { exact: true }).fill("2026-08-20");
    await page
      .getByRole("button", { name: "读取历史正文", exact: true })
      .click();
    await expect(page.getByLabel("历史报告正文", { exact: true })).toHaveValue(
      /历史学习起点/,
    );
    await page
      .getByLabel("我已核对，这份报告属于当前学生，日期与类型正确", {
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "确认登记历史报告", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    saved = await page.evaluate(() => window.services.bootstrap());
    const historical = saved.data.reports.find((r) => r.imported);
    await page
      .getByRole("button", { name: "新建阶段报告", exact: true })
      .click();
    await page
      .getByLabel("报告统计开始日期", { exact: true })
      .fill("2026-08-21");
    await page.getByRole("tab", { name: "资料依据", exact: true }).click();
    await page
      .getByLabel("对比的上期报告", { exact: true })
      .selectOption(historical.id);
    await page
      .getByRole("button", { name: "选中本周期有日期资料", exact: true })
      .click();
    await page
      .getByRole("button", { name: "AI 重新生成整份报告", exact: true })
      .click();
    await page
      .getByRole("button", { name: "使用整份报告并保存草稿", exact: true })
      .click();
    expect(requests.at(-1).messages.at(-1).content).toContain("历史学习起点");
    await page.screenshot({ path: "test-results/learning-report-preview.png" });
    await page
      .getByLabel(/已核对学生信息、成绩、评级与建议/, {
        exact: false,
      })
      .check();
    await page
      .getByRole("button", { name: "完成并导出 Word", exact: true })
      .click();
    await expect(
      page.getByText("学习力报告已导出，报告周期已更新", { exact: true }),
    ).toBeVisible();
    saved = await page.evaluate(() => window.services.bootstrap());
    const stage = saved.data.reports.find(
      (r) => r.schemaVersion === 2 && r.type === "stage",
    );
    expect(stage.sourceSnapshot.baseline.id).toBe(historical.id);
    await fs.copyFile(stage.path, "test-results/阶段报告导出验证.docx");
    expect(await fs.readdir(reports)).toHaveLength(3);
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
