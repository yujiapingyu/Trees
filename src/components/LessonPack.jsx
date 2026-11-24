import React, { useState, useEffect } from "react";
import { services } from "../shared/services";
import { Button, Modal, Field, ErrorBox } from "./UI";
export default function LessonPack({ lesson, onClose, onRefresh }) {
  const [form, setForm] = useState(null),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [overwrite, setOverwrite] = useState(false),
    [result, setResult] = useState(null);
  useEffect(() => {
    let live = true;
    services
      .lessonPackOptions({ path: lesson.path, name: lesson.name })
      .then((p) => {
        if (live) {
          setForm({ version: p.version, grade: p.grade, year: p.year });
          setPreview(p);
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [lesson.id]);
  useEffect(() => {
    if (!form) return;
    let live = true;
    setPreview(null);
    setOverwrite(false);
    services
      .lessonPackOptions({ path: lesson.path, name: lesson.name, ...form })
      .then((p) => {
        if (live) {
          setPreview(p);
          setError("");
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [form]);
  return (
    <Modal
      title={"打包「" + lesson.name + "」"}
      onClose={() => !busy && onClose()}
      wide
    >
      <p>按旧项目规则将教案和学案整理为ZIP，保存到当前讲义目录，源文件保留。</p>
      {form && (
        <>
          <Field label="教材版本">
            <select
              value={form.version}
              disabled={busy}
              onChange={(e) =>
                setForm((f) => ({ ...f, version: e.target.value }))
              }
            >
              {(preview?.versions || [form.version]).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <div className="form-grid two">
            <Field label="年份">
              <input
                type="number"
                min="2020"
                max={new Date().getFullYear() + 5}
                value={form.year}
                disabled={busy}
                onChange={(e) =>
                  setForm((f) => ({ ...f, year: +e.target.value }))
                }
              />
            </Field>
            <Field label="打包年级">
              <select
                value={form.grade}
                disabled={busy}
                onChange={(e) =>
                  setForm((f) => ({ ...f, grade: e.target.value }))
                }
              >
                {(preview?.grades || [form.grade]).map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </Field>
          </div>
        </>
      )}
      {preview && (
        <div className="info-banner">
          <div>
            <p>ZIP：{preview.baseName}.zip</p>
            <p>教案来源：{preview.teaching.name}</p>
            <p>学案来源：{preview.learning.name}</p>
            {preview.learningFallback && (
              <p>
                未找到学案：按旧项目规则使用教案副本作为学案，不会自动删除答案。
              </p>
            )}
          </div>
        </div>
      )}
      {preview?.existingHash && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={overwrite}
            disabled={busy}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          同名ZIP已存在，备份后覆盖
        </label>
      )}
      {error && <ErrorBox message={error} />}{" "}
      {result && (
        <div role="status">
          已打包至：{result.path}
          <Button onClick={() => services.open(lesson.path)}>
            打开讲义目录
          </Button>
        </div>
      )}
      <footer>
        <Button disabled={busy} onClick={onClose}>
          关闭
        </Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={
            !preview || !!result || (!!preview.existingHash && !overwrite)
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await services.lessonPack({
                ...form,
                path: lesson.path,
                name: lesson.name,
                existingHash: preview.existingHash,
                overwrite,
              });
              setResult(r);
              onRefresh();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          开始打包
        </Button>
      </footer>
    </Modal>
  );
}
