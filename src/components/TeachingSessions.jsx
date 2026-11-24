import React, { useState } from "react";
import { useApp } from "../shared/store";
import { useDraft } from "../shared/drafts";
import { freshSession, saveSession, teachingCount } from "../shared/teaching";
import { Section, Button, Field, ErrorBox, Confirm, Empty } from "./UI";
export default function TeachingSessions({ student, courses }) {
  const { data, mutate, run } = useApp(),
    [form, setForm] = useDraft("session-editor:" + student.id, null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState(null);
  const records = (data.sessions || [])
    .filter((s) => s.studentId === student.id)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
  const stopped = student.status === "已停课",
    change = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Section
      title="授课记录"
      subtitle={`已完成授课 ${teachingCount(student, data) ?? 0} 次（含已校准历史次数）；每次课独立登记，缺课与取消不计次。`}
      action={
        <Button
          disabled={stopped || !!form}
          onClick={() => setForm(freshSession(student.id))}
        >
          登记本次课
        </Button>
      }
    >
      {form && (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await mutate((d) => saveSession(d, form));
              setForm(null);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="form-hint">
            草稿自动保存在本机。完成记录可直接用于课堂反馈与学习力报告。
          </p>
          <div className="form-grid two">
            <Field label="授课日期">
              <input
                type="date"
                value={form.date}
                onChange={(e) => change("date", e.target.value)}
                required
              />
            </Field>
            <Field label="授课状态">
              <select
                value={form.status}
                onChange={(e) => change("status", e.target.value)}
              >
                <option value="completed">已完成</option>
                <option value="absent">缺课</option>
                <option value="cancelled">已取消</option>
              </select>
            </Field>
          </div>
          <Field label="授课主题">
            <input
              value={form.topic}
              onChange={(e) => change("topic", e.target.value)}
              required
            />
          </Field>
          <div className="form-grid two">
            <Field label="关联讲义 / 考试">
              <select
                value={form.courseId || ""}
                onChange={(e) => change("courseId", e.target.value)}
              >
                <option value="">不关联</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="实际授课时长（分钟，可留空）">
              <input
                type="number"
                min="1"
                max="1440"
                value={form.duration}
                onChange={(e) => change("duration", e.target.value)}
              />
            </Field>
          </div>
          <Field label="实际讲授范围">
            <textarea
              value={form.scope}
              onChange={(e) => change("scope", e.target.value)}
              placeholder="页码、题号、章节，以及未讲的内容"
            />
          </Field>
          <Field label="课堂表现与观察">
            <textarea
              value={form.notes}
              onChange={(e) => change("notes", e.target.value)}
            />
          </Field>
          <Field label="下次继续进度">
            <input
              value={form.nextProgress}
              onChange={(e) => change("nextProgress", e.target.value)}
            />
          </Field>
          {error && <ErrorBox message={error} />}
          <div className="button-row">
            <Button type="submit" variant="primary" busy={busy}>
              保存授课记录
            </Button>
            <Button disabled={busy} onClick={() => setForm(null)}>
              放弃草稿
            </Button>
          </div>
        </form>
      )}
      {!records.length && !form && (
        <Empty
          title="暂无授课记录"
          description="从本次课开始登记；历史次数可在学习报告中校准。"
        />
      )}
      {records.map((s) => (
        <article
          className="record-card"
          key={s.id}
          data-search-key={"授课:" + s.id}
        >
          <strong>
            {s.date} · {s.topic}
          </strong>
          <p>
            {
              { completed: "已完成", absent: "缺课", cancelled: "已取消" }[
                s.status
              ]
            }
            {s.duration ? ` · ${s.duration}分钟` : ""}
          </p>
          <p>{s.scope}</p>
          <p>{s.notes}</p>
          {s.nextProgress && <p>下次：{s.nextProgress}</p>}
          <div className="button-row">
            <Button disabled={stopped || !!form} onClick={() => setForm(s)}>
              编辑授课记录
            </Button>
            <Button disabled={stopped} onClick={() => setRemove(s)}>
              删除授课记录
            </Button>
          </div>
        </article>
      ))}
      {remove && (
        <Confirm
          title="删除授课记录"
          description="将减少该次完成授课的计数，已有反馈仍保留。"
          onClose={() => setRemove(null)}
          onConfirm={() =>
            mutate((d) => ({
              ...d,
              sessions: d.sessions.filter((s) => s.id !== remove.id),
            }))
          }
        />
      )}
    </Section>
  );
}
