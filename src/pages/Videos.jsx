import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Maximize,
  Minimize,
  PanelLeftClose,
  PanelLeftOpen,
  History,
  NotebookPen,
  Save,
  FolderOpen,
  Video,
  Sparkles,
} from "lucide-react";
import { useApp, useView } from "../shared/store";
import { services, parent, basename } from "../shared/services";
import { useFiles } from "../shared/hooks";
import { isWithinRoot } from "../shared/paths";
import { id, parseJSONResult, matches } from "../shared/domain";
import {
  PageHeader,
  Button,
  Empty,
  Editor,
  Field,
  ErrorBox,
  Tabs,
  Markdown,
  Badge,
} from "../components/UI";
import { FileBrowser } from "../components/FileBrowser";
import { AIAction } from "../components/AIPanel";
const videoExt = /\.(mp4|webm|mov|m4v|mkv|avi)$/i;
export default function Videos() {
  const { config, data, mutate, run } = useApp();
  const [view, setView] = useView("teachingVideos", {
    selected: "",
    stage: "初中",
    panel: "",
    focus: false,
    collapsed: false,
    grade: "",
  });
  const { files, refresh } = useFiles(config.videosRoot, true);
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [intent, setIntent] = useState(""),
    [recommendations, setRecommendations] = useState([]),
    [duration, setDuration] = useState(0),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const player = useRef(),
    lastSave = useRef(0),
    snapshots = useRef({});
  const root = files.some((f) => f.isDirectory && f.relativePath === view.stage)
    ? config.videosRoot + "/" + view.stage
    : config.videosRoot;
  const grades = [
    ...new Set(
      files
        .filter(
          (f) =>
            f.isDirectory &&
            f.relativePath.startsWith(view.stage + "/") &&
            !f.relativePath.slice(view.stage.length + 1).includes("/"),
        )
        .map((f) => f.name),
    ),
  ];
  const browserRoot = view.grade ? root + "/" + view.grade : root;
  const change = (k, v) => setView((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    let live = true;
    setUrl("");
    setError("");
    if (view.selected && !isWithinRoot(view.selected, config.videosRoot)) {
      setError(
        "上次选择的视频属于旧视频目录，请从当前目录重新选择。观看历史和笔记已保留。",
      );
      return;
    }
    if (view.selected)
      services
        .mediaURL(view.selected)
        .then((u) => live && setUrl(u))
        .catch((e) => live && setError(e.message));
    setNote(data.videoNotes[view.selected] || "");
    return () => {
      live = false;
    };
  }, [view.selected, config.videosRoot]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") change("focus", false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const snapshot = () => {
    const v = player.current;
    if (!v || !view.selected || !v.readyState) return;
    const item = {
      path: view.selected,
      name: basename(view.selected),
      time: v.ended ? 0 : v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      watchedAt: new Date().toISOString(),
      completed: v.ended,
    };
    snapshots.current[view.selected] = item;
    return item;
  };
  const persistItem = async (item) => {
    if (!item) return;
    await mutate((d) => ({
      ...d,
      videoHistory: [
        item,
        ...d.videoHistory.filter((x) => x.path !== item.path),
      ].slice(0, 80),
    }));
  };
  const saveProgress = () => persistItem(snapshot());
  useEffect(() => {
    const path = view.selected;
    const flush = () => persistItem(snapshots.current[path]).catch(() => {});
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
    };
  }, [view.selected]);
  const select = async (f) => {
    await saveProgress();
    change("selected", f.path);
  };
  const format = (s) =>
    `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
  return (
    <div className={"page video-page " + (view.focus ? "focus-mode" : "")}>
      <PageHeader
        title="教学视频"
        eyebrow="WATCH · LEARN · TEACH"
        description="从知识讲解到课堂灵感，留住每一次收获。"
      >
        <Button
          icon={view.collapsed ? PanelLeftOpen : PanelLeftClose}
          onClick={() => change("collapsed", !view.collapsed)}
        >
          资源列表
        </Button>
        <Button
          icon={view.focus ? Minimize : Maximize}
          onClick={() => change("focus", !view.focus)}
        >
          {view.focus ? "退出专注" : "专注模式"}
        </Button>
      </PageHeader>
      <div className={"video-layout " + (view.collapsed ? "collapsed" : "")}>
        {!view.collapsed && (
          <aside className="panel video-browser">
            <div className="stage-switch">
              {["初中", "高中"].map((s) => (
                <button
                  key={s}
                  className={view.stage === s ? "active" : ""}
                  onClick={() =>
                    setView((v) => ({ ...v, stage: s, grade: "" }))
                  }
                >
                  {s}
                </button>
              ))}
            </div>
            {grades.length > 0 && (
              <Field label="年级">
                <select
                  value={view.grade}
                  onChange={(e) => change("grade", e.target.value)}
                >
                  <option value="">全部年级</option>
                  {grades.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </Field>
            )}
            <FileBrowser
              root={browserRoot}
              viewKey={"videosBrowser" + view.stage + view.grade}
              onSelect={(f) => run(() => select(f))}
              extensions={videoExt}
              compact
            />
            <div className="video-index-info">
              已索引 {files.filter((f) => videoExt.test(f.name)).length} 个视频{" "}
              <button onClick={refresh}>刷新索引</button>
            </div>
          </aside>
        )}
        <div className="video-content">
          <div className="video-player card">
            {error ? (
              <ErrorBox message={error} />
            ) : url ? (
              <video
                key={url}
                ref={player}
                src={url}
                controls
                onError={() =>
                  setError(
                    "视频无法播放。请检查文件是否存在及编码格式；可用系统播放器打开。",
                  )
                }
                onLoadedMetadata={() => {
                  const v = player.current;
                  setDuration(v.duration);
                  const old = data.videoHistory.find(
                    (h) => h.path === view.selected,
                  );
                  if (old && !old.completed) v.currentTime = old.time;
                  v.playbackRate = speed;
                }}
                onTimeUpdate={() => {
                  setTime(player.current?.currentTime || 0);
                  snapshot();
                  if (Date.now() - lastSave.current > 5000) {
                    lastSave.current = Date.now();
                    saveProgress().catch(() => {});
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => {
                  setPlaying(false);
                  saveProgress().catch(() => {});
                }}
                onEnded={() => saveProgress().catch(() => {})}
              />
            ) : (
              <Empty
                icon={Video}
                title="选择一段视频，开始学习"
                description="支持本地视频播放、续播与笔记。"
              />
            )}
          </div>
          {view.selected && (
            <>
              <div className="video-now">
                <div>
                  <h3>{basename(view.selected)}</h3>
                  <small>{view.selected}</small>
                </div>
                <Button
                  icon={FolderOpen}
                  onClick={() =>
                    run(() => services.open(parent(view.selected)))
                  }
                >
                  所在目录
                </Button>
              </div>
              <div className="playback-controls">
                <Button
                  icon={SkipBack}
                  disabled={!url}
                  onClick={() => {
                    player.current.currentTime = Math.max(0, time - 10);
                  }}
                >
                  后退 10 秒
                </Button>
                <Button
                  icon={playing ? Pause : Play}
                  disabled={!url}
                  onClick={() =>
                    run(() =>
                      playing ? player.current.pause() : player.current.play(),
                    )
                  }
                >
                  {playing ? "暂停" : "播放"}
                </Button>
                <Button
                  icon={SkipForward}
                  disabled={!url}
                  onClick={() => {
                    player.current.currentTime = Math.min(duration, time + 10);
                  }}
                >
                  前进 10 秒
                </Button>
                <span>
                  {format(time)} / {format(duration)}
                </span>
                <select
                  aria-label="播放速度"
                  value={speed}
                  onChange={(e) => {
                    setSpeed(+e.target.value);
                    if (player.current)
                      player.current.playbackRate = +e.target.value;
                  }}
                >
                  {[0.75, 1, 1.25, 1.5, 2].map((n) => (
                    <option key={n} value={n}>
                      {n}x
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="card video-bottom">
            <Tabs
              items={[
                { key: "recommend", label: "AI 视频推荐" },
                { key: "history", label: "观看历史" },
                { key: "notes", label: "视频笔记" },
              ]}
              value={view.panel || "recommend"}
              onChange={(v) => change("panel", v)}
            />
            {view.panel === "history" ? (
              <div>
                {!data.videoHistory.length ? (
                  <Empty icon={History} title="还没有观看记录" />
                ) : (
                  data.videoHistory.map((h) => (
                    <div className="history-row" key={h.path}>
                      <button onClick={() => run(() => select(h))}>
                        <Play size={16} />
                        <span>
                          {h.name}
                          <small>
                            {format(h.time)} / {format(h.duration)} ·{" "}
                            {h.completed ? "已完成" : "可续播"}
                          </small>
                        </span>
                      </button>
                      <Button
                        onClick={() =>
                          run(() =>
                            mutate((d) => ({
                              ...d,
                              videoHistory: d.videoHistory.filter(
                                (x) => x.path !== h.path,
                              ),
                            })),
                          )
                        }
                      >
                        移除
                      </Button>
                    </div>
                  ))
                )}
              </div>
            ) : view.panel === "notes" ? (
              view.selected ? (
                <>
                  <Editor value={note} onChange={setNote} />
                  <Button
                    icon={Save}
                    variant="primary"
                    onClick={() =>
                      run(
                        () =>
                          mutate((d) => ({
                            ...d,
                            videoNotes: {
                              ...d.videoNotes,
                              [view.selected]: note,
                            },
                          })),
                        "视频笔记已保存",
                      )
                    }
                  >
                    保存笔记
                  </Button>
                </>
              ) : (
                <Empty icon={NotebookPen} title="先选择视频，再记录收获" />
              )
            ) : (
              <div className="recommend">
                <Field label="你想寻找什么讲解？">
                  <input
                    value={intent}
                    onChange={(e) => setIntent(e.target.value)}
                    placeholder="例如：适合初二学生的函数入门…"
                  />
                </Field>
                <AIAction
                  label="在本地视频中推荐"
                  disabled={!intent.trim()}
                  task={() =>
                    `根据意图从索引中推荐最多5个视频。仅输出 JSON 数组，每项 path,name,reason。不能捏造路径。意图：${intent}\n索引：${JSON.stringify(files.filter((f) => videoExt.test(f.name)).map((f) => ({ name: f.name, path: f.path })))}`
                  }
                  extra={{ json: true }}
                  onResult={(v) => {
                    const list = parseJSONResult(v);
                    if (!Array.isArray(list)) throw Error("推荐格式异常");
                    setRecommendations(
                      list.filter((r) => files.some((f) => f.path === r.path)),
                    );
                  }}
                />
                {recommendations.map((r) => (
                  <button
                    className="recommendation"
                    key={r.path}
                    onClick={() => run(() => select(r))}
                  >
                    <Play size={18} />
                    <span>
                      <strong>{r.name}</strong>
                      <small>{r.path}</small>
                      <p>{r.reason}</p>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
