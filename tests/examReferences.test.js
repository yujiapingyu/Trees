import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_DATA } from "../src/shared/domain.js";
import {
  addExamReference,
  examReferenceCourse,
  referenceCourseId,
  removeCourseReference,
} from "../src/shared/examReferences.js";
import { deleteExam, saveExam, removeExamFile } from "../src/shared/exams.js";
const file = (id, kind, patch = {}) => ({
  id,
  kind,
  name: id + ".txt",
  path: "/exams/" + id + ".txt",
  schoolId: "",
  version: "A卷",
  ...patch,
});
const setup = () => ({
  ...structuredClone(EMPTY_DATA),
  students: [
    { id: "s", status: "稳定授课", grade: "高中三年级", schoolId: "outside" },
    { id: "other", status: "稳定授课" },
  ],
  schools: [{ id: "a", name: "一中", stage: "高中" }],
  refs: [{ id: "old", studentId: "s", lessonId: "lesson" }],
  courseOrders: { s: ["lesson"] },
  exams: [
    {
      id: "e",
      name: "联盟考试",
      kind: "school",
      schoolIds: ["a"],
      grade: "高中一年级",
      date: "2026-11-02",
      subjects: [
        {
          id: "math",
          name: "数学",
          maxScore: 150,
          files: [
            file("paper", "paper"),
            file("answer", "answer"),
            file("other", "paper", { schoolId: "a" }),
            file("v2", "paper", { version: "B卷" }),
          ],
        },
      ],
    },
  ],
});
const add = (d) =>
  addExamReference(d, "s", "e", "math", { schoolId: "", version: "A卷" });
test("考试课程按学科、学校范围及卷别引用，置顶去重且不创建成绩", () => {
  let d = add(setup());
  const ref = d.refs[0],
    key = referenceCourseId(ref);
  assert.equal(d.refs.length, 2);
  assert.equal(d.courseOrders.s[0], key);
  assert.deepEqual(d.examRecords, []);
  assert.deepEqual(
    examReferenceCourse(d, ref, "/exams").files.map((f) => f.id),
    ["paper", "answer"],
  );
  assert.throws(() => add(d), /重复/);
  d = addExamReference(d, "s", "e", "math", { schoolId: "a", version: "A卷" });
  assert.equal(d.refs.length, 3);
  assert.deepEqual(
    examReferenceCourse(d, d.refs[0], "/exams").files.map((f) => f.id),
    ["other"],
  );
  assert.equal(d.exams[0].subjects[0].files.length, 4);
  assert.throws(
    () => addExamReference(d, "s", "e", "math", { version: "不存在" }),
    /变更/,
  );
  assert.throws(
    () =>
      addExamReference(
        { ...d, students: [{ id: "s", status: "已停课" }] },
        "s",
        "e",
        "math",
        { version: "B卷" },
      ),
    /停课/,
  );
});
test("课程跟随来源名称与同组文件更新，归档可读，越界或缺失来源明确标记", () => {
  const d = add(setup()),
    ref = d.refs[0];
  d.exams[0].name = "新名称";
  d.exams[0].archived = true;
  d.exams[0].subjects[0].files.push(file("answer2", "answer"));
  let course = examReferenceCourse(d, ref, "/exams");
  assert.match(course.name, /新名称/);
  assert.equal(course.files.length, 3);
  assert.equal(course.archived, true);
  assert.equal(examReferenceCourse(d, ref, "/new-root").missing, true);
  assert.equal(
    examReferenceCourse({ ...d, exams: [] }, ref, "/exams").missing,
    true,
  );
  // Older archived papers can still be used for teaching independently of participation.
  assert.equal(
    addExamReference(d, "other", "e", "math", { version: "A卷" }).refs[0]
      .studentId,
    "other",
  );
});
test("课程引用保护考试、学科与最后一份试卷，移除只解除当前学生关系", () => {
  let d = add(setup());
  const ref = d.refs[0],
    key = referenceCourseId(ref);
  assert.throws(() => deleteExam(d, "e"), /课程讲义引用/);
  assert.throws(
    () =>
      saveExam(d, {
        ...d.exams[0],
        subjects: [{ id: "new", name: "物理", maxScore: 100, files: [] }],
      }),
    /课程讲义引用/,
  );
  assert.throws(() => removeExamFile(d, "e", "math", "paper"), /最后一份/);
  d = removeExamFile(d, "e", "math", "answer");
  assert.equal(d.exams[0].subjects[0].files.length, 3);
  assert.throws(
    () =>
      removeCourseReference(
        { ...d, feedback: [{ studentId: "s", lessonId: key }] },
        "s",
        key,
      ),
    /课堂反馈引用/,
  );
  const clean = removeCourseReference(
    { ...d, feedback: [{ studentId: "other", lessonId: key }] },
    "s",
    key,
  );
  assert.deepEqual(clean.refs, [d.refs[1]]);
  assert.deepEqual(clean.courseOrders.s, ["lesson"]);
  assert.equal(clean.exams.length, 1);
  assert.equal(deleteExam(clean, "e").exams.length, 0);
});
