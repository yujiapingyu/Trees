import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { useApp } from "../shared/store";
import { services } from "../shared/services";
import {
  buildSearchIndex,
  searchIndex,
  SEARCH_TYPES,
} from "../shared/globalSearch";
import { Modal, Button, Badge, Empty, ErrorBox } from "./UI";

const ROOT_LABELS = {
  lessonsRoot: "讲义",
  examsRoot: "考试",
  referenceJunior: "初中教辅",
  referenceSenior: "高中教辅",
  referenceVocational: "中职教辅",
  textbooksJunior: "初中教材",
  textbooksSenior: "高中教材",
  planningJunior: "初中规划",
  planningSenior: "高中规划",
  exercisesJunior: "初中练习",
  exercisesSenior: "高中练习",
  booksRoot: "书籍",
  videosRoot: "视频",
};
export default function GlobalSearch({ open, onClose, onOpen }) {
  const { data, config } = useApp();
  const inputRef = useRef(null);
  const scanVersion = useRef(0);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [active, setActive] = useState(0);
  const [files, setFiles] = useState([]),
    [busy, setBusy] = useState(false),
    [warning, setWarning] = useState("");
  const configKey = JSON.stringify(
    Object.keys(ROOT_LABELS).map((k) => config[k]),
  );
  useEffect(() => {
    scanVersion.current++;
    setFiles([]);
    setWarning("");
    setBusy(false);
  }, [configKey]);
  const index = useMemo(
    () => (open ? buildSearchIndex(data, files) : []),
    [open, data, files],
  );
  const results = useMemo(
    () => searchIndex(index, query, kind, 81),
    [index, query, kind],
  );
  useEffect(() => setActive(0), [query, kind]);
  useEffect(() => {
    document
      .querySelector('[data-search-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const scan = async () => {
    const version = ++scanVersion.current;
    setBusy(true);
    setWarning("");
    const roots = [
      ...new Map(
        Object.entries(ROOT_LABELS)
          .filter(([k]) => config[k])
          .map(([k, label]) => [config[k], label]),
      ).entries(),
    ];
    const all = await Promise.allSettled(
      roots.map(async ([root, label]) =>
        (await services.list(root, true))
          .filter((f) => !f.isDirectory)
          .map((f) => ({ ...f, rootLabel: label })),
      ),
    );
    if (version !== scanVersion.current) return;
    setFiles([
      ...new Map(
        all
          .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
          .map((f) => [f.path, f]),
      ).values(),
    ]);
    const failed = all.flatMap((r, i) =>
      r.status === "rejected" ? [roots[i][1]] : [],
    );
    setWarning(
      !roots.length
        ? "请先在配置中心设置资源目录。"
        : failed.length
          ? failed.join("、") + "目录暂不可读，其余结果可正常搜索。"
          : "",
    );
    setBusy(false);
  };
  if (!open) return null;
  return (
    <Modal title="全局搜索" onClose={onClose} wide>
      <div className="global-search-input">
        <Search size={20} />
        <input
          ref={inputRef}
          aria-label="全局搜索内容"
          placeholder="学生姓名、拼音、知识点、考试或记录内容…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((n) =>
                Math.max(
                  0,
                  Math.min(
                    Math.min(results.length, 80) - 1,
                    n + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              onOpen(results[active]);
            }
          }}
        />
      </div>
      <div className="search-controls">
        <select
          aria-label="搜索类别"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">全部类别</option>
          {SEARCH_TYPES.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <Button icon={RefreshCw} busy={busy} onClick={scan}>
          刷新资源文件名
        </Button>
        <small>
          {files.length
            ? `已索引 ${files.length} 个文件名`
            : "业务记录即时搜索；资源文件名按需加载"}
        </small>
      </div>
      <p className="form-hint">
        支持多个关键词、姓名全拼和首字母。文件只搜索名称和目录，不读取正文。↑↓
        选择，回车打开，Esc 关闭。
      </p>
      {warning && <ErrorBox message={warning} />}
      <div className="global-search-results" aria-label="搜索结果">
        {!results.length ? (
          <Empty
            title={query.trim() ? "没有匹配的结果" : "搜索整个教学工作区"}
            description={
              query.trim()
                ? "试试学生姓名、授课主题，或刷新资源文件名。"
                : "学生、讲义、考试、授课、反馈、回访和学习报告都可以查找。"
            }
          />
        ) : (
          results.slice(0, 80).map((r, i) => (
            <button
              className="global-search-result"
              data-search-active={i === active}
              key={r.key}
              onMouseEnter={() => setActive(i)}
              onClick={() => onOpen(r)}
            >
              <div>
                <Badge>{r.kind}</Badge>
                <strong>{r.title}</strong>
                <small>{r.subtitle}</small>
              </div>
              {r.snippet && <p>{r.snippet}</p>}
            </button>
          ))
        )}
      </div>
      {!!results.length && (
        <p className="form-hint">
          {results.length > 80
            ? "结果较多，显示前80条，请增加关键词缩小范围。"
            : `找到 ${results.length} 条结果`}
        </p>
      )}
    </Modal>
  );
}
