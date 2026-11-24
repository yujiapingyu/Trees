import React, { useState } from "react";
import { useApp } from "../shared/store";
import { matches } from "../shared/domain";
import { gradeLabel, paperGroups } from "../shared/exams";
import {
  addExamReference,
  matchesExamGroup,
  referenceCourseId,
} from "../shared/examReferences";
import { Modal, SearchBox, Button, Empty, Badge } from "./UI";

export default function ExamCoursePicker({ student, onClose, onAdded }) {
  const { data, mutate, run } = useApp();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const exams = data.exams
    .filter(
      (e) =>
        (archived || !e.archived) &&
        matches(
          [
            e.name,
            e.organizer,
            e.grade,
            gradeLabel(e.grade),
            ...e.subjects.map((s) => s.name),
          ].join(" "),
          query,
        ),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Modal title="引用考试试卷" onClose={() => !busy && onClose()} wide>
      <p className="form-hint">
        选择本次讲评的学科、卷别及适用学校。引用只用于教学，不要求学生参加过该考试，也不会添加成绩；文件继续由考试管理统一维护。
      </p>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder="搜索考试、学科、年级或联盟…"
      />
      <label className="check-line">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        包含归档考试
      </label>
      {!exams.length && (
        <Empty
          title="暂无可引用的考试"
          description="请先在考试管理创建考试并上传试卷，或调整搜索条件。"
        />
      )}
      {exams.map((exam) => (
        <article className="record-card" key={exam.id}>
          <h3>
            {exam.name} {exam.archived && <Badge>已归档</Badge>}
          </h3>
          <p className="muted">
            {exam.date} · {gradeLabel(exam.grade)}
          </p>
          {exam.subjects.flatMap((subject) =>
            paperGroups(subject)
              .filter((group) => group.paper.length)
              .map((group) => {
                const scope = group.schoolId
                  ? data.schools.find((s) => s.id === group.schoolId)?.name ||
                    "原学校"
                  : "公共卷";
                const added = data.refs.some(
                  (r) =>
                    r.studentId === student.id &&
                    matchesExamGroup(r, exam.id, subject.id, group),
                );
                return (
                  <div
                    className="lesson-pick-row"
                    key={JSON.stringify([
                      subject.id,
                      group.schoolId,
                      group.version,
                    ])}
                  >
                    <div className="grow">
                      <strong>
                        {subject.name} · {group.version} · {scope}
                      </strong>
                      <small>
                        {group.paper.map((f) => f.name).join("、")} ·{" "}
                        {group.answer.length
                          ? `${group.answer.length} 份答案`
                          : "暂未上传答案"}
                      </small>
                    </div>
                    <Button
                      busy={busy}
                      disabled={added || student.status === "已停课"}
                      aria-label={`引用 ${exam.name} ${subject.name} ${group.version} ${scope}`}
                      onClick={() =>
                        run(async () => {
                          setBusy(true);
                          try {
                            let courseId;
                            await mutate((d) => {
                              const next = addExamReference(
                                d,
                                student.id,
                                exam.id,
                                subject.id,
                                group,
                              );
                              courseId = referenceCourseId(next.refs[0]);
                              return next;
                            });
                            onAdded(courseId);
                          } finally {
                            setBusy(false);
                          }
                        }, "考试试卷已引用")
                      }
                    >
                      {added ? "已引用" : "引用这份试卷"}
                    </Button>
                  </div>
                );
              }),
          )}
          {!exam.subjects.some((s) =>
            paperGroups(s).some((g) => g.paper.length),
          ) && <p className="muted">尚未上传试卷，请先到考试管理添加文件。</p>}
        </article>
      ))}
    </Modal>
  );
}
