import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_DATA } from "../src/shared/domain.js";
import {
  saveExam,
  saveExamRecord,
  deleteExam,
  examTotal,
  paperGroups,
} from "../src/shared/exams.js";
import { deleteSchool } from "../src/shared/schools.js";
const setup = () => ({
  ...structuredClone(EMPTY_DATA),
  schools: [
    { id: "a", name: "一中", stage: "高中" },
    { id: "b", name: "二中", stage: "高中" },
    { id: "c", name: "初中", stage: "初中" },
  ],
  students: [
    {
      id: "s",
      name: "学生",
      grade: "高中一年级",
      schoolId: "a",
      status: "稳定授课",
    },
  ],
});
const exam = (patch = {}) => ({
  id: "e",
  name: "A9联盟11月测试",
  kind: "alliance",
  organizer: "A9",
  grade: "高中一年级",
  date: "2026-11-02",
  schoolIds: ["a", "b"],
  subjects: [{ id: "math", name: "数学", maxScore: 150, files: [] }],
  notes: "",
  archived: false,
  ...patch,
});
test("多校联盟考试复用同一考试，独考只能一校且年级学段匹配", () => {
  let d = saveExam(setup(), exam());
  assert.equal(d.exams.length, 1);
  assert.equal(d.exams[0].schoolIds.length, 2);
  assert.throws(
    () => saveExam(d, exam({ id: "duplicate", schoolIds: ["a"] })),
    /已存在/,
  );
  assert.throws(
    () => saveExam(d, exam({ id: "school", kind: "school" })),
    /一所/,
  );
  assert.throws(
    () => saveExam(d, exam({ id: "junior", schoolIds: ["c"] })),
    /学段/,
  );
  assert.throws(() => saveExam(d, exam({ date: "2026-02-30" })), /日期/);
  d = saveExam(d, exam({ id: "school-a", kind: "school", schoolIds: ["a"] }));
  d = saveExam(d, exam({ id: "school-b", kind: "school", schoolIds: ["b"] }));
  assert.equal(d.exams.length, 3);
});
test("成绩留空、缺考与零分独立保存，并拒绝越界、重复关联", () => {
  let d = saveExam(setup(), exam());
  d = saveExamRecord(d, { id: "r", examId: "e", studentId: "s", results: [] });
  assert.equal(d.examRecords[0].results[0].score, null);
  assert.equal(examTotal(d.examRecords[0], d.exams[0]).complete, false);
  assert.throws(
    () => saveExamRecord(d, { examId: "e", studentId: "s", results: [] }),
    /已关联/,
  );
  d = saveExamRecord(d, {
    ...d.examRecords[0],
    results: [{ subjectId: "math", status: "scored", score: "0" }],
  });
  assert.equal(d.examRecords[0].results[0].score, 0);
  assert.equal(examTotal(d.examRecords[0], d.exams[0]).complete, true);
  assert.throws(
    () =>
      saveExamRecord(d, {
        ...d.examRecords[0],
        results: [{ subjectId: "math", status: "scored", score: 151 }],
      }),
    /0–150/,
  );
  d = saveExamRecord(d, {
    ...d.examRecords[0],
    results: [{ subjectId: "math", status: "absent", score: 20 }],
  });
  assert.equal(d.examRecords[0].results[0].score, null);
});
test("已有考试历史保护学校、年级、学科和满分，升学转校不改快照", () => {
  let d = saveExam(setup(), exam());
  d = saveExamRecord(d, {
    id: "r",
    examId: "e",
    studentId: "s",
    results: [{ subjectId: "math", status: "scored", score: 135 }],
  });
  assert.throws(() => deleteExam(d, "e"), /归档/);
  assert.throws(() => deleteSchool(d, "b"), /考试/);
  assert.throws(
    () => saveExam(d, { ...d.exams[0], grade: "高中二年级" }),
    /年级/,
  );
  assert.throws(() => saveExam(d, { ...d.exams[0], schoolIds: ["b"] }), /成绩/);
  assert.throws(
    () =>
      saveExam(d, {
        ...d.exams[0],
        subjects: [{ id: "math", name: "数学", maxScore: 100, files: [] }],
      }),
    /满分/,
  );
  d.students[0] = { ...d.students[0], grade: "高中二年级", schoolId: "b" };
  d = saveExamRecord(d, { ...d.examRecords[0], notes: "已核对" });
  assert.equal(d.examRecords[0].schoolSnapshot.id, "a");
  assert.equal(d.examRecords[0].gradeSnapshot, "高中一年级");
});
test("历史模式显式允许不同年级，停课和归档禁止新增或修改", () => {
  let d = saveExam(setup(), exam({ grade: "高中二年级" }));
  const r = {
    id: "r",
    examId: "e",
    studentId: "s",
    schoolId: "b",
    results: [],
  };
  assert.throws(() => saveExamRecord(d, r), /历史模式/);
  d = saveExamRecord(d, { ...r, historical: true });
  assert.equal(d.examRecords[0].schoolSnapshot.id, "b");
  assert.equal(d.examRecords[0].gradeSnapshot, "高中二年级");
  d.exams[0].archived = true;
  assert.throws(() => saveExamRecord(d, d.examRecords[0]), /归档/);
  d.exams[0].archived = false;
  d.students[0].status = "已停课";
  assert.throws(() => saveExamRecord(d, d.examRecords[0]), /停课/);
});
test("试卷答案按学科内的学校范围与版本配对，不跨校误配", () => {
  const groups = paperGroups({
    files: [
      { kind: "paper", schoolId: "", version: "A" },
      { kind: "answer", schoolId: "a", version: "A" },
      { kind: "answer", schoolId: "", version: "A" },
    ],
  });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].paper.length, 1);
  assert.equal(groups[0].answer.length, 1);
  assert.equal(groups[1].paper.length, 0);
});
