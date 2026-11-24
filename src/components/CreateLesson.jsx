import React, { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { services, join, basename } from "../shared/services";
import { Button, ErrorBox, Field, Modal } from "./UI";
export default function CreateLesson({ stage, onClose, onCreated }) {
  const [options, setOptions] = useState(null),
    [name, setName] = useState(""),
    [grade, setGrade] = useState(""),
    [template, setTemplate] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [created, setCreated] = useState(null),
    [revision, setRevision] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setOptions(null);
    setError("");
    services
      .lessonCreateOptions(stage)
      .then((r) => {
        if (live) {
          setOptions(r);
          setGrade(r.grades[0] || "");
          setTemplate(r.templates[0]?.path || "");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [stage, revision]);
  const submit = async (e) => {
    e.preventDefault();
    if (submitting.current || !options) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    let made = created;
    try {
      if (!made) {
        made = await services.lessonCreate({
          stage,
          grade,
          name,
          template,
          configurationKey: options.configurationKey,
        });
        setCreated(made);
      }
      await onCreated(made);
    } catch (e) {
      setError(
        made
          ? "文件已创建，但登记尚未完成。可点击「完成登记」重试；也可关闭后刷新讲义库恢复。" +
              e.message
          : e.message,
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const selectedTemplate = options?.templates.find((t) => t.path === template),
    ext = selectedTemplate
      ? basename(selectedTemplate.path).match(/\.[^.]+$/)?.[0] || ""
      : "";
  const directory = options ? join(options.stageRoot, grade, name.trim()) : "";
  return (
    <Modal
      title={`新建讲义（${stage}）`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="lesson-create-form" onSubmit={submit}>
        <Field label="讲义名称">
          <input
            autoFocus
            value={name}
            disabled={busy || !!created}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入讲义标题"
          />
        </Field>
        {stage !== "中职" && (
          <Field label="年级">
            <select
              value={grade}
              disabled={loading || !options || busy || !!created}
              onChange={(e) => setGrade(e.target.value)}
            >
              {options?.grades.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </Field>
        )}
        {stage === "中职" && (
          <p className="form-hint">
            中职讲义直接保存在中职目录下，无需选择年级。
          </p>
        )}
        <Field label="讲义模板">
          <select
            value={template}
            disabled={loading || !options || busy || !!created}
            onChange={(e) => setTemplate(e.target.value)}
          >
            {options?.templates.map((t) => (
              <option key={t.path} value={t.path}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <p className="form-hint">
          沿用当前{stage}
          学段，复制所选模板并按讲义标题命名，模板原件保留。创建后会自动选中新讲义。
        </p>
        {options && name.trim() && (
          <div
            className="lesson-create-preview"
            role="region"
            aria-label="创建位置"
          >
            <small>创建位置</small>
            <code>{join(directory, name.trim() + "（教案）" + ext)}</code>
          </div>
        )}
        {loading && <p role="status">正在读取年级与模板…</p>}
        {error && <ErrorBox message={error} />}
        {!loading && !options && (
          <Button type="button" onClick={() => setRevision((v) => v + 1)}>
            重新读取配置
          </Button>
        )}
        <footer>
          <Button type="button" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            icon={Plus}
            variant="primary"
            busy={busy}
            disabled={loading || !options || !name.trim() || !template}
          >
            {created ? "完成登记" : "创建"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
