import React, { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  FileText,
  Check,
  Calendar,
  BookOpen,
  Sparkles,
  FolderOpen,
  Link2,
  Pencil,
  Save,
  ClipboardList,
} from "lucide-react";
import { useApp } from "../shared/store";
import {
  id,
  today,
  parseJSONResult,
  validateQuestions,
  safeStudentContext,
  timeFilter,
} from "../shared/domain";
import { services, join, generate } from "../shared/services";
import {
  Button,
  Section,
  Empty,
  Badge,
  Field,
  Editor,
  CopyButton,
  Confirm,
  Modal,
  Markdown,
  ErrorBox,
  Tabs,
  FileItem,
} from "./UI";
import { ResourcePicker } from "./FileBrowser";
import { AIAction } from "./AIPanel";
import { useFiles } from "../shared/hooks";
import { studentDirectoryState } from "../shared/paths";
import { schoolNameForStudent } from "../shared/schools";
import { readLessonDocuments } from "../shared/documents";
import {
  feedbackDate,
  feedbackPrompt,
  formatFeedback,
  localFeedback,
} from "../shared/feedback";
export function HomeworkPanel({ student }) {
  const { data, mutate, run } = useApp();
  const items = data.homework.filter((x) => x.studentId === student.id);
  const [picker, setPicker] = useState(null),
    [due, setDue] = useState(today()),
    [remove, setRemove] = useState(null);
  const stopped = student.status === "已停课";
  const pick = async (file) => {
    if (picker === "new") {
      if (!due) throw Error("请先填写作业日期");
      if (items.some((x) => x.path === file.path && x.dueDate === due))
        throw Error("同一日期已添加此作业");
      await mutate((d) => ({
        ...d,
        homework: [
          ...d.homework,
          {
            id: id(),
            studentId: student.id,
            ...file,
            dueDate: due,
            completed: false,
          },
        ],
      }));
    } else
      await mutate((d) => ({
        ...d,
        homework: d.homework.map((x) =>
          x.id === picker ? { ...x, answerPath: file.path } : x,
        ),
      }));
  };
  return (
    <Section
      title="作业管理"
      subtitle="把练习安排与完成情况放在一起"
      action={
        <Button icon={Plus} disabled={stopped} onClick={() => setPicker("new")}>
          添加作业
        </Button>
      }
    >
      <Field label="作业日期">
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </Field>
      {!items.length ? (
        <Empty
          icon={ClipboardList}
          title="暂无作业"
          description="从课本、练习或参考资料中安排一份作业。"
        />
      ) : (
        items.map((h) => (
          <div className="homework-row" key={h.id}>
            <button
              className={"checkbox " + (h.completed ? "checked" : "")}
              aria-label={h.completed ? "标记未完成" : "标记已完成"}
              disabled={stopped}
              onClick={() =>
                run(() =>
                  mutate((d) => ({
                    ...d,
                    homework: d.homework.map((x) =>
                      x.id === h.id ? { ...x, completed: !x.completed } : x,
                    ),
                  })),
                )
              }
            >
              {h.completed && <Check size={14} />}
            </button>
            <div className="grow">
              <button
                className="text-button"
                onClick={() => run(() => services.open(h.path))}
              >
                {h.name}
              </button>
              <p>
                {h.source} · {h.dueDate} · {h.completed ? "已完成" : "待完成"}
              </p>
              <small className="path-text">{h.relativePath || h.path}</small>
              <div className="button-row">
                {h.answerPath && (
                  <Button
                    onClick={() => run(() => services.open(h.answerPath))}
                  >
                    打开答案
                  </Button>
                )}
                <button
                  disabled={stopped}
                  className="text-button muted"
                  onClick={() => setPicker(h.id)}
                >
                  {h.answerPath ? "更换答案" : "关联参考答案"}
                </button>
                {h.answerPath && (
                  <button
                    className="text-button muted"
                    disabled={stopped}
                    onClick={() =>
                      run(() =>
                        mutate((d) => ({
                          ...d,
                          homework: d.homework.map((x) =>
                            x.id === h.id ? { ...x, answerPath: null } : x,
                          ),
                        })),
                      )
                    }
                  >
                    移除答案
                  </button>
                )}
              </div>
            </div>
            <Button
              icon={Trash2}
              disabled={stopped}
              onClick={() => setRemove(h)}
            >
              移除
            </Button>
          </div>
        ))
      )}
      {picker && (
        <ResourcePicker
          title={picker === "new" ? "选择作业" : "选择参考答案"}
          onClose={() => setPicker(null)}
          onSelect={(f) => run(() => pick(f))}
        />
      )}
      {remove && (
        <Confirm
          title="移除作业"
          description={"只移除“" + remove.name + "”的作业记录，来源文件保留。"}
          onClose={() => setRemove(null)}
          onConfirm={() =>
            mutate((d) => ({
              ...d,
              homework: d.homework.filter((x) => x.id !== remove.id),
            }))
          }
        />
      )}
    </Section>
  );
}
export function FeedbackPanel({ student, courses, course }) {
  const { data, config, mutate, run } = useApp();
  const [lessonId, setLesson] = useState(course?.id || ""),
    [classDate, setClassDate] = useState(today()),
    [input, setInput] = useState(""),
    [draft, setDraft] = useState(""),
    [model, setModel] = useState(""),
    [editing, setEditing] = useState(null),
    [remove, setRemove] = useState(null),
    [generating, setGenerating] = useState(false),
    [sourceFiles, setSourceFiles] = useState([]);
  const stopped = student.status === "已停课";
  const history = data.feedback
    .filter((f) => f.studentId === student.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const generateDraft = () =>
    run(async () => {
      setGenerating(true);
      try {
        if (!config.deepseekKey)
          throw Error("请先在配置中心设置 DeepSeek API Key");
        feedbackDate(classDate);
        if (!input.trim()) throw Error("请先输入本节课记录");
        const lesson = courses.find((c) => c.id === lessonId);
        if (!lesson) throw Error("请选择关联讲义，AI 将从讲义正文提取授课内容");
        const documents = await readLessonDocuments(lesson);
        const template = config.feedbackTemplate
          ? await services.readText(config.feedbackTemplate)
          : "";
        const result = await generate(
          feedbackPrompt({
            student,
            date: classDate,
            notes: input,
            lesson,
            documents,
            template,
            school: schoolNameForStudent(student, data),
          }),
          { json: true },
        );
        const text = formatFeedback(parseJSONResult(result.text), {
          student,
          date: classDate,
        });
        setDraft(text);
        setModel(result.model);
        setSourceFiles(documents.map(({ path, name }) => ({ path, name })));
      } finally {
        setGenerating(false);
      }
    });
  return (
    <Section
      title="课堂反馈"
      subtitle="日期默认今天；AI 从讲义提取授课内容，结合教师记录扩写家长反馈"
    >
      <div className="form-grid two">
        <Field label="上课日期">
          <input
            type="date"
            disabled={stopped || generating}
            value={classDate}
            onChange={(e) => setClassDate(e.target.value)}
          />
        </Field>
        <Field label="关联讲义">
          <select
            value={lessonId}
            disabled={stopped || generating}
            onChange={(e) => setLesson(e.target.value)}
          >
            <option value="">请选择讲义</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id} disabled={c.missing}>
                {c.name}
                {c.missing ? "（路径失效）" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="本节课记录">
        <textarea
          rows={5}
          value={input}
          disabled={stopped || generating}
          onChange={(e) => setInput(e.target.value)}
          placeholder="填写你观察到的表现、优点、薄弱点和建议。AI 将结合讲义正文，扩写为优点和不足各 2–3 条。"
        />
      </Field>
      <div className="button-row">
        <Button
          icon={Sparkles}
          busy={generating}
          disabled={stopped}
          onClick={generateDraft}
        >
          AI 整理家长反馈
        </Button>
        <Button
          disabled={stopped || generating || !input.trim()}
          onClick={() =>
            run(async () => {
              setDraft(
                localFeedback({ student, date: classDate, notes: input }),
              );
              setModel("本地模板 / 非 AI 生成");
              setSourceFiles([]);
            })
          }
        >
          使用本地模板
        </Button>
      </div>
      {draft && (
        <>
          <Badge type={model.includes("非 AI") ? "warning" : "blue"}>
            {model || "手动编辑草稿"}
          </Badge>
          {sourceFiles.length > 0 && (
            <p className="form-hint">
              授课内容来源：{sourceFiles.map((f) => f.name).join("、")}
            </p>
          )}
          <Editor value={draft} onChange={setDraft} rows={16} />
          <div className="button-row">
            <CopyButton text={draft} />
            <Button
              icon={Save}
              variant="primary"
              disabled={stopped || generating}
              onClick={() =>
                run(async () => {
                  feedbackDate(classDate);
                  if (!draft.trim()) throw Error("反馈内容不能为空");
                  const values = {
                    content: draft,
                    lessonId,
                    date: classDate,
                    teacherNotes: input,
                    sourceFiles,
                    model,
                  };
                  await mutate((d) => ({
                    ...d,
                    feedback: editing
                      ? d.feedback.map((f) =>
                          f.id === editing ? { ...f, ...values } : f,
                        )
                      : [
                          ...d.feedback,
                          { id: id(), studentId: student.id, ...values },
                        ],
                  }));
                  setDraft("");
                  setEditing(null);
                  setSourceFiles([]);
                }, "反馈已保存")
              }
            >
              保存反馈
            </Button>
          </div>
        </>
      )}
      <h4 className="subheading">
        历史反馈 <span>{history.length}</span>
      </h4>
      {!history.length ? (
        <Empty icon={FileText} title="还没有保存的课堂反馈" />
      ) : (
        history.map((f) => (
          <details className="record-card" key={f.id}>
            <summary>
              <span>
                {f.date} ·{" "}
                {courses.find((c) => c.id === f.lessonId)?.name || "课堂反馈"}
              </span>
              <Badge>已保存</Badge>
            </summary>
            <Markdown>{f.content}</Markdown>
            <div className="button-row">
              <CopyButton text={f.content} />
              <Button
                disabled={stopped || generating}
                onClick={() => {
                  setEditing(f.id);
                  setDraft(f.content);
                  setLesson(f.lessonId || "");
                  setClassDate(f.date || today());
                  setInput(f.teacherNotes || "");
                  setSourceFiles(f.sourceFiles || []);
                  setModel(f.model || "已保存反馈");
                }}
              >
                编辑
              </Button>
              <Button
                disabled={stopped || generating}
                onClick={() => setRemove(f)}
              >
                删除
              </Button>
            </div>
          </details>
        ))
      )}
      {remove && (
        <Confirm
          title="删除课堂反馈"
          description="此操作会删除该条反馈记录。"
          onClose={() => setRemove(null)}
          onConfirm={() =>
            mutate((d) => ({
              ...d,
              feedback: d.feedback.filter((f) => f.id !== remove.id),
            }))
          }
        />
      )}
    </Section>
  );
}
export function WrongPanel({ student, course, range = "all", recentN = 5 }) {
  const { data, mutate, run } = useApp();
  const [form, setForm] = useState(null),
    [remove, setRemove] = useState(null),
    [analysis, setAnalysis] = useState(""),
    [importing, setImporting] = useState(false);
  const all = data.wrongQuestions.filter(
    (q) => q.studentId === student.id && (!course || q.lessonId === course.id),
  );
  const items = timeFilter(all, range, today(), recentN);
  const stopped = student.status === "已停课";
  const fresh = () => ({
    id: id(),
    studentId: student.id,
    lessonId: course?.id || "",
    stem: "",
    options: "",
    answer: "",
    explanation: "",
    createdAt: today(),
    difficulty: "中等",
    tags: [],
  });
  const save = async () => {
    if (!form.stem.trim()) throw Error("请输入题干");
    await mutate((d) => ({
      ...d,
      wrongQuestions: d.wrongQuestions.some((x) => x.id === form.id)
        ? d.wrongQuestions.map((x) => (x.id === form.id ? form : x))
        : [...d.wrongQuestions, form],
    }));
    setForm(null);
  };
  return (
    <Section
      title="错题记录"
      subtitle={`${items.length} 道错题 · 与错题报告同步`}
      action={
        <div className="button-row">
          <Button
            icon={Plus}
            disabled={stopped}
            onClick={() => setForm(fresh())}
          >
            手工录入
          </Button>
          {course && (
            <Button
              busy={importing}
              disabled={stopped}
              onClick={() =>
                run(async () => {
                  setImporting(true);
                  try {
                    const files = await services.list(course.path, true);
                    const doc = files.find((f) =>
                      /\.(docx|doc|txt|md)$/i.test(f.name),
                    );
                    if (!doc) throw Error("当前讲义中未找到可提取的文档");
                    const text = await services.readText(doc.path);
                    const result = await generate(
                      "从以下讲义提取题目。只输出 JSON 数组，每项包含 stem, options, answer, explanation, difficulty（基础/中等/较难）,tags。未知答案留空，不编造。\n" +
                        text,
                      { json: true },
                    );
                    const questions = validateQuestions(
                      parseJSONResult(result.text),
                    );
                    await mutate((d) => ({
                      ...d,
                      wrongQuestions: [
                        ...d.wrongQuestions,
                        ...questions.map((q) => ({
                          ...q,
                          id: id(),
                          studentId: student.id,
                          lessonId: course.id,
                          createdAt: today(),
                        })),
                      ],
                    }));
                  } finally {
                    setImporting(false);
                  }
                })
              }
            >
              从讲义提取
            </Button>
          )}
        </div>
      }
    >
      {!items.length ? (
        <Empty
          icon={BookOpen}
          title="暂无错题"
          description="记录真实错题，积累可回溯的学习线索。"
        />
      ) : (
        items.map((q, i) => (
          <div className="question-card" key={q.id}>
            <div className="question-head">
              <span className="question-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Badge type="warning">{q.difficulty || "中等"}</Badge>
              <small>{q.createdAt?.slice(0, 10)}</small>
              <span className="spacer" />
              <Button
                disabled={stopped}
                icon={Pencil}
                onClick={() =>
                  setForm({
                    ...q,
                    options: Array.isArray(q.options)
                      ? q.options.join("\n")
                      : q.options || "",
                  })
                }
              >
                编辑
              </Button>
              <Button
                disabled={stopped}
                icon={Trash2}
                onClick={() => setRemove(q)}
              >
                删除
              </Button>
            </div>
            <Markdown>{q.stem}</Markdown>
            {q.options && (
              <Markdown>
                {Array.isArray(q.options) ? q.options.join("\n\n") : q.options}
              </Markdown>
            )}
            <details>
              <summary>答案与解析</summary>
              <Markdown>
                {"**答案：** " +
                  (q.answer || "待确认") +
                  "\n\n" +
                  (q.explanation || "暂无解析")}
              </Markdown>
            </details>
          </div>
        ))
      )}
      <div className="button-row">
        <AIAction
          label="分析当前错题"
          disabled={!items.length}
          task={() =>
            "只根据以下错题归纳错因与下一步教学建议，不推测未提供的学生表现。\n" +
            JSON.stringify(items)
          }
          onResult={setAnalysis}
        />
        {analysis && <CopyButton text={analysis} />}
      </div>
      {analysis && <Markdown>{analysis}</Markdown>}
      {form && (
        <Modal title="编辑错题" onClose={() => setForm(null)} wide>
          <Field label="题干（支持 LaTeX）">
            <Editor
              value={form.stem}
              onChange={(v) => setForm((f) => ({ ...f, stem: v }))}
            />
          </Field>
          <Field label="选项（每行一个）">
            <textarea
              value={form.options}
              onChange={(e) =>
                setForm((f) => ({ ...f, options: e.target.value }))
              }
            />
          </Field>
          <div className="form-grid two">
            <Field label="答案">
              <textarea
                value={form.answer}
                onChange={(e) =>
                  setForm((f) => ({ ...f, answer: e.target.value }))
                }
              />
            </Field>
            <Field label="难度">
              <select
                value={form.difficulty}
                onChange={(e) =>
                  setForm((f) => ({ ...f, difficulty: e.target.value }))
                }
              >
                {["基础", "中等", "较难"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="解析">
            <Editor
              value={form.explanation}
              onChange={(v) => setForm((f) => ({ ...f, explanation: v }))}
            />
          </Field>
          <footer>
            <Button onClick={() => setForm(null)}>取消</Button>
            <Button variant="primary" onClick={() => run(save)}>
              保存错题
            </Button>
          </footer>
        </Modal>
      )}
      {remove && (
        <Confirm
          title="删除错题"
          description="将从当前学生的错题记录与错题报告中移除。"
          onClose={() => setRemove(null)}
          onConfirm={() =>
            mutate((d) => ({
              ...d,
              wrongQuestions: d.wrongQuestions.filter(
                (q) => q.id !== remove.id,
              ),
            }))
          }
        />
      )}
    </Section>
  );
}
export function ReportPanel({ student }) {
  const { data, config, mutate, run } = useApp();
  const directoryAvailable =
    studentDirectoryState(student, config.studentsRoot) === "available";
  const [form, setForm] = useState({
      type: "入学报告",
      subject: "数学",
      school: schoolNameForStudent(student, data),
      score: "",
      target: "",
      targetSchool: "",
      requirements: "",
    }),
    [draft, setDraft] = useState(""),
    [model, setModel] = useState("");
  const history = data.reports.filter((r) => r.studentId === student.id);
  const { files: reportFiles, error: reportError } = useFiles(
    directoryAvailable ? join(student.directoryPath, "学习力报告") : undefined,
    true,
  );
  const externalReports = reportFiles.filter(
    (f) =>
      !f.isDirectory &&
      !history.some((r) => r.path === f.path) &&
      !f.name.endsWith(".bak"),
  );
  return (
    <Section title="学习力报告" subtitle="以真实记录为依据，保留每一次成长回顾">
      <div className="form-grid two">
        {[
          ["type", "报告类型"],
          ["subject", "学科"],
          ["school", "学校"],
          ["score", "当前成绩"],
          ["target", "目标分数 / 排名"],
          ["targetSchool", "目标学校"],
        ].map(([k, l]) => (
          <Field key={k} label={l}>
            {k === "type" ? (
              <select
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, type: e.target.value }))
                }
              >
                <option>入学报告</option>
                <option>阶段报告</option>
              </select>
            ) : (
              <input
                value={form[k]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [k]: e.target.value }))
                }
              />
            )}
          </Field>
        ))}
      </div>
      <Field label="补充要求">
        <textarea
          value={form.requirements}
          onChange={(e) =>
            setForm((f) => ({ ...f, requirements: e.target.value }))
          }
        />
      </Field>
      <AIAction
        disabled={student.status === "已停课"}
        label="生成报告草稿"
        task={() =>
          `生成${form.type}，未知信息标注待确认。输入：${JSON.stringify(form)}\n学生事实：${JSON.stringify(safeStudentContext(student, data))}`
        }
        onResult={(v, m) => {
          setDraft(v);
          setModel(m);
        }}
      />
      {draft && (
        <>
          <Editor value={draft} onChange={setDraft} />
          <div className="button-row">
            <CopyButton text={draft} />
            <Button
              variant="primary"
              disabled={!directoryAvailable}
              onClick={() =>
                run(async () => {
                  const path = join(
                    student.directoryPath,
                    "学习力报告",
                    `${today()}_${form.type}_${id().slice(0, 6)}.docx`,
                  );
                  await services.word(path, draft);
                  await mutate((d) => ({
                    ...d,
                    reports: [
                      ...d.reports,
                      {
                        id: id(),
                        studentId: student.id,
                        type: form.type,
                        generatedAt: new Date().toISOString(),
                        content: draft,
                        path,
                        model,
                        sourceSnapshot: safeStudentContext(student, data),
                      },
                    ],
                  }));
                  setDraft("");
                }, "报告已保存到学生学习力报告目录")
              }
            >
              保存 Word 报告
            </Button>
          </div>
        </>
      )}
      <h4 className="subheading">报告历史</h4>
      {reportError && !reportError.includes("ENOENT") && (
        <ErrorBox message={reportError} />
      )}
      {externalReports.map((f) => (
        <FileItem
          key={f.path}
          file={f}
          onOpen={() => run(() => services.open(f.path))}
        />
      ))}
      {!history.length && !externalReports.length ? (
        <Empty icon={FileText} title="还没有学习报告" />
      ) : (
        history.map((r) => (
          <FileItem
            key={r.id}
            file={{
              name: r.type + " · " + r.generatedAt.slice(0, 10),
              path: r.path,
            }}
            onOpen={() => run(() => services.open(r.path))}
          />
        ))
      )}
    </Section>
  );
}
export function AnalysisPanel({ student }) {
  const { data, mutate, run } = useApp();
  const [type, setType] = useState("学情分析"),
    [hours, setHours] = useState(20);
  const cache = data.analysis[student.id + ":" + type];
  return (
    <Section
      title="AI 教学分析"
      subtitle="汇总档案、作业、反馈、回访、错题与报告"
    >
      <Tabs
        value={type}
        onChange={setType}
        items={["学情分析", "续费清单", "课程规划"]}
      />
      {type !== "学情分析" && (
        <Field label="规划总课时（每次课 2 课时，2–200 的偶数）">
          <input
            type="number"
            min="2"
            max="200"
            step="2"
            value={hours}
            onChange={(e) => setHours(+e.target.value)}
          />
        </Field>
      )}
      <div className="analysis-sources">
        {[
          ["refs", "讲义"],
          ["homework", "作业"],
          ["feedback", "反馈"],
          ["followups", "回访"],
          ["wrongQuestions", "错题"],
          ["reports", "报告"],
        ].map(([k, l]) => (
          <span key={k}>
            {l}
            <b>{data[k].filter((x) => x.studentId === student.id).length}</b>
          </span>
        ))}
      </div>
      <AIAction
        label={cache ? "重新生成" : "生成" + type}
        task={() => {
          if (
            type !== "学情分析" &&
            (!Number.isInteger(hours) || hours < 2 || hours > 200 || hours % 2)
          )
            throw Error("课时必须为 2–200 的偶数");
          return `${type === "学情分析" ? "输出学生总评、关键问题、趋势变化、下一步建议。" : `生成数学${type}，仅输出 JSON 数组，每项 lessonNumber（从1开始）,topic,goal,focus,homework,hours（必须为2）。必须恰好 ${hours / 2} 项，总课时 ${hours}，禁止编造价格。`}只基于提供数据，缺失标注待确认。\n${JSON.stringify(safeStudentContext(student, data))}`;
        }}
        extra={{ json: type !== "学情分析" }}
        onResult={(raw, model) => {
          let content = raw;
          if (type !== "学情分析") {
            const plan = parseJSONResult(raw);
            if (
              !Array.isArray(plan) ||
              plan.length !== hours / 2 ||
              new Set(plan.map((p) => p.lessonNumber)).size !== hours / 2 ||
              plan.some(
                (p, i) =>
                  p.hours !== 2 ||
                  p.lessonNumber !== i + 1 ||
                  !p.topic ||
                  !p.goal,
              )
            )
              throw Error(
                "课程规划的课次、课时或必需字段不符合约束，未保存，请重试",
              );
            content =
              type === "续费清单"
                ? [
                    "课次\t课程主题\t课时\t教学目标",
                    ...plan.map((p) =>
                      [p.lessonNumber, p.topic, 2, p.goal]
                        .map((v) => String(v).replace(/[\t\n]/g, " "))
                        .join("\t"),
                    ),
                    `合计\t${plan.length}次课\t${hours}课时`,
                  ].join("\n")
                : `# ${student.name} · 数学课程规划\n\n共 ${plan.length} 次课，每次 2 课时，总计 ${hours} 课时。\n\n` +
                  plan
                    .map(
                      (p) =>
                        `## 第${p.lessonNumber}次课：${p.topic}\n\n教学目标：${p.goal}\n\n重点：${p.focus || "待确认"}\n\n作业：${p.homework || "待确认"}`,
                    )
                    .join("\n\n");
          }
          return mutate((d) => ({
            ...d,
            analysis: {
              ...d.analysis,
              [student.id + ":" + type]: {
                content,
                model,
                updatedAt: new Date().toISOString(),
              },
            },
          }));
        }}
      />
      {cache ? (
        <>
          <div className="analysis-meta">
            {cache.model} · 更新于{" "}
            {new Date(cache.updatedAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
            <CopyButton text={cache.content} />
          </div>
          <Markdown>{cache.content}</Markdown>
        </>
      ) : (
        <Empty
          icon={Sparkles}
          title="从现有记录中，找到下一步"
          description="AI 分析仅使用当前学生的数据，输出供教师审阅。"
        />
      )}
    </Section>
  );
}
