import test from "node:test";
import assert from "node:assert/strict";
import { copyExamFiles, appendExamFiles } from "../src/shared/examFiles.js";
const base = {
  root: "/exam-data",
  examId: "exam",
  subjectId: "math",
  version: "A卷",
  schoolId: "school",
};
test("试卷与答案分开选、多文件去重，批量保存保留类型和同名文件", async () => {
  const copies = [];
  const files = await copyExamFiles({
    ...base,
    papers: ["/paper/one.pdf", "/paper/one.pdf", "/paper/two.pdf"],
    answers: ["/answer/one.pdf"],
    copy: async (a, b) => copies.push([a, b]),
  });
  assert.equal(files.length, 3);
  assert.deepEqual(
    files.map((f) => f.kind),
    ["paper", "paper", "answer"],
  );
  assert.equal(new Set(files.map((f) => f.path)).size, 3);
  assert.ok(files.every((f) => f.version === "A卷" && f.schoolId === "school"));
  const data = {
    exams: [
      {
        id: "exam",
        schoolIds: ["school"],
        subjects: [{ id: "math", files: [{ id: "original" }] }],
      },
    ],
  };
  const next = appendExamFiles(data, "exam", "math", files);
  assert.equal(next.exams[0].subjects[0].files.length, 4);
  assert.equal(next.exams[0].subjects[0].files[0].id, "original");
  assert.equal(
    appendExamFiles(next, "exam", "math", files).exams[0].subjects[0].files
      .length,
    4,
  );
});
test("保存失败后保留成功副本，重试不重复复制且不覆盖旧关联", async () => {
  const cache = new Map(),
    calls = [];
  let fail = true;
  const copy = async (source) => {
    calls.push(source);
    if (source === "/answer.pdf" && fail) throw Error("disk failure");
  };
  const input = {
    ...base,
    papers: ["/paper.pdf"],
    answers: ["/answer.pdf"],
    copy,
    cache,
  };
  await assert.rejects(() => copyExamFiles(input), /answer.pdf.*保存失败/);
  assert.equal(cache.size, 1);
  fail = false;
  const files = await copyExamFiles(input);
  assert.equal(files.length, 2);
  assert.deepEqual(calls, ["/paper.pdf", "/answer.pdf", "/answer.pdf"]);
  assert.throws(
    () =>
      appendExamFiles(
        { exams: [{ id: "exam", archived: true, subjects: [] }] },
        "exam",
        "math",
        files,
      ),
    /变更/,
  );
});
test("允许仅试卷或仅答案，空选择与缺少根目录明确报错", async () => {
  const copy = async () => {};
  assert.equal(
    (await copyExamFiles({ ...base, papers: ["/paper.pdf"], copy }))[0].kind,
    "paper",
  );
  assert.equal(
    (await copyExamFiles({ ...base, answers: ["/answer.pdf"], copy }))[0].kind,
    "answer",
  );
  await assert.rejects(() => copyExamFiles({ ...base, copy }), /至少/);
  await assert.rejects(
    () => copyExamFiles({ ...base, root: "", papers: ["/paper.pdf"], copy }),
    /根目录/,
  );
});
