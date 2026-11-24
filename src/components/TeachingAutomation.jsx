import { useEffect, useRef, useState } from "react";
import { useApp } from "../shared/store";
import { id } from "../shared/domain";
import { services } from "../shared/services";
import {
  extractionPrompt,
  validateLessonExtraction,
  localLessonExtraction,
  applyLessonCloseout,
} from "../shared/lessonCloseout";
import {
  feedbackPrompt,
  generateFeedbackDraft,
  localFeedback,
} from "../shared/feedback";
import { feedbackStylePrompt } from "../shared/feedbackStyle";
import { readLessonDocuments } from "../shared/documents";
import { sessionCourse } from "../shared/preparation";

export default function TeachingAutomation() {
  const { data, config, mutate, notify } = useApp();
  const latest = useRef({ data, config });
  latest.current = { data, config };
  const active = useRef(false),
    live = useRef(true),
    requests = useRef(new Set()),
    failed = useRef(new Set());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      for (const request of requests.current)
        services.cancelAI(request).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (active.current) return;
    const session = (data.sessions || []).find(
      (s) =>
        s.status === "completed" &&
        s.closeout?.state === "pending" &&
        !failed.current.has(s.id + s.closeout.version) &&
        data.students.some(
          (st) => st.id === s.studentId && st.status !== "已停课",
        ),
    );
    if (!session) return;
    const student = data.students.find((s) => s.id === session.studentId),
      version = session.closeout.version;
    active.current = true;
    const request = async (task, json = true) => {
      const key = id();
      requests.current.add(key);
      try {
        return await services.ai({
          id: key,
          task,
          json,
          maxTokens: 6500,
          thinking: false,
        });
      } finally {
        requests.current.delete(key);
      }
    };
    const check = () => {
      const current = latest.current.data.sessions.find(
        (s) => s.id === session.id,
      );
      if (
        !live.current ||
        current?.closeout?.version !== version ||
        !latest.current.data.students.some(
          (s) => s.id === student.id && s.status !== "已停课",
        )
      )
        throw Error("原始记录已变化");
    };
    (async () => {
      let extraction = localLessonExtraction(session),
        content = localFeedback({
          student,
          date: session.date,
          notes: session.closeout.raw,
        }),
        model = "本地自动整理 / 非 AI 生成",
        warning = "",
        sourceFiles = [];
      try {
        if (config.deepseekKey) {
          const response = await request(extractionPrompt(session));
          check();
          extraction = validateLessonExtraction(response.text, session);
          for (const key of ["topic", "scope", "nextProgress"])
            if (session.closeout.manualFields?.[key])
              extraction[key] = session[key] || "";
          const lesson = sessionCourse(
            session,
            student,
            latest.current.data,
            config,
          );
          let documents = [];
          if (lesson && !lesson.missing) {
            try {
              documents = await readLessonDocuments(lesson);
            } catch {
              warning = "关联资料暂不可读，已仅依据课堂原始记录整理。";
            }
          }
          check();
          const feedback = await generateFeedbackDraft({
            prompt: feedbackPrompt({
              student,
              date: session.date,
              notes: session.closeout.raw,
              scope:
                extraction.scope ||
                session.scope ||
                "仅限教师原始记录明确讲过的内容",
              lesson,
              documents,
              allowTeacherOnly: true,
              style: feedbackStylePrompt(latest.current.data.feedbackStyle),
            }),
            student,
            date: session.date,
            subject: lesson?.subjectName,
            style: latest.current.data.feedbackStyle,
            request: (task) => request(task),
          });
          check();
          content = feedback.feedback;
          model = feedback.model;
          sourceFiles = documents.map(({ name, path }) => ({ name, path }));
        }
      } catch (e) {
        if (!live.current) return;
        warning = "AI整理暂未完成，已保留原始记录和本地反馈草稿：" + e.message;
      }
      if (!live.current) return;
      try {
        await mutate((d) =>
          applyLessonCloseout(
            d,
            session.id,
            version,
            {
              extraction,
              feedbackDraft: {
                content,
                generatedOriginal: model.includes("非 AI") ? "" : content,
                model,
                sourceFiles,
              },
              warning,
            },
            session.updatedAt,
          ),
        );
      } catch (e) {
        failed.current.add(session.id + version);
        notify("课堂记录已保留，自动整理结果暂未保存：" + e.message, "danger");
      } finally {
        active.current = false;
        if (live.current) setTick((t) => t + 1);
      }
    })();
  }, [data, config, tick]);
  return null;
}
