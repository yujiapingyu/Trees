import React, { useEffect, useRef, useState } from "react";
import { Copy, FileText, FolderOpen, Save, Sparkles } from "lucide-react";
import { useApp, useView } from "../shared/store";
import { basename, join, services } from "../shared/services";
import { renderPDF } from "../shared/documents";
import { Badge, Button, ErrorBox, Field, Modal } from "./UI";
const sourceFiles = (files) =>
  files.filter(
    (f) =>
      !f.isDirectory &&
      /\.docx$/i.test(f.name) &&
      !/学案|原始题目|基础题库|历史|备份|\.bak/.test(f.relativePath || f.name),
  );
function studyPath(lesson, source) {
  const stem = basename(source).replace(/\.docx$/i, "");
  const name = /（教案）|\(教案\)/.test(stem)
    ? stem.replace(/（教案）|\(教案\)/, "（学案）")
    : stem.replace(/教案$/, "") + "（学案）";
  return join(lesson.path, name + ".docx");
}
export default function LessonDocumentTools({
  kind,
  lesson,
  files,
  onClose,
  onRefresh,
}) {
  const { run, notify } = useApp(),
    options = sourceFiles(files),
    [source, setSource] = useState(
      options.find((f) => /教案/.test(f.name))?.path || options[0]?.path || "",
    ),
    [preview, setPreview] = useState(null),
    [draft, setDraft] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [result, setResult] = useState(null),
    [instructions, setInstructions] = useState(""),
    [overwrite, setOverwrite] = useState(false),
    [targetExists, setTargetExists] = useState(false),
    [pages, setPages] = useState([]),
    [layoutPath, setLayoutPath] = useState("");
  const [spacing, setSpacing] = useView("lessonStudySpacing", {
    factor: "0.75",
    exponent: "0.9",
  });
  const token = useRef(null);
  useEffect(() => {
    let live = true;
    setPreview(null);
    setDraft(null);
    setResult(null);
    setError("");
    setOverwrite(false);
    setLayoutPath("");
    setPages([]);
    if (!source) return;
    if (kind === "improve") {
      setBusy("正在检查教案结构和题目…");
      services
        .lessonPrepare(source)
        .then((r) => {
          if (live) {
            token.current = r.token;
            setPreview(r);
          } else services.lessonDiscard(r.token).catch(() => {});
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setBusy("");
        });
    } else
      services
        .check(studyPath(lesson, source))
        .then((r) => {
          if (live) setTargetExists(r.exists);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
      if (token.current) {
        services.lessonDiscard(token.current).catch(() => {});
        token.current = null;
      }
    };
  }, [source, kind]);
  const action = async (message, fn) => {
    setBusy(message);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };
  const patch = (key, value) => {
    setDraft(null);
    setPreview((p) => ({ ...p, [key]: value }));
  };
  const allocate = (index, key, raw) => {
    setDraft(null);
    setPreview((p) => ({
      ...p,
      categories: p.categories.map((c, i) =>
        i !== index
          ? c
          : {
              ...c,
              [key]: Math.min(
                Math.max(0, Math.floor(Number(raw) || 0)),
                c.available - c[key === "keep" ? "practice" : "keep"],
              ),
            },
      ),
    }));
  };
  const generate = () =>
    action("正在依据现有教案生成教学内容…", async () => {
      const r = await services.lessonGenerate({
        token: preview.token,
        organizeQuestions: preview.organizeQuestions,
        questionPlan: preview.categories,
        updateIntro: preview.updateIntro,
        updateSummary: preview.updateSummary,
        instructions,
      });
      setDraft(r);
      setResult(null);
    });
  const save = () =>
    action("正在备份并写入原教案…", async () => {
      const r = await services.lessonSave({
        token: preview.token,
        content: draft.content,
      });
      setResult(r);
      setLayoutPath(r.path);
      setPages([]);
      setDraft(null);
      setPreview(null);
      token.current = null;
      onRefresh();
      notify("教案已完善，原版式与未更新章节已保留");
    });
  const createStudy = (mode) =>
    action(
      mode === "copy"
        ? "正在原样复制教案…"
        : "正在识别题型、删除解析并分配作答空间…",
      async () => {
        const r = await services.study(
          source,
          studyPath(lesson, source),
          Number(spacing.factor),
          Number(spacing.exponent),
          overwrite,
          mode,
        );
        setResult(r);
        setLayoutPath(r.path);
        setPages([]);
        setTargetExists(true);
        onRefresh();
      },
    );
  const textField = (key, label) => {
    const v = draft.content[key];
    return (
      <section className="lesson-content-section" key={key}>
        <h3>{label}</h3>
        {Array.isArray(v) ? (
          v.map((text, i) => (
            <Field label={`${label} ${i + 1}`} key={i}>
              <textarea
                rows={key === "summary" ? 4 : 3}
                value={text}
                disabled={!!busy}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    content: {
                      ...d.content,
                      [key]: d.content[key].map((x, j) =>
                        j === i ? e.target.value : x,
                      ),
                    },
                  }))
                }
              />
            </Field>
          ))
        ) : (
          <Field label={label}>
            <textarea
              rows={3}
              value={v}
              disabled={!!busy}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  content: { ...d.content, [key]: e.target.value },
                }))
              }
            />
          </Field>
        )}
      </section>
    );
  };
  const retained =
      preview?.categories.reduce(
        (sum, c) => sum + (c.selected ? c.keep : 0),
        0,
      ) || 0,
    practice =
      preview?.categories.reduce(
        (sum, c) => sum + (c.selected ? c.practice : 0),
        0,
      ) || 0;
  return (
    <Modal
      title={kind === "improve" ? "教案完善" : "生成学案"}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <Field label="原教案文件">
        <select
          value={source}
          disabled={!!busy}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">请选择 DOCX 教案</option>
          {options.map((f) => (
            <option key={f.path} value={f.path}>
              {f.relativePath || f.name}
            </option>
          ))}
        </select>
      </Field>
      {!options.length && (
        <ErrorBox message="当前目录没有可处理的 DOCX 教案。请先将 DOC 另存为 DOCX；学案、原始题目和历史备份不会作为教案处理。" />
      )}
      {kind === "improve" && preview && (
        <>
          <p className="form-hint">
            按原 Word
            模板补充教学目标、重难点、趣味导入和翻转总结。题目、公式、图片及未更新章节保留在原文档中，保存前自动备份。
          </p>
          {preview.complete && (
            <div className="info-banner">
              当前教学内容已完整。继续后会更新教学目标与重难点，导入和总结按下面的勾选项处理。
            </div>
          )}
          <fieldset className="lesson-update-options">
            <legend>本次完善内容</legend>
            <label className="check-label">
              <input
                type="checkbox"
                checked={preview.organizeQuestions}
                disabled={!!busy || !preview.canOrganize}
                onChange={(e) => patch("organizeQuestions", e.target.checked)}
              />
              整理题目与随堂练习
            </label>
            <small>关闭后，当前题目与随堂练习保持原样。</small>
            <label className="check-label">
              <input
                type="checkbox"
                checked={preview.updateIntro}
                disabled={!!busy || !preview.hasIntro}
                onChange={(e) => patch("updateIntro", e.target.checked)}
              />
              重新生成趣味导入
              {!preview.hasIntro ? "（当前为空，将自动生成）" : ""}
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={preview.updateSummary}
                disabled={!!busy || !preview.hasSummary}
                onChange={(e) => patch("updateSummary", e.target.checked)}
              />
              重新生成翻转总结
              {!preview.hasSummary ? "（当前为空，将自动生成）" : ""}
            </label>
          </fieldset>
          {preview.warning && <p className="info-banner">{preview.warning}</p>}
          {preview.organizeQuestions && (
            <section className="lesson-question-plan" aria-label="题目分配">
              <p>
                {preview.hasBase
                  ? "每次都从固定原始题目重新分配，可恢复之前未选用的题目。"
                  : "首次保存将额外保留固定原始题目，后续整理都从这一原件开始。"}
              </p>
              <div className="lesson-plan-counts">
                <Badge type="blue">正文 {retained} 题</Badge>
                <Badge type="blue">随堂练习 {practice} 题</Badge>
                <Badge>
                  不选用 {preview.originalTotal - retained - practice} 题
                </Badge>
              </div>
              <Button
                disabled={!!busy}
                onClick={() => {
                  setDraft(null);
                  setPreview((p) => ({
                    ...p,
                    categories: p.categories.map((c) => ({
                      ...c,
                      selected: !p.categories.every((x) => x.selected),
                    })),
                  }));
                }}
              >
                {preview.categories.every((c) => c.selected)
                  ? "取消全选题型"
                  : "全选题型"}
              </Button>
              {preview.categories.map((c, i) => (
                <div className="lesson-question-row" key={i}>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={c.selected}
                      disabled={!!busy}
                      onChange={(e) => {
                        setDraft(null);
                        setPreview((p) => ({
                          ...p,
                          categories: p.categories.map((v, j) =>
                            j === i ? { ...v, selected: e.target.checked } : v,
                          ),
                        }));
                      }}
                    />
                    <span>
                      {c.label}
                      <small>原有 {c.available} 题</small>
                    </span>
                  </label>
                  <Field label={`题型 ${i + 1} 正文题数`}>
                    <input
                      type="number"
                      min="0"
                      max={c.available - c.practice}
                      value={c.keep}
                      disabled={!!busy || !c.selected}
                      onChange={(e) => allocate(i, "keep", e.target.value)}
                    />
                  </Field>
                  <Field label={`题型 ${i + 1} 练习题数`}>
                    <input
                      type="number"
                      min="0"
                      max={c.available - c.keep}
                      value={c.practice}
                      disabled={!!busy || !c.selected}
                      onChange={(e) => allocate(i, "practice", e.target.value)}
                    />
                  </Field>
                </div>
              ))}
              <small>
                正文取当前题型前面的题，练习取末尾的题；未选题型从当前教案中移除，原始题目保留。题型与题目会重新编号。
              </small>
            </section>
          )}
          <Field label="补充完善要求（可选）">
            <textarea
              rows={2}
              value={instructions}
              disabled={!!busy}
              onChange={(e) => {
                setInstructions(e.target.value);
                setDraft(null);
              }}
              placeholder="例如：导入适合初中学生，重点解释公式的成立条件。"
            />
          </Field>
          <Button
            icon={Sparkles}
            variant="primary"
            disabled={
              !!busy ||
              (preview.organizeQuestions &&
                !preview.categories.some((c) => c.selected))
            }
            onClick={generate}
          >
            生成完善草稿
          </Button>
        </>
      )}
      {kind === "study" && (
        <>
          <p className="form-hint">
            选择原样复制，或删除答案解析后按题型留出作答空间。选择题与填空题留一行，解答题按原答案估算行数留白。
          </p>
          <div className="form-grid two">
            <Field label="空白量系数（0.1–1.5）">
              <input
                type="number"
                min=".1"
                max="1.5"
                step=".05"
                value={spacing.factor}
                disabled={!!busy}
                onChange={(e) =>
                  setSpacing((s) => ({ ...s, factor: e.target.value }))
                }
              />
            </Field>
            <Field label="增长指数（0.5–1）">
              <input
                type="number"
                min=".5"
                max="1"
                step=".05"
                value={spacing.exponent}
                disabled={!!busy}
                onChange={(e) =>
                  setSpacing((s) => ({ ...s, exponent: e.target.value }))
                }
              />
            </Field>
          </div>
          <p className="muted">
            空白行数 = 向上取整（系数 ×
            答案估算行数的指数次幂）。参数会在本机记住。
          </p>
          {source && (
            <p className="form-hint">
              保存为：{basename(studyPath(lesson, source))}
            </p>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={!!busy}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            {targetExists
              ? "同名学案已存在，确认备份后覆盖"
              : "允许覆盖同名学案（覆盖前自动备份）"}
          </label>
          <div className="lesson-study-actions">
            <Button
              icon={Copy}
              disabled={!!busy || !source || (targetExists && !overwrite)}
              onClick={() => createStudy("copy")}
            >
              仅复制
            </Button>
            <Button
              icon={FileText}
              variant="primary"
              disabled={!!busy || !source || (targetExists && !overwrite)}
              onClick={() => createStudy("process")}
            >
              复制并处理
            </Button>
          </div>
        </>
      )}
      {busy && (
        <div className="info-banner" role="status">
          {busy}
        </div>
      )}
      {error && <ErrorBox message={error} />}
      {draft && (
        <div className="lesson-content-review">
          <h3>教学补充草稿</h3>
          <Badge type="blue">{draft.model}</Badge>
          <p className="form-hint">
            以下内容可直接修改，数学公式使用
            $公式$。保存时写回对应单元格和章节，原有题目不由 AI 改写。
          </p>
          {textField("goals", "教学目标")}
          {textField("key_point", "教学重点")}
          {textField("difficulty", "教学难点")}
          {preview.updateIntro && textField("fun_intro", "趣味导入")}
          {preview.updateSummary && textField("summary", "翻转总结")}
          <Button
            icon={Save}
            variant="primary"
            disabled={!!busy}
            onClick={save}
          >
            备份并保存教案
          </Button>
        </div>
      )}
      {result && !busy && (
        <div className="info-banner" role="status">
          {kind === "improve"
            ? `教案已完善并保留原版式。${result.basePath ? `正文保留 ${result.retainedCount} 题，移至随堂练习 ${result.movedCount} 题。` : "题目与随堂练习保持原样。"}`
            : result.mode === "copy"
              ? "已原样复制为学案，保留全部答案和解析。"
              : `${result.layout}；共识别 ${result.questions} 道题，处理 ${result.processed} 题（选择 ${result.choiceCount}、填空 ${result.fillBlankCount}、解答 ${result.longAnswerCount}），删除 ${result.removedParagraphCount} 个答案解析段落。`}
        </div>
      )}
      {result?.unprocessedQuestionCount > 0 && (
        <p className="info-banner">
          有 {result.unprocessedQuestionCount}{" "}
          题没有识别到独立答案标记，已原样保留。请检查是否存在行内答案。
        </p>
      )}
      {result?.oversizedQuestionCount > 0 && (
        <p className="info-banner">
          有 {result.oversizedQuestionCount}{" "}
          道题超过一页可容纳高度，已允许跨页，请在分页预览中检查题干。
        </p>
      )}
      {result?.backupPath && (
        <Button
          icon={FolderOpen}
          onClick={() => run(() => services.open(result.backupPath))}
        >
          打开修改前备份
        </Button>
      )}
      {layoutPath && (
        <>
          <div className="button-row">
            <Button
              icon={FolderOpen}
              disabled={!!busy}
              onClick={() => run(() => services.open(layoutPath))}
            >
              打开生成文件
            </Button>
            <Button
              icon={FileText}
              disabled={!!busy}
              onClick={() =>
                action("正在生成分页预览…", async () => {
                  setPages([]);
                  await renderPDF(
                    layoutPath,
                    (image, page, total) =>
                      setPages((v) => [...v, { image, page, total }]),
                    () => {},
                  );
                })
              }
            >
              版式检查 / 分页预览
            </Button>
          </div>
          {pages.map((p) => (
            <div className="document-page" key={p.page}>
              <small>
                第 {p.page} / {p.total} 页 · 检查题目、公式和作答空间
              </small>
              <img
                src={p.image}
                alt={
                  (kind === "study" ? "学案" : "教案") + "第 " + p.page + " 页"
                }
              />
            </div>
          ))}
        </>
      )}
      <footer>
        <Button disabled={!!busy} onClick={onClose}>
          关闭
        </Button>
      </footer>
    </Modal>
  );
}
