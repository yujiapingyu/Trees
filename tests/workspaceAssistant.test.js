import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_DATA } from "../src/shared/domain.js";
import { buildSearchIndex, searchIndex } from "../src/shared/globalSearch.js";
import {
  assistantContext,
  assistantMessages,
} from "../src/shared/assistantContext.js";
import {
  academicTerm,
  curriculumContext,
  saveStudentProgress,
  saveSchoolProgress,
  schoolScheduleKey,
} from "../src/shared/zhejiangCurriculum.js";
import { saveSchool } from "../src/shared/schools.js";
import { coursePlanRules } from "../src/shared/learningPlan.js";

function fixture() {
  return {
    ...structuredClone(EMPTY_DATA),
    schools: [{ id: "school", name: "浙江测试高中", stage: "高中" }],
    students: [
      {
        id: "s",
        name: "王品越",
        grade: "高中一年级",
        schoolId: "school",
        status: "稳定授课",
        notes: "待加强运算",
      },
      {
        id: "other",
        name: "隔离学生",
        grade: "初中二年级",
        notes: "绝不能混用的观察",
      },
    ],
    notes: [
      {
        id: "n",
        studentId: "s",
        title: "对数课堂观察",
        date: "2026-11-20",
        markdown: "换底公式需要提示；能独立进行指数互化",
      },
      {
        id: "p",
        studentId: "other",
        title: "另一份观察",
        markdown: "独有隔离内容",
      },
      {
        id: "orphan",
        studentId: "deleted",
        title: "回收站记录",
        markdown: "不得进入搜索",
      },
    ],
    sessions: [
      {
        id: "c",
        studentId: "s",
        date: "2026-11-21",
        topic: "对数",
        scope: "对数的运算",
        nextProgress: "对数函数",
        status: "completed",
      },
    ],
    lessons: [
      {
        id: "l",
        name: "对数函数",
        stage: "高中",
        grade: "高一",
        tags: ["函数"],
        path: "/lessons/对数",
      },
      { id: "missing", name: "缺失资料", missing: true },
    ],
    followups: [
      {
        id: "f",
        studentId: "s",
        date: "2026-11-10",
        purpose: "家长沟通",
        parentFeedback: "计算慢",
        nextDate: "2026-11-15",
      },
    ],
    exams: [
      {
        id: "e",
        name: "A9联盟期中",
        grade: "高中一年级",
        date: "2026-11-12",
        schoolIds: ["school"],
        subjects: [
          { id: "math", name: "数学", files: [{ name: "期中答案.pdf" }] },
        ],
      },
    ],
    examRecords: [
      {
        id: "score",
        studentId: "s",
        examId: "e",
        results: [{ subjectId: "math", status: "scored", score: 69 }],
      },
    ],
  };
}
test("全局搜索涵盖正文、拼音、学校、文件与成绩；多词与分类正确且排除回收站", () => {
  const index = buildSearchIndex(fixture(), [
    {
      path: "/book/函数.pdf",
      name: "函数.pdf",
      relativePath: "数学/函数.pdf",
      rootLabel: "初中教材",
    },
  ]);
  assert.equal(searchIndex(index, "wpy")[0].kind, "学生");
  assert.equal(searchIndex(index, "wangpinyue")[0].title, "王品越");
  assert.equal(searchIndex(index, "王品越 换底")[0].key, "记录:n");
  assert.ok(searchIndex(index, "浙江测试高中", "学生").length);
  assert.equal(searchIndex(index, "69", "成绩")[0].key, "成绩:score");
  assert.equal(searchIndex(index, "期中答案", "考试")[0].key, "考试:e");
  assert.equal(
    searchIndex(index, "函数", "文件")[0].target.file,
    "/book/函数.pdf",
  );
  assert.equal(searchIndex(index, "不得进入").length, 0);
  assert.equal(searchIndex(index, "缺失资料").length, 0);
  assert.equal(searchIndex(index, "对数")[0].kind, "授课");
  assert.equal(searchIndex(index, "   ").length, 0);
});
test("助手按资料范围隔离，引用可定位，资源范围不暴露学生资料", () => {
  const data = fixture(),
    student = assistantContext(data, "s", "总结课堂情况");
  const prompt = JSON.stringify(assistantMessages(student, [], "给建议"));
  assert.ok(prompt.includes("换底公式"));
  assert.ok(!prompt.includes("独有隔离内容"));
  assert.ok(!prompt.includes("隔离学生"));
  assert.ok(
    student.sources.some(
      (s) => s.key === "记录:n" && s.target.route === "studentNotes",
    ),
  );
  assert.ok(prompt.includes("[S1]"));
  const general = JSON.stringify(
    assistantContext(data, "general", "王品越怎么样"),
  );
  assert.ok(!general.includes("王品越"));
  const resources = assistantContext(data, "resources", "帮我找对数复习讲义");
  assert.equal(resources.sources[0].title, "对数函数");
  assert.ok(!JSON.stringify(resources.context).includes("王品越"));
  const overview = assistantContext(data, "overview", "待回访");
  assert.ok(overview.context.dueFollowupsCount >= 1);
  assert.ok(!JSON.stringify(overview.context).includes("换底公式"));
});
test("浙江教材区分学校目标与实际辅导，学校安排跨学生复用且改名不丢失", () => {
  let d = fixture();
  const term = academicTerm("2026-11-23");
  assert.deepEqual(term, { schoolYear: "2026", semester: "上学期" });
  d = saveSchoolProgress(d, "school", "高中一年级", {
    ...term,
    volume: "必修第一册",
    chapter: "三角函数",
    mode: "同步巩固",
    notes: "先补函数",
  });
  d.schools[0].mathSchedules[
    schoolScheduleKey("高中一年级", term)
  ].confirmedDate = "2026-11-22";
  let c = curriculumContext(d.students[0], d, "2026-11-23");
  assert.equal(c.schoolProgress.chapter, "三角函数");
  assert.equal(c.tutoringProgress.nextProgress, "对数函数");
  d = saveSchool(d, { id: "school", name: "改名高中", stage: "高中" });
  assert.equal(
    curriculumContext(d.students[0], d, "2026-11-23").schoolProgress.chapter,
    "三角函数",
  );
  d = saveStudentProgress(d, "s", {
    ...term,
    volume: "必修第一册",
    chapter: "指数函数",
    mode: "查漏补缺",
    notes: "先确保基础",
  });
  d.students[0].mathProgress.confirmedDate = "2026-11-23";
  c = curriculumContext(d.students[0], d, "2026-11-23");
  assert.equal(c.schoolProgress.chapter, "指数函数");
  assert.equal(c.mode, "查漏补缺");
  assert.equal(
    curriculumContext(d.students[0], d, "2026-11-21").schoolProgress,
    null,
  );
  assert.equal(
    curriculumContext(d.students[0], d, "2027-03-01").schoolProgress,
    null,
  );
  assert.equal(
    curriculumContext(
      { ...d.students[0], grade: "高中二年级" },
      d,
      "2026-11-23",
    ).schoolProgress,
    null,
  );
  const rules = coursePlanRules(
    { meta: { grade: "高中一年级" } },
    { regionalCurriculum: c },
  );
  assert.match(rules, /指数函数/);
  assert.match(rules, /辅导实际进度/);
  assert.match(rules, /不把月份当成全省统一周进度/);
  assert.throws(
    () =>
      saveStudentProgress(d, "s", {
        ...term,
        volume: "七年级上册",
        mode: "同步巩固",
        chapter: "",
        notes: "",
      }),
    /学段/,
  );
});

