import LessonPack from "../components/LessonPack";
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
} from "../shared/domain";
import { services, join, basename, parent } from "../shared/services";
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
  CopyButton,
} from "../components/UI";
import { ResourcePicker } from "../components/FileBrowser";
import LessonDocumentTools from "../components/LessonDocumentTools";
import CreateLesson from "../components/CreateLesson";
function Tools({ kind, lesson, files, onClose, onRefresh }) {
  const { mutate } = useApp();
  const [form, setForm] = useState({
      name: kind === "rename" ? lesson?.name || "" : "",
      overwrite: false,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const [clean, setClean] = useState([]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const actions = {
    rename: "重命名讲义",
    clean: "清理文件",
  };
  const execute = async () => {
    setBusy(true);
    setError("");
    try {
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
      {kind === "rename" && (
        <Field label="讲义名称">
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
      )}
      {kind === "clean" && (
        <>
          <p>选择将移入废纸篓的文件。历史教案、备份目录与备份文件受保护。</p>
          {files
            .filter(
              (f) =>
                !f.isDirectory &&
                !/(历史教案|历史|备份|原始题目|基础题库|\.bak)/.test(
                  f.relativePath || f.name,
                ),
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
      <footer>
        <Button disabled={busy} onClick={onClose}>
          关闭
        </Button>
        <Button
          busy={busy}
          variant={kind === "clean" ? "danger" : "primary"}
          onClick={execute}
        >
          {"执行" + actions[kind]}
        </Button>
      </footer>
    </Modal>
  );
}
function Detail({ lesson, onTool, onRefresh }) {
  const { data, mutate, run, notify } = useApp();
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
  const { data, mutate, run, notify } = useApp();
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
  const ToolComponent = ["improve", "study"].includes(tool)
    ? LessonDocumentTools
    : tool === "pack"
      ? LessonPack
      : Tools;
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
      {tool === "create" ? (
        <CreateLesson
          stage={view.stage}
          onClose={() => setTool(null)}
          onCreated={async ({ lesson }) => {
            const next = await mutate((d) => {
              const old = d.lessons.find((l) => l.path === lesson.path);
              if (old) return d;
              const order =
                Math.max(
                  -1,
                  ...d.lessons
                    .filter((l) => l.stage === lesson.stage)
                    .map((l) => l.order || 0),
                ) + 1;
              return { ...d, lessons: [...d.lessons, { ...lesson, order }] };
            });
            const selected = next.lessons.find((l) => l.path === lesson.path);
            setView((v) => ({
              ...v,
              stage: lesson.stage,
              grade: lesson.grade,
              collection: "",
              query: "",
              tags: [],
              selected: selected.id,
            }));
            setTool(null);
            refreshDetail();
            notify("已在讲义库创建：" + lesson.name);
          }}
        />
      ) : (
        tool && (
          <ToolComponent
            kind={tool}
            lesson={selected}
            files={toolFiles}
            onClose={() => setTool(null)}
            onRefresh={refreshDetail}
          />
        )
      )}
    </div>
  );
}
