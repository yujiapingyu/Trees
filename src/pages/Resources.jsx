import React, { useState } from "react";
import { BookOpen, Layers, FolderOpen, FileSpreadsheet } from "lucide-react";
import { useApp, useView } from "../shared/store";
import { matches } from "../shared/domain";
import { services } from "../shared/services";
import {
  PageHeader,
  Button,
  Tabs,
  Empty,
  Modal,
  Field,
  SearchBox,
  ErrorBox,
  Loading,
} from "../components/UI";
import { FileBrowser } from "../components/FileBrowser";
function SheetPreview({ file, onClose }) {
  const { run } = useApp();
  const [sheets, setSheets] = useState([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [sheet, setSheet] = useState(0),
    [q, setQ] = useState(""),
    [grade, setGrade] = useState(""),
    [level, setLevel] = useState("");
  React.useEffect(() => {
    let live = true;
    services
      .sheet(file.path)
      .then((v) => live && setSheets(v))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [file.path]);
  const rows = sheets[sheet]?.rows || [],
    header = rows[0] || [];
  const gradeIndex = header.findIndex((c) => /年级/.test(String(c))),
    levelIndex = header.findIndex((c) => /程度|层次|水平/.test(String(c)));
  const filtered = rows
    .slice(1)
    .filter(
      (r) =>
        matches(r.join(" "), q) &&
        (!grade || String(r[gradeIndex]) === grade) &&
        (!level || String(r[levelIndex]) === level),
    );
  return (
    <Modal title={"规划表 · " + file.name} onClose={onClose} wide>
      <div className="filter-toolbar">
        <Field label="工作表">
          <select
            value={sheet}
            onChange={(e) => {
              setSheet(+e.target.value);
              setGrade("");
              setLevel("");
            }}
          >
            {sheets.map((s, i) => (
              <option key={i} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {[
          [gradeIndex, grade, setGrade, "年级"],
          [levelIndex, level, setLevel, "程度"],
        ]
          .filter(([i]) => i >= 0)
          .map(([idx, value, setter, label]) => (
            <Field key={label} label={label}>
              <select value={value} onChange={(e) => setter(e.target.value)}>
                <option value="">全部{label}</option>
                {[...new Set(rows.slice(1).map((r) => String(r[idx] || "")))]
                  .filter(Boolean)
                  .map((v) => (
                    <option key={v}>{v}</option>
                  ))}
              </select>
            </Field>
          ))}
        <SearchBox
          value={q}
          onChange={setQ}
          placeholder="搜索表格内容 / 拼音…"
        />
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {header.map((h, i) => (
                  <th key={i}>{String(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i}>
                  {header.map((_, j) => (
                    <td key={j}>{String(r[j] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <Empty title="没有匹配的表格内容" />}
        </div>
      )}
      <footer>
        <Button
          icon={FolderOpen}
          onClick={() => run(() => services.open(file.path))}
        >
          系统打开原文件
        </Button>
        <Button onClick={onClose}>关闭</Button>
      </footer>
    </Modal>
  );
}
export default function Resources({ books = false }) {
  const { config } = useApp();
  const [view, setView] = useView(books ? "books" : "teachingResources", {
    tab: "textbooks",
    stage: "Junior",
  });
  const [preview, setPreview] = useState(null);
  React.useEffect(() => {
    const listener = (e) => setView((v) => ({ ...v, tab: e.detail }));
    window.addEventListener("resource:tab", listener);
    return () => window.removeEventListener("resource:tab", listener);
  }, []);
  const planning = view.tab === "planning";
  const root = books
    ? config.booksRoot
    : config[(planning ? "planning" : "textbooks") + view.stage];
  return (
    <div className="page">
      <PageHeader
        title={books ? "书籍" : "教学资源"}
        eyebrow="YOUR TEACHING COLLECTION"
        description={
          books
            ? "沿用本地目录，让阅读积累随手可达。"
            : "教材与规划，各有条理，随时可用。"
        }
      />
      {!books && (
        <div className="resource-toolbar">
          <Tabs
            value={view.tab}
            onChange={(v) => setView((x) => ({ ...x, tab: v }))}
            items={[
              { key: "textbooks", label: "课本管理" },
              { key: "planning", label: "分层规划" },
            ]}
          />
          <div className="stage-switch">
            {[
              ["Junior", "初中"],
              ["Senior", "高中"],
            ].map(([k, l]) => (
              <button
                key={k}
                className={view.stage === k ? "active" : ""}
                onClick={() => setView((x) => ({ ...x, stage: k }))}
              >
                <BookOpen size={16} />
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="resource-main card">
        <div className="section-head">
          <div>
            <h3>
              {books
                ? "我的书籍"
                : (view.stage === "Junior" ? "初中" : "高中") +
                  (planning ? "分层规划" : "教材资料")}
            </h3>
            <p>
              {planning
                ? "支持 XLSX / CSV 表格预览，可按年级与程度筛选"
                : "点击文件夹浏览，点击文件用系统应用打开"}
            </p>
          </div>
        </div>
        <FileBrowser
          root={root}
          viewKey={books ? "booksBrowser" : view.tab + view.stage}
          onSelect={
            planning
              ? (f) =>
                  /\.(xlsx|csv)$/i.test(f.name)
                    ? setPreview(f)
                    : services.open(f.path)
              : undefined
          }
        />
      </div>
      {preview && (
        <SheetPreview file={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
