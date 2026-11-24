import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  lessonFixture,
  content: lessonContent,
} = require("../tests/helpers/lessonFixture.cjs");
import { EMPTY_DATA } from "../src/shared/domain.js";
import { freshReport } from "../src/shared/reports.js";
const executablePath =
  process.argv[2] ||
  path.join(os.homedir(), "Applications/知序.app/Contents/MacOS/知序");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-packaged-"));
const profile = path.join(temporary, "profile"),
  resources = path.join(temporary, "resources");
await fs.mkdir(resources);
const smokeShortcut = "CommandOrControl+Alt+Shift+F11";
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "workspace.json"),
  JSON.stringify({
    sm_desktop_preferences_v1: { shortcut: smokeShortcut, openAtLogin: false },
  }),
);
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }
  const autoPlan = JSON.parse(raw).messages?.some((m) =>
    m.content?.includes("其他报告内容保持不变"),
  );
  const automaticResult = {
    curriculum: {
      volume: "必修第一册",
      currentTopic: "对数函数",
      progressEvidence: "安装包自动取材验证",
      mode: "同步推进",
    },
    plan: Array.from({ length: 15 }, (_, i) => ({
      topic: "自动衔接任务" + i,
      objectives: "独立完成任务",
      keyPoints: "条件与方法",
      hours: "1",
    })),
    planningNotes: "无需预先设置学校进度，系统主动生成。",
  };
  const prompt = JSON.parse(raw).messages?.at(-1)?.content || "";
  const isExtraction = prompt.includes("整理当前学生的一段课后原始记录");
  const isFeedback = prompt.includes("你是正在给家长反馈");
  const extraction = {
    topic: "对数运算",
    scope: "对数运算",
    scopeQuote: "今天讲了对数运算",
    strengths: [{ text: "能复述定义", quote: "能复述定义" }],
    weaknesses: [{ text: "真数条件要回查", quote: "漏真数条件" }],
    nextProgress: "对数函数",
    nextQuote: "下次继续对数函数",
    homeworkAssigned: [],
    homeworkSuggestions: ["建议巩固真数条件"],
    nextSuggestions: [],
  };
  const feedback = {
    theme: "对数运算",
    contentPoints: [
      { topic: "对数运算", details: ["复习定义与运算条件，检查真数范围。"] },
    ],
    strengths: [
      "孩子能复述定义，概念已有初步认识，可以结合具体算式进一步巩固。",
    ],
    weaknesses: ["计算中还会漏真数条件，我会引导孩子把条件检查固定为第一步。"],
    afterClass: ["建议复习本次概念和方法，并回查真数条件。"],
  };
  const assistant = JSON.parse(raw).messages?.some(
    (m) => m.role === "system" && m.content.includes("你是知序的AI教学助手"),
  );
  const actionTask = prompt.includes("办事指令解释器");
  const actionQuestion = prompt.split("用户本轮指令：").at(-1);
  const actionContent = JSON.stringify({
    actions: [
      {
        type: actionQuestion.includes("回访")
          ? "schedule_followup"
          : "add_note",
        sourceQuote: actionQuestion.split("：").at(-1),
      },
    ],
  });
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: actionTask
              ? actionContent
              : assistant
                ? "安装包助手验证：结合浙江教材与实际进度提出教学建议。"
                : isExtraction
                  ? JSON.stringify(extraction)
                  : isFeedback
                    ? JSON.stringify(feedback)
                    : autoPlan
                      ? JSON.stringify(automaticResult)
                      : JSON.stringify(lessonContent),
          },
        },
      ],
    }),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let app;
