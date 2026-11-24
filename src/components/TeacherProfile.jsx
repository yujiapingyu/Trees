import React, { useState } from "react";
import { Save, UserRound } from "lucide-react";
import { useApp } from "../shared/store";
import { useDraft } from "../shared/drafts";
import {
  TEACHER_FIELDS,
  teacherProfile,
  saveTeacherProfile,
} from "../shared/teacherProfile";
import { Modal, Field, Button, ErrorBox } from "./UI";

export default function TeacherProfile({ onClose }) {
  const { data, mutate, notify } = useApp();
  const [form, setForm] = useDraft("teacher-profile-editor", () =>
    teacherProfile(data.teacherProfile),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title="教师个人信息"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="form-hint">
        <UserRound size={15} />{" "}
        姓名会自动用于新学习报告的教师署名。个人信息随当前数据文件保存，换设备打开同一份数据也可使用。
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await mutate((d) => saveTeacherProfile(d, form));
            notify("教师个人信息已保存");
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid two">
          {TEACHER_FIELDS.filter(([key]) => key !== "bio").map(
            ([key, label, limit]) => (
              <Field key={key} label={label}>
                <input
                  value={form[key]}
                  maxLength={limit}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [key]: e.target.value }))
                  }
                  placeholder={
                    key === "displayName"
                      ? "例如：王老师；用于左下角显示"
                      : key === "subjects"
                        ? "例如：高中数学、初中数学"
                        : "选填"
                  }
                />
              </Field>
            ),
          )}
        </div>
        <Field label="个人简介">
          <textarea
            value={form.bio}
            maxLength={1000}
            disabled={busy}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            placeholder="教学经历、擅长方向等（选填）"
            rows={4}
          />
        </Field>
        <p className="form-hint">
          修改会暂存为本机草稿，点击保存后生效。已有报告和单独指定的任课教师保持原有署名。
        </p>
        {!!data.feedbackStyle?.learnedCount && (
          <details className="curriculum-outline">
            <summary>
              AI反馈表达习惯 · 已学习{data.feedbackStyle.learnedCount}次修改
            </summary>
            <p>
              保存修改后的AI反馈时自动学习语气与篇幅，不需要设置，也不会把其他学生的事实当作写作示例。
            </p>
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  await mutate((d) => ({ ...d, feedbackStyle: null }));
                  notify("反馈表达习惯已恢复默认");
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              恢复默认表达习惯
            </Button>
          </details>
        )}
        {error && <ErrorBox message={error} />}
        <footer>
          <Button type="button" disabled={busy} onClick={onClose}>
            稍后继续
          </Button>
          <Button type="submit" icon={Save} variant="primary" busy={busy}>
            保存个人信息
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
