import React from "react";
import { BookOpen, PencilLine } from "lucide-react";
import { useApp } from "../shared/store";
import { preparationCard } from "../shared/preparation";
import { Button, Badge } from "./UI";

export default function PreparationCard({
  student,
  courses,
  expanded,
  onRecord,
  onFeedback,
}) {
  const { data, config } = useApp(),
    card = preparationCard(student, data, courses, config);
  const jobs = (data.sessions || []).filter(
    (s) => s.studentId === student.id && s.closeout && s.status === "completed",
  );
  const drafts = jobs.filter(
    (s) =>
      s.closeout.state === "ready" &&
      !data.feedback.some((f) => f.id === s.closeout.publishedFeedbackId),
  );
  const pending = jobs.filter((s) => s.closeout.state === "pending").length;
  return (
    <details
      className="preparation-card"
      open={expanded}
      key={student.id + (expanded ? ":open" : ":compact")}
    >
      <summary>
        <span>
          <BookOpen size={17} /> 课前备课卡 · {card.target}
        </span>
        <Badge>自动整理</Badge>
      </summary>
      <div className="preparation-content">
        <div className="prep-grid">
          <div>
            <small>上次停在哪里</small>
            <strong>
              {card.last
                ? card.last.date + " · " + card.last.topic
                : "暂无已完成授课记录"}
            </strong>
            <p>
              {card.last?.scope ||
                card.rawEvidence.slice(0, 160) ||
                "先做基础诊断，再根据真实表现接课。"}
            </p>
          </div>
          <div>
            <small>本次建议</small>
            <strong>{card.target}</strong>
            <p>{card.review}</p>
            {card.nextSuggestions[0] && <p>建议：{card.nextSuggestions[0]}</p>}
          </div>
        </div>
        <div className="prep-grid">
          <div>
            <small>需要回查的作业 · {card.homeworkCount}份未标记完成</small>
            {card.homework.length ? (
              card.homework.map((h) => (
                <p key={h.id}>
                  {h.name || "课后作业"} · {h.dueDate || "未设日期"}
                </p>
              ))
            ) : (
              <p>暂无未完成作业记录。</p>
            )}
          </div>
          <div>
            <small>巩固关注点</small>
            {card.weaknesses.length ? (
              card.weaknesses.map((w, i) => (
                <p key={i}>
                  {w.text}
                  <small> · {w.source}</small>
                </p>
              ))
            ) : (
              <p>暂无明确薄弱点记录，本次先通过练习检查，不预设学生不会。</p>
            )}
          </div>
        </div>
        {card.resources.length > 0 && (
          <div className="prep-resources">
            <small>匹配的讲义与试卷</small>
            {card.resources.map((r) => (
              <Button
                key={r.id}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("workspace:open", {
                      detail: { key: "讲义:" + r.id, target: r.target },
                    }),
                  )
                }
              >
                {r.name}
                {r.linked ? " · 已关联" : ""}
              </Button>
            ))}
          </div>
        )}
        {(pending > 0 || drafts.length > 0) && (
          <div className="info-banner">
            {pending > 0 && <span>有{pending}次课正在自动整理。 </span>}
            {drafts.length > 0 && (
              <span>
                已准备{drafts.length}份家长反馈草稿。{" "}
                <Button onClick={onFeedback}>查看反馈草稿</Button>
              </span>
            )}
          </div>
        )}
        <div className="button-row">
          <Button
            icon={PencilLine}
            variant="primary"
            disabled={student.status === "已停课"}
            onClick={onRecord}
          >
            课后记一段
          </Button>
          <small className="form-hint">
            依据本学生已保存的记录与资料匹配，建议不代表已经完成授课。
          </small>
        </div>
      </div>
    </details>
  );
}
