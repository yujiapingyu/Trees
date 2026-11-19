import React, { useState } from "react";
import {
  Plus,
  Save,
  Pencil,
  Trash2,
  Sparkles,
  NotebookPen,
} from "lucide-react";
import { useApp, useView } from "../shared/store";
import { id, today } from "../shared/domain";
import StudentList, { Avatar } from "../components/StudentList";
import {
  PageHeader,
  Button,
  Section,
  Empty,
  Modal,
  Field,
  Editor,
  Markdown,
  Confirm,
} from "../components/UI";
import { Assistant } from "../components/AIPanel";
export default function Notes() {
  const { data, mutate, run } = useApp();
  const [view, setView] = useView("studentNotes", { selected: "", query: "" });
  const [form, setForm] = useState(null),
    [remove, setRemove] = useState(null),
    [assistant, setAssistant] = useState(false);
  const student = data.students.find(
    (s) => s.id === view.selected && s.status !== "已停课",
  );
  const notes = data.notes
    .filter((n) => n.studentId === student?.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="page">
      <PageHeader
        title="学生记录"
        eyebrow="NOTES & INSIGHTS"
        description="记住细节，才能更好地理解每一位学生。"
      >
        <Button
          icon={Sparkles}
          disabled={!student}
          onClick={() => setAssistant(true)}
        >
          AI 教学助手
        </Button>
        <Button
          variant="primary"
          icon={Plus}
          disabled={!student}
          onClick={() =>
            setForm({
              id: id(),
              studentId: student.id,
              title: "",
              date: today(),
              markdown: "",
            })
          }
        >
          新建记录
        </Button>
      </PageHeader>
      <div className="two-panel">
        <StudentList
          selected={view.selected}
          onSelect={(s) => setView((v) => ({ ...v, selected: s }))}
          query={view.query}
          onQuery={(q) => setView((v) => ({ ...v, query: q }))}
          count={(s) =>
            data.notes.filter((n) => n.studentId === s.id).length + " 条记录"
          }
        />
        <div className="panel scroll-pane">
          {student ? (
            <>
              <div className="student-profile">
                <Avatar student={student} />
                <div>
                  <h2>{student.name}</h2>
                  <p>
                    {notes.length} 条长期记录 · {student.grade || "未设置年级"}
                  </p>
                </div>
              </div>
              {!notes.length ? (
                <Empty
                  icon={NotebookPen}
                  title="从一个值得记住的细节开始"
                  description="学习习惯、目标、沟通要点，都可以记录在这里。"
                />
              ) : (
                notes.map((n) => (
                  <details
                    className="note-card"
                    key={n.id}
                    open={(view.expanded || []).includes(n.id)}
                    onToggle={(e) => {
                      const opened = e.currentTarget.open;
                      if (opened !== (view.expanded || []).includes(n.id))
                        setView((v) => ({
                          ...v,
                          expanded: opened
                            ? [...(v.expanded || []), n.id]
                            : (v.expanded || []).filter((i) => i !== n.id),
                        }));
                    }}
                  >
                    <summary>
                      <span>
                        <strong>{n.title}</strong>
                        <small>{n.date}</small>
                      </span>
                    </summary>
                    <Markdown>{n.markdown}</Markdown>
                    <div className="button-row">
                      <Button icon={Pencil} onClick={() => setForm(n)}>
                        编辑
                      </Button>
                      <Button icon={Trash2} onClick={() => setRemove(n)}>
                        删除
                      </Button>
                    </div>
                  </details>
                ))
              )}
            </>
          ) : (
            <Empty
              icon={NotebookPen}
              title="选择一位学生，继续记录"
              description="笔记和 AI 上下文按学生独立保存。"
            />
          )}
        </div>
      </div>
      {form && (
        <Modal title="学生记录" onClose={() => setForm(null)} wide>
          <div className="form-grid two">
            <Field label="标题">
              <input
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </Field>
            <Field label="日期">
              <input
                type="date"
                value={form.date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date: e.target.value }))
                }
              />
            </Field>
          </div>
          <Field label="正文">
            <Editor
              value={form.markdown}
              onChange={(v) => setForm((f) => ({ ...f, markdown: v }))}
              rows={12}
            />
          </Field>
          <footer>
            <Button onClick={() => setForm(null)}>取消</Button>
            <Button
              icon={Save}
              variant="primary"
              onClick={() =>
                run(async () => {
                  if (!form.title.trim() || !form.markdown.trim() || !form.date)
                    throw Error("请填写标题、日期和正文");
                  await mutate((d) => ({
                    ...d,
                    notes: d.notes.some((n) => n.id === form.id)
                      ? d.notes.map((n) => (n.id === form.id ? form : n))
                      : [...d.notes, form],
                  }));
                  setForm(null);
                }, "记录已保存")
              }
            >
              保存记录
            </Button>
          </footer>
        </Modal>
      )}
      {remove && (
        <Confirm
          title="删除学生记录"
          description={"将删除“" + remove.title + "”。"}
          onClose={() => setRemove(null)}
          onConfirm={() =>
            mutate((d) => ({
              ...d,
              notes: d.notes.filter((n) => n.id !== remove.id),
            }))
          }
        />
      )}
      {assistant && student && (
        <Assistant
          key={student.id}
          student={student}
          onClose={() => setAssistant(false)}
        />
      )}
    </div>
  );
}