try {
  app = await electron.launch({
    executablePath,
    args: [],
    env: {
      ...process.env,
      TEACHING_DEV: "",
      TEACHING_DATA_DIR: profile,
      TEACHING_ENABLE_SHORTCUTS: "1",
    },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.getByRole("button", { name: "教师个人信息", exact: true }).click();
  await page.getByLabel("教师姓名", { exact: true }).fill("安装包教师");
  await page.getByLabel("显示称呼", { exact: true }).fill("验证老师");
  await page.getByRole("button", { name: "保存个人信息", exact: true }).click();
  await expect(page.locator(".teacher-profile-entry")).toContainText(
    "验证老师",
  );
  assert.match(page.url(), /app\.asar\/dist\/index\.html/);
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  const info = await page.evaluate(() => window.services.bootstrap());
  assert.equal(
    info.storagePath,
    path.join(await fs.realpath(profile), "workspace.sqlite"),
  );
  assert.equal(info.storageState.engine, "sqlite");
  const text = await page.evaluate(
    async ({ resources }) => {
      await window.services.storageSet("sm_path_config_v1", {
        studentsRoot: resources,
      });
      const document = resources + "/打包验证.docx";
      await window.services.word(document, "独立应用文档验证", false);
      return window.services.readText(document);
    },
    { resources },
  );
  assert.match(text, /独立应用文档验证/);
  const lessonSource = path.join(resources, "打包验证（教案）.docx");
  await fs.writeFile(lessonSource, await lessonFixture());
  const lessonResult = await page.evaluate(
    async ({ resources, lessonSource, host }) => {
      await window.services.storageSet("sm_path_config_v1", {
        studentsRoot: resources,
        lessonsRoot: resources,
        deepseekHost: host,
        deepseekKey: "isolated-packaged-test",
      });
      const p = await window.services.lessonPrepare(lessonSource);
      const draft = await window.services.lessonGenerate({
        token: p.token,
        organizeQuestions: true,
        questionPlan: p.categories,
        updateIntro: true,
        updateSummary: true,
      });
      const saved = await window.services.lessonSave({
        token: p.token,
        content: draft.content,
      });
      const study = await window.services.study(
        lessonSource,
        resources + "/打包验证（学案）.docx",
        0.75,
        0.9,
        false,
        "process",
      );
      return {
        categoryCounts: p.categories.map((c) => c.available),
        saved,
        study,
        studyText: await window.services.readText(study.path),
      };
    },
    {
      resources,
      lessonSource,
      host: "http://127.0.0.1:" + server.address().port,
    },
  );
  assert.deepEqual(lessonResult.categoryCounts, [4, 3]);
  assert.equal(lessonResult.saved.movedCount, 4);
  assert.equal(lessonResult.study.processed, 7);
  assert.ok(!lessonResult.studyText.includes("【答案】"));
  assert.ok(!lessonResult.studyText.includes("解析后续段落"));
  assert.match(lessonResult.studyText, /TYPE1_Q1/);
  const creationRoot = path.join(temporary, "new-lesson-library");
  const creation = await page.evaluate(
    async ({ creationRoot, resources, lessonSource }) => {
      const cfg = await window.services.storageGet("sm_path_config_v1");
      await window.services.storageSet("sm_path_config_v1", {
        ...cfg,
        lessonsRoot: creationRoot,
        templatesRoot: resources,
      });
      const opts = await window.services.lessonCreateOptions("高中");
      const created = await window.services.lessonCreate({
        stage: "高中",
        grade: "高二",
        name: "新建教案验证",
        template: lessonSource,
        configurationKey: opts.configurationKey,
      });
      return { created, grades: opts.grades };
    },
    { creationRoot, resources, lessonSource },
  );
  assert.deepEqual(creation.grades, ["高一", "高二", "高三"]);
  assert.equal(
    path.basename(creation.created.filePath),
    "新建教案验证（教案）.docx",
  );
  assert.deepEqual(
    await fs.readFile(creation.created.filePath),
    await fs.readFile(lessonSource),
  );
  const packedLesson = await page.evaluate(async (lesson) => {
    const options = await window.services.lessonPackOptions({
      path: lesson.path,
      name: lesson.name,
    });
    return window.services.lessonPack({
      path: lesson.path,
      name: lesson.name,
      version: options.version,
      grade: options.grade,
      year: options.year,
      existingHash: options.existingHash,
    });
  }, creation.created.lesson);
  assert.equal(packedLesson.learningFallback, true);
  assert.equal(
    path.dirname(packedLesson.path),
    await fs.realpath(creation.created.lesson.path),
  );
  const student = { id: "packaged", name: "导出验证学生", grade: "高中一年级" };
  const report = freshReport(
    student,
    { ...structuredClone(EMPTY_DATA), students: [student] },
    "entry",
  );
  report.meta.teacher = "导出验证教师";
  report.plan = Array.from({ length: 15 }, (_, i) => ({
    topic: `导出任务${i + 1}`,
    objectives: "独立完成练习",
    keyPoints: "重点与难点验证",
    hours: "1",
  }));
  report.comments.overall = "此内容仅用于验证安装包中的报告导出服务。";
  const reportText = await page.evaluate(
    async ({ resources, report }) => {
      const file = resources + "/学习力报告验证.docx";
      await window.services.learningReport(file, report);
      return window.services.readText(file);
    },
    { resources, report },
  );
  assert.match(reportText, /入学学习力报告/);
  assert.match(reportText, /导出验证学生/);
  assert.match(reportText, /毅力提升篇/);
  assert.match(reportText, /导出任务15/);

  const stageText = await page.evaluate(
    async ({ resources, report }) => {
      const file = resources + "/阶段模板导出验证.docx";
      await window.services.learningReport(file, { ...report, type: "stage" });
      return window.services.readText(file);
    },
    { resources, report },
  );
  assert.match(stageText, /阶段学习力报告/);
  assert.match(stageText, /安装包中的报告导出服务/);
  await page.evaluate(
    async ({ resources, student, empty }) => {
      const directoryPath = resources + "/" + student.name;
      await window.services.mkdir(directoryPath);
      await window.services.storageSet("sm_workspace_v1", {
        ...empty,
        teacherProfile: (await window.services.bootstrap()).data.teacherProfile,
        students: [{ ...student, directoryPath, status: "稳定授课" }],
      });
      await window.services.storageSet("sm_view_state_route", "students");
      await window.services.storageSet("sm_view_state_students", {
        selected: student.id,
        query: "",
        grade: "",
        status: "active",
        course: "",
        tab: "reports",
        courseWidth: 232,
      });
    },
    { resources, student, empty: structuredClone(EMPTY_DATA) },
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "AI 生成入学报告", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "AI 生成阶段报告", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "全局搜索", exact: true }).click();
  await page.getByLabel("全局搜索内容").fill(student.name);
  await page.getByLabel("全局搜索内容").press("Enter");
  await expect(page.locator(".profile-title")).toContainText(student.name);
  await page.getByRole("tab", { name: "教材进度", exact: true }).click();
  await expect(page.locator(".auto-plan-row")).toHaveCount(15);
  await page.locator(".optional-curriculum-correction > summary").click();
  await page.getByLabel("学校当前教材册次").selectOption("必修第一册");
  await page
    .getByLabel("学校当前章节或近期考试范围")
    .fill("打包验证学校进度：对数函数");
  await page.getByRole("button", { name: "保存教材进度", exact: true }).click();
  await expect(page.locator(".curriculum-current")).toContainText(
    "打包验证学校进度",
  );
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await page.getByLabel("助手资料范围").selectOption(student.id);
  await page.getByLabel("向助手提问").fill("结合浙江教材与实际进度给我建议");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-message.assistant")).toContainText(
    "安装包助手验证",
  );
  await page
    .getByLabel("向助手提问")
    .fill("给导出验证学生记一条观察：安装包撤销观察。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-message.assistant").last()).toContainText(
    "保存学生记录",
  );
  assert.equal(
    (await page.evaluate(() => window.services.bootstrap())).data.notes[0]
      .markdown,
    "安装包撤销观察。",
  );
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByRole("button", { name: "撤销这次操作" })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.services.bootstrap())).data.notes
          .length,
    )
    .toBe(0);
  await page
    .getByLabel("向助手提问")
    .fill("给导出验证学生记一条观察：安装包保留观察。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-message.assistant").last()).toContainText(
    "保存学生记录",
  );
  await page.getByLabel("向助手提问").fill("下周五回访导出验证学生");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-message.assistant").last()).toContainText(
    "已安排导出验证学生",
  );
  assert.equal(
    (await page.evaluate(() => window.services.bootstrap())).data.followups
      .length,
    0,
  );
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.evaluate(async () => {
    const { data } = await window.services.bootstrap();
    data.schools = [
      { id: "school-grades", name: "打包多年度学校", stage: "高中" },
    ];
    data.students = data.students.map((s) => ({
      ...s,
      schoolId: "school-grades",
    }));
    await window.services.storageSet("sm_workspace_v1", data);
  });
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "配置中心", exact: true })
    .click();
  await page
    .getByRole("button", { name: "浙江教材与进度", exact: true })
    .click();
  await page.locator(".optional-curriculum-correction > summary").click();
  await expect(page.locator("[data-curriculum-grade]")).toHaveCount(3);
  for (const [grade, chapter] of [
    ["高一", "高一对数"],
    ["高二", "高二圆锥曲线"],
  ]) {
    await page
      .getByRole("button", { name: "编辑" + grade + "进度", exact: true })
      .click();
    await page.getByLabel("学校当前教材册次").selectOption("必修第一册");
    await page.getByLabel("学校当前章节或近期考试范围").fill(chapter);
    await page
      .getByRole("button", { name: "保存" + grade + "进度", exact: true })
      .click();
    await expect(page.locator(".school-curriculum-table")).toContainText(
      chapter,
    );
  }
  await expect(
    page.locator('[data-curriculum-grade="高中一年级"]'),
  ).toContainText("高一对数");
  await expect(
    page.locator('[data-curriculum-grade="高中二年级"]'),
  ).toContainText("高二圆锥曲线");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "学生管理", exact: true })
    .click();
  await page
    .getByRole("button", { name: "课后记一段", exact: true })
    .first()
    .click();
  await page
    .getByLabel("这一节课的原始记录")
    .fill("今天讲了对数运算。能复述定义，但漏真数条件。下次继续对数函数。");
  await page
    .getByRole("button", { name: "保存并自动整理", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.services.bootstrap())).data
          .sessions[0]?.closeout?.state,
    )
    .toBe("ready");
  await page.getByRole("tab", { name: "课堂反馈", exact: true }).click();
  await page.locator(".automatic-feedback-drafts summary").first().click();
  await page
    .getByRole("button", { name: "编辑并保存这份反馈", exact: true })
    .click();
  await page
    .getByLabel("家长反馈正文")
    .fill(
      student.name + "同学家长您好。\n1.我会先巩固真数条件，再接着讲函数。",
    );
  await page.getByRole("button", { name: "保存反馈", exact: true }).click();
  const workflow = await page.evaluate(() => window.services.bootstrap());
  assert.equal(workflow.data.sessions.length, 1);
  assert.equal(workflow.data.feedback.length, 1);
  assert.equal(workflow.data.feedbackStyle.learnedCount, 1);
  await fs.writeFile(
    path.join(resources, student.name, "个人作业验证.txt"),
    "学生个人文件夹内的作业",
  );
  await page.getByRole("tab", { name: "作业 0", exact: true }).click();
  await page.getByRole("button", { name: "添加作业", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("combobox").locator("option:checked"),
  ).toHaveText(student.name + "的个人文件夹");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /个人作业验证.txt/ })
    .click();
  await expect(page.locator(".homework-row")).toContainText("个人作业验证.txt");
  assert.equal(
    (await page.evaluate(() => window.services.bootstrap())).data.homework[0]
      .path,
    path.join(resources, student.name, "个人作业验证.txt"),
  );
  const archiveResult = await page.evaluate(async (id) => {
    const removed = await window.services.studentArchive(id);
    const item = removed.recycleBin.find((r) => r.student.id === id);
    if (!item) throw Error("打包版缺少学生回收记录");
    const restored = await window.services.studentRestore(item.id);
    await window.services.storageSet("sm_draft_packaged-check", {
      text: "打包草稿持久化",
    });
    return {
      count: restored.students.filter((s) => s.id === id).length,
      draft: await window.services.storageGet("sm_draft_packaged-check"),
      backups: await window.services.storageBackups(),
    };
  }, student.id);
  assert.equal(archiveResult.count, 1);
  assert.equal(archiveResult.draft.text, "打包草稿持久化");
  assert.ok(archiveResult.backups.length >= 1);
  const exportRoot = path.join(temporary, "full-backups");
  await fs.mkdir(exportRoot);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, exportRoot);
  const full = await page.evaluate(() =>
    window.services.fullBackupExport(["studentsRoot"]),
  );
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, full.file);
  const fullPreview = await page.evaluate(() =>
    window.services.fullBackupInspect(),
  );
  assert.equal(fullPreview.counts.students, 1);
  const restoreRoot = path.join(temporary, "restored");
  await fs.mkdir(restoreRoot);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, restoreRoot);
  await page.evaluate(
    (token) => window.services.fullBackupRestore(token),
    fullPreview.token,
  );
  await page.reload();
  const restoredInfo = await page.evaluate(() => window.services.bootstrap());
  assert.equal(restoredInfo.data.teacherProfile.name, "安装包教师");
  assert.equal(restoredInfo.data.feedbackStyle.learnedCount, 1);
  assert.equal(restoredInfo.data.homework[0].name, "个人作业验证.txt");
  assert.equal(restoredInfo.data.notes[0].markdown, "安装包保留观察。");
  assert.ok(restoredInfo.data.students[0].followupPlan.date);
  assert.equal(Object.values(restoredInfo.data.assistantActions).length, 3);
  assert.equal(restoredInfo.data.sessions[0].closeout.state, "ready");
  assert.ok(
    restoredInfo.config.studentsRoot.startsWith(await fs.realpath(restoreRoot)),
  );
  assert.equal(
    restoredInfo.data.students.find((s) => s.id === student.id).name,
    student.name,
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "配置中心" })
    .click();
  await page.getByRole("button", { name: "启动与快捷键", exact: true }).click();
  await expect(page.getByLabel("登录自动启动")).toBeEnabled();
  const desktopState = await page.evaluate(() =>
    window.services.desktopState(),
  );
  const { version } = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(desktopState.version, version);
  assert.equal(desktopState.registered, true, desktopState.shortcutError);
  assert.equal(
    await app.evaluate(
      ({ globalShortcut }, shortcut) => globalShortcut.isRegistered(shortcut),
      smokeShortcut,
    ),
    true,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().items[0].submenu.items.find(
      (item) => item.label === "显示知序",
    );
    item.click();
  });
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(true);
  await page.screenshot({ path: "test-results/packaged-desktop.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Packaged app passed: bundled runtime, isolated data, global search, scoped AI assistant, actual assistant actions and undo with backup restoration, Zhejiang curriculum progress, real DOCX read/write, original-template entry and stage report export, lesson creation and ZIP packing, enrichment and study conversion, draft storage, daily backups, student recycle and full restore, desktop settings, hide and restore.",
  );
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
