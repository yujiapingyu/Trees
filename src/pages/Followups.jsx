import React, { useState, useEffect, useRef } from "react";
import {
  Phone,
  PhoneCall,
  CalendarClock,
  AlertCircle,
  Plus,
  Save,
  Trash2,
  Pencil,
  Users,
  Sparkles,
  Square,
} from "lucide-react";
import { useApp, useView } from "../shared/store";
import {
  followupState,
  today,
  addDays,
  id,
  studentMatches,
  safeStudentContext,
  parseJSONResult,
} from "../shared/domain";
import {
  PageHeader,
  Button,
  SearchBox,
  Badge,
  Section,
  Field,
  Editor,
  CopyButton,
  Empty,
  Confirm,
  Markdown,
  ErrorBox,
  Modal,
} from "../components/UI";
import { Avatar } from "../components/StudentList";
import { AIAction } from "../components/AIPanel";
import { services } from "../shared/services";
import {
  FOLLOWUP_FIELDS as fields,
  followupSummaryPrompt,
  validateFollowupSummary,
} from "../shared/followupSummary";
function Detail({ student }) {
  const { data, config, mutate, run, notify } = useApp();
  const empty = () => ({
    id: id(),
    studentId: student.id,
    date: today(),
    nextDate: addDays(today(), 14),
    purpose: "",
    content: "",
    parentFeedback: "",
    habits: "",
    keyInfo: "",
    solution: "",
    solutionFeedback: "",
    plan: "",
    notes: "",
  });
  const [form, setForm] = useState(empty),
    [script, setScript] = useState(""),
    [remove, setRemove] = useState(null),
    [summary, setSummary] = useState(""),
    [generating, setGenerating] = useState(false),
    [summaryError, setSummaryError] = useState(""),
    [pendingFields, setPendingFields] = useState(null);
  const request = useRef(""),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (request.current) services.cancelAI(request.current).catch(() => {});
    };
  }, []);
  const generateSummary = async () => {
    setSummaryError("");
    setGenerating(true);
    try {
      const task = followupSummaryPrompt(summary);
      if (!config.deepseekKey)
        throw Error("请先在配置中心设置 DeepSeek API Key");
      request.current = id();
      const result = await services.ai({
        id: request.current,
        task,
        json: true,
      });
      if (!live.current) return;
      const extracted = validateFollowupSummary(parseJSONResult(result.text));
      if (fields.some(([key]) => (form[key] || "").trim()))
        setPendingFields(extracted);
      else {
        setForm((f) => ({ ...f, ...extracted }));
        notify("九项回访内容已填入，请核对后保存");
      }
    } catch (e) {
      if (live.current) setSummaryError(e.message);
    } finally {
      if (live.current) setGenerating(false);
      request.current = "";
    }
  };

  const records = data.followups
    .filter((f) => f.studentId === student.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const state = followupState(records, today(), student.status === "已停课");
  const stopped = student.status === "已停课";
  return (
    <div className="followup-detail">
      <div className="student-profile card">
        <Avatar student={student} size="large" />
        <div className="grow">
          <h2>{student.name}</h2>
          <p>
            {student.grade || "未设置年级"} · {student.phone || "未设置电话"}
          </p>
        </div>
        <Badge type={state.type}>{state.label}</Badge>
        {student.phone && <CopyButton text={student.phone} label="复制电话" />}
      </div>
      <div className="followup-dates">
        <span>
          最近回访 <b>{state.last || "暂无"}</b>
        </span>
        <span>
          下次建议 <b>{state.next || "尽快联系"}</b>
        </span>
      </div>
      {stopped && (
        <div className="info-banner">该学生已停课，仅可查看历史回访。</div>
      )}
      <Section title="电话沟通准备" subtitle="结合当前学生的近期教学记录">
        <div className="button-row">
          <AIAction
            label="生成沟通提纲与话术"
            disabled={stopped || generating}
            task={() =>
              "基于以下真实学生数据生成电话提纲和自然口语化家长话术。缺失数据明确标注，不能编造。\n" +
              JSON.stringify(safeStudentContext(student, data))
            }
            onResult={setScript}
          />
          <Button
            disabled={stopped || generating}
            onClick={() =>
              setScript(
                `【本地模板 / 非 AI 生成】\n\n${student.name}家长您好，方便聊一下孩子最近的学习情况吗？\n\n1. 询问近期作业与在家学习习惯。\n2. 结合实际课堂记录反馈掌握情况。\n3. 确认需要共同解决的问题。\n4. 商议后续学习安排与下次沟通时间。`,
              )
            }
          >
            本地备用模板
          </Button>
        </div>
        {script && (
          <>
            <Editor value={script} onChange={setScript} />
            <CopyButton text={script} />
          </>
        )}
      </Section>
      <Section
        title="摘要整理"
        subtitle="输入实际回访摘要，AI 将归类填入下方九项；未提及的信息留空"
      >
        <Field label="回访内容摘要">
          <textarea
            rows={5}
            value={summary}
            disabled={stopped || generating}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="例如：家长反馈近期作业拖延；商议每天固定时间练习，家长同意先执行一周，下周再联系……"
          />
        </Field>
        <div className="button-row">
          <Button
            icon={Sparkles}
            variant="primary"
            busy={generating}
            disabled={stopped || !summary.trim()}
            onClick={generateSummary}
          >
            根据摘要生成并填入
          </Button>
          {generating && (
            <Button
              icon={Square}
              onClick={() => services.cancelAI(request.current)}
            >
              取消生成
            </Button>
          )}
        </div>
        {summaryError && (
          <ErrorBox
            message={summaryError}
            retry={stopped || generating ? undefined : generateSummary}
          />
        )}
        <p className="form-hint">
          只整理当前输入的摘要，不自动保存记录；已有填写内容时会先展示替换预览。
        </p>
      </Section>
      <Section title="回访记录" subtitle="记录沟通的事实，也记录接下来的行动">
        <div className="form-grid two">
          <Field label="回访日期">
            <input
              type="date"
              value={form.date}
              disabled={stopped || generating}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  date: e.target.value,
                  nextDate: e.target.value ? addDays(e.target.value, 14) : "",
                }))
              }
            />
          </Field>
          <Field label="下次联系日期">
            <input
              type="date"
              value={form.nextDate}
              disabled={stopped || generating}
              min={form.date}
              onChange={(e) =>
                setForm((f) => ({ ...f, nextDate: e.target.value }))
              }
            />
          </Field>
        </div>
        {fields.map(([k, l]) => (
          <div className="followup-field" key={k}>
            <div className="followup-field-heading">
              <label htmlFor={"followup-" + student.id + "-" + k}>{l}</label>
              <CopyButton
                text={form[k] || ""}
                ariaLabel={"复制" + l}
                disabled={!form[k]?.trim()}
              />
            </div>
            <textarea
              id={"followup-" + student.id + "-" + k}
              aria-label={l}
              disabled={stopped || generating}
              rows={k === "content" ? 4 : 2}
              value={form[k] || ""}
              onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
            />
          </div>
        ))}
        <div className="button-row">
          <Button
            icon={Save}
            variant="primary"
            disabled={stopped || generating}
            onClick={() =>
              run(async () => {
                if (!form.date || !form.content.trim())
                  throw Error("请填写日期与沟通内容");
                if (form.nextDate && form.nextDate < form.date)
                  throw Error("下次联系日期不能早于回访日期");
                await mutate((d) => ({
                  ...d,
                  followups: d.followups.some((r) => r.id === form.id)
                    ? d.followups.map((r) => (r.id === form.id ? form : r))
                    : [...d.followups, form],
                }));
                setForm(empty());
                setSummary("");
                setSummaryError("");
              }, "回访已保存")
            }
          >
            保存回访
          </Button>
          <Button
            onClick={() => {
              setForm(empty());
              setSummary("");
              setSummaryError("");
            }}
            disabled={stopped || generating}
          >
            清空草稿
          </Button>
        </div>
      </Section>
      <Section title="历史回访" subtitle={records.length + " 次沟通记录"}>
        {!records.length ? (
          <Empty
            icon={PhoneCall}
            title="尚未记录回访"
            description="每一次沟通，都是理解学生的新线索。"
          />
        ) : (
          records.map((r) => (
            <details className="record-card" key={r.id}>
              <summary>
                <strong>
                  {r.date} · {r.purpose || "家长回访"}
                </strong>
                <Badge>下次 {r.nextDate || addDays(r.date, 14)}</Badge>
              </summary>
              {fields
                .filter(([k]) => r[k])
                .map(([k, l]) => (
                  <div key={k}>
                    <div className="followup-field-heading">
                      <h4>{l}</h4>
                      <CopyButton text={r[k]} ariaLabel={"复制历史" + l} />
                    </div>
                    <Markdown>{r[k]}</Markdown>
                  </div>
                ))}
              <div className="button-row">
                <CopyButton
                  text={fields
                    .map(([k, l]) => l + "：" + (r[k] || ""))
                    .join("\n")}
                />
                <Button
                  disabled={stopped || generating}
                  icon={Pencil}
                  onClick={() => {
                    setForm(r);
                    document
                      .querySelector(".followup-detail")
                      ?.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  编辑
                </Button>
                <Button
                  disabled={stopped || generating}
                  icon={Trash2}
                  onClick={() => setRemove(r)}
                >
                  删除
                </Button>
              </div>
            </details>
          ))
        )}
      </Section>
      {pendingFields && (
        <Modal
          title="预览回访整理结果"
          onClose={() => setPendingFields(null)}
          wide
        >
          <div className="info-banner">
            当前表单已有内容。确认后将替换下方九项，摘要未提及的项目会清空；回访日期、下次联系日期和已保存的历史不变。
          </div>
          {fields.map(([key, label]) => (
            <div className="summary-preview-field" key={key}>
              <h4>{label}</h4>
              <p>{pendingFields[key] || "（摘要未提及，将留空）"}</p>
            </div>
          ))}
          <footer>
            <Button onClick={() => setPendingFields(null)}>保留原草稿</Button>
            <Button
              variant="primary"
              disabled={stopped}
              onClick={() => {
                setForm((f) => ({ ...f, ...pendingFields }));
                setPendingFields(null);
                notify("九项回访内容已替换，请核对后保存");
              }}
            >
              替换并填入九项
            </Button>
          </footer>
        </Modal>
      )}
      {remove && (
        <Confirm
          title="删除回访记录"
          description="删除后将根据剩余有效回访重新计算联系提醒。"
          onClose={() => setRemove(null)}
          onConfirm={() =>
            mutate((d) => ({
              ...d,
              followups: d.followups.filter((r) => r.id !== remove.id),
            }))
          }
        />
      )}
    </div>
  );
}
export default function Followups() {
  const { data } = useApp();
  const [view, setView] = useView("followups", {
    selected: "",
    query: "",
    filter: "due",
  });
  const active = data.students.filter((s) => s.status !== "已停课");
  const getState = (s) =>
    followupState(
      data.followups.filter((f) => f.studentId === s.id),
      today(),
      s.status === "已停课",
    );
  const due = active.filter((s) => getState(s).due),
    overdue = active.filter(
      (s) => getState(s).label === "已逾期" || getState(s).label === "从未回访",
    ),
    week = active.filter(
      (s) => getState(s).delta >= 0 && getState(s).delta <= 7,
    );
  const students = data.students
    .filter(
      (s) =>
        studentMatches(s, view.query, data.schools) &&
        (view.filter === "all" ||
          (s.status !== "已停课" &&
            (view.filter === "due"
              ? getState(s).due
              : view.filter === "overdue"
                ? getState(s).label === "已逾期" ||
                  getState(s).label === "从未回访"
                : getState(s).label === "已安排"))),
    )
    .sort((a, b) => (getState(a).delta ?? -999) - (getState(b).delta ?? -999));
  const selected = data.students.find((s) => s.id === view.selected);
  const change = (k, v) => setView((x) => ({ ...x, [k]: v }));
  return (
    <div className="page">
      <PageHeader
        title="回访管理"
        eyebrow="STAY CONNECTED"
        description="好的沟通，让课堂之外的支持持续发生。"
      />
      <div className="followup-layout">
        <aside className="panel followup-sidebar">
          <div className="mini-stats">
            <div>
              <PhoneCall size={17} />
              <b>{due.length}</b>
              <span>优先联系</span>
            </div>
            <div>
              <AlertCircle size={17} />
              <b>{overdue.length}</b>
              <span>逾期 / 未联系</span>
            </div>
            <div>
              <CalendarClock size={17} />
              <b>{week.length}</b>
              <span>未来 7 天</span>
            </div>
          </div>
          <SearchBox
            value={view.query}
            onChange={(v) => change("query", v)}
            placeholder="搜索姓名、年级、电话…"
          />
          <div className="filter-pills">
            {[
              ["due", "需联系"],
              ["overdue", "逾期"],
              ["scheduled", "已安排"],
              ["all", "全部"],
            ].map(([k, l]) => (
              <button
                className={view.filter === k ? "active" : ""}
                key={k}
                onClick={() => change("filter", k)}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="followup-students">
            {!students.length ? (
              <Empty icon={Users} title="当前没有待联系学生" />
            ) : (
              students.map((s) => {
                const state = getState(s);
                return (
                  <button
                    className={
                      "followup-student " +
                      (s.id === view.selected ? "selected" : "")
                    }
                    key={s.id}
                    onClick={() => change("selected", s.id)}
                  >
                    <div>
                      <Avatar student={s} />
                      <span className="grow">
                        <strong>{s.name}</strong>
                        <small>
                          {s.grade || "年级待补充"} · {s.phone || "电话待补充"}
                        </small>
                      </span>
                      <Badge type={state.type}>{state.label}</Badge>
                    </div>
                    <p>
                      上次 {state.last || "未联系"}
                      <span>下次 {state.next || "尽快安排"}</span>
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </aside>
        {selected ? (
          <Detail key={selected.id} student={selected} />
        ) : (
          <div className="panel">
            <Empty
              icon={PhoneCall}
              title="从一次关心开始"
              description="选择学生，查看回访提醒、准备话术并记录沟通。"
            />
          </div>
        )}
      </div>
    </div>
  );
}
