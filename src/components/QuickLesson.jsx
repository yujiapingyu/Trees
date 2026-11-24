import React, { useState, useRef } from "react";
import { Save } from "lucide-react";
import { useApp } from "../shared/store";
import { useDraft } from "../shared/drafts";
import { id, today } from "../shared/domain";
import { saveQuickLesson } from "../shared/lessonCloseout";
import { Modal, Field, Button, ErrorBox } from "./UI";

export default function QuickLesson({ student, courses, course, onClose }) {
  const { mutate, notify } = useApp();
  const [form, setForm] = useDraft("quick-lesson:" + student.id, () => ({
    id: id(),
    studentId: student.id,
    date: today(),
    raw: "",
    courseId: course?.id || "",
    duration: "",
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Modal
      title={student.name + " · 课后记一段"}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError("");
          try {
            await mutate((d) =>
              saveQuickLesson(d, { ...form, studentId: student.id }),
            );
            setForm({
              id: id(),
              studentId: student.id,
              date: today(),
              raw: "",
              courseId: course?.id || "",
              duration: "",
            });
            notify("课堂原始记录已保存，反馈草稿和接课要点将自动整理");
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <p className="form-hint">
          默认记录今天已完成的课。写下实际讲授、学生表现和下次安排即可，不用分别填写多个页面。
        </p>
        <Field label="这一节课的原始记录">
          <textarea
            rows={8}
            maxLength={12000}
            value={form.raw}
            disabled={busy}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                raw: e.target.value,
                date: !f.raw.trim() && !f.dateExplicit ? today() : f.date,
              }))
            }
            placeholder="例如：今天讲了对数运算和换底公式。能复述定义，但计算时漏真数条件。布置讲义第3—5题，下次继续对数函数。"
            required
          />
        </Field>
        <details className="curriculum-outline">
          <summary>日期、讲义或时长需要调整时展开（选填）</summary>
          <div className="form-grid two">
            <Field label="本次课程日期">
              <input
                type="date"
                value={
                  form.raw.trim() || form.dateExplicit ? form.date : today()
                }
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    date: e.target.value,
                    dateExplicit: true,
                  }))
                }
                disabled={busy}
              />
            </Field>
            <Field label="本次实际课时（分钟）">
              <input
                type="number"
                min="1"
                max="1440"
                value={form.duration}
                onChange={(e) => set("duration", e.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
          <Field label="本次使用的讲义或试卷">
            <select
              value={form.courseId}
              onChange={(e) => set("courseId", e.target.value)}
              disabled={busy}
            >
              <option value="">只根据本次原始记录整理</option>
              {courses
                .filter((c) => !c.missing)
                .map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        </details>
        {error && <ErrorBox message={error} />}
        <footer>
          <Button type="button" disabled={busy} onClick={onClose}>
            稍后继续
          </Button>
          <Button
            type="submit"
            icon={Save}
            variant="primary"
            busy={busy}
            disabled={!form.raw.trim()}
          >
            保存并自动整理
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
