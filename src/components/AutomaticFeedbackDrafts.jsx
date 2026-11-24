import React from "react";
import { useApp } from "../shared/store";
import { Button, Badge, Markdown, CopyButton } from "./UI";

export default function AutomaticFeedbackDrafts({
  student,
  onAdopt,
  disabled = false,
}) {
  const { data, mutate, run } = useApp();
  const sessions = (data.sessions || [])
    .filter(
      (s) =>
        s.studentId === student.id &&
        s.closeout &&
        s.status === "completed" &&
        !data.feedback.some((f) => f.id === s.closeout.publishedFeedbackId),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!sessions.length) return null;
  return (
    <div className="automatic-feedback-drafts">
      <h4>课后记录自动准备的反馈</h4>
      {sessions.map((s) => (
        <details
          className="record-card"
          key={s.id}
          open={s.closeout.state === "pending"}
        >
          <summary>
            {s.date} · {s.topic}{" "}
            <Badge>
              {s.closeout.state === "pending"
                ? "正在自动整理，原文已保存"
                : "草稿已准备"}
            </Badge>
          </summary>
          {s.closeout.feedbackDraft ? (
            <>
              <Markdown>{s.closeout.feedbackDraft.content}</Markdown>
              <CopyButton
                text={s.closeout.feedbackDraft.content}
                label="复制自动反馈"
              />
              {s.closeout.warning && (
                <p className="form-hint">{s.closeout.warning}</p>
              )}
              <Button
                disabled={disabled || student.status === "已停课"}
                onClick={() => onAdopt(s)}
              >
                编辑并保存这份反馈
              </Button>
            </>
          ) : (
            <p className="form-hint">
              无需重复填写原始记录，完成后这里会出现反馈草稿。
            </p>
          )}
          {!!s.closeout.extraction?.homeworkAssigned?.length && (
            <p>
              已明确布置：
              {s.closeout.extraction.homeworkAssigned
                .map((h) => h.text)
                .join("；")}
            </p>
          )}
          {!!s.closeout.extraction?.homeworkSuggestions?.length && (
            <p>
              建议练习：{s.closeout.extraction.homeworkSuggestions.join("；")}
            </p>
          )}
          {s.closeout.state !== "pending" && (
            <Button
              onClick={() =>
                run(() =>
                  mutate((d) => ({
                    ...d,
                    sessions: d.sessions.map((r) =>
                      r.id === s.id
                        ? {
                            ...r,
                            closeout: {
                              ...r.closeout,
                              state: "pending",
                              version: crypto.randomUUID(),
                            },
                          }
                        : r,
                    ),
                  })),
                )
              }
              disabled={student.status === "已停课"}
            >
              重新自动整理
            </Button>
          )}
        </details>
      ))}
    </div>
  );
}
