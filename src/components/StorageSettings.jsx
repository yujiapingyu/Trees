import BackupTools from "./BackupTools";
import React, { useEffect, useState } from "react";
import { Database, FolderOpen, Download, RefreshCw } from "lucide-react";
import { desktop, services } from "../shared/services";
import { useApp } from "../shared/store";
import { Button, Badge, ErrorBox } from "./UI";
const countsText = (counts = {}) =>
  `学生 ${counts.students || 0} · 课程 ${counts.refs || 0} · 考试 ${counts.exams || 0} · 回访 ${counts.followups || 0} · 报告 ${counts.reports || 0}`;
export default function StorageSettings() {
  const { storageState, notify } = useApp();
  const [state, setState] = useState(storageState),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (desktop)
      services
        .storageState()
        .then(setState)
        .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (storageState) setState(storageState);
  }, [storageState]);
  if (!desktop) return <p>请在已安装的「知序」中设置 SQLite 数据保存位置。</p>;
  const action = async (fn) => {
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
  const choose = (kind) =>
    action(async () => {
      const result = await services.storageChoose(kind);
      if (!result) return;
      if (kind === "backup") notify("已导出完整数据库备份：" + result.file);
      else setPreview(result);
    });
  return (
    <div className="settings-fields storage-settings">
      <div className="storage-heading">
        <Database size={22} />
        <Badge type={state?.pending ? "warning" : "success"}>
          SQLite ·{" "}
          {state?.pending ? "本机已保存，数据文件待更新" : "数据文件已保存"}
        </Badge>
      </div>
      <p>
        学生、课程、考试、回访、反馈和学习力报告等业务记录保存在数据库中。可以选择本地文件夹，也可以选择
        iCloud、OneDrive、Dropbox 等已同步到本机的文件夹。
      </p>
      <div className="storage-location">
        <strong>当前数据文件</strong>
        <code>{state?.file || "正在读取…"}</code>
        <small>{countsText(state?.counts)}</small>
        {state?.lastPublished && (
          <small>
            最近写入数据文件：
            {new Date(state.lastPublished).toLocaleString("zh-CN")}
          </small>
        )}
      </div>
      {state?.error && <ErrorBox message={state.error} />}
      {error && <ErrorBox message={error} />}
      <div className="storage-actions">
        <Button
          icon={FolderOpen}
          variant="primary"
          disabled={busy || !!preview}
          onClick={() => choose("move")}
        >
          更改保存文件夹
        </Button>
        <Button
          icon={Database}
          disabled={busy || !!preview}
          onClick={() => choose("open")}
        >
          打开已有数据库
        </Button>
        <Button
          icon={Download}
          disabled={busy || !!preview}
          onClick={() => choose("backup")}
        >
          导出数据库备份
        </Button>
        <Button
          disabled={busy}
          onClick={() => action(() => services.storageReveal())}
        >
          在文件夹中显示
        </Button>
        {state?.pending && (
          <Button
            icon={RefreshCw}
            disabled={busy}
            onClick={() =>
              action(async () => {
                const next = await services.storageRetry();
                setState(next);
                if (!next.pending) notify("数据文件已更新");
              })
            }
          >
            重试写入
          </Button>
        )}
      </div>
      {preview && (
        <section className="storage-preview" aria-label="数据文件确认">
          <h3>
            {preview.kind === "move"
              ? "将当前数据迁移到此处"
              : "切换为这份数据库"}
          </h3>
          <code>{preview.file}</code>
          <p>{countsText(preview.counts)}</p>
          <p>
            {preview.kind === "move"
              ? "将复制当前完整数据，后续记录写入新位置。原位置的数据文件会保留。"
              : "将加载所选文件中的业务记录；不会合并两份数据库。当前本机记录会自动备份，之后可通过「打开已有数据库」恢复。"}
          </p>
          <p>
            请先保存其他页面未提交的草稿。确认后页面会重新加载，本机目录设置和
            AI 配置仍保留。
          </p>
          <div className="storage-actions">
            <Button
              variant="primary"
              busy={busy}
              onClick={() =>
                action(async () => {
                  await services.storageApply(preview.token);
                  window.location.reload();
                })
              }
            >
              确认并重新加载
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setError("");
              }}
            >
              取消
            </Button>
          </div>
        </section>
      )}
      <BackupTools onPreview={setPreview} />
      <div className="storage-guidance">
        <h3>使用云同步文件夹</h3>
        <p>
          请让数据库文件保持下载到本机。应用先可靠保存本机副本，再写入完整的数据文件；云盘的上传进度由云盘软件负责。另一台电脑通过「打开已有数据库」选择已同步好的文件。
        </p>
        <p>
          多台电脑请轮流使用：退出一台，等待同步完成，再打开另一台。数据库不能自动合并同时编辑的内容。若有冲突，请用「更改保存文件夹」保留本机版本，或用「打开已有数据库」采用另一份版本，切换前都会备份本机数据。
        </p>
        <p>
          讲义、试卷、答案、视频和导出的文档仍保存在各自的资源目录，不会打包进数据库。需要跨设备使用时，请同步这些资料并在每台电脑重新配置路径。API
          密钥、快捷键、资源路径和页面草稿保存在本机设置库。
        </p>
        {state?.migrationBackup && (
          <p>
            旧 JSON 已保留，并额外备份到：<code>{state.migrationBackup}</code>
            。以后业务记录保存到 SQLite。
          </p>
        )}
      </div>
    </div>
  );
}
