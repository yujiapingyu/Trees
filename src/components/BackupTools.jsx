import React, { useEffect, useState } from "react";
import { services } from "../shared/services";
import { useApp } from "../shared/store";
import { Button, Field, ErrorBox, Confirm } from "./UI";
const labels = {
  studentsRoot: "学生目录（含导出报告与回收站）",
  lessonsRoot: "讲义库",
  templatesRoot: "教案模板",
  examsRoot: "试卷与答案",
  referenceJunior: "初中参考资料",
  referenceSenior: "高中参考资料",
  referenceVocational: "中职参考资料",
  textbooksJunior: "初中教材",
  textbooksSenior: "高中教材",
  exercisesJunior: "初中练习",
  exercisesSenior: "高中练习",
  planningJunior: "初中规划资料",
  planningSenior: "高中规划资料",
  videosRoot: "视频",
  booksRoot: "书籍",
  usbRoot: "外部存储资料",
};
export default function BackupTools({ onPreview }) {
  const { config, notify, storageState } = useApp(),
    [rows, setRows] = useState([]),
    [keys, setKeys] = useState(Object.keys(labels).filter((k) => config[k])),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [bundle, setBundle] = useState(null);
  const load = () =>
    services
      .storageBackups()
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="backup-tools">
      <h3>自动备份与恢复</h3>
      <p>
        每天首次打开及跨日保存前自动备份，按当前数据集保留最近30个备份日。恢复前会另存当前数据库，资源文件不会随数据库回退。
      </p>
      {storageState?.backupError && (
        <ErrorBox message={storageState.backupError} />
      )}
      <Button disabled={busy} onClick={load}>
        刷新备份列表
      </Button>
      {rows.map((r) => (
        <div className="record-card" key={r.name}>
          <strong>
            {r.label
              ? r.label + " · " + new Date(r.date).toLocaleString("zh-CN")
              : r.name}
          </strong>
          <p>
            {r.error ||
              `学生 ${r.counts.students} · 授课 ${r.counts.sessions || 0} · 反馈 ${r.counts.feedback} · 回访 ${r.counts.followups}`}
          </p>
          <Button
            disabled={busy || !!r.error}
            onClick={() =>
              act(async () =>
                onPreview(await services.storageBackupPreview(r.name)),
              )
            }
          >
            预览恢复此备份
          </Button>
        </div>
      ))}
      <h3>完整备份与换机迁移</h3>
      <p>
        生成包含数据库和所选教学资料的独立备份文件夹，逐个校验文件。恢复时创建新目录、自动调整资料路径，保留当前数据库备份；原资料不覆盖。本机密钥与快捷键不导出。
      </p>
      <div className="backup-root-options">
        {Object.keys(labels)
          .filter((k) => config[k])
          .map((k) => (
            <label className="check-label" key={k}>
              <input
                type="checkbox"
                checked={keys.includes(k)}
                disabled={busy}
                onChange={(e) =>
                  setKeys((v) =>
                    e.target.checked ? [...v, k] : v.filter((x) => x !== k),
                  )
                }
              />
              {labels[k]}
            </label>
          ))}
      </div>
      <div className="button-row">
        <Button
          disabled={busy}
          busy={busy}
          onClick={() =>
            act(async () => {
              const r = await services.fullBackupExport(keys);
              if (r)
                notify(`完整备份已保存：${r.file}，包含 ${r.files} 个文件`);
            })
          }
        >
          导出完整备份
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            act(async () => {
              const r = await services.fullBackupInspect();
              if (r) setBundle(r);
            })
          }
        >
          从完整备份恢复
        </Button>
      </div>
      {error && <ErrorBox message={error} />}
      {bundle && (
        <Confirm
          title="恢复完整备份"
          description={`备份日期：${bundle.date}。学生 ${bundle.counts.students}，授课 ${bundle.counts.sessions || 0}，资料 ${bundle.files} 个文件。将切换为该数据集，下一步选择新资料存放位置。未包含的资料目录将清空配置，本机AI配置保留。`}
          onClose={() => setBundle(null)}
          onConfirm={async () => {
            const r = await services.fullBackupRestore(bundle.token);
            if (r) window.location.reload();
          }}
        />
      )}
    </section>
  );
}
