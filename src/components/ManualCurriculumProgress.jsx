import React, { useState } from "react";
import { BookOpen, Save } from "lucide-react";
import { useApp } from "../shared/store";
import { useDraft } from "../shared/drafts";
import { GRADES } from "../shared/domain";
import { gradeLabel } from "../shared/exams";
import { useFiles } from "../shared/hooks";
import { mathTextbook, selectTextbooks } from "../shared/learningPlan";
import {
  academicTerm,
  curriculumContext,
  curriculumVolumes,
  CURRICULUM_MODES,
  CURRICULUM_SOURCES,
  gradeStage,
  saveSchoolProgress,
  saveStudentProgress,
  schoolScheduleKey,
  validProgress,
} from "../shared/zhejiangCurriculum";
import { Button, Field, Badge, Empty } from "./UI";

function ProgressForm({ student, school, grade, term }) {
  const { data, mutate, run } = useApp();
  const scope = student
    ? "student:" + student.id
    : "school:" + school.id + ":" + grade;
  const inherited = school?.mathSchedules?.[schoolScheduleKey(grade, term)];
  const saved = student
    ? validProgress(student.mathProgress, grade, term)
      ? student.mathProgress
      : null
    : inherited;
  const [form, setForm] = useDraft(
    "math-progress:" +
      scope +
      ":" +
      grade +
      ":" +
      term.schoolYear +
      ":" +
      term.semester,
    () =>
      saved || {
        ...term,
        grade,
        volume: "",
        chapter: "",
        mode: inherited?.mode || "同步巩固",
        notes: "",
      },
  );
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const volumes = curriculumVolumes(grade),
    volume = volumes.find((v) => v.volume === form.volume);
  return (
    <div className="curriculum-form">
      {student && inherited && (
        <p className="info-banner">
          已继承本校安排：{inherited.volume || "册次未确认"} ·{" "}
          {inherited.chapter || "章节未确认"}（{inherited.confirmedDate}
          确认）。留空学生册次与章节即可沿用。
        </p>
      )}
      <div className="form-grid two">
        <Field label="学校当前教材册次">
          <select
            value={form.volume}
            onChange={(e) => set("volume", e.target.value)}
          >
            <option value="">
              {student && inherited ? "沿用学校安排" : "待确认，不强行推断"}
            </option>
            {volumes.map((v) => (
              <option key={v.volume}>{v.volume}</option>
            ))}
          </select>
        </Field>
        <Field label="辅导方向">
          <select
            value={form.mode}
            onChange={(e) => set("mode", e.target.value)}
          >
            {CURRICULUM_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="学校当前章节或近期考试范围">
        <input
          value={form.chapter}
          maxLength={4000}
          onChange={(e) => set("chapter", e.target.value)}
          placeholder="可选，例如：学校正在讲对数函数，下周考函数性质"
        />
      </Field>
      <Field label="同步要求与学校安排补充">
        <textarea
          value={form.notes}
          maxLength={4000}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="可选，例如：辅导需先补对数运算，再跟上学校进度"
        />
      </Field>
      {volume && (
        <details className="curriculum-outline">
          <summary>
            <BookOpen size={15} />
            {volume.volume} · 目录摘要
          </summary>
          <p>{volume.outline}</p>
          <small>
            用于衔接章节；以配置的本地新版教材目录为准，不代表学校已教完这些内容。
          </small>
        </details>
      )}
      <div className="button-row">
        <Button
          icon={Save}
          variant="primary"
          onClick={() =>
            run(
              async () => {
                await mutate((d) =>
                  student
                    ? saveStudentProgress(d, student.id, form)
                    : saveSchoolProgress(d, school.id, grade, form),
                );
              },
              student
                ? "学生教材进度已保存，AI规划将使用此安排"
                : `本校${gradeLabel(grade)}进度已保存，仅供本校该年级学生共用`,
            )
          }
        >
          {student ? "保存教材进度" : `保存${gradeLabel(grade)}进度`}
        </Button>
        {saved && (
          <Button
            onClick={() =>
              run(async () => {
                await mutate((d) =>
                  student
                    ? {
                        ...d,
                        students: d.students.map((s) =>
                          s.id === student.id
                            ? { ...s, mathProgress: null }
                            : s,
                        ),
                      }
                    : {
                        ...d,
                        schools: d.schools.map((s) => {
                          if (s.id !== school.id) return s;
                          const plans = { ...s.mathSchedules };
                          delete plans[schoolScheduleKey(grade, term)];
                          return { ...s, mathSchedules: plans };
                        }),
                      },
                );
                setForm({
                  ...term,
                  grade,
                  volume: "",
                  chapter: "",
                  mode: "同步巩固",
                  notes: "",
                });
              }, "已清除这份安排")
            }
          >
            {student
              ? "清除学生单独安排"
              : `清除${gradeLabel(grade)}本学期安排`}
          </Button>
        )}
      </div>
      <p className="form-hint">
        以上内容均可选。未填写时 AI
        仍会根据授课、反馈等现有信息生成建议，不会要求先填表。
        {saved?.confirmedDate && ` 最近确认：${saved.confirmedDate}。`}
      </p>
    </div>
  );
}
export default function ManualCurriculumProgress({ student }) {
  const { data, config } = useApp();
  const [schoolId, setSchoolId] = useState(data.schools[0]?.id || ""),
    [grade, setGrade] = useState(""),
    [term, setTerm] = useState(academicTerm);
  const school = data.schools.find(
    (s) => s.id === (student ? student.schoolId : schoolId),
  );
  const schoolGrades = GRADES.filter((g) => gradeStage(g) === school?.stage);
  const actualGrade = student
      ? student.grade || ""
      : grade || schoolGrades[0] || "",
    stage = student ? gradeStage(actualGrade) : school?.stage || "";
  const context = student && curriculumContext(student, data);
  const textbook = mathTextbook(actualGrade);
  const local = useFiles(config[textbook.configKey], true);
  const books = selectTextbooks(local.files, actualGrade);
  return (
    <section className="curriculum-panel">
      <div className="section-head">
        <h3>浙江数学教材与进度</h3>
        <Badge>
          {stage === "高中"
            ? "人教A版"
            : stage === "初中"
              ? "浙教新版"
              : "请设置年级"}
        </Badge>
      </div>
      <p className="form-hint">
        初中按浙教新版、高中按人教A版衔接章节。年级与学期只用于选教材，不用于推断已经上到哪一章。
      </p>
      {!student && (
        <div className="form-grid two">
          <Field label="共用安排的学校">
            <select
              value={schoolId}
              onChange={(e) => {
                const id = e.target.value;
                setSchoolId(id);
                setGrade("");
              }}
            >
              <option value="">选择学校</option>
              {data.schools.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name} · {s.stage}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <div className="form-grid two">
        <Field label="教材安排学年">
          <select
            value={term.schoolYear}
            onChange={(e) =>
              setTerm((t) => ({ ...t, schoolYear: e.target.value }))
            }
          >
            {Array.from(
              { length: 5 },
              (_, i) => +academicTerm().schoolYear - 2 + i,
            ).map((y) => (
              <option key={y} value={y}>
                {y}—{y + 1}学年
              </option>
            ))}
          </select>
        </Field>
        <Field label="教材安排学期">
          <select
            value={term.semester}
            onChange={(e) =>
              setTerm((t) => ({ ...t, semester: e.target.value }))
            }
          >
            <option>上学期</option>
            <option>下学期</option>
          </select>
        </Field>
      </div>
      {!student && school && (
        <div className="school-curriculum-overview">
          <h4>{school.name} · 各年级进度</h4>
          <p className="form-hint">
            {term.schoolYear}—{+term.schoolYear + 1}学年{term.semester}
            。各年级分别设置、分别保存；修改一个年级不会覆盖其他年级。
          </p>
          <div className="school-curriculum-table">
            <table aria-label={school.name + "各年级教材进度"}>
              <thead>
                <tr>
                  <th scope="col">年级</th>
                  <th scope="col">教材与学校进度</th>
                  <th scope="col">关联学生</th>
                  <th scope="col">管理</th>
                </tr>
              </thead>
              <tbody>
                {schoolGrades.map((g) => {
                  const plan =
                    school.mathSchedules?.[schoolScheduleKey(g, term)];
                  const count = data.students.filter(
                    (s) => s.schoolId === school.id && s.grade === g,
                  ).length;
                  return (
                    <tr
                      key={g}
                      data-curriculum-grade={g}
                      className={grade === g ? "selected" : ""}
                    >
                      <th scope="row">{gradeLabel(g)}</th>
                      <td>
                        {plan ? (
                          <>
                            <strong>{plan.volume || "册次待确认"}</strong>
                            <p>{plan.chapter || "章节待确认"}</p>
                            <small>
                              {plan.mode} · {plan.confirmedDate}确认
                            </small>
                          </>
                        ) : (
                          <span className="form-hint">尚未设置本学期进度</span>
                        )}
                      </td>
                      <td>{count} 位</td>
                      <td>
                        <Button
                          onClick={() => setGrade(g)}
                          aria-expanded={grade === g}
                          aria-controls="school-grade-progress-editor"
                        >
                          编辑{gradeLabel(g)}进度
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {context && (
        <div className="curriculum-current">
          <p>
            <strong>当前学校进度：</strong>
            {context.schoolProgress
              ? `${context.schoolProgress.volume} ${context.schoolProgress.chapter}（${context.schoolProgress.source}）`
              : "未确认，AI会结合记录提出建议"}
          </p>
          <p>
            <strong>最近辅导进度：</strong>
            {context.tutoringProgress
              ? `${context.tutoringProgress.date} · ${context.tutoringProgress.topic}；下次：${context.tutoringProgress.nextProgress || "未记录"}`
              : "暂无已完成授课记录"}
          </p>
          {context.staleStudentProgress && (
            <p>旧学期或旧年级的单独进度已保留，本学期不自动沿用。</p>
          )}
        </div>
      )}
      {stage && (student || (school && grade)) ? (
        <div
          id={student ? undefined : "school-grade-progress-editor"}
          className={student ? undefined : "school-grade-progress-editor"}
        >
          {!student && (
            <div className="section-head">
              <h4>
                正在编辑：{school.name} · {gradeLabel(grade)} ·{" "}
                {term.schoolYear}—{+term.schoolYear + 1}学年{term.semester}
              </h4>
              <Button onClick={() => setGrade("")}>收起年级编辑</Button>
            </div>
          )}
          <ProgressForm
            key={[
              student?.id || school.id,
              actualGrade,
              term.schoolYear,
              term.semester,
            ].join(":")}
            student={student}
            school={school}
            grade={actualGrade}
            term={term}
          />
        </div>
      ) : !student && school ? (
        <p className="form-hint">
          从上方选择要维护的年级。已有安排会直接显示在各年级列表中。
        </p>
      ) : (
        <Empty
          title={student ? "设置学生年级后可关联教材" : "请先选择或添加学校"}
        />
      )}
      <details className="curriculum-outline">
        <summary>
          本地教材检查 ·{" "}
          {local.loading ? "读取中" : books.length + " 份可用候选"}
        </summary>
        {local.error ? (
          <p>
            教材目录暂不可读，请到“教材与练习”检查路径。AI会明确标注目录不足。
          </p>
        ) : !books.length ? (
          <p>
            尚未配置可读取的对应新版教材，AI将使用内置目录摘要并标注待核对。
          </p>
        ) : (
          books.map((b) => <p key={b.path}>{b.name}</p>)
        )}
        {stage === "初中" &&
          !books.some((b) => /9下|九年级下|初三下/.test(b.name)) && (
            <p>未找到九年级下册新版候选。旧版已排除，不会用于冒充新版。</p>
          )}
        <small>
          按文件名识别版本，不能代替出版信息核验；生成规划时会尝试提取目录。扫描件无文字或文件过大时将显示使用内置摘要。
        </small>
      </details>
      <details className="curriculum-outline">
        <summary>教材依据与使用说明</summary>
        <p>
          内置目录为章节摘要；本地新版课本可读目录优先。没有核实的目录会标注待确认。未内置全省统一周进度，高中册次与进度遵循学校实际安排。学校共用安排按学年、学期、年级保存，只供对应学生使用。
        </p>
        {CURRICULUM_SOURCES.map((s) => (
          <p key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
          </p>
        ))}
      </details>
    </section>
  );
}
