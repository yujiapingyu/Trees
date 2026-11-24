import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_DATA, followupState, today } from "../src/shared/domain.js";
import {
  actionAuthority,
  actionDate,
  isAssistantActionRequest,
  prepareAssistantAction,
  executeAssistantActions,
  undoAssistantAction,
  followupListResult,
} from "../src/shared/assistantActions.js";
const config = {
  studentsRoot: "/students",
  lessonsRoot: "/lessons",
  examsRoot: "/exams",
};
const fixture = () => ({
  ...structuredClone(EMPTY_DATA),
  schools: [{ id: "school", name: "测试高中", stage: "高中" }],
  students: [
    {
      id: "s",
      name: "张小明",
      grade: "高中一年级",
      schoolId: "school",
      directoryPath: "/students/张小明",
      status: "稳定授课",
    },
    {
      id: "b",
      name: "李小红",
      grade: "高中一年级",
      schoolId: "school",
      directoryPath: "/students/李小红",
      status: "稳定授课",
    },
    {
      id: "c",
      name: "初中学生",
      grade: "初中一年级",
      directoryPath: "/students/初中学生",
    },
    {
      id: "stop",
      name: "停课学生",
      status: "已停课",
      directoryPath: "/students/停课学生",
    },
  ],
  lessons: [{ id: "l", name: "对数", grade: "高一", path: "/lessons/对数" }],
  exams: [
    {
      id: "e",
      name: "A9联盟11月测试",
      grade: "高中一年级",
      date: today(),
      schoolIds: ["school"],
      subjects: [
        {
          id: "math",
          name: "数学",
          maxScore: 150,
          files: [
            {
              id: "p",
              kind: "paper",
              path: "/exams/p.pdf",
              version: "默认卷",
              schoolId: "",
            },
            {
              id: "a",
              kind: "answer",
              path: "/exams/a.pdf",
              version: "默认卷",
              schoolId: "",
            },
          ],
        },
      ],
    },
  ],
  homework: [
    { id: "h", studentId: "s", name: "对数作业", completed: false },
    { id: "hb", studentId: "b", name: "李的作业", completed: false },
  ],
});
const apply = (d, question, actions, extra = {}) =>
  executeAssistantActions(
    d,
    { actions },
    { question, scope: "workspace", config, operationId: "op", ...extra },
  );