test("同校多个年级及学期独立保存，学生只继承自身年级；未关联学校不回退到第一所学校", () => {
  let d = fixture();
  const term = academicTerm();
  const form = (chapter, semester = term.semester) => ({
    ...term,
    semester,
    volume: "必修第一册",
    chapter,
    mode: "同步巩固",
    notes: "",
  });
  for (const [grade, chapter] of [
    ["高中一年级", "高一对数"],
    ["高中二年级", "高二圆锥曲线"],
    ["高中三年级", "高三复习"],
  ])
    d = saveSchoolProgress(d, "school", grade, form(chapter));
  d = saveSchoolProgress(d, "school", "高中二年级", form("高二更新圆锥曲线"));
  const otherTerm = term.semester === "上学期" ? "下学期" : "上学期";
  d = saveSchoolProgress(
    d,
    "school",
    "高中二年级",
    form("另一个学期", otherTerm),
  );
  assert.equal(Object.keys(d.schools[0].mathSchedules).length, 4);
  for (const [grade, chapter] of [
    ["高中一年级", "高一对数"],
    ["高中二年级", "高二更新圆锥曲线"],
    ["高中三年级", "高三复习"],
  ])
    assert.equal(
      curriculumContext({ ...d.students[0], grade }, d).schoolProgress.chapter,
      chapter,
    );
  assert.equal(
    curriculumContext({ ...d.students[0], schoolId: "" }, d).schoolProgress,
    null,
  );
  assert.throws(
    () => saveSchoolProgress(d, "school", "高中", form("未指定年级")),
    /具体年级/,
  );
  const original =
    d.schools[0].mathSchedules[schoolScheduleKey("高中一年级", term)];
  d.schools[0].mathSchedules[schoolScheduleKey("高中一年级", term)] = {
    ...original,
    grade: "高中二年级",
  };
  assert.equal(curriculumContext(d.students[0], d).schoolProgress, null);
});
