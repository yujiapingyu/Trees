import React, { useState } from "react";
import { useApp } from "../shared/store";
import { id } from "../shared/domain";
import { EXAM_GRADES, gradeLabel, saveExamRecord } from "../shared/exams";
import { Modal, Field, Button, ErrorBox } from "./UI";
export default function ExamRecordEditor({
  student: fixed,
  exam: fixedExam,
  record,
  onClose,
}) {
  const { data, mutate } = useApp();
  const [form, setForm] = useState(
      record
        ? { ...record, schoolId: record.schoolSnapshot.id, historical: false }
        : {
            id: id(),
            studentId: fixed?.id || "",
            examId: fixedExam?.id || "",
            schoolId: fixed?.schoolId || "",
            historical: false,
            results: [],
            notes: "",
          },
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const student = data.students.find((s) => s.id === form.studentId),
    exam = data.exams.find((e) => e.id === form.examId);
  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const available = data.exams.filter(
    (e) =>
      !e.archived &&
      (form.historical ||
        (student &&
          e.grade === student.grade &&
          e.schoolIds.includes(student.schoolId))),
  );
  return (
    <Modal
      title={record ? "编辑考试成绩" : "关联考试与成绩"}
      onClose={() => !busy && onClose()}
      wide
    >
      {!fixed && (
        <Field label="关联学生">
          <select
            disabled={!!record}
            value={form.studentId}
            onChange={(e) => {
              const s = data.students.find((s) => s.id === e.target.value);
              setForm((f) => ({
                ...f,
                studentId: s?.id || "",
                schoolId: s?.schoolId || "",
                results: [],
              }));
            }}
          >
            <option value="">选择学生</option>
            {data.students
              .filter((s) => s.status !== "已停课")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {gradeLabel(s.grade)}
                </option>
              ))}
          </select>
        </Field>
      )}
      {!record && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={form.historical}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                historical: e.target.checked,
                ...(!fixedExam ? { examId: "", results: [] } : {}),
              }))
            }
          />
          历史考试模式（允许当前年级或学校与考试不一致，须明确选择当时学校）
        </label>
      )}
      {!fixedExam && (
        <Field label="关联考试">
          <select
            disabled={!!record}
            value={form.examId}
            onChange={(e) =>
              setForm((f) => ({ ...f, examId: e.target.value, results: [] }))
            }
          >
            <option value="">选择考试</option>
            {(record ? data.exams : available).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {gradeLabel(e.grade)} · {e.date}
              </option>
            ))}
          </select>
        </Field>
      )}
      {exam && (
        <>
          <p className="info-banner">
            {exam.name} · {gradeLabel(exam.grade)} · {exam.date}
            。成绩可以全部留空，未出分与零分分别保存。
          </p>
          <Field label="考试时学校">
            <select
              disabled={!!record}
              value={form.schoolId}
              onChange={(e) => change("schoolId", e.target.value)}
            >
              <option value="">选择学校</option>
              {data.schools
                .filter((s) => exam.schoolIds.includes(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          {exam.subjects.map((subject) => {
            const result = form.results.find(
              (r) => r.subjectId === subject.id,
            ) || { subjectId: subject.id, status: "pending", score: "" };
            const update = (patch) =>
              setForm((f) => ({
                ...f,
                results: [
                  ...f.results.filter((r) => r.subjectId !== subject.id),
                  { ...result, ...patch },
                ],
              }));
            return (
              <div className="form-grid two" key={subject.id}>
                <Field label={subject.name + "状态"}>
                  <select
                    value={result.status}
                    onChange={(e) =>
                      update({ status: e.target.value, score: "" })
                    }
                  >
                    <option value="pending">未出分 / 未录入</option>
                    <option value="scored">已出分</option>
                    <option value="absent">缺考</option>
                  </select>
                </Field>
                <Field
                  label={subject.name + "成绩（满分 " + subject.maxScore + "）"}
                >
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max={subject.maxScore}
                    disabled={result.status !== "scored"}
                    value={result.score ?? ""}
                    onChange={(e) => update({ score: e.target.value })}
                  />
                </Field>
              </div>
            );
          })}
        </>
      )}
      <Field label="成绩备注">
        <textarea
          value={form.notes}
          onChange={(e) => change("notes", e.target.value)}
          placeholder="成绩来源、需要核实的事项等"
        />
      </Field>
      {error && <ErrorBox message={error} />}
      <footer>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button
          variant="primary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await mutate((d) => saveExamRecord(d, form));
              onClose();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存考试关联
        </Button>
      </footer>
    </Modal>
  );
}
