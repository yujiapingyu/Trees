import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Plus,
  X,
  LoaderCircle,
  FolderOpen,
  FileText,
  ChevronRight,
  Copy,
  Check,
  AlertTriangle,
  Inbox,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useApp } from "../shared/store";
import { services, desktop } from "../shared/services";
export function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      <Icon size={17} />
    </button>
  );
}
export function Button({
  children,
  icon: Icon,
  variant = "",
  busy = false,
  ...props
}) {
  return (
    <button
      className={"button " + variant}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy ? (
        <LoaderCircle className="spin" size={16} />
      ) : (
        Icon && <Icon size={16} />
      )}
      <span>{children}</span>
    </button>
  );
}
export function Badge({ children, type = "muted" }) {
  return <span className={"badge " + type}>{children}</span>;
}
export function SearchBox({
  value,
  onChange,
  placeholder = "搜索…",
  onKeyDown,
}) {
  return (
    <label className="search">
      <Search size={17} />
      <input
        aria-label={placeholder}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="清空搜索" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </label>
  );
}
export function Empty({
  icon: Icon = Inbox,
  title = "还没有内容",
  description,
  action,
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={28} strokeWidth={1.4} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function ErrorBox({ message, retry }) {
  return (
    <div role="alert" className="error-box">
      <AlertTriangle size={17} />
      <span>{message}</span>
      {retry && <button onClick={retry}>重试</button>}
    </div>
  );
}
export function Loading({ text = "正在读取本地资料…" }) {
  return (
    <div className="loading">
      <LoaderCircle size={20} className="spin" />
      {text}
    </div>
  );
}
export function Markdown({ children }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
export function Field({ label, children, hint }) {
  const annotate = (node) => {
    if (!React.isValidElement(node)) return node;
    const native = ["input", "select", "textarea"].includes(node.type);
    if (native)
      return React.cloneElement(node, {
        "aria-label": node.props["aria-label"] || label,
      });
    if (node.type === Editor)
      return React.cloneElement(node, { "aria-label": label });
    return node.props.children
      ? React.cloneElement(
          node,
          {},
          React.Children.map(node.props.children, annotate),
        )
      : node;
  };
  return (
    <div className="field">
      <span>{label}</span>
      {React.Children.map(children, annotate)}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  const previous = useRef(document.activeElement);
  useEffect(() => {
    const el = ref.current;
    const focusable = () =>
      [...el.querySelectorAll("button,input,select,textarea,a[href]")].filter(
        (e) => !e.disabled,
      );
    focusable()[0]?.focus();
    const handle = (e) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const list = focusable(),
          first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous.current?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
      >
        <header>
          <h2>{title}</h2>
          <IconButton icon={X} label="关闭弹窗" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
export function Confirm({
  title = "确认删除",
  description,
  name,
  onConfirm,
  onClose,
}) {
  const [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={title} onClose={() => !busy && onClose()}>
      <p>{description}</p>
      {name && (
        <Field label={"请输入“" + name + "”以确认"}>
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      )}
      {error && <ErrorBox message={error} />}
      <footer>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button
          variant="danger"
          disabled={name && name !== value}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          确认执行
        </Button>
      </footer>
    </Modal>
  );
}
export function CopyButton({ text, label = "复制" }) {
  const { run } = useApp();
  const [done, setDone] = useState(false);
  return (
    <Button
      icon={done ? Check : Copy}
      onClick={() =>
        run(async () => {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        })
      }
    >
      {done ? "已复制" : label}
    </Button>
  );
}
export function Section({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={"card " + className}>
      <div className="section-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Tabs({ items, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => {
        const key = typeof item === "string" ? item : item.key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={value === key}
            className={value === key ? "active" : ""}
            onClick={() => onChange(key)}
          >
            {typeof item === "string" ? item : item.label}
          </button>
        );
      })}
    </div>
  );
}
export function PageHeader({ eyebrow, title, description, children }) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow">{eyebrow || "TEACHING WORKSPACE"}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}
export function FileItem({ file, onOpen, action }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    setMissing(false);
    if (desktop && file.path)
      services
        .check(file.path)
        .then((r) => live && setMissing(!r.readable))
        .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [file.path]);
  return (
    <div className="file-row">
      <button onClick={() => onOpen(file)} className="file-main">
        <span className={"file-icon " + (file.isDirectory ? "folder" : "")}>
          {file.isDirectory ? <FolderOpen size={20} /> : <FileText size={20} />}
        </span>
        <span>
          <strong>
            {file.name}
            {missing && <span className="text-danger"> · 路径失效</span>}
          </strong>
          <small>{file.relativePath || file.path}</small>
        </span>
        {file.isDirectory && <ChevronRight size={16} />}
      </button>
      {action}
    </div>
  );
}
export function Editor({
  value,
  onChange,
  placeholder = "",
  rows = 7,
  "aria-label": label,
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button
          className={!preview ? "selected" : ""}
          onClick={() => setPreview(false)}
        >
          编辑
        </button>
        <button
          className={preview ? "selected" : ""}
          onClick={() => setPreview(true)}
        >
          预览
        </button>
        <small>Markdown · LaTeX</small>
      </div>
      {preview ? (
        <div className="editor-preview">
          <Markdown>{value || "*暂无内容*"}</Markdown>
        </div>
      ) : (
        <textarea
          aria-label={label || placeholder || "Markdown 正文"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
        />
      )}
    </div>
  );
}
export function Progress({ stage, detail }) {
  return (
    <div className="progress">
      <LoaderCircle className="spin" size={18} />
      <div>
        <strong>{stage}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}
