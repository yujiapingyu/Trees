import { enrichPlanningSnapshot } from "../shared/planningContext";
import { useDraft } from "../shared/drafts";
import { teachingCount } from "../shared/teaching";
import React, { useState, useRef, useEffect } from "react";
import { Plus, Save, Sparkles, FileText, Copy } from "lucide-react";
import { useApp } from "../shared/store";
import { services, join } from "../shared/services";
import { id, today, parseJSONResult } from "../shared/domain";
import { studentDirectoryState } from "../shared/paths";
import { useFiles } from "../shared/hooks";
import { extractDocumentText } from "../shared/documents";
import {
  PLAN_FORMAT,
  PLAN_LESSONS,
  mathTextbook,
  learningPlanPrompt,
  validateCoursePlan,
} from "../shared/learningPlan";
import {
  REPORT_TYPES,
  RATINGS,
  MOTIVATION_ANSWERS,
  reportKind,
  reportDate,
  completedReports,
  reportTask,
  saveReportSettings,
  freshReport,
  reportEvidence,
  reportSnapshot,
  reportIssues,
  saveLearningReport,
  learningReportPrompt,
  validateReportAI,
  reportManualFields,
  reportPlainText,
  validDate,
  historicalNameMismatch,
} from "../shared/reports";
import {
  Section,
  Button,
  Field,
  Badge,
  ErrorBox,
  Empty,
  Modal,
  Confirm,
  Tabs,
  Markdown,
  CopyButton,
  FileItem,
} from "./UI";

