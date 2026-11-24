import AutomaticFeedbackDrafts from "./AutomaticFeedbackDrafts";
import { saveFeedbackWithStyle } from "../shared/lessonCloseout";
import { feedbackStylePrompt } from "../shared/feedbackStyle";
import { curriculumContext } from "../shared/zhejiangCurriculum";
import { enrichPlanningSnapshot } from "../shared/planningContext";
import { freshReport, reportSnapshot } from "../shared/reports";
import {
  learningPlanPrompt,
  validateCoursePlan,
  PLAN_FORMAT,
} from "../shared/learningPlan";
import { useDraft } from "../shared/drafts";
import {
  latestProgress,
  analysisSources,
  changedSources,
  SOURCE_LABELS,
} from "../shared/teaching";
import React, { useEffect, useState, useRef } from "react";
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
  generateFeedbackDraft,
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
          <div
            className="homework-row"
            key={h.id}
            data-search-key={"作业:" + h.id}
          >
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
          student={student}
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
  const draftKey = "feedback:" + student.id + ":" + (course?.id || "general");
  const [lessonId, setLesson] = useDraft(
    draftKey + ":lesson",
    course?.id || "",
  );
  const [classDate, setClassDate] = useDraft(draftKey + ":date", today);
  const [input, setInput] = useDraft(draftKey + ":notes", "");
  const [draft, setDraft] = useDraft(draftKey + ":text", "");
  const [model, setModel] = useDraft(draftKey + ":model", "");
  const [generatedOriginal, setGeneratedOriginal] = useDraft(
    draftKey + ":generated-original",
    "",
  );
  const [editing, setEditing] = useDraft(draftKey + ":editing", null);
  const [scope, setScope] = useDraft(draftKey + ":scope", "");
  const [sessionId, setSessionId] = useDraft(draftKey + ":session", "");
  const [sourceFiles, setSourceFiles] = useDraft(draftKey + ":sources", []);
  const [remove, setRemove] = useState(null),
    [generating, setGenerating] = useState(false);
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
        if (!lesson)
          throw Error("请选择关联讲义或试卷，AI 将从正文提取授课内容");
        const documents = await readLessonDocuments(lesson);
        const template = config.feedbackTemplate
          ? await services.readText(config.feedbackTemplate)
          : "";
        const result = await generateFeedbackDraft({
          prompt: feedbackPrompt({
            student,
            date: classDate,
            notes: input,
            scope,
            lesson,
            documents,
            template,
            school: schoolNameForStudent(student, data),
            style: feedbackStylePrompt(data.feedbackStyle),
          }),
          student,
          date: classDate,
          subject: lesson.subjectName,
          style: data.feedbackStyle,
          request: (task) => generate(task, { json: true }),
        });
        setDraft(result.feedback);
        setGeneratedOriginal(result.feedback);
        setModel(result.model);
        setSourceFiles(documents.map(({ path, name }) => ({ path, name })));
      } finally {
        setGenerating(false);
      }
    });
  return (
    <Section
      title="课堂反馈"
      subtitle="未提交内容自动保存；AI 仅围绕实际授课范围扩写反馈"
    >
      <AutomaticFeedbackDrafts
        student={student}
        disabled={generating}
        onAdopt={(s) => {
          if (
            draft.trim() &&
            !window.confirm("编辑框已有未保存的草稿，是否换成这份自动反馈？")
          )
            return;
          setDraft(s.closeout.feedbackDraft.content);
          setGeneratedOriginal(
            s.closeout.feedbackDraft.generatedOriginal || "",
          );
          setModel(s.closeout.feedbackDraft.model);
          setInput(s.closeout.raw);
          setScope(s.scope || s.topic);
          setSessionId(s.id);
          setClassDate(s.date);
          setLesson(s.courseId || "");
          setSourceFiles(s.closeout.feedbackDraft.sourceFiles || []);
          setEditing(s.closeout.supersedesFeedbackId || null);
        }}
      />
      {!!data.feedbackStyle?.learnedCount && (
        <p className="form-hint">
          已从你保存的 {data.feedbackStyle.learnedCount}{" "}
          次反馈修改中学习表达习惯，后续生成会自动参考。
        </p>
      )}
      <Field label="关联本次授课记录（可选）">
        <select
          aria-label="关联本次授课记录"
          value={sessionId}
          disabled={stopped || generating}
          onChange={(e) => {
            setSessionId(e.target.value);
            const s = (data.sessions || []).find(
              (s) => s.id === e.target.value,
            );
            if (s) {
              setClassDate(s.date);
              setScope(s.scope || s.topic);
              setInput(s.notes || "");
              setLesson(s.courseId || "");
            }
          }}
        >
          <option value="">不关联，手动填写</option>
          {(data.sessions || [])
            .filter(
              (s) => s.studentId === student.id && s.status === "completed",
            )
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.date} · {s.topic}
              </option>
            ))}
        </select>
      </Field>
      <Field label="本次实际讲授范围">
        <textarea
          aria-label="本次实际讲授范围"
          value={scope}
          disabled={stopped || generating}
          onChange={(e) => setScope(e.target.value)}
          placeholder="例如：第2–4页，第3–8题；只讲对数定义，未讲换底公式。留空时只按教师记录判断，不默认整份讲完。"
        />
      </Field>
      <Button
        disabled={generating || stopped}
        onClick={() => {
          setInput("");
          setDraft("");
          setGeneratedOriginal("");
          setModel("");
          setEditing(null);
          setScope("");
          setSessionId("");
          setSourceFiles([]);
          setClassDate(today());
        }}
      >
        清空未提交反馈草稿
      </Button>
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
          placeholder="简单记下孩子本节课学得怎样，例如：能复述定义，但计算时容易漏条件。AI 会据此展开学生表现，讲义只用于提取授课内容和提出巩固建议，不用填写完整反馈。"
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
                localFeedback({
                  student,
                  date: classDate,
                  notes: input,
                  subject: courses.find((c) => c.id === lessonId)?.subjectName,
                }),
              );
              setGeneratedOriginal("");
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
          <Editor
            aria-label="家长反馈正文"
            value={draft}
            onChange={setDraft}
            rows={16}
          />
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
                    scope,
                    sessionId,
                    sourceFiles,
                    model,
                  };
                  await mutate((d) =>
                    saveFeedbackWithStyle(d, {
                      ...values,
                      studentId: student.id,
                      feedbackId: editing,
                      generatedOriginal,
                    }),
                  );
                  setDraft("");
                  setGeneratedOriginal("");
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
          <details
            className="record-card"
            key={f.id}
            data-search-key={"反馈:" + f.id}
          >
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
                  setGeneratedOriginal(f.generatedOriginal || "");
                  setLesson(f.lessonId || "");
                  setClassDate(f.date || today());
                  setInput(f.teacherNotes || "");
                  setScope(f.scope || "");
                  setSessionId(f.sessionId || "");
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
                    const documents = await readLessonDocuments(course);
                    const text = documents
                      .map((d) => `${d.name}\n${d.text}`)
                      .join("\n\n");
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
          <div
            className="question-card"
            key={q.id}
            data-search-key={"错题:" + q.id}
          >
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
export { default as ReportPanel } from "./LearningReports";
export function AnalysisPanel({ student, courses = [] }) {
  const { data, config, mutate, run } = useApp();
  const [type, setType] = useState("学情分析");
  const generation = useRef(null);
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
      <p className="form-hint">
        课程规划和续费清单统一为后续15次授课，采用与学习力报告相同的教材及进度规则；每次课的实际分钟数另行登记。
      </p>
      {cache &&
        changedSources(cache.sourceSnapshot, student, data).length > 0 && (
          <div role="status" className="info-banner">
            分析需要更新：
            {changedSources(cache.sourceSnapshot, student, data)
              .map((k) => SOURCE_LABELS[k] || k)
              .join("、")}
            已变化。旧结果保留，可重新生成。
          </div>
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
        task={async () => {
          generation.current = analysisSources(student, data);
          if (type === "学情分析")
            return `输出学生总评、关键问题、趋势变化、下一步建议。以最近实际日期的授课记录和教师原始观察为主，只基于事实，不编造表现；缺失标注待确认。\n${JSON.stringify({ ...safeStudentContext(student, data), regionalCurriculum: curriculumContext(student, data) })}`;
          const report = freshReport(student, data, "stage");
          const latest = latestProgress(student.id, data);
          report.currentProgressOverride = latest
            ? `${latest.date}实际授课：${latest.topic}；实际范围：${latest.scope || ""}；下次继续：${latest.nextProgress || "按当前进度继续"}`
            : "";
          const snapshot = await enrichPlanningSnapshot(
            reportSnapshot(report, data),
            report,
            data,
            courses,
            config,
          );
          return learningPlanPrompt(report, snapshot);
        }}
        extra={{ json: type !== "学情分析" }}
        onResult={(raw, model) => {
          let content = raw,
            planData = null;
          if (type !== "学情分析") {
            planData = validateCoursePlan(parseJSONResult(raw), {
              meta: { grade: student.grade },
            });
            content =
              `# ${student.name} · ${type}\n\n${planData.curriculum.edition} · ${planData.curriculum.currentTopic}\n\n${planData.planningNotes}\n\n` +
              planData.plan
                .map(
                  (p, i) =>
                    `## 第${i + 1}次课：${p.topic}\n目标：${p.objectives}\n重难点：${p.keyPoints}`,
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
                planData,
                sourceSnapshot: generation.current,
                updatedAt: new Date().toISOString(),
                history: cache
                  ? [
                      {
                        content: cache.content,
                        updatedAt: cache.updatedAt,
                        model: cache.model,
                      },
                      ...(cache.history || []),
                    ].slice(0, 5)
                  : [],
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
          {!!cache.history?.length && (
            <details>
              <summary>上次分析版本（{cache.history.length}）</summary>
              {cache.history.map((v, i) => (
                <article className="record-card" key={i}>
                  <small>{new Date(v.updatedAt).toLocaleString("zh-CN")}</small>
                  <Markdown>{v.content}</Markdown>
                </article>
              ))}
            </details>
          )}
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
