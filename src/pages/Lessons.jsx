import React, { useState } from "react";
import {
  BookOpen,
  Plus,
  FolderOpen,
  FileText,
  Tag,
  Users,
  Pencil,
  Trash2,
  Sparkles,
  Copy,
  Package,
  ArrowDownUp,
  Link2,
  GripVertical,
  RefreshCw,
  Save,
} from "lucide-react";
import { addLessonReference } from "../shared/lessonReferences";
import { useApp, useView } from "../shared/store";
import { useLessonIndex, useFiles } from "../shared/hooks";
import {
  id,
  matches,
  validateName,
  uniqueRef,
  removeRef,
  validateBlank,
  parseJSONResult,
  today,
} from "../shared/domain";
import { services, join, basename, parent, generate } from "../shared/services";
import {
  PageHeader,
  Button,
  IconButton,
  Tabs,
  SearchBox,
  Badge,
  Empty,
  Loading,
  ErrorBox,
  Section,
  FileItem,
  Modal,
  Field,
  Confirm,
  Editor,
  CopyButton,
  Markdown,
} from "../components/UI";
import { ResourcePicker } from "../components/FileBrowser";
import { renderPDF } from "../shared/documents";
function Tools({ kind, lesson, files, onClose, onRefresh }) {
  const { data, config, mutate, run, notify } = useApp();
  const { files: templates } = useFiles(config.templatesRoot);
  const [form, setForm] = useState({
      name: kind === "rename" ? lesson?.name || "" : "",
      stage: "初中",
      grade: "初一",
      template: "",
      source:
        files?.find((f) => /教案.*\.docx$/i.test(f.name))?.path ||
        files?.find((f) => /\.docx?$/i.test(f.name))?.path ||
        "",
      factor: 0.6,
      exponent: 0.75,
      overwrite: false,
      version: "人教版",
      year: new Date().getFullYear(),
      types: "选择题、填空题、解答题",
      count: 10,
      prompt: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(""),
    [draft, setDraft] = useState("");
  const [clean, setClean] = useState([]),
    [layoutPath, setLayoutPath] = useState(""),
    [layoutPages, setLayoutPages] = useState([]),
    [checkingLayout, setCheckingLayout] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const actions = {
    create: "新建讲义",
    rename: "重命名讲义",
    improve: "AI 完善教案",
    study: "教案转学案",
    pack: "打包讲义",
    clean: "清理文件",
  };
  const execute = async () => {
    setBusy(true);
    setError("");
    try {
      if (kind === "create") {
        const name = validateName(form.name);
        if (form.stage !== "中职") validateName(form.grade);
        if (!config.lessonsRoot || !form.template)
          throw Error("请配置讲义目录并选择模板");
        const dir = join(
          config.lessonsRoot,
          form.stage,
          form.stage === "中职" ? "" : form.grade,
          name,
        );
        /* mkdir ancestors via a template copy only after path existence checks */ const existing =
          await services.check(dir);
        if (existing.exists) throw Error("目标讲义目录已存在");
        await services.copy(form.template, join(dir, basename(form.template)));
        setResult("讲义已创建：" + dir);
        onRefresh();
      }
      if (kind === "rename") {
        const name = validateName(form.name);
        const target = join(parent(lesson.path), name);
        await services.rename(lesson.path, target);
        try {
          await mutate((d) => {
            const walk = (v) =>
              Array.isArray(v)
                ? v.map(walk)
                : v && typeof v === "object"
                  ? Object.fromEntries(
                      Object.entries(v).map(([k, x]) => [k, walk(x)]),
                    )
                  : typeof v === "string" &&
                      (v === lesson.path || v.startsWith(lesson.path + "/"))
                    ? target + v.slice(lesson.path.length)
                    : v;
            const next = walk(d);
            next.lessons = next.lessons.map((l) =>
              l.id === lesson.id ? { ...l, name } : l,
            );
            return next;
          });
        } catch (error) {
          await services.rename(target, lesson.path);
          throw error;
        }
        setResult("讲义已重命名");
        onRefresh();
      }
      if (kind === "improve") {
        if (!form.source) throw Error("请选择原教案");
        if (
          !Number.isInteger(+form.count) ||
          form.count < 1 ||
          form.count > 100
        )
          throw Error("题量应为 1–100 的整数");
        const original = await services.readText(form.source);
        const response = await generate(
          `在原教案基础上完善教学设计。只输出 JSON 对象，含 goals（教学目标字符串）,focus（重点字符串）,difficulties（难点字符串）,procedure（教学过程字符串）,questions（恰好 ${form.count} 项数组，每项 type,stem,answer,explanation，均为字符串）。题型从以下设置选择：${form.types}。不编造学生情况。额外要求：${form.prompt}\n原文：${original}`,
          { json: true },
        );
        const parsed = parseJSONResult(response.text);
        for (const key of ["goals", "focus", "difficulties", "procedure"])
          if (typeof parsed[key] !== "string" || !parsed[key].trim())
            throw Error("输出结构校验失败，缺少：" + key);
        if (
          !Array.isArray(parsed.questions) ||
          parsed.questions.length !== +form.count ||
          parsed.questions.some(
            (q) =>
              typeof q.type !== "string" ||
              typeof q.stem !== "string" ||
              !q.stem.trim() ||
              typeof q.answer !== "string" ||
              typeof q.explanation !== "string",
          )
        )
          throw Error("题目数量或题目结构不符合设置，未保存，请重试");
        setDraft(
          `# 教学目标\n\n${parsed.goals}\n\n# 重点难点\n\n重点：${parsed.focus}\n\n难点：${parsed.difficulties}\n\n# 教学过程\n\n${parsed.procedure}\n\n# 课后练习\n\n` +
            parsed.questions
              .map(
                (q, i) =>
                  `${i + 1}. 【${q.type}】${q.stem}\n\n答案：${q.answer}\n\n解析：${q.explanation}`,
              )
              .join("\n\n"),
        );
        setResult(
          "已生成草稿，请校对后保存。保存将备份原文档后覆盖为标准 DOCX 文档。",
        );
      }
      if (kind === "study") {
        validateBlank(form.factor, form.exponent);
        if (!form.source) throw Error("请选择教案 DOCX");
        const target = join(
          lesson.path,
          basename(form.source).replace(
            /(?:（教案）|教案)?\.docx$/i,
            "（学案）.docx",
          ),
        );
        if (target === form.source) throw Error("目标学案不能与原教案同路径");
        const output = await services.study(
          form.source,
          target,
          +form.factor,
          +form.exponent,
          form.overwrite,
        );
        setLayoutPath(output.path);
        setLayoutPages([]);
        setResult(
          output.layout +
            "；共识别 " +
            output.questions +
            " 道题。" +
            output.path,
        );
        onRefresh();
      }
      if (kind === "pack") {
        if (
          !config.usbRoot ||
          !form.stage ||
          !form.version.trim() ||
          !form.year ||
          !form.grade.trim()
        )
          throw Error("请配置导出 U 盘目录，并填写学段、教材版本、年份、年级");
        const nameParts = [
          form.stage,
          form.version,
          String(form.year),
          form.grade,
          lesson.name,
        ];
        nameParts.forEach((p) => validateName(p));
        const target = join(config.usbRoot, ...nameParts);
        for (const f of files.filter((f) => !f.isDirectory))
          await services.copy(f.path, join(target, f.relativePath || f.name));
        setResult("已打包至：" + target);
      }
      if (kind === "clean") {
        if (!clean.length) throw Error("请选择要清理的文件");
        if (!form.overwrite) throw Error("请勾选删除确认");
        for (const p of clean) await services.trash(p, basename(p));
        setResult("所选文件已移入系统废纸篓");
        onRefresh();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={actions[kind]} onClose={() => !busy && onClose()} wide>
      {["create", "rename"].includes(kind) && (
        <Field label="讲义名称">
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
      )}
      {["create", "pack"].includes(kind) && (
        <div className="form-grid two">
          <Field label="学段">
            <select
              value={form.stage}
              onChange={(e) => set("stage", e.target.value)}
            >
              {["初中", "高中", "中职"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="年级 / 集合">
            <input
              value={form.grade}
              onChange={(e) => set("grade", e.target.value)}
            />
          </Field>
        </div>
      )}
      {kind === "create" && (
        <Field label="DOC / DOCX 模板">
          <select
            value={form.template}
            onChange={(e) => set("template", e.target.value)}
          >
            <option value="">请选择模板</option>
            {templates
              .filter((f) => /\.docx?$/i.test(f.name))
              .map((f) => (
                <option key={f.path} value={f.path}>
                  {f.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      {["improve", "study"].includes(kind) && (
        <Field label="原教案文件">
          <select
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
          >
            <option value="">请选择</option>
            {files
              .filter((f) => /\.docx?$/i.test(f.name))
              .map((f) => (
                <option key={f.path} value={f.path}>
                  {f.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      {kind === "improve" && (
        <>
          <div className="form-grid two">
            <Field label="题型">
              <input
                value={form.types}
                onChange={(e) => set("types", e.target.value)}
              />
            </Field>
            <Field label="题量（1–100）">
              <input
                type="number"
                min="1"
                max="100"
                value={form.count}
                onChange={(e) => set("count", +e.target.value)}
              />
            </Field>
          </div>
          <Field label="完善要求">
            <textarea
              value={form.prompt}
              onChange={(e) => set("prompt", e.target.value)}
            />
          </Field>
        </>
      )}
      {kind === "study" && (
        <>
          <div className="form-grid two">
            <Field label="空白量系数（0.1–1.5）">
              <input
                type="number"
                min=".1"
                max="1.5"
                step=".1"
                value={form.factor}
                onChange={(e) => set("factor", e.target.value)}
              />
            </Field>
            <Field label="增长指数（0.5–1）">
              <input
                type="number"
                min=".5"
                max="1"
                step=".05"
                value={form.exponent}
                onChange={(e) => set("exponent", e.target.value)}
              />
            </Field>
          </div>
          <p className="muted">
            保留 DOCX
            结构，按编号题目插入作答空间，移除独立答案/解析段落。复杂答案与分页请人工检查。
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={form.overwrite}
              onChange={(e) => set("overwrite", e.target.checked)}
            />
            允许覆盖同名学案（覆盖前备份）
          </label>
        </>
      )}
      {kind === "pack" && (
        <div className="form-grid two">
          <Field label="教材版本">
            <input
              value={form.version}
              onChange={(e) => set("version", e.target.value)}
            />
          </Field>
          <Field label="年份">
            <input
              type="number"
              value={form.year}
              onChange={(e) => set("year", e.target.value)}
            />
          </Field>
        </div>
      )}
      {kind === "clean" && (
        <>
          <p>选择将移入废纸篓的文件。历史教案、备份目录与备份文件受保护。</p>
          {files
            .filter(
              (f) =>
                !f.isDirectory &&
                !/(历史教案|历史|备份|\.bak)/.test(f.relativePath || f.name),
            )
            .map((f) => (
              <label className="check-label" key={f.path}>
                <input
                  type="checkbox"
                  checked={clean.includes(f.path)}
                  onChange={(e) =>
                    setClean((v) =>
                      e.target.checked
                        ? [...v, f.path]
                        : v.filter((x) => x !== f.path),
                    )
                  }
                />
                {f.relativePath || f.name}
              </label>
            ))}
          <label className="check-label">
            <input
              type="checkbox"
              checked={form.overwrite}
              onChange={(e) => set("overwrite", e.target.checked)}
            />
            确认移除以上 {clean.length} 个文件
          </label>
        </>
      )}
      {error && <ErrorBox message={error} />}
      {result && (
        <div role="status" className="info-banner">
          {result}
        </div>
      )}
      {layoutPath && (
        <>
          <Button
            icon={FileText}
            busy={checkingLayout}
            onClick={() =>
              run(async () => {
                setCheckingLayout(true);
                setLayoutPages([]);
                try {
                  await renderPDF(
                    layoutPath,
                    (image, page, total) =>
                      setLayoutPages((v) => [...v, { image, page, total }]),
                    () => {},
                  );
                } finally {
                  setCheckingLayout(false);
                }
              })
            }
          >
            版式检查 / 分页预览
          </Button>
          {layoutPages.map((p) => (
            <div className="document-page" key={p.page}>
              <small>
                第 {p.page} / {p.total} 页 · 请检查分页、作答空间与答案残留
              </small>
              <img src={p.image} alt={"学案第 " + p.page + " 页"} />
            </div>
          ))}
        </>
      )}
      {draft && (
        <>
          <Editor value={draft} onChange={setDraft} rows={15} />
          <label className="check-label">
            <input
              type="checkbox"
              checked={form.overwrite}
              onChange={(e) => set("overwrite", e.target.checked)}
            />
            确认备份并覆盖原教案（将重排为标准 Word 文档）
          </label>
          <Button
            icon={Save}
            variant="primary"
            disabled={!form.overwrite}
            onClick={() =>
              run(async () => {
                await services.word(
                  form.source.replace(/\.doc$/i, ".docx"),
                  draft,
                  true,
                );
                setDraft("");
                setResult("已备份并保存");
                onRefresh();
              })
            }
          >
            保存教案
          </Button>
        </>
      )}
      <footer>
        <Button disabled={busy} onClick={onClose}>
          关闭
        </Button>
        <Button
          busy={busy}
          variant={kind === "clean" ? "danger" : "primary"}
          onClick={execute}
        >
          {kind === "improve" ? "生成教案草稿" : "执行" + actions[kind]}
        </Button>
      </footer>
    </Modal>
  );
}
function Detail({ lesson, onTool, onRefresh }) {
  const { data, mutate, run } = useApp();
  const { files, error, refresh } = useFiles(lesson.path, true);
  const [tag, setTag] = useState(""),
    [picker, setPicker] = useState(false),
    [assign, setAssign] = useState(false),
    [remove, setRemove] = useState(null);
  const save = (patch) =>
    mutate((d) => ({
      ...d,
      lessons: d.lessons.map((l) =>
        l.id === lesson.id ? { ...l, ...patch } : l,
      ),
    }));
  const assigned = data.students.filter((s) =>
    data.refs.some((r) => r.studentId === s.id && r.lessonId === lesson.id),
  );
  return (
    <div className="lesson-detail">
      <div className="lesson-detail-header">
        <span className="course-symbol">
          <BookOpen size={30} />
        </span>
        <div className="grow">
          <h2>{lesson.name}</h2>
          <p>
            {[lesson.stage, lesson.grade, lesson.collection]
              .filter(Boolean)
              .join(" / ")}
          </p>
        </div>
        <Button
          icon={FolderOpen}
          onClick={() => run(() => services.open(lesson.path))}
        >
          打开目录
        </Button>
      </div>
      {lesson.missing && (
        <ErrorBox message="讲义来源路径已失效，请恢复目录或重新配置。" />
      )}
      <div className="lesson-actions">
        {[
          ["rename", Pencil, "重命名"],
          ["improve", Sparkles, "教案完善"],
          ["study", FileText, "转学案"],
          ["pack", Package, "打包讲义"],
          ["clean", Trash2, "清理文件"],
        ].map(([k, I, l]) => (
          <Button
            key={k}
            icon={I}
            disabled={lesson.missing}
            onClick={() => onTool(k, files)}
          >
            {l}
          </Button>
        ))}
        <CopyButton
          label="复制教案路径"
          text={
            files.find((f) => /教案.*\.docx?$/i.test(f.name))?.path ||
            lesson.path
          }
        />
      </div>
      <Section
        title="讲义文件"
        subtitle={files.filter((f) => !f.isDirectory).length + " 个文件"}
      >
        {error && <ErrorBox message={error} />}
        {files
          .filter((f) => !f.isDirectory)
          .map((f) => (
            <FileItem
              key={f.path}
              file={f}
              onOpen={() => run(() => services.open(f.path))}
            />
          ))}
      </Section>
      <Section title="标签">
        <div className="tag-list">
          {(lesson.tags || []).map((t) => (
            <button
              className="tag"
              key={t}
              onClick={() =>
                run(() => save({ tags: lesson.tags.filter((v) => v !== t) }))
              }
            >
              {t} ×
            </button>
          ))}
        </div>
        <div className="inline-input">
          <input
            aria-label="新标签"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="添加标签，回车确认"
            onKeyDown={(e) => {
              if (e.key === "Enter" && tag.trim()) {
                run(() =>
                  save({
                    tags: [...new Set([...(lesson.tags || []), tag.trim()])],
                  }),
                );
                setTag("");
              }
            }}
          />
          <Button
            icon={Plus}
            onClick={() => {
              if (tag.trim())
                run(() =>
                  save({
                    tags: [...new Set([...(lesson.tags || []), tag.trim()])],
                  }),
                );
              setTag("");
            }}
          >
            添加
          </Button>
        </div>
      </Section>
      <Section
        title="关联学生"
        action={
          <Button icon={Users} onClick={() => setAssign(true)}>
            分配学生
          </Button>
        }
      >
        {!assigned.length ? (
          <p className="muted">尚未分配给学生</p>
        ) : (
          assigned.map((s) => (
            <div className="linked-row" key={s.id}>
              <strong>{s.name}</strong>
              <span>{s.grade}</span>
              <Button
                disabled={s.status === "已停课"}
                onClick={() =>
                  run(() =>
                    mutate((d) => {
                      const refs = removeRef(
                        d.refs.filter((r) => r.studentId === s.id),
                        lesson.id,
                        d.feedback.filter((f) => f.studentId === s.id),
                      );
                      return {
                        ...d,
                        refs: [
                          ...d.refs.filter((r) => r.studentId !== s.id),
                          ...refs,
                        ],
                      };
                    }),
                  )
                }
              >
                取消分配
              </Button>
            </div>
          ))
        )}
      </Section>
      <Section
        title="参考资料"
        action={
          <Button icon={Link2} onClick={() => setPicker(true)}>
            关联资料
          </Button>
        }
      >
        {!(lesson.resources || []).length ? (
          <p className="muted">关联备课参考资料，授课时随手可达。</p>
        ) : (
          (lesson.resources || []).map((f) => (
            <FileItem
              key={f.path}
              file={f}
              onOpen={() => run(() => services.open(f.path))}
              action={
                <Button
                  onClick={() =>
                    run(() =>
                      save({
                        resources: lesson.resources.filter(
                          (r) => r.path !== f.path,
                        ),
                      }),
                    )
                  }
                >
                  移除
                </Button>
              }
            />
          ))
        )}
      </Section>
      <Button variant="danger" icon={Trash2} onClick={() => setRemove(lesson)}>
        删除讲义目录
      </Button>
      {picker && (
        <ResourcePicker
          title="关联参考资料"
          onClose={() => setPicker(false)}
          onSelect={(f) =>
            run(async () => {
              if (lesson.resources?.some((r) => r.path === f.path))
                throw Error("此资料已关联");
              await save({ resources: [...(lesson.resources || []), f] });
            })
          }
        />
      )}
      {assign && (
        <Modal title="分配给学生" onClose={() => setAssign(false)}>
          {data.students
            .filter((s) => s.status !== "已停课")
            .map((s) => (
              <div className="linked-row" key={s.id}>
                <strong>{s.name}</strong>
                <span>{s.grade}</span>
                <Button
                  disabled={assigned.some((a) => a.id === s.id)}
                  onClick={() =>
                    run(async () => {
                      uniqueRef(
                        data.refs.filter((r) => r.studentId === s.id),
                        lesson.id,
                      );
                      await mutate((d) =>
                        addLessonReference(d, s.id, lesson.id),
                      );
                    })
                  }
                >
                  {assigned.some((a) => a.id === s.id) ? "已分配" : "分配"}
                </Button>
              </div>
            ))}
        </Modal>
      )}
      {remove && (
        <Confirm
          title="删除讲义"
          name={lesson.name}
          description={
            "整个目录将移入系统废纸篓：" +
            lesson.path +
            "。已分配给学生或被反馈引用的讲义不能删除。"
          }
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            if (assigned.length)
              throw Error("请先处理所有学生引用，讲义当前不能删除");
            await services.trash(lesson.path, lesson.name);
            await mutate((d) => ({
              ...d,
              lessons: d.lessons.filter((l) => l.id !== lesson.id),
            }));
            onRefresh();
          }}
        />
      )}
    </div>
  );
}
export default function Lessons() {
  const { data, mutate, run } = useApp();
  const { lessons, error, loading, refresh } = useLessonIndex();
  const [view, setView] = useView("lessonLibrary", {
    stage: "初中",
    query: "",
    grade: "",
    collection: "",
    tags: [],
    selected: "",
    sort: "custom",
    recentTags: [],
  });
  const [detailRevision, setDetailRevision] = useState(0);
  const refreshDetail = () => {
    refresh();
    setDetailRevision((v) => v + 1);
  };
  const [tool, setTool] = useState(null),
    [toolFiles, setToolFiles] = useState([]),
    [drag, setDrag] = useState("");
  const change = (k, v) => setView((x) => ({ ...x, [k]: v }));
  const stageLessons = lessons.filter((l) => l.stage === view.stage);
  const tags = [...new Set(stageLessons.flatMap((l) => l.tags || []))];
  const selected = lessons.find((l) => l.id === view.selected);
  const filtered = stageLessons
    .filter(
      (l) =>
        (!view.grade || l.grade === view.grade) &&
        (!view.collection || l.collection === view.collection) &&
        matches(l.name + " " + l.path, view.query) &&
        view.tags.every((t) => (l.tags || []).includes(t)),
    )
    .sort((a, b) =>
      view.sort === "created"
        ? (b.createdAt || "").localeCompare(a.createdAt || "")
        : (a.order || 0) - (b.order || 0),
    );
  return (
    <div className="page">
      <PageHeader
        title="讲义库"
        eyebrow="YOUR KNOWLEDGE, ORGANIZED"
        description="把备课成果沉淀成资产，让好内容持续发挥价值。"
      >
        <Button icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
        <Button icon={Plus} variant="primary" onClick={() => setTool("create")}>
          新建讲义
        </Button>
      </PageHeader>
      <div className="resource-toolbar">
        <Tabs
          items={["初中", "高中", "中职"]}
          value={view.stage}
          onChange={(s) =>
            setView((v) => ({ ...v, stage: s, grade: "", collection: "" }))
          }
        />
        <Badge>{stageLessons.length} 份讲义</Badge>
      </div>
      <div className="lesson-layout">
        <aside className="panel lesson-browser">
          <SearchBox
            value={view.query}
            onChange={(q) => change("query", q)}
            placeholder="搜索标题、年级、路径…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && view.query.trim())
                setView((v) => ({
                  ...v,
                  tags: [...new Set([...v.tags, v.query.trim()])],
                  recentTags: [
                    v.query.trim(),
                    ...(v.recentTags || []).filter((t) => t !== v.query.trim()),
                  ].slice(0, 8),
                  query: "",
                }));
            }}
          />
          <div className="filter-row">
            <select
              aria-label="讲义年级"
              value={view.grade}
              onChange={(e) => change("grade", e.target.value)}
            >
              <option value="">全部年级</option>
              {[
                ...new Set(stageLessons.map((l) => l.grade).filter(Boolean)),
              ].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <select
              aria-label="讲义集合"
              value={view.collection}
              onChange={(e) => change("collection", e.target.value)}
            >
              <option value="">全部集合</option>
              {[
                ...new Set(
                  stageLessons.map((l) => l.collection).filter(Boolean),
                ),
              ].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="tag-filter">
            {tags.map((t) => (
              <button
                key={t}
                className={"tag " + (view.tags.includes(t) ? "selected" : "")}
                onClick={() =>
                  setView((v) => ({
                    ...v,
                    tags: v.tags.includes(t)
                      ? v.tags.filter((x) => x !== t)
                      : [...v.tags, t],
                    recentTags: [
                      t,
                      ...(v.recentTags || []).filter((x) => x !== t),
                    ].slice(0, 8),
                  }))
                }
              >
                {t}
              </button>
            ))}
            {view.tags.length > 0 && (
              <button onClick={() => change("tags", [])}>清空</button>
            )}
          </div>
          <div className="list-caption">
            <span>{filtered.length} 份讲义</span>
            <select
              aria-label="讲义排序"
              value={view.sort}
              onChange={(e) => change("sort", e.target.value)}
            >
              <option value="custom">自定义排序</option>
              <option value="created">创建时间</option>
            </select>
          </div>
          <div className="lesson-list">
            {loading ? (
              <Loading />
            ) : error ? (
              <ErrorBox message={error} />
            ) : !filtered.length ? (
              <Empty
                icon={BookOpen}
                title="这里是你的教学积累"
                description="配置讲义目录，或从模板创建第一份讲义。"
              />
            ) : (
              filtered.map((l) => (
                <button
                  key={l.id}
                  className={
                    "lesson-list-item " +
                    (view.selected === l.id ? "selected" : "")
                  }
                  draggable={view.sort === "custom"}
                  onDragStart={() => setDrag(l.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!drag || drag === l.id) return;
                    const order = filtered.filter((x) => x.id !== drag);
                    order.splice(
                      order.findIndex((x) => x.id === l.id),
                      0,
                      filtered.find((x) => x.id === drag),
                    );
                    run(() =>
                      mutate((d) => ({
                        ...d,
                        lessons: d.lessons.map((item) => {
                          const i = order.findIndex((x) => x.id === item.id);
                          return i >= 0 ? { ...item, order: i } : item;
                        }),
                      })),
                    );
                  }}
                  onClick={() => change("selected", l.id)}
                >
                  <span className="file-icon">
                    <FileText size={21} />
                  </span>
                  <span>
                    <strong>{l.name}</strong>
                    <small>
                      {l.grade} / {l.collection || l.stage}
                    </small>
                    <span className="tag-list">
                      {l.tags?.map((t) => (
                        <span className="tag" key={t}>
                          {t}
                        </span>
                      ))}
                    </span>
                    {l.missing && (
                      <small className="text-danger">来源缺失</small>
                    )}
                  </span>
                  <GripVertical size={14} />
                </button>
              ))
            )}
          </div>
        </aside>
        <div className="panel scroll-pane">
          {selected ? (
            <Detail
              key={selected.id + ":" + detailRevision}
              lesson={selected}
              onTool={(k, f) => {
                setTool(k);
                setToolFiles(f);
              }}
              onRefresh={refreshDetail}
            />
          ) : (
            <Empty
              icon={BookOpen}
              title="选择讲义，查看教学资产"
              description="管理文件、标签、参考资料与学生分配。"
            />
          )}
        </div>
      </div>
      {tool && (
        <Tools
          kind={tool}
          lesson={selected}
          files={toolFiles}
          onClose={() => setTool(null)}
          onRefresh={refreshDetail}
        />
      )}
    </div>
  );
}
