import { useDraft } from "../shared/drafts";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Square, Trash2, Send, ArrowRight } from "lucide-react";
import { useApp } from "../shared/store";
import { id, parseJSONResult } from "../shared/domain";
import { services, storage } from "../shared/services";
import {
  assistantContext,
  assistantMessages,
} from "../shared/assistantContext";
import { enrichTextbookContext } from "../shared/planningContext";
import {
  ActionClarification,
  isAssistantActionRequest,
  prepareAssistantAction,
  assistantActionPrompt,
  executeAssistantActions,
  undoAssistantAction,
  followupListResult,
  actionReceiptSources,
} from "../shared/assistantActions";
import { buildSearchIndex, searchIndex } from "../shared/globalSearch";
import {
  Modal,
  Button,
  Editor,
  ErrorBox,
  Markdown,
  CopyButton,
  Badge,
} from "./UI";
export function AIAction({
  label = "AI 生成",
  task,
  onResult,
  disabled = false,
  extra = {},
  variant = "",
}) {
  const { run } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      icon={Sparkles}
      variant={variant}
      disabled={disabled}
      busy={busy}
      onClick={() =>
        run(async () => {
          setBusy(true);
          try {
            const result = await services.ai({
              id: id(),
              task: typeof task === "function" ? await task() : task,
              ...extra,
            });
            await onResult(result.text, result.model);
          } finally {
            setBusy(false);
          }
        })
      }
    >
      {label}
    </Button>
  );
}
export function Assistant({ student, onClose }) {
  const { data, config } = useApp();
  const [scope, setScope] = useDraft("global-assistant-scope-v2", "workspace");
  const activeScope =
    student?.id ||
    (scope === "workspace" ||
    scope === "general" ||
    scope === "overview" ||
    scope === "resources" ||
    data.students.some((s) => s.id === scope)
      ? scope
      : "workspace");
  return (
    <Modal
      title={student ? student.name + " · AI 教学助手" : "AI 教学助手"}
      onClose={onClose}
      wide
    >
      {!student && (
        <label className="assistant-scope">
          使用的资料范围
          <select
            aria-label="助手资料范围"
            value={activeScope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="workspace">工作区 · 查找与办事</option>
            <option value="general">教学通用 · 不使用学生记录</option>
            <option value="overview">工作台概览 · 数量与待回访名单</option>
            <option value="resources">讲义与考试目录 · 查找与选材建议</option>
            {data.students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.grade || "未设置年级"}
                {s.status === "已停课" ? " · 已停课" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="assistant-info">
        <Sparkles size={18} />
        <span>
          {activeScope === "workspace"
            ? "按指令查找资料、办理学生事务"
            : activeScope === "general"
              ? "通用教学建议"
              : activeScope === "overview"
                ? "只使用工作台统计与待回访名单"
                : activeScope === "resources"
                  ? "只使用已登记讲义、考试的目录信息"
                  : "仅使用所选学生记录、浙江教材与进度"}
        </span>
        <Badge type={config.deepseekKey ? "success" : "warning"}>
          {config.deepseekKey
            ? config.deepseekModel || "DeepSeek"
            : "请先配置 API Key"}
        </Badge>
      </div>
      <p className="form-hint">
        点击发送后，所选范围的资料摘要会交给已配置的 AI
        服务。工作区和学生助手可按你的明确指令保存记录、引用资料、安排回访；每次办理都有回执和撤销入口。
      </p>
      <AssistantChat key={activeScope} scope={activeScope} onClose={onClose} />
    </Modal>
  );
}
function AssistantChat({ scope, onClose }) {
  const { data, config, mutate } = useApp();
  const [messages, setMessages] = useDraft(
    "assistant:" + scope + ":messages",
    [],
  );
  const [input, setInput] = useDraft("assistant:" + scope + ":input", "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(""),
    live = useRef(true),
    sending = useRef(false),
    cancelled = useRef(false),
    end = useRef(null);
  const [hint, setHint] = useState({});
  useEffect(() => {
    let active = true;
    (async () => {
      const route = await storage.get("sm_view_state_route", "students");
      const view = await storage.get("sm_view_state_" + route, {});
      if (active)
        setHint(
          route === "students"
            ? { studentId: view.selected }
            : route === "exams"
              ? { examId: view.selected }
              : route === "lessonLibrary"
                ? { lessonId: view.selected }
                : {},
        );
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const receipts = Object.values(data.assistantActions || {})
    .filter((r) => scope === "workspace" || r.studentIds.includes(scope))
    .slice(-10)
    .reverse();
  const undo = async (operationId) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      await mutate((d) => undoAssistantAction(d, operationId), { quiet: true });
      if (live.current)
        setMessages((ms) => [
          ...ms,
          {
            role: "assistant",
            content: "已撤销该次办理，后续独立修改的内容仍保留。",
            receiptId: operationId,
          },
        ]);
    } catch (e) {
      if (live.current) setError(e.message);
    } finally {
      sending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const index = useMemo(() => buildSearchIndex(data), [data]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (request.current) services.cancelAI(request.current);
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);
  const send = async (text, selected = null) => {
    if (!text.trim() || sending.current) return;
    if (text.length > 6000) {
      setError("问题请控制在6000字以内");
      return;
    }
    sending.current = true;
    cancelled.current = false;
    const question = text.trim(),
      history = messages;
    const next = [
      ...history,
      {
        role: "user",
        content: selected ? "选择：" + selected.label : question,
      },
    ];
    const bundle = assistantContext(data, scope, question, index);
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");
    request.current = id();
    try {
      if (isAssistantActionRequest(question)) {
        const choice = selected?.choice || {},
          operationId = selected?.operationId || id();
        try {
          const { authority, catalog } = prepareAssistantAction(
            data,
            config,
            scope,
            question,
            hint,
            choice,
          );
          const writes = authority.allowed.filter(
            (t) => !["undo", "search", "list_followups"].includes(t),
          );
          let reply;
          if (authority.allowed.includes("undo") && !writes.length) {
            const receipt = receipts.find(
              (r) =>
                !r.undoneAt &&
                (!authority.explicit ||
                  r.studentIds.every((s) => authority.studentIds.includes(s))),
            );
            if (!receipt) throw Error("没有符合本次范围的可撤销操作");
            await mutate((d) => undoAssistantAction(d, receipt.id), {
              quiet: true,
            });
            reply = { content: "已撤销上一次办理。", receiptId: receipt.id };
          } else if (
            authority.allowed.includes("list_followups") &&
            !writes.length
          ) {
            const result = followupListResult(data, authority, question);
            reply = { content: result.text, sources: result.sources };
          } else if (authority.allowed.includes("search") && !writes.length) {
            const query = question
              .replace(/请|帮我|查找|搜索|找一下|找出|讲义|试卷|考试|的/g, " ")
              .trim();
            const rows = searchIndex(
              index.filter(
                (r) =>
                  scope === "workspace" ||
                  (scope === "resources" &&
                    ["讲义", "考试"].includes(r.kind)) ||
                  r.studentId === scope,
              ),
              query,
              "",
              15,
            );
            reply = {
              content: rows.length
                ? "找到以下相关资料，点击来源可直接打开：\n\n" +
                  rows
                    .map(
                      (r, i) =>
                        i +
                        1 +
                        "、" +
                        r.kind +
                        " · " +
                        r.title +
                        " · " +
                        r.subtitle,
                    )
                    .join("\n")
                : "没有找到匹配记录，可尝试学生姓名或资料名称。",
              sources: rows.map((r, i) => ({
                ...r,
                body: undefined,
                ref: "S" + (i + 1),
              })),
            };
          } else {
            if (!writes.length)
              throw Error(
                "请明确说明要引用资料、登记记录、安排回访或标记作业。",
              );
            if (!config.deepseekKey)
              throw Error("请先在配置中心设置 AI 服务，再使用自然语言办事");
            const result = await services.ai({
              id: request.current,
              task: assistantActionPrompt(question, authority, catalog),
              json: true,
              maxTokens: 4096,
            });
            if (!live.current || cancelled.current)
              throw Error("请求已取消，未执行");
            const plan = parseJSONResult(result.text);
            const updated = await mutate(
              (d) => {
                if (!live.current || cancelled.current)
                  throw Error("请求已取消，未执行");
                return executeAssistantActions(
                  d,
                  plan,
                  {
                    question,
                    scope,
                    config,
                    hint,
                    choice,
                    operationId,
                  },
                  { quiet: true },
                );
              },
              { quiet: true },
            );
            const receipt = updated.assistantActions[operationId];
            reply = {
              content: "已办理：\n\n" + receipt.lines.join("\n\n"),
              receiptId: operationId,
              sources: actionReceiptSources(updated, receipt),
            };
          }
          if (live.current)
            setMessages([...next, { role: "assistant", ...reply }]);
        } catch (e) {
          if (e instanceof ActionClarification) {
            if (live.current)
              setMessages([
                ...next,
                {
                  role: "assistant",
                  content: e.message,
                  pending: {
                    question,
                    operationId,
                    choice,
                    choices: e.choices,
                  },
                },
              ]);
          } else throw e;
        }
        return;
      }
      if (!config.deepseekKey) throw Error("请先配置 AI 服务");
      const selectedStudent = data.students.find((s) => s.id === scope);
      if (
        selectedStudent &&
        /教材|进度|规划|节课|排课|同步|复习/.test(question)
      ) {
        const textbooks = await enrichTextbookContext(
          {},
          selectedStudent.grade,
          config,
          () => {
            if (!live.current || cancelled.current) throw Error("请求已取消");
          },
        );
        bundle.context.localTextbooks = textbooks;
      }
      if (!live.current || cancelled.current) throw Error("请求已取消");
      const result = await services.ai({
        id: request.current,
        messages: assistantMessages(bundle, history, question),
        maxTokens: 8192,
      });
      if (live.current)
        setMessages([
          ...next,
          {
            role: "assistant",
            content: result.text,
            sources: bundle.sources.map(
              ({ key, ref, title, kind, date, target }) => ({
                key,
                ref,
                title,
                kind,
                date,
                target,
              }),
            ),
            model: result.model,
          },
        ]);
    } catch (e) {
      if (live.current) {
        setError(e.message);
        setInput(question);
      }
    } finally {
      request.current = "";
      sending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const suggestions =
    scope === "workspace"
      ? ["整理本周需要回访的学生", "搜索对数讲义"]
      : scope === "general"
        ? [
            "给我设计一节浙教新版初中数学的分层教学思路",
            "如何区分学校进度和个别辅导进度？",
            "写一份具体、自然的家长沟通提纲",
          ]
        : scope === "overview"
          ? [
              "今天有哪些学生需要回访？按紧急程度整理",
              "根据工作台概览，给我安排今天的工作",
            ]
          : scope === "resources"
            ? [
                "帮我找适合对数复习的讲义，说明推荐依据",
                "整理近期考试资料，并提示哪些资料还需核对",
              ]
            : [
                "总结这位学生近期的学习情况，指出依据",
                "结合浙江教材、学校进度和辅导记录，安排接下来15节课",
                "用我的第一人称整理下次家长沟通要点",
              ];
  return (
    <>
      <div className="chat-messages">
        {!messages.length ? (
          <div className="suggestions">
            <p>
              {scope === "workspace"
                ? "直接说要办的事。例如：给张三引用对数讲义；下周五回访李四；给张三记一条观察：计算需要检查符号。"
                : "从已有信息出发，得到建议，也可直接安排学生事务。"}
            </p>
            {suggestions.map((s) => (
              <button key={s} disabled={busy} onClick={() => send(s)}>
                {s}
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div className={"chat-message " + m.role} key={i}>
              <small>{m.role === "user" ? "你" : "教学助手"}</small>
              <Markdown>{m.content}</Markdown>
              {m.role === "assistant" && (
                <>
                  <CopyButton text={m.content} />
                  {m.receiptId && data.assistantActions?.[m.receiptId] && (
                    <div className="assistant-receipt">
                      <Badge
                        type={
                          data.assistantActions[m.receiptId].undoneAt
                            ? "muted"
                            : "success"
                        }
                      >
                        {data.assistantActions[m.receiptId].undoneAt
                          ? "已撤销"
                          : "已保存"}
                      </Badge>
                      {!data.assistantActions[m.receiptId].undoneAt && (
                        <Button
                          disabled={busy}
                          onClick={() => undo(m.receiptId)}
                        >
                          撤销这次操作
                        </Button>
                      )}
                    </div>
                  )}
                  {m.pending && !m.pending.choices?.length && (
                    <Button
                      disabled={busy}
                      onClick={() => setInput(m.pending.question)}
                    >
                      补全原指令
                    </Button>
                  )}
                  {!!m.pending?.choices?.length && (
                    <div className="button-row">
                      {m.pending.choices.map((c, j) => (
                        <Button
                          key={j}
                          disabled={busy}
                          onClick={() =>
                            send(m.pending.question, {
                              label: c.label,
                              operationId: m.pending.operationId,
                              choice: { ...m.pending.choice, ...c.selection },
                            })
                          }
                        >
                          {c.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {!!m.sources?.length && (
                    <details className="assistant-sources">
                      <summary>
                        {m.receiptId ? "打开办理结果" : "本次参考资料"}（
                        {m.sources.length}）
                      </summary>
                      {m.sources.map((s) => (
                        <button
                          key={s.key}
                          onClick={() => {
                            onClose();
                            window.dispatchEvent(
                              new CustomEvent("workspace:open", { detail: s }),
                            );
                          }}
                        >
                          [{s.ref}] {s.kind} · {s.title}
                          {s.date ? " · " + s.date : ""}
                        </button>
                      ))}
                    </details>
                  )}
                </>
              )}
            </div>
          ))
        )}
        {busy && (
          <p role="status" className="form-hint">
            正在结合资料整理回答…
          </p>
        )}
        <div ref={end} />
      </div>
      {!!receipts.length && (
        <details className="assistant-recent-actions">
          <summary>最近办理记录（{receipts.length}）</summary>
          {receipts.map((r) => (
            <div key={r.id} className="assistant-receipt">
              <div className="grow">
                <small>{new Date(r.createdAt).toLocaleString("zh-CN")}</small>
                <p>{r.lines.join(" ")}</p>
              </div>
              {r.undoneAt ? (
                <Badge>已撤销</Badge>
              ) : (
                <Button disabled={busy} onClick={() => undo(r.id)}>
                  撤销这次操作
                </Button>
              )}
            </div>
          ))}
        </details>
      )}
      {error && <ErrorBox message={error} />}
      <div className="chat-input">
        <textarea
          aria-label="向助手提问"
          maxLength={6000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入问题或办事指令…⌘/Ctrl + 回车发送"
          onKeyDown={(e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter" &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <div>
          <Button
            icon={Trash2}
            disabled={busy}
            onClick={() => {
              setMessages([]);
              setError("");
            }}
          >
            清空
          </Button>
          {busy ? (
            <Button
              icon={Square}
              onClick={() => {
                cancelled.current = true;
                services.cancelAI(request.current);
              }}
            >
              取消请求
            </Button>
          ) : (
            <Button
              icon={Send}
              variant="primary"
              disabled={!input.trim()}
              onClick={() => send(input)}
            >
              发送
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
