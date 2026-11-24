import React, { useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw, BookOpen } from "lucide-react";
import { useApp } from "../shared/store";
import { useCourses, useFiles } from "../shared/hooks";
import { services } from "../shared/services";
import { id, parseJSONResult } from "../shared/domain";
import {
  mathTextbook,
  learningPlanPrompt,
  validateCoursePlan,
} from "../shared/learningPlan";
import { enrichPlanningSnapshot } from "../shared/planningContext";
import { freshReport, reportSnapshot } from "../shared/reports";
import {
  automaticPlanKey,
  automaticSourceKey,
  inferAutomaticProgress,
  localAutomaticPlan,
} from "../shared/automaticCurriculum";
import { Badge, Button, CopyButton, Empty, ErrorBox } from "./UI";

function StudentAutomaticPlan({ student }) {
  const { data, config, mutate } = useApp();
  const latest = useRef({ data, config });
  latest.current = { data, config };
  const courses = useCourses(student);
  const progress = inferAutomaticProgress(student, data);
  const textbook = mathTextbook(progress.grade),
    books = useFiles(config[textbook.configKey], true);
  const materials = [...books.files, ...courses.courses]
    .map((f) => ({
      id: f.id,
      path: f.path,
      name: f.name,
      modifiedAt: f.modifiedAt,
      size: f.size,
      missing: f.missing,
    }))
    .sort((a, b) =>
      String(a.path || a.id).localeCompare(String(b.path || b.id)),
    );
  const sourceKey = automaticSourceKey(student, data, config, materials);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const stored = data.analysis?.[automaticPlanKey(student.id)],
    cache = stored?.sourceKey === sourceKey ? stored : null;
  const fallback = localAutomaticPlan(progress),
    planData = cache?.planData || fallback;
  const loading = courses.loading || books.loading;
  useEffect(() => {
    if (loading) return;
    let live = true;
    const requestId = id(),
      starting = latest.current;
    const existing = starting.data.analysis?.[automaticPlanKey(student.id)];
    const retryAfterFailure =
      existing?.warning &&
      Date.now() - new Date(existing.updatedAt).getTime() >= 5 * 60 * 1000;
    if (existing?.sourceKey === sourceKey && !retry && !retryAfterFailure)
      return;
    const check = () => {
      if (!live) throw Error("自动规划已切换到最新资料");
    };
    setBusy(true);
    setError("");
    (async () => {
      let result = fallback,
        model = "本地自动规划",
        warning = "";
      try {
        if (starting.config.deepseekKey) {
          const draft = freshReport(
            { ...student, grade: progress.grade },
            starting.data,
            "stage",
          );
          const snapshot = await enrichPlanningSnapshot(
            reportSnapshot(draft, starting.data),
            draft,
            starting.data,
            courses.courses,
            starting.config,
            check,
          );
          check();
          const response = await services.ai({
            id: requestId,
            task:
              learningPlanPrompt(draft, snapshot) +
              "\n本次为自动教学规划：直接生成结果，系统已收集资料，不向教师索取设置。",
            json: true,
            maxTokens: 8192,
            thinking: false,
          });
          check();
          result = validateCoursePlan(parseJSONResult(response.text), draft);
          model = response.model;
        }
      } catch (e) {
        if (!live) return;
        warning = e.message;
      }
      if (!live) return;
      try {
        await mutate((d) => {
          const current = d.students.find((s) => s.id === student.id);
          if (
            !current ||
            automaticSourceKey(current, d, latest.current.config, materials) !==
              sourceKey
          )
            return d;
          const old = d.analysis?.[automaticPlanKey(student.id)];
          return {
            ...d,
            analysis: {
              ...d.analysis,
              [automaticPlanKey(student.id)]: {
                sourceKey,
                planData: result,
                model,
                warning,
                updatedAt: new Date().toISOString(),
                history: old?.planData
                  ? [
                      { planData: old.planData, updatedAt: old.updatedAt },
                      ...(old.history || []),
                    ].slice(0, 3)
                  : [],
              },
            },
          };
        });
        if (live)
          setError(
            warning ? "AI细化暂未完成，已自动保留完整基础方案：" + warning : "",
          );
      } catch (e) {
        if (live) setError("自动方案保存失败：" + e.message);
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
      services.cancelAI(requestId);
    };
  }, [sourceKey, loading, retry]);
  const copy =
    `${student.name} · 自动教学规划\n${planData.curriculum.edition}\n进度：${planData.curriculum.currentTopic}\n依据：${planData.curriculum.progressEvidence}\n${planData.planningNotes}\n\n` +
    planData.plan
      .map(
        (p, i) =>
          `第${i + 1}节：${p.topic}\n目标：${p.objectives}\n重点：${p.keyPoints}`,
      )
      .join("\n\n");
  return (
    <section
      className="automatic-curriculum"
      aria-label={student.name + "自动教学规划"}
    >
      <div className="section-head">
        <div>
          <h3>{student.name} · 自动教学规划</h3>
          <p className="form-hint">
            保存授课、反馈或学生记录后自动更新；再次打开时自动重排，无需设置学校进度。
          </p>
        </div>
        <Badge type={busy || loading ? "warning" : "success"}>
          {busy
            ? "正在自动细化"
            : loading
              ? "正在读取资料"
              : cache
                ? "已自动保存"
                : "已自动给出基础方案"}
        </Badge>
      </div>
      <div className="auto-progress-summary">
        <div>
          <small>自动匹配教材</small>
          <strong>{planData.curriculum.edition}</strong>
          <span>{planData.curriculum.volume}</span>
        </div>
        <div>
          <small>判断的教学起点</small>
          <strong>{planData.curriculum.currentTopic}</strong>
          <span>{planData.curriculum.mode}</span>
        </div>
      </div>
      <p className="auto-progress-evidence">
        <strong>判断依据：</strong>
        {planData.curriculum.progressEvidence}
      </p>
      <p className="form-hint">{planData.planningNotes}</p>
      {error && <ErrorBox message={error} />}
      {cache?.warning && !error && (
        <p className="form-hint">
          AI细化暂不可用，当前显示已保存的自动基础方案。
        </p>
      )}
      <div className="button-row">
        <CopyButton text={copy} label="复制15节课方案" />
        <Button
          icon={RefreshCw}
          busy={busy}
          disabled={loading}
          onClick={() => setRetry((n) => n + 1)}
        >
          重新分析
        </Button>
        <small className="form-hint">
          {cache?.model ||
            (config.deepseekKey
              ? "先显示基础方案，AI自动细化中"
              : "未配置AI也可自动衔接教材并生成基础方案")}
        </small>
      </div>
      <div className="auto-plan-list" aria-label="自动生成的15节课">
        {planData.plan.map((p, i) => (
          <article className="auto-plan-row" key={i}>
            <span className="auto-plan-number">{i + 1}</span>
            <div>
              <h4>{p.topic}</h4>
              <p>
                <strong>目标：</strong>
                {p.objectives}
              </p>
              <p>
                <strong>重难点：</strong>
                {p.keyPoints}
              </p>
            </div>
          </article>
        ))}
      </div>
      <details className="curriculum-outline">
        <summary>已自动使用的近期记录（{progress.evidence.length}）</summary>
        {progress.evidence.length ? (
          progress.evidence.slice(0, 8).map((r) => (
            <p key={r.kind + r.id}>
              {r.date} · {r.kind} · {r.topic || r.text.slice(0, 160)}
              {r.next ? "；下次继续：" + r.next : ""}
            </p>
          ))
        ) : (
          <p>
            暂无课堂记录，先按年级学期与对应教材给出诊断和建议起点。新增记录后会自动调整，不要求先填表。
          </p>
        )}
      </details>
    </section>
  );
}

export default function AutomaticCurriculum({ student }) {
  const { data } = useApp();
  const active = data.students.filter((s) => s.status !== "已停课");
  const [selected, setSelected] = useState(active[0]?.id || "");
  const current = student
    ? data.students.find((s) => s.id === student.id) || student
    : active.find((s) => s.id === selected) || active[0];
  return (
    <div className="automatic-workspace">
      {!student && (
        <>
          <div className="section-head">
            <h3>
              <Sparkles size={18} /> 自动匹配教材，自动安排后续课程
            </h3>
            <Badge>{active.length} 位学生</Badge>
          </div>
          <p className="form-hint">
            已按学生现有资料判断教材与起点。选择学生即可查看自动生成的15节课，不需要维护学校、年级和章节表。
          </p>
          <div className="automatic-student-list" aria-label="自动规划学生列表">
            {active.map((s) => {
              const p = inferAutomaticProgress(s, data);
              return (
                <button
                  key={s.id}
                  aria-pressed={current?.id === s.id}
                  onClick={() => setSelected(s.id)}
                >
                  <strong>{s.name}</strong>
                  <span>{s.grade || p.grade || "自动判断中"}</span>
                  <small>{p.nextTopic}</small>
                </button>
              );
            })}
          </div>
        </>
      )}
      {current ? (
        <StudentAutomaticPlan key={current.id} student={current} />
      ) : (
        <Empty
          icon={BookOpen}
          title="新增学生后自动衔接教材"
          description="有学生档案即可生成基础方案，后续授课记录会让安排更贴近实际。"
        />
      )}
    </div>
  );
}
