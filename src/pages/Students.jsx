import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  Users,
  BookOpen,
  CalendarCheck2,
  TrendingUp,
  FolderOpen,
  ArrowUpRight,
  MoreHorizontal,
  Phone,
  Pencil,
  Pause,
  Play,
  Trash2,
  FileText,
  Link2,
  ChevronRight,
  GripVertical,
  RefreshCw,
  Sparkles,
  Copy,
  Settings2,
} from "lucide-react";
import { useApp, useView } from "../shared/store";
import {
  GRADES,
  STATUSES,
  id,
  uniqueRef,
  removeRef,
  matches,
} from "../shared/domain";
import { services } from "../shared/services";
import { isWithinRoot, studentDirectoryState } from "../shared/paths";
import { useCourses, useFiles, useLessonIndex } from "../shared/hooks";
import StudentList, { Avatar } from "../components/StudentList";
import SchoolManager from "../components/SchoolManager";
import {
  SCHOOL_STAGES,
  schoolForStudent,
  schoolNameForStudent,
  schoolStageForGrade,
} from "../shared/schools";
import { addLessonReference } from "../shared/lessonReferences";
import {
  Button,
  IconButton,
  Badge,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  Field,
  Confirm,
  Tabs,
  Section,
  Markdown,
  FileItem,
  PageHeader,
  SearchBox,
} from "../components/UI";
import {
  HomeworkPanel,
  FeedbackPanel,
  WrongPanel,
  ReportPanel,
  AnalysisPanel,
} from "../components/StudentPanels";
import { Assistant } from "../components/AIPanel";
export function StudentForm({ student, onClose, onSaved }) {
  const { addStudent, editStudent, run, data } = useApp();
  const [schoolStage, setSchoolStage] = useState(
      schoolForStudent(student, data)?.stage ||
        schoolStageForGrade(student?.grade) ||
        "初中",
    ),
    [manageSchools, setManageSchools] = useState(false);
  const [form, setForm] = useState(
      student
        ? {
            name: student.name,
            grade: student.grade,
            phone: student.phone,
            notes: student.notes,
            schoolId: student.schoolId || "",
          }
        : { name: "", grade: "", phone: "", notes: "", schoolId: "" },
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={student ? "编辑学生档案" : "新增学生"}
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            const created = student
              ? await editStudent(student, form)
              : await addStudent(form);
            onSaved?.(created);
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid two">
          <Field label="学生姓名 *">
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="年级">
            <select
              value={form.grade}
              onChange={(e) => {
                const grade = e.target.value,
                  next = schoolStageForGrade(grade);
                if (next) setSchoolStage(next);
                setForm((f) => ({
                  ...f,
                  grade,
                  schoolId:
                    next && schoolForStudent(f, data)?.stage !== next
                      ? ""
                      : f.schoolId,
                }));
              }}
            >
              <option value="">请选择年级</option>
              {GRADES.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-grid two">
          <Field label="学校学段">
            <select
              value={schoolStage}
              onChange={(e) => {
                const stage = e.target.value;
                setSchoolStage(stage);
                setForm((f) => ({
                  ...f,
                  schoolId:
                    schoolForStudent(f, data)?.stage === stage
                      ? f.schoolId
                      : "",
                }));
              }}
            >
              {SCHOOL_STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="关联学校">
            <select
              value={form.schoolId}
              onChange={(e) =>
                setForm((f) => ({ ...f, schoolId: e.target.value }))
              }
            >
              <option value="">暂不关联学校</option>
              {data.schools
                .filter((s) => s.stage === schoolStage)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Button type="button" onClick={() => setManageSchools(true)}>
          管理 / 新增学校
        </Button>
        <Field label="家长电话">
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
        </Field>
        <Field label="备注">
          <textarea
            rows={4}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="学习目标、沟通习惯、需要留意的事…"
          />
        </Field>
        {!student && (
          <p className="form-hint">
            将同时在配置的学生根目录下创建同名文件夹。
          </p>
        )}
        {error && <ErrorBox message={error} />}
        <footer>
          <Button type="button" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            {student ? "保存修改" : "创建学生"}
          </Button>
        </footer>
      </form>
      {manageSchools && (
        <Modal title="学校管理" onClose={() => setManageSchools(false)} wide>
          <SchoolManager initialStage={schoolStage} />
        </Modal>
      )}
    </Modal>
  );
}
function LessonPicker({ student, onClose }) {
  const { data, mutate, run } = useApp();
  const { lessons, error, loading } = useLessonIndex();
  const [q, setQ] = useState(""),
    [stage, setStage] = useState(""),
    [grade, setGrade] = useState(""),
    [collection, setCollection] = useState("");
  return (
    <Modal title="从讲义库关联课程" onClose={onClose} wide>
      <SearchBox
        value={q}
        onChange={setQ}
        placeholder="搜索讲义、年级或路径…"
      />
      <div className="filter-row">
        <select
          aria-label="学段"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          <option value="">全部学段</option>
          {["初中", "高中", "中职"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          aria-label="年级"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
        >
          <option value="">全部年级</option>
          {[...new Set(lessons.map((l) => l.grade).filter(Boolean))].map(
            (x) => (
              <option key={x}>{x}</option>
            ),
          )}
        </select>
        <select
          aria-label="集合"
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
        >
          <option value="">全部集合</option>
          {[...new Set(lessons.map((l) => l.collection).filter(Boolean))].map(
            (x) => (
              <option key={x}>{x}</option>
            ),
          )}
        </select>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : !lessons.length ? (
        <Empty
          title="讲义库暂无内容"
          description="请配置讲义根目录并放入教学文件。"
        />
      ) : (
        lessons
          .filter(
            (l) =>
              !l.missing &&
              (!stage || l.stage === stage) &&
              (!grade || l.grade === grade) &&
              (!collection || l.collection === collection) &&
              matches(l.name + " " + l.path, q),
          )
          .map((l) => (
            <div className="lesson-pick-row" key={l.id}>
              <BookOpen size={22} />
              <div className="grow">
                <strong>{l.name}</strong>
                <small>{l.path}</small>
              </div>
              <Button
                disabled={data.refs.some(
                  (r) => r.studentId === student.id && r.lessonId === l.id,
                )}
                onClick={() =>
                  run(async () => {
                    uniqueRef(
                      data.refs.filter((r) => r.studentId === student.id),
                      l.id,
                    );
                    await mutate((d) =>
                      addLessonReference(d, student.id, l.id),
                    );
                  }, "讲义已关联")
                }
              >
                {data.refs.some(
                  (r) => r.studentId === student.id && r.lessonId === l.id,
                )
                  ? "已关联"
                  : "添加引用"}
              </Button>
            </div>
          ))
      )}
    </Modal>
  );
}
function CourseFiles({ course, student }) {
  const { run, config } = useApp();
  const accessible =
    course &&
    !course.missing &&
    isWithinRoot(
      course.path,
      course.isRef ? config.lessonsRoot : config.studentsRoot,
    );
  const { files, error, loading } = useFiles(
    accessible ? course.path : undefined,
    true,
  );
  const [summary, setSummary] = useState(""),
    [parseError, setParseError] = useState("");
  useEffect(() => {
    let live = true;
    setSummary("");
    setParseError("");
    const doc =
      files.find((f) => /教案.*\.(docx?|txt)$/i.test(f.name)) ||
      files.find((f) => /\.docx$/i.test(f.name));
    if (doc)
      services
        .readText(doc.path)
        .then((v) => {
          if (!live) return;
          const lines = v.split("\n").filter((x) => x.trim());
          const relevant = lines.filter(
            (x, i) =>
              /目标|重点|难点/.test(x) ||
              (i > 0 && /目标|重点|难点/.test(lines[i - 1])),
          );
          setSummary(
            relevant.slice(0, 16).join("\n\n") ||
              "文档中未识别到明确的教学目标或重难点，可打开原教案查看。",
          );
        })
        .catch((e) => live && setParseError(e.message));
    return () => {
      live = false;
    };
  }, [files]);
  return (
    <>
      <Section
        title="当前讲义"
        subtitle={course?.path || "选择一份课程，查看教学文件"}
        action={
          accessible && (
            <Button
              icon={FolderOpen}
              onClick={() => run(() => services.open(course.path))}
            >
              打开目录
            </Button>
          )
        }
      >
        {!course ? (
          <Empty
            icon={BookOpen}
            title="还没有选择课程"
            description="从左侧选择课程，或从讲义库添加引用。"
          />
        ) : !accessible ? (
          <ErrorBox message="这份讲义属于旧资源目录或路径已失效。请恢复对应根目录，或选择当前目录中的讲义。原引用记录已保留。" />
        ) : loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} />
        ) : (
          <>
            <div className="course-title">
              <span className="course-symbol">
                <BookOpen size={25} />
              </span>
              <div>
                <h3>{course.name}</h3>
                <span>
                  {files.filter((f) => !f.isDirectory).length} 份文件
                  {course.isRef ? " · 来自个人讲义库" : " · 学生本地课程"}
                </span>
              </div>
            </div>
            <div className="file-grid">
              {files
                .filter((f) => !f.isDirectory)
                .map((f) => (
                  <FileItem
                    key={f.path}
                    file={f}
                    onOpen={() => run(() => services.open(f.path))}
                  />
                ))}
            </div>
            {!files.filter((f) => !f.isDirectory).length && (
              <Empty title="课程目录暂无文件" />
            )}
          </>
        )}
      </Section>
      {course && (
        <Section title="教案摘要" subtitle="从本地文档读取教学目标与重难点">
          {parseError ? (
            <ErrorBox message={parseError} />
          ) : summary ? (
            <Markdown>{summary}</Markdown>
          ) : (
            <p className="muted">未找到可解析的教案 DOC / DOCX 文件。</p>
          )}
        </Section>
      )}
      {course?.resources?.length > 0 && (
        <Section title="关联参考资料">
          {course.resources.map((r) => (
            <FileItem
              key={r.path}
              file={r}
              onOpen={() => run(() => services.open(r.path))}
            />
          ))}
        </Section>
      )}
    </>
  );
}
export default function Students({ navigate }) {
  const { data, config, mutate, run, syncStudents, deleteStudent } = useApp();
  const [view, setView] = useView("students", {
    selected: "",
    query: "",
    grade: "",
    status: "active",
    course: "",
    tab: "overview",
    courseWidth: 232,
  });
  const [modal, setModal] = useState(null),
    [assistant, setAssistant] = useState(false);
  const student = data.students.find((s) => s.id === view.selected);
  const { courses, error, refresh, directoryState } = useCourses(student);
  const currentNameMatches = student
    ? data.students.filter(
        (s) =>
          s.id !== student.id &&
          s.name === student.name &&
          studentDirectoryState(s, config.studentsRoot) === "available",
      )
    : [];
  const course = courses.find((c) => c.id === view.course);
  const [drag, setDrag] = useState("");
  const change = (k, v) => setView((s) => ({ ...s, [k]: v }));
  const active = data.students.filter((s) => s.status !== "已停课");
  const count = (k) =>
    data[k].filter((x) => x.studentId === student?.id).length;
  const resize = (e) => {
    const start = e.clientX,
      initial = view.courseWidth || 232;
    const move = (ev) =>
      change(
        "courseWidth",
        Math.min(380, Math.max(180, initial + ev.clientX - start)),
      );
    const stop = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  };
  return (
    <div className="page students-page">
      <PageHeader
        title="学生管理"
        description="把每一次教学，连成清晰的成长轨迹。"
        eyebrow="STUDENT WORKSPACE"
      >
        <Button
          icon={RefreshCw}
          onClick={() => run(syncStudents, "学生目录已刷新")}
        >
          刷新目录
        </Button>
        <Button icon={Plus} variant="primary" onClick={() => setModal("new")}>
          新增学生
        </Button>
      </PageHeader>
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-icon blue">
            <Users size={21} />
          </span>
          <div>
            <small>在读学生</small>
            <b>
              {active.length}
              <em>位</em>
            </b>
          </div>
          <span className="stat-hint">持续陪伴</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon mint">
            <BookOpen size={21} />
          </span>
          <div>
            <small>关联讲义</small>
            <b>
              {data.refs.length}
              <em>份</em>
            </b>
          </div>
          <span className="stat-hint">教学积累</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon peach">
            <CalendarCheck2 size={21} />
          </span>
          <div>
            <small>待完成作业</small>
            <b>
              {
                data.homework.filter(
                  (h) =>
                    !h.completed && active.some((s) => s.id === h.studentId),
                ).length
              }
              <em>份</em>
            </b>
          </div>
          <span className="stat-hint">及时跟进</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon purple">
            <TrendingUp size={21} />
          </span>
          <div>
            <small>课堂反馈</small>
            <b>
              {data.feedback.length}
              <em>次</em>
            </b>
          </div>
          <span className="stat-hint">看见成长</span>
        </div>
      </div>
      <div
        className="student-workspace"
        style={{ "--course-width": (view.courseWidth || 232) + "px" }}
      >
        <StudentList
          selected={view.selected}
          onSelect={(sid) =>
            setView((v) => ({
              ...v,
              selected: sid,
              course: "",
              tab: "overview",
            }))
          }
          query={view.query}
          onQuery={(v) => change("query", v)}
          grade={view.grade}
          onGrade={(v) => change("grade", v)}
          status={view.status}
          onStatus={(v) => change("status", v)}
          onAdd={() => setModal("new")}
          onSettings={() => navigate("settings")}
        />
        <aside className="course-list panel">
          <div className="panel-heading">
            <h2>
              课程讲义 <span>{courses.length}</span>
            </h2>
            <IconButton
              icon={Plus}
              label="从讲义库添加"
              disabled={!student || student.status === "已停课"}
              onClick={() => setModal("lessons")}
            />
          </div>
          <div className="course-caption">
            {student ? student.name + "的教学安排" : "选择学生后查看课程"}
          </div>
          <div className="course-list-items">
            {error && <ErrorBox message={error} />}
            {!courses.length ? (
              <Empty
                icon={BookOpen}
                title="暂无课程讲义"
                description="从讲义库关联，或放入学生文件夹。"
              />
            ) : (
              courses.map((c, i) => (
                <div
                  key={c.id}
                  className={
                    "course-item " + (view.course === c.id ? "selected" : "")
                  }
                  draggable={student.status !== "已停课"}
                  onDragStart={() => setDrag(c.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const order = courses
                      .map((c) => c.id)
                      .filter((cid) => cid !== drag);
                    order.splice(order.indexOf(c.id), 0, drag);
                    run(() =>
                      mutate((d) => ({
                        ...d,
                        courseOrders: {
                          ...d.courseOrders,
                          [student.id]: order,
                        },
                      })),
                    );
                  }}
                >
                  <button onClick={() => change("course", c.id)}>
                    <span className="course-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <strong>{c.name}</strong>
                      <small>
                        {c.missing
                          ? "来源缺失"
                          : c.isRef
                            ? "讲义库引用"
                            : "本地课程"}
                      </small>
                    </span>
                    <GripVertical size={14} />
                  </button>
                  {c.isRef && (
                    <button
                      className="remove-ref"
                      disabled={student.status === "已停课"}
                      onClick={() => setModal({ removeRef: c })}
                    >
                      移除引用
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <button
            className="panel-bottom"
            onClick={() => navigate("lessonLibrary")}
          >
            <BookOpen size={16} />
            前往讲义库
            <ArrowUpRight size={15} />
          </button>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整课程栏宽度"
            tabIndex={0}
            className="resize-handle"
            onPointerDown={resize}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight")
                change(
                  "courseWidth",
                  Math.min(380, (view.courseWidth || 232) + 10),
                );
              if (e.key === "ArrowLeft")
                change(
                  "courseWidth",
                  Math.max(180, (view.courseWidth || 232) - 10),
                );
            }}
          />
        </aside>
        <div className="student-detail panel">
          {student ? (
            <>
              <div className="student-profile">
                <Avatar student={student} size="large" />
                <div className="grow">
                  <div className="profile-title">
                    <button
                      title="复制姓名"
                      onClick={() =>
                        run(
                          () => navigator.clipboard.writeText(student.name),
                          "姓名已复制",
                        )
                      }
                    >
                      {student.name}
                    </button>
                    <Badge
                      type={student.status === "已停课" ? "muted" : "success"}
                    >
                      {student.status}
                    </Badge>
                  </div>
                  <div className="profile-meta">
                    <span>{student.grade || "未设置年级"}</span>
                    {schoolNameForStudent(student, data) && (
                      <span>{schoolNameForStudent(student, data)}</span>
                    )}
                    <span>
                      <Phone size={12} />
                      {student.phone || "未设置电话"}
                    </span>
                  </div>
                </div>
                <IconButton
                  icon={Pencil}
                  label="编辑学生档案"
                  onClick={() => setModal("edit")}
                />
                <IconButton
                  icon={FolderOpen}
                  label="打开学生文件夹"
                  disabled={directoryState !== "available"}
                  onClick={() =>
                    run(() => services.open(student.directoryPath))
                  }
                />
                <IconButton
                  icon={MoreHorizontal}
                  label="学生更多操作"
                  onClick={() => setModal("manage")}
                />
              </div>
              {student.notes && <p className="student-note">{student.notes}</p>}
              <Tabs
                items={[
                  { key: "overview", label: "课程概览" },
                  { key: "homework", label: "作业 " + count("homework") },
                  { key: "feedback", label: "课堂反馈" },
                  { key: "wrong", label: "错题" },
                  { key: "reports", label: "学习报告" },
                  { key: "analysis", label: "学情分析" },
                ]}
                value={view.tab}
                onChange={(v) => change("tab", v)}
              />
              <div className="student-detail-scroll" key={student.id}>
                {directoryState !== "available" && (
                  <div
                    role="status"
                    className="info-banner student-directory-notice"
                  >
                    <strong>
                      {directoryState === "outside"
                        ? "该档案属于旧学生目录"
                        : directoryState === "unconfigured"
                          ? "尚未配置学生根目录"
                          : "学生目录已失效"}
                    </strong>
                    <p>
                      已保留该档案及关联记录，暂停扫描此路径：
                      {student.directoryPath}
                    </p>
                    <div className="button-row">
                      {currentNameMatches.length === 1 && (
                        <Button
                          onClick={() =>
                            setView((v) => ({
                              ...v,
                              selected: currentNameMatches[0].id,
                              course: "",
                              tab: "overview",
                            }))
                          }
                        >
                          切换到当前目录的同名学生
                        </Button>
                      )}
                      <Button onClick={() => navigate("settings")}>
                        检查目录配置
                      </Button>
                    </div>
                  </div>
                )}

                {student.status === "已停课" && (
                  <div className="info-banner">
                    已停课，教学记录保留。恢复授课后可继续新增教学活动。
                  </div>
                )}
                {view.tab === "overview" && (
                  <CourseFiles course={course} student={student} />
                )}
                {view.tab === "homework" && <HomeworkPanel student={student} />}
                {view.tab === "feedback" && (
                  <FeedbackPanel
                    key={course?.id}
                    student={student}
                    courses={courses}
                    course={course}
                  />
                )}
                {view.tab === "wrong" && (
                  <WrongPanel student={student} course={course} />
                )}
                {view.tab === "reports" && <ReportPanel student={student} />}
                {view.tab === "analysis" && <AnalysisPanel student={student} />}
                <div className="assistant-banner">
                  <span className="assistant-spark">
                    <Sparkles size={21} />
                  </span>
                  <div>
                    <strong>让教学记录，成为下一步的依据</strong>
                    <p>结合当前学生的记录，和 AI 一起梳理教学思路。</p>
                  </div>
                  <Button onClick={() => setAssistant(true)}>
                    打开助手
                    <ArrowUpRight size={14} />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="workspace-welcome">
              <div className="welcome-art">
                <BookOpen size={64} strokeWidth={1} />
                <span className="welcome-dot one" />
                <span className="welcome-dot two" />
              </div>
              <span className="eyebrow">每一位学生，都值得被看见</span>
              <h2>从一份学生档案开始</h2>
              <p>
                把课程、作业、反馈与成长记录连在一起，
                <br />
                留出更多时间，专注教学本身。
              </p>
              <Button
                variant="primary"
                icon={config.studentsRoot ? Plus : FolderOpen}
                onClick={() =>
                  config.studentsRoot ? setModal("new") : navigate("settings")
                }
              >
                {config.studentsRoot ? "新增第一位学生" : "连接学生目录"}
              </Button>
              <div className="welcome-steps">
                <span>01 连接目录</span>
                <ChevronRight size={12} />
                <span>02 建立档案</span>
                <ChevronRight size={12} />
                <span>03 记录成长</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {(modal === "new" || modal === "edit") && (
        <StudentForm
          student={modal === "edit" ? student : null}
          onClose={() => setModal(null)}
          onSaved={(s) => s && change("selected", s.id)}
        />
      )}
      {modal === "lessons" && student && (
        <LessonPicker student={student} onClose={() => setModal(null)} />
      )}
      {modal === "manage" && student && (
        <Modal title="学生管理操作" onClose={() => setModal(null)}>
          <Field label="授课状态">
            <select
              value={student.status}
              onChange={(e) => {
                const status = e.target.value;
                run(() =>
                  mutate((d) => ({
                    ...d,
                    students: d.students.map((s) =>
                      s.id === student.id ? { ...s, status } : s,
                    ),
                  })),
                );
              }}
            >
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Button
            variant="danger"
            icon={Trash2}
            disabled={directoryState !== "available"}
            onClick={() => setModal("delete")}
          >
            删除学生及本地目录
          </Button>
        </Modal>
      )}
      {modal === "delete" && student && (
        <Confirm
          title="删除学生"
          name={student.name}
          description={
            "学生目录将移入系统废纸篓；同时清除该学生的档案、作业、反馈、回访、笔记、错题与报告索引。讲义库原件保留。目录：" +
            student.directoryPath
          }
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await deleteStudent(student);
            change("selected", "");
          }}
        />
      )}
      {modal?.removeRef && (
        <Confirm
          title="移除讲义引用"
          description="只移除学生与讲义的关系，讲义库原件保留。被课堂反馈使用的引用需要先处理反馈。"
          onClose={() => setModal(null)}
          onConfirm={() =>
            mutate((d) => {
              const remaining = removeRef(
                d.refs.filter((r) => r.studentId === student.id),
                modal.removeRef.id,
                d.feedback.filter((f) => f.studentId === student.id),
              );
              return {
                ...d,
                refs: [
                  ...d.refs.filter((r) => r.studentId !== student.id),
                  ...remaining,
                ],
              };
            })
          }
        />
      )}
      {assistant && student && (
        <Assistant student={student} onClose={() => setAssistant(false)} />
      )}
    </div>
  );
}
