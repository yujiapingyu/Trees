import React, { useState, useRef, useEffect } from "react";
import {
  Plus,
  BookOpen,
  FileText,
  FolderOpen,
  Save,
  Pencil,
  Sparkles,
  RefreshCw,
  Square,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { useApp, useView } from "../shared/store";
import { services, basename, parent } from "../shared/services";
import {
  id,
  validateName,
  validatePair,
  validateQuestions,
  matches,
} from "../shared/domain";
import { importBank } from "../shared/questionPipeline";
import {
  PageHeader,
  Button,
  SearchBox,
  Badge,
  Section,
  Empty,
  Modal,
  Field,
  ErrorBox,
  Progress,
  Markdown,
  Editor,
  Confirm,
} from "../components/UI";
function LocalImage({ path }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    services
      .mediaURL(path)
      .then((v) => live && setSrc(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  return src ? (
    <img className="question-figure" src={src} alt="题目图形" />
  ) : (
    <small className="muted">图片不可用：{path}</small>
  );
}
export default function QuestionBank() {
  const { data, config, mutate, run } = useApp();
  const [view, setView] = useView("questionBank", {
    selected: "",
    query: "",
    category: "",
    difficulty: "",
  });
  const [form, setForm] = useState(null),
    [bank, setBank] = useState(null),
    [questions, setQuestions] = useState([]),
    [edit, setEdit] = useState(null),
    [stage, setStage] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [remove, setRemove] = useState(null);
  const request = useRef(""),
    cancelled = useRef(false),
    stageRef = useRef("");
  const change = (k, v) => setView((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    let live = true;
    setBank(null);
    setQuestions([]);
    setDirty(false);
    setError("");
    const index = data.banks.find((b) => b.id === view.selected);
    if (index)
      services
        .readText(index.path)
        .then((text) => {
          const b = JSON.parse(text);
          b.questions = validateQuestions(b.questions);
          if (live) {
            setBank(b);
            setQuestions(b.questions);
          }
        })
        .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [view.selected]);
  const importFiles = async () => {
    setError("");
    cancelled.current = false;
    stageRef.current = "";
    try {
      validateName(form.name);
      validatePair(form.mode, form.original, form.answer);
      if (!config.questionBankRoot) throw Error("请先配置题库根目录");
      if (!config.qwenKey || !config.deepseekKey)
        throw Error("请先配置千问与 DeepSeek API Key");
      stageRef.current = "读取文档与转换页面";
      setStage(stageRef.current);
      const result = await importBank({
        form: { ...form, root: config.questionBankRoot },
        progress: (value) => {
          stageRef.current = value;
          setStage(value);
        },
        request,
        checkCancel: () => {
          if (cancelled.current)
            throw Error(
              "导入已取消。已写入的页面图片保留，未完成题库不会加入索引。",
            );
        },
      });
      await mutate((d) => ({
        ...d,
        banks: [
          ...d.banks,
          {
            id: result.id,
            name: result.name,
            path: result.path,
            count: result.questions.length,
          },
        ],
      }));
      setForm(null);
      change("selected", result.id);
    } catch (e) {
      setError((stageRef.current ? stageRef.current + "：" : "") + e.message);
    } finally {
      setStage("");
    }
  };
  const scan = () =>
    run(async () => {
      if (!config.questionBankRoot) throw Error("请先配置题库目录");
      const files = await services.list(config.questionBankRoot, true);
      const found = [];
      for (const f of files.filter((f) => f.name === "questions.json")) {
        const b = JSON.parse(await services.readText(f.path));
        validateQuestions(b.questions);
        found.push({
          id: b.id || f.path,
          name: b.name || basename(parent(f.path)),
          path: f.path,
          count: b.questions.length,
        });
      }
      await mutate((d) => ({ ...d, banks: found }));
    }, "题库索引已刷新");
  const visible = questions.filter(
    (q) =>
      matches(q.stem + " " + (q.tags || []).join(" "), view.query) &&
      (!view.category || q.category === view.category) &&
      (!view.difficulty || q.difficulty === view.difficulty),
  );
  return (
    <div className="page">
      <PageHeader
        title="数学题库"
        eyebrow="QUESTION STUDIO"
        description="识别、校对、归档，让每一道题都有清晰的来处。"
      >
        <Button icon={RefreshCw} onClick={scan}>
          扫描题库
        </Button>
        <Button
          variant="primary"
          icon={Plus}
          disabled={!!stage}
          onClick={() => {
            setError("");
            setForm({ name: "", mode: "paired", original: "", answer: "" });
          }}
        >
          导入试卷
        </Button>
      </PageHeader>
      <div className="questionbank-layout">
        <aside className="panel bank-sidebar">
          <div className="panel-heading">
            <h2>
              专题索引 <span>{data.banks.length}</span>
            </h2>
          </div>
          {!data.banks.length ? (
            <Empty
              icon={BookOpen}
              title="暂无本地题库"
              description="导入试卷或扫描已有题库目录。"
            />
          ) : (
            data.banks.map((b) => (
              <button
                key={b.id}
                className={
                  "bank-item " + (b.id === view.selected ? "selected" : "")
                }
                onClick={() => {
                  if (dirty) {
                    setRemove({ switchTo: b.id });
                    return;
                  }
                  change("selected", b.id);
                }}
              >
                <BookOpen size={19} />
                <span>
                  <strong>{b.name}</strong>
                  <small>{b.count} 道题目</small>
                </span>
              </button>
            ))
          )}
        </aside>
        <div className="panel scroll-pane">
          {error && !form && <ErrorBox message={error} />}
          {bank ? (
            <>
              <div className="bank-title">
                <div>
                  <h2>{bank.name}</h2>
                  <small>
                    {questions.length} 道题 ·{" "}
                    {dirty ? "有未保存的修改" : "已保存至本地 JSON"}
                  </small>
                </div>
                <Button
                  icon={FolderOpen}
                  onClick={() => run(() => services.open(parent(bank.path)))}
                >
                  打开目录
                </Button>
                <Button
                  icon={Save}
                  variant="primary"
                  disabled={!dirty}
                  onClick={() =>
                    run(async () => {
                      validateQuestions(questions);
                      const updated = {
                        ...bank,
                        questions,
                        updatedAt: new Date().toISOString(),
                      };
                      await services.writeJSON(bank.path, updated, true);
                      await mutate((d) => ({
                        ...d,
                        banks: d.banks.map((b) =>
                          b.id === bank.id
                            ? { ...b, count: questions.length }
                            : b,
                        ),
                      }));
                      setBank(updated);
                      setDirty(false);
                    }, "题库已写入本地，旧文件已备份")
                  }
                >
                  保存题库
                </Button>
              </div>
              <div className="filter-toolbar">
                <SearchBox
                  value={view.query}
                  onChange={(q) => change("query", q)}
                  placeholder="搜索题干或知识点…"
                />
                <select
                  aria-label="题目类别"
                  value={view.category}
                  onChange={(e) => change("category", e.target.value)}
                >
                  <option value="">全部类别</option>
                  {[
                    ...new Set(
                      questions.map((q) => q.category).filter(Boolean),
                    ),
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select
                  aria-label="题目难度"
                  value={view.difficulty}
                  onChange={(e) => change("difficulty", e.target.value)}
                >
                  <option value="">全部难度</option>
                  {["基础", "中等", "较难"].map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
                <Button
                  icon={Plus}
                  onClick={() =>
                    setEdit({
                      id: id(),
                      number: questions.length + 1,
                      stem: "",
                      options: [],
                      answer: "",
                      explanation: "",
                      tags: [],
                      difficulty: "中等",
                      category: "未分类",
                    })
                  }
                >
                  手工添加
                </Button>
              </div>
              {visible.map((q, i) => (
                <article className="question-card" key={q.id}>
                  <div className="question-head">
                    <span className="question-number">{q.number || i + 1}</span>
                    <Badge>{q.category}</Badge>
                    <Badge type="blue">{q.difficulty}</Badge>
                    {q.uncertain && <Badge type="warning">需人工校对</Badge>}
                    <span className="spacer" />
                    <Button icon={Pencil} onClick={() => setEdit(q)}>
                      编辑
                    </Button>
                    <Button
                      icon={Trash2}
                      onClick={() => setRemove({ question: q })}
                    >
                      删除
                    </Button>
                  </div>
                  <Markdown>{q.stem}</Markdown>
                  <Markdown>
                    {Array.isArray(q.options)
                      ? q.options.join("\n\n")
                      : q.options || ""}
                  </Markdown>
                  {q.images?.map((p) => (
                    <LocalImage key={p} path={p} />
                  ))}
                  <div className="tag-list">
                    {q.tags?.map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <details>
                    <summary>答案与解析</summary>
                    <Markdown>
                      {"**答案：** " +
                        (q.answer || "待确认") +
                        "\n\n" +
                        (q.explanation || "暂无解析")}
                    </Markdown>
                    {q.sourceImage && (
                      <Button
                        onClick={() => run(() => services.open(q.sourceImage))}
                      >
                        查看原页图片
                      </Button>
                    )}
                  </details>
                </article>
              ))}
              {!visible.length && <Empty title="没有匹配题目" />}
            </>
          ) : (
            <Empty
              icon={FileText}
              title="把试卷变成可积累的题目"
              description="选择专题，或导入 DOC、DOCX、PDF 试卷进行识别。"
            />
          )}
        </div>
      </div>
      {form && (
        <Modal
          title="导入试卷到本地题库"
          onClose={() => !stage && setForm(null)}
          wide
        >
          <Field label="专题名称">
            <input
              disabled={!!stage}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="导入模式">
            <select
              disabled={!!stage}
              value={form.mode}
              onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
            >
              <option value="paired">原试题 + 解析版（双文件配对）</option>
              <option value="original">仅原试题</option>
            </select>
          </Field>
          {[
            ["original", "原试题文件"],
            ...(form.mode === "paired" ? [["answer", "对应解析版文件"]] : []),
          ].map(([k, l]) => (
            <Field key={k} label={l}>
              <div className="path-input">
                <input
                  readOnly
                  value={form[k]}
                  placeholder="选择 DOC / DOCX / PDF"
                />
                <Button
                  icon={FolderOpen}
                  disabled={!!stage}
                  onClick={() =>
                    run(async () => {
                      const p = await services.pick("file", [
                        { name: "试卷", extensions: ["doc", "docx", "pdf"] },
                      ]);
                      if (p) setForm((f) => ({ ...f, [k]: p }));
                    })
                  }
                >
                  选择
                </Button>
              </div>
            </Field>
          ))}
          <div className="info-banner">
            逐页转图 → 千问识别 → 跨页合并 / 答案配对 → DeepSeek 分类 → 本地
            JSON 与图片。DOC / DOCX 转图需 LibreOffice；不确定内容会标记待校对。
          </div>
          {stage && <Progress stage={stage} />}
          {error && <ErrorBox message={error} />}
          <footer>
            {stage ? (
              <Button
                icon={Square}
                onClick={() => {
                  cancelled.current = true;
                  services.cancelAI(request.current);
                }}
              >
                取消处理
              </Button>
            ) : (
              <Button onClick={() => setForm(null)}>取消</Button>
            )}
            <Button
              variant="primary"
              icon={Sparkles}
              busy={!!stage}
              onClick={importFiles}
            >
              开始导入
            </Button>
          </footer>
        </Modal>
      )}
      {edit && (
        <Modal title="编辑题目" onClose={() => setEdit(null)} wide>
          <Field label="题干">
            <Editor
              value={edit.stem}
              onChange={(v) => setEdit((q) => ({ ...q, stem: v }))}
            />
          </Field>
          <Field label="选项（每行一个）">
            <textarea
              value={
                Array.isArray(edit.options)
                  ? edit.options.join("\n")
                  : edit.options || ""
              }
              onChange={(e) =>
                setEdit((q) => ({ ...q, options: e.target.value.split("\n") }))
              }
            />
          </Field>
          <div className="form-grid two">
            <Field label="类别">
              <input
                value={edit.category || ""}
                onChange={(e) =>
                  setEdit((q) => ({ ...q, category: e.target.value }))
                }
              />
            </Field>
            <Field label="难度">
              <select
                value={edit.difficulty}
                onChange={(e) =>
                  setEdit((q) => ({ ...q, difficulty: e.target.value }))
                }
              >
                {["基础", "中等", "较难"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="知识点（逗号分隔）">
            <input
              value={(edit.tags || []).join(",")}
              onChange={(e) =>
                setEdit((q) => ({ ...q, tags: e.target.value.split(/[,，]/) }))
              }
            />
          </Field>
          <Field label="答案">
            <textarea
              value={edit.answer || ""}
              onChange={(e) =>
                setEdit((q) => ({ ...q, answer: e.target.value }))
              }
            />
          </Field>
          <Field label="解析">
            <Editor
              value={edit.explanation || ""}
              onChange={(v) => setEdit((q) => ({ ...q, explanation: v }))}
            />
          </Field>
          <label className="check-label">
            <input
              type="checkbox"
              checked={!edit.uncertain}
              onChange={(e) =>
                setEdit((q) => ({ ...q, uncertain: !e.target.checked }))
              }
            />
            已人工校对
          </label>
          <footer>
            <Button onClick={() => setEdit(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={() =>
                run(async () => {
                  validateQuestions([edit]);
                  setQuestions((q) =>
                    q.some((x) => x.id === edit.id)
                      ? q.map((x) => (x.id === edit.id ? edit : x))
                      : [...q, edit],
                  );
                  setDirty(true);
                  setEdit(null);
                })
              }
            >
              应用修改（仍需保存题库）
            </Button>
          </footer>
        </Modal>
      )}
      {remove && (
        <Confirm
          title={remove.switchTo ? "放弃未保存修改？" : "删除题目"}
          description={
            remove.switchTo
              ? "切换专题会丢弃未保存的修改。"
              : "删除应用到草稿，保存题库后才会写入文件。"
          }
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            if (remove.switchTo) change("selected", remove.switchTo);
            else {
              setQuestions((q) => q.filter((x) => x.id !== remove.question.id));
              setDirty(true);
            }
          }}
        />
      )}
    </div>
  );
}