test("自然语言动作识别、年级与学校自动匹配、日期由本地按北京时间解释", () => {
  for (const q of [
    "能不能帮我给张小明引用对数讲义",
    "下周五回访张小明",
    "把张小明的作业标为完成",
    "列出待回访名单",
  ])
    assert.ok(isAssistantActionRequest(q), q);
  assert.equal(isAssistantActionRequest("怎么关联讲义"), false);
  assert.deepEqual(
    actionAuthority(
      fixture(),
      config,
      "workspace",
      "给测试高中高一学生引用对数讲义",
    ).studentIds,
    ["s", "b"],
  );
  assert.deepEqual(
    actionAuthority(fixture(), config, "workspace", "给七年级学生引用对数讲义")
      .studentIds,
    ["c"],
  );
  assert.equal(
    actionDate("下周五回访", { future: true, now: "2026-11-23" }),
    "2026-12-04",
  );
  assert.equal(
    actionDate("本周五回访", { future: true, now: "2026-11-23" }),
    "2026-11-27",
  );
  assert.throws(
    () => actionDate("2026年2月30日", { now: "2026-01-01" }),
    /日期无效/,
  );
});
test("批量引用直接保存、重试幂等、重复引用保留、撤销仅移除本次增加项", () => {
  const d = fixture();
  d.refs = [{ id: "old", studentId: "s", lessonId: "l" }];
  d.courseOrders = { s: ["old-course", "l"] };
  const next = apply(d, "给高一学生引用对数讲义", [
    { type: "reference_lesson", lessonId: "l" },
  ]);
  assert.equal(next.refs.length, 2);
  assert.equal(next.assistantActions.op.lines.length, 2);
  assert.equal(d.refs.length, 1);
  assert.equal(
    apply(next, "给高一学生引用对数讲义", [
      { type: "reference_lesson", lessonId: "l" },
    ]),
    next,
  );
  const undone = undoAssistantAction(next, "op");
  assert.deepEqual(undone.refs, d.refs);
  assert.deepEqual(undone.courseOrders.s, d.courseOrders.s);
  assert.ok(undone.assistantActions.op.undoneAt);
});
test("试卷引用包含独立试卷和答案；关联考试成绩留空，不伪称参加", () => {
  const next = apply(fixture(), "给张小明引用A9联盟11月测试试卷", [
    { type: "reference_exam", examId: "e", subjectId: "math" },
  ]);
  assert.equal(next.refs[0].type, "exam");
  assert.match(next.assistantActions.op.lines[0], /试卷1份、答案1份/);
  const enrolled = apply(fixture(), "给张小明关联A9联盟11月测试考试", [
    { type: "enroll_exam", examId: "e" },
  ]);
  assert.equal(enrolled.examRecords[0].results[0].score, null);
  assert.equal(enrolled.examRecords[0].results[0].status, "pending");
  const bad = fixture();
  bad.students[0].grade = "高中二年级";
  assert.throws(
    () =>
      apply(bad, "给张小明关联A9联盟11月测试考试", [
        { type: "enroll_exam", examId: "e" },
      ]),
    /年级不匹配/,
  );
});
test("同名资料与多卷别给出具体候选，不靠模型猜测", () => {
  const d = fixture();
  d.lessons.push({ ...d.lessons[0], id: "l2", grade: "高二" });
  try {
    prepareAssistantAction(d, config, "workspace", "给张小明引用对数讲义");
    assert.fail();
  } catch (e) {
    assert.equal(e.choices.length, 2);
  }
  const p = prepareAssistantAction(
    d,
    config,
    "workspace",
    "给张小明引用对数讲义",
    {},
    { lessonId: "l2" },
  );
  assert.equal(p.catalog.lessons[0].id, "l2");
  const e = fixture();
  e.exams[0].subjects[0].files.push({
    id: "v2",
    kind: "paper",
    path: "/exams/v2.pdf",
    version: "B卷",
    schoolId: "",
  });
  try {
    apply(e, "给张小明引用A9联盟11月测试试卷", [
      { type: "reference_exam", examId: "e" },
    ]);
    assert.fail();
  } catch (err) {
    assert.equal(err.choices.length, 2);
  }
  const selected = apply(
    e,
    "给张小明引用A9联盟11月测试试卷",
    [{ type: "reference_exam", examId: "e" }],
    { choice: { examId: "e", version: "B卷" } },
  );
  assert.equal(selected.refs[0].version, "B卷");
});
test("同名学生补问；具体学生助手及原文范围不能被模型扩大", () => {
  const d = fixture();
  d.students[1].name = "张小明";
  assert.throws(
    () => actionAuthority(d, config, "workspace", "给张小明引用对数讲义"),
    (e) => e.choices.length === 2,
  );
  assert.throws(
    () =>
      apply(fixture(), "给张小明引用对数讲义", [
        { type: "reference_lesson", studentIds: ["b"], lessonId: "l" },
      ]),
    /超出/,
  );
  assert.throws(
    () =>
      apply(
        fixture(),
        "给李小红引用对数讲义",
        [{ type: "reference_lesson", lessonId: "l" }],
        { scope: "s" },
      ),
    /限定/,
  );
  assert.throws(
    () =>
      apply(
        fixture(),
        "给张小明引用对数讲义",
        [{ type: "reference_lesson", lessonId: "l" }],
        { scope: "general" },
      ),
    /切换/,
  );
  assert.throws(
    () =>
      apply(fixture(), "不要给张小明引用对数讲义", [
        { type: "reference_lesson", lessonId: "l" },
      ]),
    /否定/,
  );
});
test("保存原文观察与课程，不将记录中提到的他人或指令扩成授权", () => {
  const q = "给张小明记一条观察：李小红说不要布置作业。";
  const d = apply(fixture(), q, [
    {
      type: "add_note",
      sourceQuote: "李小红说不要布置作业。",
      title: "课堂观察",
    },
  ]);
  assert.equal(d.notes[0].studentId, "s");
  assert.equal(d.notes[0].markdown, "李小红说不要布置作业。");
  assert.throws(
    () =>
      apply(fixture(), q, [{ type: "add_note", sourceQuote: "上课不认真" }]),
    /原文/,
  );
  const course = apply(
    fixture(),
    "给张小明登记今天的课堂记录：今天讲对数，漏了真数条件。",
    [{ type: "record_lesson", sourceQuote: "今天讲对数，漏了真数条件。" }],
  );
  assert.equal(course.sessions.length, 1);
  assert.equal(course.sessions[0].closeout.state, "pending");
  assert.equal(course.sessions[0].date, today());
  assert.equal(course.feedback.length, 0);
});
test("安排回访直接生效，但不虚构历史沟通；作业仅修改当前对象", () => {
  const d = apply(fixture(), "下周五回访张小明", [
    { type: "schedule_followup" },
  ]);
  assert.ok(d.students[0].followupPlan);
  assert.equal(d.followups.length, 0);
  const state = followupState([], today(), false, d.students[0].followupPlan);
  assert.ok(state.next);
  assert.equal(state.last, undefined);
  const hw = apply(fixture(), "把张小明的对数作业标记完成", [
    { type: "complete_homework", homeworkIds: ["h"] },
  ]);
  assert.equal(hw.homework[0].completed, true);
  assert.equal(hw.homework[1].completed, false);
  assert.throws(
    () =>
      apply(fixture(), "把张小明的作业标记完成", [
        { type: "complete_homework", homeworkIds: ["hb"] },
      ]),
    /不属于/,
  );
  assert.equal(undoAssistantAction(hw, "op").homework[0].completed, false);
});
test("整个计划原子保存、未知动作及无效资源不执行，失败不留半成品", () => {
  const d = fixture(),
    before = JSON.stringify(d);
  assert.throws(
    () =>
      apply(d, "给张小明引用对数讲义并添加记录：内容", [
        { type: "reference_lesson", lessonId: "l" },
        { type: "add_note", sourceQuote: "不存在的内容" },
      ]),
    /原文/,
  );
  assert.equal(JSON.stringify(d), before);
  assert.throws(
    () => apply(d, "给张小明引用对数讲义", [{ type: "delete_student" }]),
    /本轮/,
  );
  d.lessons[0].path = "/outside/对数";
  assert.throws(
    () =>
      apply(d, "给张小明引用对数讲义", [
        { type: "reference_lesson", lessonId: "l" },
      ]),
    /没有找到/,
  );
});
test("撤销保护后续手工修改、考试成绩和已被使用的讲义", () => {
  const note = apply(fixture(), "给张小明记一条观察：运算要检查", [
    { type: "add_note", sourceQuote: "运算要检查" },
  ]);
  note.notes[0].markdown = "教师新内容";
  assert.throws(() => undoAssistantAction(note, "op"), /后续修改/);
  const linked = apply(fixture(), "给张小明引用对数讲义", [
    { type: "reference_lesson", lessonId: "l" },
  ]);
  linked.feedback.push({ id: "f", studentId: "s", lessonId: "l" });
  assert.throws(() => undoAssistantAction(linked, "op"), /已用于/);
  const exam = apply(fixture(), "给张小明关联A9联盟11月测试考试", [
    { type: "enroll_exam", examId: "e" },
  ]);
  exam.examRecords[0].results[0] = {
    subjectId: "math",
    status: "scored",
    score: 80,
  };
  assert.throws(() => undoAssistantAction(exam, "op"), /后续修改/);
});
test("回访名单按实际计划计算，停课学生不进入待办", () => {
  const d = fixture();
  const a = actionAuthority(d, config, "workspace", "整理本周需要回访的学生");
  const out = followupListResult(d, a, "整理本周需要回访的学生");
  assert.match(out.text, /3位/);
  assert.doesNotMatch(out.text, /停课学生/);
});

