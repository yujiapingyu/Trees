import React, { useState } from "react";
import { Plus, Users, FolderOpen, SlidersHorizontal } from "lucide-react";
import { useApp } from "../shared/store";
import { studentDirectoryState } from "../shared/paths";
import { studentMatches, GRADES, STATUSES } from "../shared/domain";
import { Button, SearchBox, Badge, Empty, IconButton } from "./UI";
export function Avatar({ student, size = "" }) {
  const colors = ["blue", "mint", "purple", "peach"];
  const hash = [...(student?.name || "")].reduce(
    (a, b) => a + b.charCodeAt(0),
    0,
  );
  return (
    <span className={"avatar " + colors[hash % 4] + " " + size}>
      {student?.name?.slice(-2) || "生"}
    </span>
  );
}
export default function StudentList({
  selected,
  onSelect,
  query = "",
  onQuery,
  grade = "",
  onGrade,
  status = "active",
  onStatus,
  onAdd,
  onSettings,
  count,
  label = "学生列表",
  extra,
  students: custom,
}) {
  const { data, config } = useApp();
  const students = (custom || data.students).filter(
    (s) =>
      studentMatches(s, query) &&
      (!grade || s.grade === grade) &&
      (status === "all" ||
        (status === "active" ? s.status !== "已停课" : s.status === status)),
  );
  return (
    <aside className="student-list panel">
      <div className="panel-heading">
        <h2>
          {label} <span>{students.length}</span>
        </h2>
        {onAdd && <IconButton icon={Plus} label="新增学生" onClick={onAdd} />}
      </div>
      {onQuery && (
        <SearchBox
          value={query}
          onChange={onQuery}
          placeholder="搜索姓名、年级或拼音…"
        />
      )}
      {(onGrade || onStatus) && (
        <div className="filter-row">
          {onGrade && (
            <select
              aria-label="筛选年级"
              value={grade}
              onChange={(e) => onGrade(e.target.value)}
            >
              <option value="">全部年级</option>
              {GRADES.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          )}
          {onStatus && (
            <select
              aria-label="筛选授课状态"
              value={status}
              onChange={(e) => onStatus(e.target.value)}
            >
              <option value="active">在读学生</option>
              <option value="all">全部状态</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
      )}
      {extra}
      <div className="student-list-items">
        {!students.length ? (
          <Empty
            icon={Users}
            title="暂无学生"
            description={
              query ? "调整搜索或筛选条件" : "连接学生目录，开始教学管理"
            }
          />
        ) : (
          students.map((s) => (
            <button
              className={
                "student-item " + (selected === s.id ? "selected" : "")
              }
              key={s.id}
              onClick={() => onSelect(s.id)}
            >
              <Avatar student={s} />
              <span className="student-label">
                <strong>
                  {s.name}
                  {studentDirectoryState(s, config.studentsRoot) ===
                  "outside" ? (
                    <small className="text-danger"> · 旧目录档案</small>
                  ) : (
                    s.missing && (
                      <small className="text-danger"> · 目录缺失</small>
                    )
                  )}
                </strong>
                <small>
                  {s.grade || "未设置年级"}
                  {count && " · " + count(s)}
                </small>
              </span>
              {s.status === "已停课" ? (
                <Badge>已停课</Badge>
              ) : (
                <span
                  className={
                    "status-dot " + (s.status === "稳定授课" ? "green" : "")
                  }
                />
              )}
            </button>
          ))
        )}
      </div>
      {onSettings && (
        <button className="panel-bottom" onClick={onSettings}>
          <FolderOpen size={16} />
          配置学生根目录
          <SlidersHorizontal size={14} />
        </button>
      )}
    </aside>
  );
}
