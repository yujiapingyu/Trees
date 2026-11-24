import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_DATA } from "../src/shared/domain.js";
import { saveTeacherProfile } from "../src/shared/teacherProfile.js";
import { freshReport } from "../src/shared/reports.js";

test("个人姓名成为新报告默认署名，学生单独指定的教师优先，旧报告不改动", () => {
  const student = { id: "s", name: "学生", grade: "高中一年级" };
  const old = {
    id: "r",
    studentId: "s",
    type: "stage",
    status: "final",
    reportDate: "2026-10-20",
    meta: {
      teacher: "原任课教师",
      advisor: "原班主任",
      periodEnd: "2026-10-20",
    },
  };
  const data = saveTeacherProfile(
    { ...structuredClone(EMPTY_DATA), students: [student], reports: [old] },
    { name: " 当前老师 ", phone: "0571-12345678", wechat: "teacher_private" },
  );
  assert.equal(
    freshReport(student, data, "stage", "2026-11-23").meta.teacher,
    "当前老师",
  );
  assert.equal(
    freshReport(
      { ...student, reportSettings: { teacher: "单独指定老师" } },
      data,
      "stage",
      "2026-11-23",
    ).meta.teacher,
    "单独指定老师",
  );
  assert.equal(data.reports[0].meta.teacher, "原任课教师");
  assert.equal(data.reports[0].meta.advisor, "原班主任");
  assert.equal(data.teacherProfile.phone, "0571-12345678");
  assert.throws(
    () => saveTeacherProfile(data, { name: "老师", bio: "字".repeat(1001) }),
    /个人简介/,
  );
});
