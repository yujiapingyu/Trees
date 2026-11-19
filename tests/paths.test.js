import test from "node:test";
import assert from "node:assert/strict";
import {
  isWithinRoot,
  normalizePath,
  studentDirectoryState,
} from "../src/shared/paths.js";
test("目录前缀以路径分隔符为边界，兼容尾斜线与路径规范化", () => {
  assert.equal(isWithinRoot("/资料/学生/张三", "/资料/学生/"), true);
  assert.equal(isWithinRoot("/资料/学生旧/张三", "/资料/学生"), false);
  assert.equal(isWithinRoot("/资料/学生/../旧目录", "/资料/学生"), false);
  assert.equal(isWithinRoot("/资料/学生/张三", ""), false);
  assert.equal(normalizePath("C:\\资料\\学生\\张三"), "C:/资料/学生/张三");
});
test("切换根目录后旧学生档案停止扫描，原数据不被重写", () => {
  const student = {
    id: "original-id",
    directoryPath: "/旧目录/张三",
    missing: false,
  };
  assert.equal(studentDirectoryState(student, "/新目录"), "outside");
  assert.equal(studentDirectoryState(student, ""), "unconfigured");
  assert.equal(
    studentDirectoryState({ ...student, missing: true }, "/旧目录"),
    "missing",
  );
  assert.equal(studentDirectoryState(student, "/旧目录"), "available");
  assert.equal(student.id, "original-id");
  assert.equal(student.directoryPath, "/旧目录/张三");
});
