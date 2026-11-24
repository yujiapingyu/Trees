import { copyExamFiles, appendExamFiles } from "../shared/examFiles";
import React, { useState, useRef, useEffect } from "react";
import { Plus, Files, FolderOpen, Pencil, Archive, Trash2 } from "lucide-react";
import { useApp, useView } from "../shared/store";
import { id, today, matches } from "../shared/domain";
import { schoolStageForGrade } from "../shared/schools";
import {
  EXAM_GRADES,
  gradeLabel,
  saveExam,
  deleteExam,
  removeExamFile,
  paperGroups,
} from "../shared/exams";
import { services, join, basename } from "../shared/services";
import {
  PageHeader,
  Button,
  SearchBox,
  Field,
  Modal,
  ErrorBox,
  Section,
  Empty,
  Badge,
  Confirm,
  FileItem,
} from "../components/UI";
import ExamRecordEditor from "../components/ExamRecordEditor";
function ExamForm({ exam, onClose, onSaved }) {
  const { data, mutate } = useApp();
  const [form, setForm] = useState(
      exam
        ? structuredClone(exam)
        : {
            id: id(),
            name: "",
            kind: "alliance",
            organizer: "",
            grade: "高中一年级",
            date: today(),
            schoolIds: [],
            subjects: [{ id: id(), name: "数学", maxScore: 150, files: [] }],
            notes: "",
            archived: false,
            stage: "",
          },
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const schools = data.schools.filter(
    (s) => s.stage === schoolStageForGrade(form.grade),
  );
  return (
    <Modal
      title={exam ? "编辑考试" : "新建考试"}
      onClose={() => !busy && onClose()}
      wide
    >
      <Field label="考试名称">
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="例如：A9联盟11月测试"
        />
      </Field>
      <div className="form-grid two">
        <Field label="考试类型">
          <select
            value={form.kind}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                kind: e.target.value,
                schoolIds:
                  e.target.value === "school"
                    ? f.schoolIds.slice(0, 1)
                    : f.schoolIds,
              }))
            }
          >
            <option value="alliance">联盟 / 多校统考</option>
            <option value="school">学校独立考试</option>
          </select>
        </Field>
        <Field label="联盟 / 组织名称">
          <input
            disabled={form.kind !== "alliance"}
            value={form.organizer}
            onChange={(e) => set("organizer", e.target.value)}
            placeholder="例如：A9联盟"
          />
        </Field>
        <Field label="考试年级">
          <select
            value={form.grade}
            onChange={(e) => set("grade", e.target.value)}
          >
            {EXAM_GRADES.map((g) => (
              <option value={g} key={g}>
                {gradeLabel(g)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="考试日期">
          <input
            type="date"
            value={form.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </Field>
      </div>
      <Field label="参与学校">
        <div>
          {schools.map((s) => (
            <label className="check-label" key={s.id}>
              <input
                type="checkbox"
                aria-label={s.name}
                checked={form.schoolIds.includes(s.id)}
                onChange={(e) =>
                  set(
                    "schoolIds",
                    e.target.checked
                      ? form.kind === "school"
                        ? [s.id]
                        : [...form.schoolIds, s.id]
                      : form.schoolIds.filter((key) => key !== s.id),
                  )
                }
              />
              {s.name}
            </label>
          ))}
          {!schools.length && (
            <p className="info-banner">
              请先到配置中心「学校管理」添加对应学段的学校。
            </p>
          )}
        </div>
      </Field>
      <h4>考试学科与满分</h4>
      {form.subjects.map((s, i) => (
        <div className="exam-subject-form" key={s.id}>
          <Field label={"学科" + (i + 1)}>
            <input
              value={s.name}
              onChange={(e) =>
                set(
                  "subjects",
                  form.subjects.map((x) =>
                    x.id === s.id ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
          </Field>
          <Field label={"学科" + (i + 1) + "满分"}>
            <input
              type="number"
              min="0.1"
              step="any"
              value={s.maxScore}
              onChange={(e) =>
                set(
                  "subjects",
                  form.subjects.map((x) =>
                    x.id === s.id ? { ...x, maxScore: e.target.value } : x,
                  ),
                )
              }
            />
          </Field>
          <Button
            onClick={() =>
              set(
                "subjects",
                form.subjects.filter((x) => x.id !== s.id),
              )
            }
          >
            移除学科
          </Button>
        </div>
      ))}
      <Button
        icon={Plus}
        onClick={() =>
          set("subjects", [
            ...form.subjects,
            { id: id(), name: "", maxScore: 100, files: [] },
          ])
        }
      >
        添加学科
      </Button>
      <Field label="考试备注">
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      {error && <ErrorBox message={error} />}
      <footer>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button
          variant="primary"
          busy={busy}
          onClick={async () => {
            setError("");
            setBusy(true);
            try {
              await mutate((d) => saveExam(d, form));
              onSaved(form.id);
              onClose();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存考试
        </Button>
      </footer>
    </Modal>
  );
}
function AttachmentForm({ exam, onClose, initial = {} }) {
  const { config, data, mutate } = useApp();
  const [form, setForm] = useState({
      subjectId: initial.subjectId || exam.subjects[0]?.id || "",
      schoolId: initial.schoolId || "",
      version: initial.version || "默认卷",
      papers: [],
      answers: [],
    }),
    [busy, setBusy] = useState(false),
    [choosing, setChoosing] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const cache = useRef(new Map());
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const choose = async (key) => {
    setError("");
    setChoosing(true);
    try {
      const chosen = await services.pick("files");
      const paths = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
      setForm((f) => ({ ...f, [key]: [...new Set([...f[key], ...paths])] }));
    } catch (e) {
      setError(e.message);
    } finally {
      setChoosing(false);
    }
  };
  const locked = busy || choosing;
  return (
    <Modal title="添加试卷 / 答案" onClose={() => !locked && onClose()} wide>
      <div className="form-grid two">
        <Field label="文件学科">
          <select
            disabled={locked}
            value={form.subjectId}
            onChange={(e) => set("subjectId", e.target.value)}
          >
            {exam.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="文件适用学校">
          <select
            disabled={locked}
            value={form.schoolId}
            onChange={(e) => set("schoolId", e.target.value)}
          >
            <option value="">所有参与学校共用</option>
            {data.schools
              .filter((s) => exam.schoolIds.includes(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label="卷别 / 版本">
        <input
          disabled={locked}
          value={form.version}
          onChange={(e) => set("version", e.target.value)}
          placeholder="默认卷、A卷等；试卷和对应答案使用相同卷别"
        />
      </Field>
      <div className="exam-upload-columns">
        {[
          ["papers", "试卷文件", "选择试卷（可多选）"],
          ["answers", "答案 / 解析文件", "选择答案（可多选）"],
        ].map(([key, title, label]) => (
          <section className="exam-upload-section" key={key}>
            <h4>
              {title} <Badge>{form[key].length} 份</Badge>
            </h4>
            <Button icon={Plus} disabled={locked} onClick={() => choose(key)}>
              {label}
            </Button>
            {form[key].length ? (
              form[key].map((path) => (
                <div className="exam-selected-file" key={path}>
                  <div>
                    <strong>{basename(path)}</strong>
                    <small>{path}</small>
                  </div>
                  <Button
                    disabled={locked}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        [key]: f[key].filter((p) => p !== path),
                      }))
                    }
                    aria-label={"移除已选" + basename(path)}
                  >
                    移除
                  </Button>
                </div>
              ))
            ) : (
              <p className="form-hint">
                尚未选择{key === "papers" ? "试卷" : "答案"}
                ，可先单独保存另一类，之后再补充。
              </p>
            )}
          </section>
        ))}
      </div>
      <p className="info-banner">
        本次添加：试卷 {form.papers.length} 份，答案 {form.answers.length}{" "}
        份。两类独立选择，一次保存；可反复添加文件。复制至考试资料目录，原文件保留，同名文件不覆盖。
      </p>
      {progress && <p role="status">{progress}</p>}
      {error && <ErrorBox message={error} />}
      <footer>
        <Button disabled={locked} onClick={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={choosing || (!form.papers.length && !form.answers.length)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const additions = await copyExamFiles({
                root: config.examsRoot,
                examId: exam.id,
                subjectId: form.subjectId,
                schoolId: form.schoolId,
                version: form.version,
                papers: form.papers,
                answers: form.answers,
                copy: services.copy,
                cache: cache.current,
                onProgress: (n, total) =>
                  setProgress("正在保存文件 " + n + " / " + total),
              });
              await mutate((d) =>
                appendExamFiles(d, exam.id, form.subjectId, additions),
              );
              onClose();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
              setProgress("");
            }
          }}
        >
          保存文件关联
        </Button>
      </footer>
    </Modal>
  );
}
export default function Exams() {
  const { data, mutate, run } = useApp();
  const [view, setView] = useView("exams", {
    selected: "",
    query: "",
    grade: "",
    school: "",
    archived: false,
    stage: "",
  });
  const [form, setForm] = useState(null),
    [files, setFiles] = useState(false),
    [record, setRecord] = useState(null),
    [remove, setRemove] = useState(null);
  const exam = data.exams.find((e) => e.id === view.selected),
    records = data.examRecords.filter((r) => r.examId === exam?.id);
  const filtered = data.exams
    .filter(
      (e) =>
        (view.archived || !e.archived) &&
        (!view.stage || schoolStageForGrade(e.grade) === view.stage) &&
        (!view.grade || e.grade === view.grade) &&
        (!view.school || e.schoolIds.includes(view.school)) &&
        matches(e.name + " " + e.organizer + " " + e.date, view.query),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const set = (k, v) => setView((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (view.selected && !filtered.some((e) => e.id === view.selected))
      set("selected", "");
  }, [view.stage, view.grade, view.school, view.query, view.archived]);
  const grades = EXAM_GRADES.filter(
    (g) => !view.stage || schoolStageForGrade(g) === view.stage,
  );
  const gradeCount = (g) =>
    data.exams.filter(
      (e) =>
        e.grade === g &&
        (view.archived || !e.archived) &&
        (!view.school || e.schoolIds.includes(view.school)) &&
        matches(e.name + " " + e.organizer + " " + e.date, view.query),
    ).length;
  return (
    <div className="page">
      <PageHeader
        title="考试管理"
        eyebrow="EXAMS & RESULTS"
        description="一次联盟考试，多校共用资料；学生成绩独立记录。"
      >
        <Button variant="primary" icon={Plus} onClick={() => setForm({})}>
          新建考试
        </Button>
      </PageHeader>
      <div
        className="stage-switch exam-stage-switch"
        role="group"
        aria-label="考试学段分类"
      >
        {[
          ["", "全部学段"],
          ["初中", "初中"],
          ["高中", "高中"],
        ].map(([k, label]) => (
          <button
            key={k}
            className={view.stage === k || (!view.stage && !k) ? "active" : ""}
            aria-pressed={(view.stage || "") === k}
            onClick={() =>
              setView((v) => ({ ...v, stage: k, grade: "", selected: "" }))
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="exam-grade-categories"
        role="group"
        aria-label="考试年级分类"
      >
        <Button onClick={() => set("grade", "")} aria-pressed={!view.grade}>
          全部年级
        </Button>
        {grades.map((g) => (
          <Button
            key={g}
            aria-pressed={view.grade === g}
            variant={view.grade === g ? "primary" : ""}
            onClick={() => set("grade", g)}
          >
            {gradeLabel(g)}（{gradeCount(g)}）
          </Button>
        ))}
      </div>
      <div className="exam-management-layout">
        <aside className="panel exam-list-panel">
          <SearchBox
            value={view.query}
            onChange={(q) => set("query", q)}
            placeholder="搜索考试、联盟、日期…"
          />
          <div className="filter-row">
            <select
              aria-label="筛选考试年级"
              value={view.grade}
              onChange={(e) => set("grade", e.target.value)}
            >
              <option value="">全部年级</option>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {gradeLabel(g)}
                </option>
              ))}
            </select>
            <select
              aria-label="筛选考试学校"
              value={view.school}
              onChange={(e) => set("school", e.target.value)}
            >
              <option value="">全部学校</option>
              {data.schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={view.archived}
              onChange={(e) => set("archived", e.target.checked)}
            />
            包含归档考试
          </label>
          <div className="exam-list-scroll">
            {!filtered.length ? (
              <Empty
                icon={Files}
                title="暂无考试"
                description="先添加学校，再创建联盟统考或学校独立考试。"
              />
            ) : (
              grades
                .filter((g) => filtered.some((e) => e.grade === g))
                .map((g) => (
                  <section
                    className="exam-grade-group"
                    key={g}
                    aria-label={gradeLabel(g) + "考试"}
                  >
                    <h3>
                      {gradeLabel(g)}{" "}
                      <small>
                        {filtered.filter((e) => e.grade === g).length}场
                      </small>
                    </h3>
                    {filtered
                      .filter((e) => e.grade === g)
                      .map((e) => (
                        <button
                          className={
                            "exam-list-entry " +
                            (exam?.id === e.id ? "selected" : "")
                          }
                          key={e.id}
                          onClick={() => set("selected", e.id)}
                        >
                          <strong>{e.name}</strong>
                          <small>
                            {e.date} · {gradeLabel(e.grade)} ·{" "}
                            {e.kind === "alliance" ? "联盟统考" : "学校独考"}
                            {e.archived ? " · 已归档" : ""}
                          </small>
                        </button>
                      ))}
                  </section>
                ))
            )}
          </div>
        </aside>
        <div className="scroll-pane">
          {!exam ? (
            <div className="card">
              <Empty
                title="选择考试，管理试卷与成绩"
                description="试卷和答案按学科、学校范围、卷别集中管理。"
              />
            </div>
          ) : (
            <>
              <Section
                title={exam.name}
                subtitle={`${exam.date} · ${gradeLabel(exam.grade)} · ${exam.organizer || "学校独立考试"}`}
                action={
                  <Button
                    icon={Pencil}
                    disabled={exam.archived}
                    onClick={() => setForm(exam)}
                  >
                    编辑考试
                  </Button>
                }
              >
                <p>
                  参与学校：
                  {exam.schoolIds
                    .map(
                      (key) =>
                        data.schools.find((s) => s.id === key)?.name ||
                        "学校信息缺失",
                    )
                    .join("、")}
                </p>
                {exam.notes && <p>{exam.notes}</p>}
                <div className="button-row">
                  <Button
                    icon={Archive}
                    onClick={() =>
                      run(() =>
                        mutate((d) => ({
                          ...d,
                          exams: d.exams.map((e) =>
                            e.id === exam.id
                              ? { ...e, archived: !e.archived }
                              : e,
                          ),
                        })),
                      )
                    }
                  >
                    {exam.archived ? "恢复考试" : "归档考试"}
                  </Button>
                  <Button
                    variant="danger"
                    icon={Trash2}
                    onClick={() => setRemove({ exam })}
                  >
                    删除考试
                  </Button>
                </div>
              </Section>
              <Section
                title="试卷与答案文件"
                subtitle="共用卷只需上传一次；可另存学校专用卷与不同版本"
                action={
                  <Button
                    icon={Plus}
                    disabled={exam.archived}
                    onClick={() => setFiles({})}
                  >
                    添加文件
                  </Button>
                }
              >
                {exam.subjects.map((s) => (
                  <div className="exam-subject-block" key={s.id}>
                    <h4>
                      {s.name} · 满分 {s.maxScore}
                    </h4>
                    {!s.files?.length ? (
                      <p className="muted">试卷、答案均待补充</p>
                    ) : (
                      paperGroups(s).map((g) => (
                        <div
                          className="exam-paper-group"
                          key={JSON.stringify([g.schoolId, g.version])}
                        >
                          <Badge
                            type={
                              g.paper.length && g.answer.length
                                ? "success"
                                : "warning"
                            }
                          >
                            {!g.paper.length
                              ? "待补试卷"
                              : !g.answer.length
                                ? "待补答案"
                                : "试卷 / 答案已配对"}
                          </Badge>
                          <p>
                            {g.schoolId
                              ? data.schools.find((x) => x.id === g.schoolId)
                                  ?.name
                              : "所有学校共用"}{" "}
                            · {g.version}
                          </p>
                          <Button
                            icon={Plus}
                            disabled={exam.archived}
                            onClick={() =>
                              setFiles({
                                subjectId: s.id,
                                schoolId: g.schoolId,
                                version: g.version,
                              })
                            }
                          >
                            补充本组试卷 / 答案
                          </Button>
                          {[...g.paper, ...g.answer].map((f) => (
                            <FileItem
                              key={f.id}
                              file={{
                                ...f,
                                name:
                                  (f.kind === "paper" ? "试卷" : "答案") +
                                  " · " +
                                  f.name,
                              }}
                              onOpen={() => run(() => services.open(f.path))}
                              action={
                                <Button
                                  disabled={exam.archived}
                                  onClick={() =>
                                    setRemove({ file: f, subjectId: s.id })
                                  }
                                >
                                  移除文件关联
                                </Button>
                              }
                            />
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </Section>
              <Section
                title="关联学生与成绩"
                subtitle={records.length + " 位学生；未出分不按零分统计"}
                action={
                  <Button
                    icon={Plus}
                    disabled={exam.archived}
                    onClick={() => setRecord({})}
                  >
                    关联学生
                  </Button>
                }
              >
                {!records.length ? (
                  <Empty title="尚未关联学生" />
                ) : (
                  records.map((r) => (
                    <div className="linked-row" key={r.id}>
                      <strong>
                        {data.students.find((s) => s.id === r.studentId)
                          ?.name || "历史学生"}
                      </strong>
                      <span>{r.schoolSnapshot.name}</span>
                      <small>
                        {exam.subjects
                          .map((s) => {
                            const result = r.results.find(
                              (x) => x.subjectId === s.id,
                            );
                            return (
                              s.name +
                              " " +
                              (result?.status === "scored"
                                ? result.score
                                : result?.status === "absent"
                                  ? "缺考"
                                  : "未出分")
                            );
                          })
                          .join(" · ")}
                      </small>
                      <Button
                        disabled={
                          exam.archived ||
                          data.students.find((s) => s.id === r.studentId)
                            ?.status === "已停课"
                        }
                        onClick={() => setRecord(r)}
                      >
                        编辑成绩
                      </Button>
                    </div>
                  ))
                )}
              </Section>
            </>
          )}
        </div>
      </div>
      {form && (
        <ExamForm
          exam={form.id ? form : null}
          onClose={() => setForm(null)}
          onSaved={(key) =>
            setView((v) => ({
              ...v,
              selected: key,
              stage: "",
              grade: "",
              school: "",
              query: "",
            }))
          }
        />
      )}
      {files && exam && (
        <AttachmentForm
          exam={exam}
          initial={files}
          onClose={() => setFiles(false)}
        />
      )}
      {record && exam && (
        <ExamRecordEditor
          exam={exam}
          record={record.id ? record : null}
          onClose={() => setRecord(null)}
        />
      )}
      {remove && (
        <Confirm
          title={remove.exam ? "删除考试" : "移除文件关联"}
          description={
            remove.exam
              ? "有学生成绩或课程讲义引用时不能删除，请使用归档。删除考试登记不会删除磁盘文件。"
              : "只移除考试中的此文件关联，原始文件和保存的副本均保留。"
          }
          onClose={() => setRemove(null)}
          onConfirm={() =>
            mutate((d) =>
              remove.exam
                ? deleteExam(d, remove.exam.id)
                : removeExamFile(d, exam.id, remove.subjectId, remove.file.id),
            )
          }
        />
      )}
    </div>
  );
}
