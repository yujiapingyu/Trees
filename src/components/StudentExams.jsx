import React, { useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "../shared/store";
import { gradeLabel, examTotal } from "../shared/exams";
import { Section, Button, Badge, Empty, Confirm, FileItem } from "./UI";
import { services } from "../shared/services";
import ExamRecordEditor from "./ExamRecordEditor";
export default function StudentExams({ student }) {
  const { data, mutate, run } = useApp();
  const [edit, setEdit] = useState(null),
    [remove, setRemove] = useState(null);
  const records = data.examRecords
    .filter((r) => r.studentId === student.id)
    .sort((a, b) =>
      (data.exams.find((e) => e.id === b.examId)?.date || "").localeCompare(
        data.exams.find((e) => e.id === a.examId)?.date || "",
      ),
    );
  return (
    <Section
      title="考试与成绩"
      subtitle="同一次联盟考试共用资料；保留当时学校，转校或升年级后历史不变"
      action={
        <Button
          icon={Plus}
          disabled={student.status === "已停课"}
          onClick={() => setEdit({})}
        >
          关联考试
        </Button>
      }
    >
      {!records.length ? (
        <Empty
          title="暂无关联考试"
          description="可先关联考试，成绩出分后再补录。"
        />
      ) : (
        records.map((r) => {
          const exam = data.exams.find((e) => e.id === r.examId);
          if (!exam) return <p key={r.id}>考试信息缺失，请恢复考试记录。</p>;
          const total = examTotal(r, exam);
          return (
            <article className="record-card" key={r.id}>
              <div className="section-head">
                <div>
                  <h3>{exam.name}</h3>
                  <p>
                    {exam.date} · {gradeLabel(exam.grade)} ·{" "}
                    {r.schoolSnapshot.name}
                  </p>
                </div>
                {exam.archived && <Badge>已归档</Badge>}
              </div>
              {exam.subjects.map((s) => {
                const result = r.results.find((x) => x.subjectId === s.id);
                return (
                  <p key={s.id}>
                    {s.name}：
                    {result?.status === "scored"
                      ? `${result.score} / ${s.maxScore}`
                      : result?.status === "absent"
                        ? "缺考"
                        : "未出分 / 未录入"}
                  </p>
                );
              })}
              <p className="form-hint">
                {total.complete
                  ? "总分：" + total.sum + " / " + total.max
                  : "已录入 " +
                    total.count +
                    "/" +
                    exam.subjects.length +
                    " 科，已录入合计 " +
                    total.sum +
                    " 分（非总分）"}
              </p>
              {r.notes && <p>{r.notes}</p>}
              <details>
                <summary>试卷与答案</summary>
                {exam.subjects.map((s) => (
                  <div key={s.id}>
                    <h4>{s.name}</h4>
                    {(s.files || [])
                      .filter(
                        (f) =>
                          !f.schoolId || f.schoolId === r.schoolSnapshot.id,
                      )
                      .map((f) => (
                        <FileItem
                          key={f.id}
                          file={{
                            ...f,
                            name:
                              (f.kind === "paper" ? "试卷" : "答案") +
                              " · " +
                              f.version +
                              " · " +
                              f.name,
                          }}
                          onOpen={() => run(() => services.open(f.path))}
                        />
                      ))}
                    {!s.files?.length && <p className="muted">尚未关联文件</p>}
                  </div>
                ))}
              </details>
              <div className="button-row">
                <Button
                  disabled={student.status === "已停课" || exam.archived}
                  onClick={() => setEdit(r)}
                >
                  编辑成绩
                </Button>
                <Button
                  disabled={student.status === "已停课" || exam.archived}
                  onClick={() => setRemove(r)}
                >
                  移除考试关联
                </Button>
              </div>
            </article>
          );
        })
      )}
      {edit && (
        <ExamRecordEditor
          student={student}
          record={edit.id ? edit : null}
          onClose={() => setEdit(null)}
        />
      )}
      {remove && (
        <Confirm
          title="移除考试关联"
          description="将移除当前学生的该次成绩记录，考试与试卷文件保留。"
          onClose={() => setRemove(null)}
          onConfirm={() =>
            mutate((d) => ({
              ...d,
              examRecords: d.examRecords.filter((r) => r.id !== remove.id),
            }))
          }
        />
      )}
    </Section>
  );
}