test("只整理本周名单不会被解释成安排本周回访；多份作业不能由模型擅选", () => {
  const d = fixture();
  assert.deepEqual(
    prepareAssistantAction(d, config, "workspace", "整理本周需要回访的学生")
      .authority.allowed,
    ["list_followups"],
  );
  d.homework.push({
    id: "h2",
    studentId: "s",
    name: "函数作业",
    completed: false,
  });
  assert.throws(
    () =>
      apply(d, "把张小明的作业标记完成", [
        { type: "complete_homework", homeworkIds: ["h"] },
      ]),
    (e) => e.choices.length === 2,
  );
  const done = apply(d, "把张小明的全部作业标记完成", [
    { type: "complete_homework", homeworkIds: ["h"] },
  ]);
  assert.equal(
    done.homework.filter((h) => h.studentId === "s" && h.completed).length,
    2,
  );
});

test("完整保留冒号后的原文；姓名包含关系与停课学生不能意外扩大批量范围", () => {
  const d = fixture();
  const saved = apply(d, "给张小明记一条观察：检查符号。下次继续。", [
    { type: "add_note", sourceQuote: "检查符号" },
  ]);
  assert.equal(saved.notes[0].markdown, "检查符号。下次继续。");
  d.students.push({ ...d.students[0], id: "long", name: "张小明明" });
  assert.deepEqual(
    actionAuthority(d, config, "workspace", "给张小明明引用对数讲义")
      .studentIds,
    ["long"],
  );
  assert.throws(
    () =>
      apply(d, "给高一的停课学生引用对数讲义", [
        { type: "reference_lesson", lessonId: "l" },
      ]),
    /已停课/,
  );
});

test("页面代词优先于资料名称中的年级，单说资料年级不扩大到全体学生", () => {
  const d = fixture();
  assert.deepEqual(
    actionAuthority(d, config, "workspace", "给他引用高一对数讲义", {
      studentId: "s",
    }).studentIds,
    ["s"],
  );
  assert.deepEqual(
    actionAuthority(d, config, "workspace", "引用高一对数讲义").studentIds,
    [],
  );
});

test("通用助手不通过办事入口泄露学生名单，资源目录范围也不读取回访", () => {
  for (const scope of ["general", "resources"])
    assert.throws(
      () =>
        prepareAssistantAction(
          fixture(),
          config,
          scope,
          "整理本周需要回访的学生",
        ),
      /切换/,
    );
  assert.ok(
    prepareAssistantAction(
      fixture(),
      config,
      "overview",
      "整理本周需要回访的学生",
    ).authority.allowed.includes("list_followups"),
  );
});