const META = {
  studentName: "学生姓名",
  grade: "年级",
  school: "学校",
  subject: "学科",
  teacher: "学科教师",
  advisor: "班主任",
  term: "学期",
  reportDate: "报告日期",
  periodStart: "统计开始日期",
  periodEnd: "统计结束日期",
};
const GOALS = {
  lastScore: "最近考试成绩",
  lastRank: "最近考试排名",
  targetScore: "下次考试目标成绩",
  targetRank: "目标排名",
  targetSchool: "目标学校",
  motivation: "学习动机与目标",
};
const TABLES = {
  knowledge: {
    label: "学科知识掌握分析",
    fields: {
      topic: "考点",
      difficulty: "难易度",
      strengths: "评价与已掌握情况",
      needs: "提升空间",
      evidence: "评价依据",
    },
  },
  habits: {
    label: "核心学科习惯分析",
    fields: { name: "核心习惯", rating: "评级", evidence: "观察依据" },
  },
  plan: {
    label: "知识辅导方案",
    fields: {
      topic: "本阶段内容计划",
      objectives: "教学目标",
      keyPoints: "重难点",
      hours: "课时",
    },
  },
  habitPlan: {
    label: "核心习惯培养方案",
    fields: {
      habit: "阶段核心习惯",
      actions: "具体方案与实施",
      criteria: "达成标准",
      support: "注意事项与所需支持",
    },
  },
};
function Rows({ kind, rows, onChange, fixedCount = 0 }) {
  const spec = fixedCount
    ? {
        ...TABLES[kind],
        label: "接下来15节课",
        fields: {
          topic: "教学内容",
          objectives: "教学目标",
          keyPoints: "重难点",
        },
      }
    : TABLES[kind];
  if (fixedCount && !rows.length)
    rows = Array.from({ length: fixedCount }, () => ({
      topic: "",
      objectives: "",
      keyPoints: "",
      hours: "1",
    }));
  return (
    <Section
      title={spec.label}
      action={
        fixedCount ? (
          <Badge type="blue">15节课 · 每行一次课</Badge>
        ) : (
          <Button
            icon={Plus}
            onClick={() =>
              onChange([
                ...rows,
                Object.fromEntries(
                  Object.keys(spec.fields).map((k) => [
                    k,
                    k === "difficulty"
                      ? "待确认"
                      : k === "rating"
                        ? "未评价"
                        : "",
                  ]),
                ),
              ])
            }
          >
            添加
            {kind === "knowledge"
              ? "考点"
              : kind === "habits"
                ? "习惯"
                : kind === "plan"
                  ? "知识计划"
                  : "习惯方案"}
          </Button>
        )
      }
    >
      {!rows.length && (
        <p className="muted">尚未填写，可手工添加，或根据真实资料生成草稿。</p>
      )}
      {rows.map((row, index) => (
        <div className="report-row" key={index}>
          <div className="section-head">
            <strong>{fixedCount ? `第${index + 1}节课` : index + 1}</strong>
            {!fixedCount && (
              <Button
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                移除此行
              </Button>
            )}
          </div>
          <div className="form-grid two">
            {Object.entries(spec.fields).map(([key, label]) => (
              <Field key={key} label={`${spec.label} ${index + 1} ${label}`}>
                {key === "rating" || key === "difficulty" ? (
                  <select
                    value={row[key]}
                    onChange={(e) =>
                      onChange(
                        rows.map((r, i) =>
                          i === index ? { ...r, [key]: e.target.value } : r,
                        ),
                      )
                    }
                  >
                    {(key === "rating"
                      ? RATINGS
                      : ["待确认", "易", "中", "难"]
                    ).map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                ) : key === "hours" ? (
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={row[key]}
                    onChange={(e) =>
                      onChange(
                        rows.map((r, i) =>
                          i === index ? { ...r, [key]: e.target.value } : r,
                        ),
                      )
                    }
                  />
                ) : (
                  <textarea
                    rows={
                      key === "topic" || key === "name" || key === "habit"
                        ? 2
                        : 3
                    }
                    value={row[key]}
                    onChange={(e) =>
                      onChange(
                        rows.map((r, i) =>
                          i === index ? { ...r, [key]: e.target.value } : r,
                        ),
                      )
                    }
                  />
                )}
              </Field>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}
function ReportPreview({ report }) {
  const fixedPlan = report.planFormat === PLAN_FORMAT;
  const tables = {
    ...TABLES,
    plan: fixedPlan
      ? {
          label: "学科知识学习 接下来15节课",
          fields: {
            topic: "教学内容",
            objectives: "教学目标",
            keyPoints: "重难点",
          },
        }
      : TABLES.plan,
  };
  return (
    <div className="report-preview">
      <h2>{REPORT_TYPES[report.type]}</h2>
      <p>
        {Object.entries(META)
          .map(([k, v]) => `${v}：${report.meta[k] || "________"}`)
          .join("　")}
      </p>
      <h3>第一篇 动力激发篇</h3>
      {Object.entries(GOALS).map(([k, label]) => (
        <p key={k}>
          {label}：{report.goals[k] || "________"}
        </p>
      ))}
      {report.type === "entry" &&
        Object.entries(report.motivationChoices).map(([q, v]) => (
          <p key={q}>
            {q}：{v}
          </p>
        ))}
      {report.type === "entry" &&
        report.observations?.some((o) => o.topic || o.performance) && (
          <>
            <h3>前三次课观察</h3>
            {report.observations.map((o, i) => (
              <p key={i}>
                <strong>
                  第 {i + 1} 次课 {o.date}
                </strong>
                <br />
                {o.topic}
                <br />
                {o.performance}
                <br />
                {o.homework}
              </p>
            ))}
          </>
        )}
      {report.type === "stage" && (
        <>
          <h3>阶段变化与回顾</h3>
          <p>{report.progress || "待结合上一份报告确认"}</p>
        </>
      )}
      <h3>第二篇 能力分析篇</h3>
      {Object.entries(tables).map(([key, spec]) => (
        <div key={key}>
          {key === "plan" && (
            <>
              <h3>
                {report.type === "entry" ? "第三篇 辅导方案篇" : "辅导方案篇"}
              </h3>
              {report.curriculum?.currentTopic && (
                <p>
                  教材：{report.curriculum.edition} · {report.curriculum.volume}
                  <br />
                  当前进度：{report.curriculum.currentTopic}
                  <br />
                  进度依据：{report.curriculum.progressEvidence}
                  <br />
                  {report.planningNotes}
                </p>
              )}
            </>
          )}
          <h3>{spec.label}</h3>
          <div className="report-table-scroll">
            <table>
              <thead>
                <tr>
                  {key === "plan" && fixedPlan && <th>课次</th>}
                  {Object.values(spec.fields).map((v) => (
                    <th key={v}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report[key].map((r, i) => (
                  <tr key={i}>
                    {key === "plan" && fixedPlan && <td>第{i + 1}节</td>}
                    {Object.keys(spec.fields).map((k) => (
                      <td key={k}>{r[k] || "待确认"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <h3>
        {report.type === "entry" ? "第四篇 毅力提升篇" : "第三篇 毅力提升篇"}
      </h3>
      {Object.entries({
        attendance: "考勤纪律",
        efficiency: "课堂效率",
        homework: "作业完成",
        overall: "整体评语",
      }).map(([k, l]) => (
        <p key={k}>
          <strong>{l}</strong>
          <br />
          {report.comments[k] || "尚需观察"}
        </p>
      ))}
      <p>教师签名：________________　日期：________________</p>
      <h4>学习执行要求</h4>
      <p>{report.requirements}</p>
      <p>学员签名：________________　日期：________________</p>
      <h3>家长回执</h3>
      <p>{report.parentReceipt || "意见与建议：\n\n\n"}</p>
      <p>家长签名：________________　日期：________________</p>
    </div>
  );
}

export default function LearningReports({ student, courses = [] }) {
  const { data, config, mutate, notify } = useApp();
  const available =
      studentDirectoryState(student, config.studentsRoot) === "available",
    stopped = student.status === "已停课";
  const [settings, setSettings] = useState({
    completedLessons: teachingCount(student, data) ?? "",
    firstLessonDate: student.reportSettings?.firstLessonDate || "",
    intervalMonths: student.reportSettings?.intervalMonths || 2,
    teacher: student.reportSettings?.teacher || "",
    advisor: student.reportSettings?.advisor || "",
  });
  const [report, setReport] = useDraft("report-editor:" + student.id, null);
  const [tab, setTab] = useState("edit"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null),
    [imported, setImported] = useState(null),
    [voiding, setVoiding] = useState(null),
    [reviewed, setReviewed] = useState(false),
    [dirty, setDirty] = useDraft("report-dirty:" + student.id, false);
  const [preserveEdits, setPreserveEdits] = useState(true),
    [progressInput, setProgressInput] = useState("");
  const active = useRef(true),
    request = useRef(""),
    exportCache = useRef(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (request.current) services.cancelAI(request.current).catch(() => {});
    };
  }, []);
  const task = reportTask(student, data),
    history = data.reports
      .filter((r) => r.studentId === student.id)
      .sort((a, b) =>
        (b.updatedAt || b.generatedAt || b.createdAt || "").localeCompare(
          a.updatedAt || a.generatedAt || a.createdAt || "",
        ),
      );
  const files = useFiles(
    available ? join(student.directoryPath, "学习力报告") : undefined,
    true,
  );
  const external = files.files.filter(
    (f) =>
      !f.isDirectory &&
      /\.docx?$/i.test(f.name) &&
      !history.some((r) => r.path === f.path && r.status !== "void"),
  );
  const perform = async (fn) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (active.current) setError(e.message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const change = (patch) => {
    setReport((r) => ({
      ...r,
      ...patch,
      manualFields: reportManualFields(r, patch),
    }));
    setReviewed(false);
    setDirty(true);
  };
  const begin = (type, withAI = false) => {
    if (dirty && !window.confirm("当前有未保存的报告草稿，确认放弃后新建？"))
      return;
    const draft = freshReport(student, data, type);
    draft.currentProgressOverride =
      report?.currentProgressOverride ?? progressInput;
    setReport(draft);
    setTab("edit");
    setReviewed(false);
    setDirty(true);
    exportCache.current = null;
    setError("");
    if (withAI) perform(() => generateDraft(draft));
  };
  const persist = async (final = false) => {
    const draft =
      final &&
      report.type === "entry" &&
      report.confirmedLessons === "" &&
      reviewed
        ? { ...report, confirmedLessons: 3 }
        : report;
    const issues = reportIssues(draft, final);
    if (issues.length) throw Error(issues.join("；"));
    if (final && !reviewed) throw Error("请先核对并勾选导出确认");
    if (final && !available) throw Error("请先恢复当前学生目录后导出");
    let value = {
      ...draft,
      status: final ? "final" : "draft",
      sourceSnapshot: report.sourceSnapshot || reportSnapshot(report, data),
    };
    if (final) {
      const fingerprint = JSON.stringify({
        ...value,
        sourceSnapshot: { ...value.sourceSnapshot, capturedAt: undefined },
      });
      let path;
      if (exportCache.current?.fingerprint === fingerprint) {
        path = exportCache.current.path;
        value = { ...value, sourceSnapshot: exportCache.current.snapshot };
      } else {
        path = join(
          student.directoryPath,
          "学习力报告",
          `${student.name}${REPORT_TYPES[report.type]}_${report.meta.reportDate}_${id().slice(0, 8)}.docx`,
        );
        await services.learningReport(path, value);
        exportCache.current = {
          fingerprint,
          path,
          snapshot: value.sourceSnapshot,
        };
      }
      value = {
        ...value,
        path,
        reportDate: report.meta.reportDate,
        generatedAt: new Date().toISOString(),
        content: reportPlainText(report),
      };
    }
    await mutate((d) => saveLearningReport(d, value));
    setReport(final ? null : value);
    setDirty(false);
    setReviewed(false);
    notify(final ? "学习力报告已导出，报告周期已更新" : "报告草稿已保存");
    if (final) files.refresh();
  };
  const generateDraft = async (draft, planOnly = false) => {
    const issues = reportIssues({
      ...draft,
      planFormat: PLAN_FORMAT,
      plan: [],
    });
    if (issues.length) throw Error(issues.join("；"));
    if (!config.deepseekKey)
      throw Error("请先配置 DeepSeek，或直接手工填写报告");
    const snapshot = reportSnapshot(draft, data);
    await enrichPlanningSnapshot(snapshot, draft, data, courses, config, () => {
      if (!active.current) throw Error("已离开报告页面");
    });
    if (!active.current) return;
    request.current = id();
    const result = await services.ai({
      id: request.current,
      task: planOnly
        ? learningPlanPrompt(draft, snapshot)
        : learningReportPrompt(draft, snapshot, preserveEdits),
      json: true,
      maxTokens: 16384,
      thinking: false,
    });
    if (!active.current) return;
    const content = planOnly
      ? validateCoursePlan(parseJSONResult(result.text), draft)
      : validateReportAI(parseJSONResult(result.text), draft, preserveEdits);
    setPending({
      content,
      snapshot,
      model: result.model,
      scope: planOnly ? "plan" : "full",
    });
    request.current = "";
  };
  const generate = () => perform(() => generateDraft(report));
  const evidence = report
    ? reportEvidence(
        student.id,
        data,
        report.meta.periodStart,
        report.meta.periodEnd,
      )
    : [];
  const scoreOptions = report
    ? data.examRecords
        .filter((record) => record.studentId === student.id)
        .flatMap((record) => {
          const exam = data.exams.find((e) => e.id === record.examId);
          if (
            !exam ||
            exam.date < report.meta.periodStart ||
            exam.date > report.meta.periodEnd
          )
            return [];
          return record.results
            .filter(
              (result) =>
                result.status === "scored" &&
                exam.subjects.find((s) => s.id === result.subjectId)?.name ===
                  report.meta.subject.trim(),
            )
            .map((result) => ({
              id: record.id + ":" + result.subjectId,
              label: `${exam.date} ${exam.name}：${result.score} / ${exam.subjects.find((s) => s.id === result.subjectId).maxScore}`,
            }));
        })
    : [];
  return (
    <div className="learning-reports">
      <Section
        title="学习力报告"
        subtitle="入学报告在确认完成三次课后制作；阶段报告每 2—3 个月回顾一次"
      >
        <div className="report-status">
          <Badge type={task.due ? "warning" : "success"}>{task.label}</Badge>
          {task.dueDate && (
            <span>
              建议制作日期 {task.dueDate}　最晚建议 {task.deadline}
            </span>
          )}
        </div>
        <p className="form-hint">
          点击下方按钮即可根据已有资料生成整份报告，无需先填表。AI
          会完成目标建议、课堂观察、习惯建议评级、辅导计划、评语和家长沟通建议；你可以逐项修改后导出。
        </p>
        <Field label="当前学习进度（可选补充）">
          <input
            disabled={busy || stopped}
            value={report?.currentProgressOverride ?? progressInput}
            onChange={(e) =>
              report
                ? change({
                    currentProgressOverride: e.target.value,
                    sourceSnapshot: null,
                  })
                : setProgressInput(e.target.value)
            }
            placeholder="留空由AI根据最近授课记录判断，例如：人教A版必修一，已学到函数单调性"
          />
        </Field>
        <p className="form-hint">
          教材：{mathTextbook(report?.meta.grade || student.grade).edition}
          ；学科知识学习固定安排后续15节课，每行一次课，不按15个钟点小时计算。
        </p>
        <div className="button-row">
          <Button
            icon={Sparkles}
            variant="primary"
            disabled={busy || stopped}
            onClick={() => begin("entry", true)}
          >
            AI 生成入学报告
          </Button>
          <Button
            icon={Sparkles}
            variant="primary"
            disabled={busy || stopped}
            onClick={() => begin("stage", true)}
          >
            AI 生成阶段报告
          </Button>
          {busy && <span role="status">正在阅读学生资料并生成完整报告…</span>}
        </div>
        <details className="report-settings">
          <summary>授课次数与报告周期</summary>
          <p className="form-hint">
            已完成授课记录自动计次；历史授课次数可在此校准，后续新增完成记录会继续累计。讲义数量和反馈数量不计入课次。
          </p>
          <div className="form-grid two">
            <Field label="已确认授课次数">
              <input
                type="number"
                min="0"
                value={settings.completedLessons}
                onChange={(e) =>
                  setSettings((v) => ({
                    ...v,
                    completedLessons: e.target.value,
                  }))
                }
              />
            </Field>
            <Field label="首次授课日期">
              <input
                type="date"
                value={settings.firstLessonDate}
                onChange={(e) =>
                  setSettings((v) => ({
                    ...v,
                    firstLessonDate: e.target.value,
                  }))
                }
              />
            </Field>
            <Field label="阶段报告周期">
              <select
                value={settings.intervalMonths}
                onChange={(e) =>
                  setSettings((v) => ({
                    ...v,
                    intervalMonths: +e.target.value,
                  }))
                }
              >
                <option value={2}>2 个月</option>
                <option value={3}>3 个月</option>
              </select>
            </Field>
            <Field label="默认学科教师">
              <input
                value={settings.teacher}
                onChange={(e) =>
                  setSettings((v) => ({ ...v, teacher: e.target.value }))
                }
              />
            </Field>
            <Field label="默认班主任">
              <input
                value={settings.advisor}
                onChange={(e) =>
                  setSettings((v) => ({ ...v, advisor: e.target.value }))
                }
              />
            </Field>
          </div>
          <p className="form-hint">
            已有{" "}
            {
              new Set(
                data.feedback
                  .filter((f) => f.studentId === student.id)
                  .map((f) => f.date),
              ).size
            }{" "}
            个上课日期的反馈记录，可据此核对次数。
          </p>
          <Button
            disabled={busy || stopped}
            onClick={() =>
              perform(async () => {
                await mutate((d) =>
                  saveReportSettings(d, student.id, settings),
                );
                notify("授课次数与报告周期已保存");
              })
            }
          >
            保存授课与周期设置
          </Button>
        </details>
        <div className="button-row">
          <Button
            icon={Plus}
            disabled={busy || stopped}
            onClick={() => begin("entry")}
          >
            新建入学报告
          </Button>
          <Button
            icon={Plus}
            disabled={busy || stopped}
            onClick={() => begin("stage")}
          >
            新建阶段报告
          </Button>
          {dirty && <Badge type="warning">草稿尚未保存</Badge>}
        </div>
      </Section>
      {error && <ErrorBox message={error} />}
      {report && (
        <Section
          title={REPORT_TYPES[report.type] + "制作"}
          subtitle="AI先生成完整草稿，可逐项修改。Word按原入学/阶段模板填入对应栏目，保留封面、前言、表格和回执；入学观察等辅助资料保留在应用内。正式导出才更新周期。"
        >
          <Tabs
            items={[
              { key: "edit", label: "编辑报告" },
              { key: "sources", label: "资料依据" },
              { key: "preview", label: "预览报告" },
            ]}
            value={tab}
            onChange={setTab}
          />
          <fieldset disabled={busy || stopped} className="report-fieldset">
            {tab === "edit" && (
              <>
                <h3>基本信息与统计周期</h3>
                <div className="form-grid two">
                  {Object.entries(META).map(([k, label]) => (
                    <Field key={k} label={"报告" + label}>
                      <input
                        type={/Date$|Start$|End$/.test(k) ? "date" : "text"}
                        readOnly={k === "studentName"}
                        value={report.meta[k]}
                        onChange={(e) =>
                          change({
                            meta: { ...report.meta, [k]: e.target.value },
                            sourceSnapshot: null,
                          })
                        }
                      />
                    </Field>
                  ))}
                  <Field label="本报告确认授课次数">
                    <input
                      type="number"
                      min="0"
                      value={report.confirmedLessons}
                      onChange={(e) =>
                        change({ confirmedLessons: e.target.value })
                      }
                    />
                  </Field>
                  {report.planFormat === PLAN_FORMAT ? (
                    <Field label="后续授课节数">
                      <input value="15节课，每行一次授课" readOnly />
                    </Field>
                  ) : (
                    <Field label="辅导计划课时预算">
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        value={report.hourBudget}
                        onChange={(e) => change({ hourBudget: e.target.value })}
                        placeholder="可留空，由教师后续确认"
                      />
                    </Field>
                  )}
                </div>
                {report.type === "entry" && (
                  <Section
                    title="前三次课观察"
                    subtitle="AI 从已有课堂记录提取；无记录的课次会给出观察建议，日期留待确认。所有内容均可修改。"
                  >
                    {report.observations.map((o, i) => (
                      <div className="report-row" key={i}>
                        <strong>第 {i + 1} 次课观察</strong>
                        <div className="form-grid two">
                          {Object.entries({
                            date: "日期",
                            topic: "教学内容",
                            performance: "课堂表现与薄弱点",
                            homework: "课后作业观察",
                          }).map(([k, l]) => (
                            <Field key={k} label={`第${i + 1}次课${l}`}>
                              <input
                                type={k === "date" ? "date" : "text"}
                                value={o[k]}
                                onChange={(e) =>
                                  change({
                                    observations: report.observations.map(
                                      (v, index) =>
                                        index === i
                                          ? { ...v, [k]: e.target.value }
                                          : v,
                                    ),
                                  })
                                }
                              />
                            </Field>
                          ))}
                        </div>
                      </div>
                    ))}
                  </Section>
                )}
                <Section title="动力激发与学习目标">
                  {!!scoreOptions.length && (
                    <Field label="从已录入考试带入成绩">
                      <select
                        value=""
                        onChange={(e) => {
                          const score = scoreOptions.find(
                            (v) => v.id === e.target.value,
                          );
                          if (score)
                            change({
                              goals: {
                                ...report.goals,
                                lastScore: score.label,
                                lastRank: "",
                              },
                            });
                        }}
                      >
                        <option value="">选择本周期当前学科的已出分考试</option>
                        {scoreOptions.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <div className="form-grid two">
                    {Object.entries(GOALS).map(([k, label]) => (
                      <Field key={k} label={label}>
                        <textarea
                          rows={2}
                          value={report.goals[k]}
                          onChange={(e) =>
                            change({
                              goals: { ...report.goals, [k]: e.target.value },
                            })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  {report.type === "entry" &&
                    Object.entries(report.motivationChoices).map(([q, v]) => (
                      <Field key={q} label={q}>
                        <select
                          value={v}
                          onChange={(e) =>
                            change({
                              motivationChoices: {
                                ...report.motivationChoices,
                                [q]: e.target.value,
                              },
                            })
                          }
                        >
                          {MOTIVATION_ANSWERS.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      </Field>
                    ))}
                  <p className="form-hint">
                    AI
                    会提取已记录成绩、提出目标和动力评估建议；未记录的分数与排名标为待确认，建议选项不代表学生已作承诺。
                  </p>
                </Section>
                {report.type === "stage" && (
                  <Field label="本阶段变化与回顾">
                    <textarea
                      rows={5}
                      value={report.progress}
                      onChange={(e) => change({ progress: e.target.value })}
                    />
                  </Field>
                )}
                <Field label="教师综合观察与补充事实">
                  <textarea
                    rows={5}
                    value={report.teacherNotes}
                    onChange={(e) => change({ teacherNotes: e.target.value })}
                    placeholder="可选补充。AI 会先从已有记录归纳，不必重复填写。"
                  />
                </Field>
                <Field label="下一阶段教学安排与要求">
                  <textarea
                    rows={4}
                    value={report.planningNotes}
                    onChange={(e) => change({ planningNotes: e.target.value })}
                    placeholder="可选补充。留空时 AI 会根据薄弱点和年级提出教学安排与建议课时。"
                  />
                </Field>
                <Button
                  icon={Sparkles}
                  disabled={busy || stopped}
                  onClick={() => perform(() => generateDraft(report, true))}
                >
                  AI 重新规划15节课
                </Button>
                {report.curriculum?.currentTopic && (
                  <p className="form-hint">
                    已判断进度：{report.curriculum.volume} ·{" "}
                    {report.curriculum.currentTopic}
                    <br />
                    {report.curriculum.progressEvidence}
                  </p>
                )}
                {Object.keys(TABLES).map((key) => (
                  <Rows
                    key={key}
                    kind={key}
                    rows={report[key]}
                    fixedCount={
                      key === "plan" && report.planFormat === PLAN_FORMAT
                        ? PLAN_LESSONS
                        : 0
                    }
                    onChange={(v) => change({ [key]: v })}
                  />
                ))}
                <p className="form-hint">
                  {report.planFormat === PLAN_FORMAT ? (
                    `后续计划 ${report.plan.length}/15 节课，每行是一次授课。`
                  ) : (
                    <>
                      知识计划已分配{" "}
                      {report.plan.reduce((n, p) => n + (+p.hours || 0), 0)}{" "}
                      课时
                      {report.hourBudget !== ""
                        ? ` / 预算 ${report.hourBudget} 课时`
                        : ""}
                      。评级与课时由 AI 先给出建议，可按实际情况修改。
                    </>
                  )}
                </p>
                <Section title="毅力提升与教师评语">
                  {Object.entries({
                    attendance: "考勤纪律",
                    efficiency: "课堂效率",
                    homework: "作业完成",
                    overall: "整体评语",
                  }).map(([k, label]) => (
                    <Field key={k} label={label}>
                      <textarea
                        rows={k === "overall" ? 5 : 3}
                        value={report.comments[k]}
                        onChange={(e) =>
                          change({
                            comments: {
                              ...report.comments,
                              [k]: e.target.value,
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                  <Field label="学习执行要求">
                    <textarea
                      rows={8}
                      value={report.requirements}
                      onChange={(e) => change({ requirements: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="家长回执意见"
                    hint="原模板回执框建议180字以内，最多240字；此处为沟通参考，不代替家长签字。"
                  >
                    <textarea
                      rows={4}
                      value={report.parentReceipt}
                      onChange={(e) =>
                        change({ parentReceipt: e.target.value })
                      }
                      placeholder="AI 会归纳已有家长反馈，或提出待沟通确认的要点；签名位置保留空白。"
                    />
                  </Field>
                </Section>
              </>
            )}
            {tab === "sources" && (
              <>
                <Field label="对比的上期报告">
                  <select
                    value={report.baselineId}
                    onChange={(e) =>
                      change({
                        baselineId: e.target.value,
                        sourceSnapshot: null,
                      })
                    }
                  >
                    <option value="">不选择上期报告</option>
                    {completedReports(student.id, data)
                      .filter((r) => r.id !== report.id)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {reportDate(r)} {REPORT_TYPES[reportKind(r)]}
                        </option>
                      ))}
                  </select>
                </Field>
                <p className="form-hint">
                  统计范围 {report.meta.periodStart} 至 {report.meta.periodEnd}
                  。自动选中当前学生本周期记录，无日期记录作为背景参考，可取消选择；较早记录仅用于历史背景，不视为本期表现。旧
                  Word 可登记后用作对比。
                </p>
                <Button
                  onClick={() =>
                    change({
                      sourceIds: evidence
                        .filter((e) => e.date)
                        .map((e) => e.id),
                      sourceSnapshot: null,
                    })
                  }
                >
                  选中本周期有日期资料
                </Button>
                {evidence.map((e) => (
                  <div className="report-source" key={e.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={report.sourceIds.includes(e.id)}
                        onChange={(event) =>
                          change({
                            sourceIds: event.target.checked
                              ? [...new Set([...report.sourceIds, e.id])]
                              : report.sourceIds.filter((k) => k !== e.id),
                            sourceSnapshot: null,
                          })
                        }
                      />
                      {e.kind} · {e.date || "无日期，需人工确认"}
                    </label>
                    <p>
                      {e.text.slice(0, 500)}
                      {e.text.length > 500 ? "…" : ""}
                    </p>
                  </div>
                ))}
                {!evidence.length && (
                  <Empty
                    title="本周期尚无可汇总记录"
                    description="AI 仍可根据档案与历史背景提出学习建议；也可调整统计周期或补充记录，让评估更准确。"
                  />
                )}
                {report.sourceSnapshot && (
                  <p className="form-hint">
                    已保存依据快照：{report.sourceSnapshot.records.length}{" "}
                    条资料，采集于{" "}
                    {report.sourceSnapshot.capturedAt.slice(0, 10)}
                    。再次生成会重新采集选中资料。
                  </p>
                )}
              </>
            )}
            {tab === "preview" && <ReportPreview report={report} />}
          </fieldset>
          <div className="report-actions">
            <Button
              icon={Save}
              disabled={busy || stopped}
              onClick={() => perform(() => persist(false))}
            >
              保存报告草稿
            </Button>
            <Button
              icon={Sparkles}
              disabled={busy || stopped}
              onClick={generate}
            >
              {busy ? "处理中…" : "AI 重新生成整份报告"}
            </Button>
            {busy && request.current && (
              <Button onClick={() => services.cancelAI(request.current)}>
                取消生成
              </Button>
            )}
            <CopyButton text={reportPlainText(report)} label="复制报告全文" />
            <label className="check-line">
              <input
                type="checkbox"
                checked={preserveEdits}
                disabled={busy}
                onChange={(e) => setPreserveEdits(e.target.checked)}
              />
              重新生成时保留我修改过的内容
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                disabled={busy || stopped}
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              {report.type === "entry"
                ? "已核对学生信息、成绩、评级与建议，并确认已完成至少3次课，正式导出"
                : "已核对学生信息、成绩、评级与建议，确认正式导出"}
            </label>
            <Button
              variant="primary"
              disabled={busy || stopped || !reviewed || !available}
              onClick={() => perform(() => persist(true))}
            >
              完成并导出 Word
            </Button>
          </div>
          {!!reportIssues(
            {
              ...report,
              confirmedLessons:
                report.confirmedLessons === "" ? 3 : report.confirmedLessons,
            },
            true,
          ).length && (
            <p className="form-hint">
              正式导出前需完善：
              {reportIssues(
                {
                  ...report,
                  confirmedLessons:
                    report.confirmedLessons === ""
                      ? 3
                      : report.confirmedLessons,
                },
                true,
              ).join("；")}
              。资料不足时可先保存草稿。
            </p>
          )}
        </Section>
      )}
      <Section
        title="报告历史与本地文件"
        subtitle="草稿、正式报告和已登记历史分开标记；修改正式报告时复制成新稿，原版本保留。"
      >
        {files.error && !files.error.includes("ENOENT") && (
          <ErrorBox message={files.error} />
        )}
        {!history.length && !external.length && (
          <Empty title="尚无学习力报告" />
        )}
        {history.map((r) => (
          <article
            className="record-card"
            key={r.id}
            data-search-key={"报告:" + r.id}
          >
            <div className="section-head">
              <h4>
                {REPORT_TYPES[reportKind(r)]} ·{" "}
                {reportDate(r) ||
                  r.meta?.reportDate ||
                  r.createdAt?.slice(0, 10)}
              </h4>
              <Badge>
                {r.status === "draft"
                  ? "草稿"
                  : r.status === "void"
                    ? "已作废"
                    : "正式报告"}
              </Badge>
            </div>
            <div className="button-row">
              {r.path && (
                <Button onClick={() => perform(() => services.open(r.path))}>
                  打开 Word 文件
                </Button>
              )}
              {r.schemaVersion === 2 && (
                <Button
                  disabled={busy || stopped}
                  onClick={() => {
                    if (
                      dirty &&
                      !window.confirm("当前草稿尚未保存，确认切换？")
                    )
                      return;
                    setReport(
                      r.status === "draft"
                        ? structuredClone(r)
                        : {
                            ...structuredClone(r),
                            id: id(),
                            parentId: r.id,
                            status: "draft",
                            manualFields: preserveEdits
                              ? r.manualFields || []
                              : [],
                            path: undefined,
                            generatedAt: undefined,
                            createdAt: new Date().toISOString(),
                          },
                    );
                    setTab("edit");
                    setReviewed(false);
                    setDirty(r.status !== "draft");
                    exportCache.current = null;
                  }}
                >
                  {r.status === "draft" ? "继续编辑草稿" : "复制为新草稿"}
                </Button>
              )}
              {r.status !== "void" && (
                <Button
                  disabled={busy || stopped}
                  onClick={() => setVoiding(r)}
                >
                  {r.status === "draft" ? "删除草稿" : "作废登记"}
                </Button>
              )}
            </div>
            {r.sourceSnapshot && (
              <details>
                <summary>查看当时的资料依据</summary>
                <p>
                  {r.sourceSnapshot.period?.start} 至{" "}
                  {r.sourceSnapshot.period?.end}
                </p>
                {r.sourceSnapshot.records?.map((e) => (
                  <p key={e.id}>
                    {e.kind} {e.date}
                    <br />
                    {e.text}
                  </p>
                ))}
              </details>
            )}
          </article>
        ))}
        {external.map((f) => (
          <div className="record-card" key={f.path}>
            <FileItem
              file={f}
              onOpen={() => perform(() => services.open(f.path))}
            />
            <Button
              disabled={busy || stopped}
              onClick={() =>
                setImported({
                  file: f,
                  type: /入学/.test(f.name) ? "entry" : "stage",
                  date: today(),
                  text: "",
                  confirmed: false,
                  error: "",
                })
              }
            >
              登记历史报告
            </Button>
          </div>
        ))}
      </Section>
      {pending && (
        <Modal
          title={
            pending.scope === "plan" ? "核对15节课方案" : "核对 AI 报告草稿"
          }
          onClose={() => !busy && setPending(null)}
          wide
        >
          <p>
            {pending.scope === "plan"
              ? "这里只替换学习进度和接下来15节课的知识方案，报告其余内容保留。确认后自动保存草稿。"
              : "完整报告已生成，包括目标、课堂观察、建议评级、辅导方案、评语与家长沟通建议。使用后自动保存草稿，仍可逐项修改；真实身份和日期以当前档案为准。"}
          </p>
          <ReportPreview report={{ ...report, ...pending.content }} />
          <footer>
            <Button disabled={busy} onClick={() => setPending(null)}>
              保留原草稿
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  const value = {
                    ...report,
                    ...pending.content,
                    sourceSnapshot:
                      pending.scope === "plan"
                        ? report.sourceSnapshot || pending.snapshot
                        : pending.snapshot,
                    planSourceSnapshot:
                      pending.scope === "plan" ? pending.snapshot : undefined,
                    model: pending.model,
                    aiGeneratedAt:
                      pending.scope === "plan"
                        ? report.aiGeneratedAt
                        : new Date().toISOString(),
                    planGeneratedAt: new Date().toISOString(),
                    manualFields:
                      pending.scope === "plan"
                        ? (report.manualFields || []).filter(
                            (f) => f !== "plan" && f !== "planningNotes",
                          )
                        : preserveEdits
                          ? report.manualFields || []
                          : [],
                    status: "draft",
                  };
                  await mutate((d) => saveLearningReport(d, value));
                  setReport(value);
                  setDirty(false);
                  setReviewed(false);
                  setPending(null);
                  setTab("preview");
                  notify(
                    pending.scope === "plan"
                      ? "15节课方案已更新并保存草稿，其余报告内容保留"
                      : "完整报告已生成并保存草稿，可直接预览、修改或导出",
                  );
                })
              }
            >
              {pending.scope === "plan"
                ? "使用15节课方案并保存"
                : "使用整份报告并保存草稿"}
            </Button>
          </footer>
        </Modal>
      )}
      {imported && (
        <Modal
          title="登记已有学习力报告"
          onClose={() => !busy && setImported(null)}
        >
          <p>{imported.file.name}</p>
          <p className="form-hint">
            请核对文件内姓名、年级及日期。文件名不一定与正文一致；历史正文仅作对比，不会覆盖当前学生身份。
          </p>
          <Field label="历史报告类型">
            <select
              value={imported.type}
              onChange={(e) =>
                setImported((v) => ({ ...v, type: e.target.value }))
              }
            >
              {Object.entries(REPORT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="历史报告日期">
            <input
              type="date"
              value={imported.date}
              onChange={(e) =>
                setImported((v) => ({ ...v, date: e.target.value }))
              }
            />
          </Field>
          <Button
            disabled={busy}
            onClick={() =>
              perform(async () => {
                try {
                  const text = await services.readText(imported.file.path);
                  setImported((v) => ({ ...v, text }));
                } catch (e) {
                  setImported((v) => ({
                    ...v,
                    error:
                      e.message + "。可检查 LibreOffice 配置，或手工粘贴正文。",
                  }));
                }
              })
            }
          >
            读取历史正文
          </Button>
          {imported.error && <ErrorBox message={imported.error} />}
          <Field label="历史报告正文">
            <textarea
              rows={10}
              value={imported.text}
              onChange={(e) =>
                setImported((v) => ({ ...v, text: e.target.value }))
              }
              placeholder="可留空仅登记日期；粘贴并核对正文后可用于阶段对比。"
            />
          </Field>
          <label className="check-line">
            <input
              type="checkbox"
              checked={imported.confirmed}
              onChange={(e) =>
                setImported((v) => ({ ...v, confirmed: e.target.checked }))
              }
            />
            我已核对，这份报告属于当前学生，日期与类型正确
          </label>
          <Button
            variant="primary"
            disabled={busy || !imported.confirmed}
            onClick={() =>
              perform(async () => {
                if (!validDate(imported.date) || imported.date > today())
                  throw Error("请输入有效的历史报告日期");
                const otherName = historicalNameMismatch(
                  imported.text,
                  student.name,
                );
                if (otherName)
                  throw Error(
                    `正文中的学员姓名为“${otherName}”，与当前档案不一致。请核对并修正参考正文，或留空仅登记日期。原文件不会改写。`,
                  );
                await mutate((d) => {
                  if (
                    d.reports.some(
                      (r) =>
                        r.path === imported.file.path && r.status !== "void",
                    )
                  )
                    throw Error("此文件已经登记");
                  return {
                    ...d,
                    reports: [
                      {
                        id: id(),
                        studentId: student.id,
                        schemaVersion: 1,
                        type: REPORT_TYPES[imported.type],
                        status: "final",
                        reportDate: imported.date,
                        generatedAt: imported.date + "T12:00:00",
                        path: imported.file.path,
                        content: imported.text,
                        imported: true,
                      },
                      ...d.reports,
                    ],
                  };
                });
                setImported(null);
                notify("历史报告已登记，周期提醒已更新");
              })
            }
          >
            确认登记历史报告
          </Button>
        </Modal>
      )}
      {voiding && (
        <Confirm
          title={voiding.status === "draft" ? "删除报告草稿" : "作废报告登记"}
          description="只处理报告索引，磁盘原文件保留。作废后该报告不再用于制作周期提醒。"
          onClose={() => setVoiding(null)}
          onConfirm={async () => {
            await mutate((d) => ({
              ...d,
              reports:
                voiding.status === "draft"
                  ? d.reports.filter((r) => r.id !== voiding.id)
                  : d.reports.map((r) =>
                      r.id === voiding.id ? { ...r, status: "void" } : r,
                    ),
            }));
            if (report?.id === voiding.id) {
              setReport(null);
              setDirty(false);
            }
          }}
        />
      )}
    </div>
  );
}
