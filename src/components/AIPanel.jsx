import React, { useRef, useState } from "react";
import { Sparkles, Square, Trash2, Send, ArrowRight } from "lucide-react";
import { useApp } from "../shared/store";
import { id, safeStudentContext } from "../shared/domain";
import { services } from "../shared/services";
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
  const { data, config, run } = useApp();
  const [messages, setMessages] = useState([]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef("");
  const send = async (text) => {
    if (!text.trim() || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");
    request.current = id();
    try {
      const result = await services.ai({
        id: request.current,
        messages: [
          {
            role: "user",
            content:
              "当前学生上下文：" +
              JSON.stringify(safeStudentContext(student, data)),
          },
          ...next,
        ],
      });
      setMessages([...next, { role: "assistant", content: result.text }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={student.name + " · AI 教学助手"}
      onClose={() => {
        if (busy) services.cancelAI(request.current);
        onClose();
      }}
      wide
    >
      <div className="assistant-info">
        <Sparkles size={18} />
        <span>仅使用当前学生的可用教学记录</span>
        <Badge type={config.deepseekKey ? "success" : "warning"}>
          {config.deepseekKey
            ? config.deepseekModel || "DeepSeek"
            : "请先配置 API Key"}
        </Badge>
      </div>
      <div className="chat-messages">
        {!messages.length ? (
          <div className="suggestions">
            <p>从教学记录出发，找到下一步。</p>
            {[
              "总结这位学生近期的学习情况",
              "根据错题提出下一次课的建议",
              "整理下次家长沟通要点",
            ].map((s) => (
              <button key={s} onClick={() => send(s)}>
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
              {m.role === "assistant" && <CopyButton text={m.content} />}
            </div>
          ))
        )}
      </div>
      {error && <ErrorBox message={error} />}
      <div className="chat-input">
        <textarea
          aria-label="向助手提问"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入问题，结合当前学生记录分析…"
        />
        <div>
          <Button icon={Trash2} disabled={busy} onClick={() => setMessages([])}>
            清空
          </Button>
          {busy ? (
            <Button
              icon={Square}
              onClick={() => services.cancelAI(request.current)}
            >
              取消请求
            </Button>
          ) : (
            <Button
              icon={Send}
              variant="primary"
              disabled={!config.deepseekKey || !input.trim()}
              onClick={() => send(input)}
            >
              发送
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
