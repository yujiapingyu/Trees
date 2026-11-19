import React, { useEffect, useState } from "react";
import {
  ArrowUp,
  FolderOpen,
  RefreshCw,
  Star,
  Clock,
  Folder,
  ChevronRight,
} from "lucide-react";
import { useApp, useView } from "../shared/store";
import { services, parent, basename } from "../shared/services";
import { matches } from "../shared/domain";
import {
  Button,
  IconButton,
  SearchBox,
  Empty,
  ErrorBox,
  Loading,
  FileItem,
  Modal,
  Field,
} from "./UI";
export function FileBrowser({
  root,
  title = "本地资源",
  viewKey = "files",
  onSelect,
  allowFolders = false,
  extensions,
  compact = false,
}) {
  const { data, mutate, run } = useApp();
  const [view, setView] = useView(viewKey, { path: root || "", query: "" });
  const [entries, setEntries] = useState([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const current =
    root &&
    view.path &&
    (view.path === root || view.path.startsWith(root + "/"))
      ? view.path
      : root;
  const query = view.query || "";
  useEffect(() => {
    let live = true;
    setEntries([]);
    setError("");
    if (!root) return;
    setLoading(true);
    services
      .list(query ? root : current, !!query)
      .then((e) => {
        if (live) setEntries(e);
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [root, current, !!query, refresh]);
  const navigate = (p) => setView((v) => ({ ...v, path: p, query: "" }));
  const record = async (file) =>
    mutate((d) => ({
      ...d,
      recent: [
        {
          path: file.path,
          name: file.name,
          root,
          isDirectory: file.isDirectory,
        },
        ...d.recent.filter((x) => x.path !== file.path),
      ].slice(0, 80),
    }));
  const open = async (file) => {
    if (file.isDirectory) {
      navigate(file.path);
      await record(file);
    } else {
      if (onSelect) await onSelect(file);
      else await services.open(file.path);
      await record(file);
    }
  };
  const favorite = (file) =>
    mutate((d) => ({
      ...d,
      favorites: d.favorites.some((f) => f.path === file.path)
        ? d.favorites.filter((f) => f.path !== file.path)
        : [...d.favorites, { ...file, root }],
    }));
  const matching = entries.filter(
    (e) =>
      (!extensions || e.isDirectory || extensions.test(e.name)) &&
      (!query || matches(e.relativePath, query)),
  );
  const filtered = matching.slice(0, 300);
  return (
    <div className={"file-browser " + (compact ? "compact" : "")}>
      <div className="browser-tools">
        <SearchBox
          value={query}
          onChange={(q) => setView((v) => ({ ...v, query: q }))}
          placeholder="搜索名称或相对路径…"
        />
        <IconButton
          icon={RefreshCw}
          label="刷新目录"
          onClick={() => setRefresh((v) => v + 1)}
        />
      </div>
      {!root ? (
        <Empty
          icon={FolderOpen}
          title="尚未连接资源目录"
          description="先到配置中心选择本地目录，即可沿用现有文件。"
        />
      ) : (
        <>
          <div className="breadcrumbs">
            <IconButton
              icon={ArrowUp}
              label="返回上级"
              disabled={current === root}
              onClick={() => navigate(parent(current))}
            />
            <button onClick={() => navigate(root)}>{basename(root)}</button>
            {current
              ?.slice(root.length)
              .split("/")
              .filter(Boolean)
              .map((part, i, arr) => (
                <React.Fragment key={i}>
                  <ChevronRight size={12} />
                  <button
                    onClick={() =>
                      navigate(root + "/" + arr.slice(0, i + 1).join("/"))
                    }
                  >
                    {part}
                  </button>
                </React.Fragment>
              ))}
            <span className="spacer" />
            <IconButton
              icon={Star}
              label="收藏当前目录"
              onClick={() =>
                run(() =>
                  favorite({
                    path: current,
                    name: basename(current),
                    isDirectory: true,
                  }),
                )
              }
            />
            <IconButton
              icon={FolderOpen}
              label="打开当前目录"
              onClick={() => run(() => services.open(current))}
            />
            {allowFolders && onSelect && (
              <Button
                onClick={() =>
                  onSelect({
                    path: current,
                    name: basename(current),
                    isDirectory: true,
                  })
                }
              >
                选择此目录
              </Button>
            )}
          </div>
          {matching.length > 300 && (
            <div className="info-banner">
              匹配 {matching.length} 项，当前显示前 300 项，请缩小搜索范围。
            </div>
          )}
          <div className="browser-path" title={current}>
            {current}
          </div>
          {error ? (
            <ErrorBox message={error} retry={() => setRefresh((v) => v + 1)} />
          ) : loading ? (
            <Loading />
          ) : !filtered.length ? (
            <Empty
              icon={Folder}
              title={query ? "没有匹配的文件" : "目录中还没有内容"}
              description={
                query
                  ? "试试其他关键词或拼音"
                  : "你可以在系统文件夹中添加资料后刷新。"
              }
            />
          ) : (
            <div className="file-list">
              {filtered.map((file) => (
                <FileItem
                  key={file.path}
                  file={file}
                  onOpen={(f) => run(() => open(f))}
                  action={
                    <IconButton
                      icon={Star}
                      label={
                        data.favorites.some((f) => f.path === file.path)
                          ? "取消收藏"
                          : "收藏"
                      }
                      onClick={() => run(() => favorite(file))}
                    />
                  }
                />
              ))}
            </div>
          )}
          {!compact && (
            <div className="quick-access">
              <h4>
                <Star size={14} />
                收藏夹{" "}
                <span>
                  {data.favorites.filter((f) => f.root === root).length}
                </span>
              </h4>
              {data.favorites
                .filter((f) => f.root === root)
                .map((f) => (
                  <div className="quick-row" key={f.path}>
                    <button onClick={() => run(() => open(f))}>{f.name}</button>
                    <IconButton
                      icon={Star}
                      label="取消收藏"
                      onClick={() => run(() => favorite(f))}
                    />
                  </div>
                ))}
              <h4>
                <Clock size={14} />
                最近访问
              </h4>
              {data.recent
                .filter((f) => f.root === root)
                .slice(0, 5)
                .map((f) => (
                  <button
                    className="quick-link"
                    key={f.path}
                    onClick={() => run(() => open(f))}
                  >
                    {f.name}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
export function ResourcePicker({
  title = "选择资源",
  onSelect,
  onClose,
  allowFolders = true,
}) {
  const { config } = useApp();
  const roots = [
    ["textbooksJunior", "初中课本"],
    ["textbooksSenior", "高中课本"],
    ["exercisesJunior", "初中练习"],
    ["exercisesSenior", "高中练习"],
    ["referenceJunior", "初中资料"],
    ["referenceSenior", "高中资料"],
    ["referenceVocational", "中职资料"],
    ["lessonsRoot", "个人讲义库"],
    ["booksRoot", "书籍"],
  ];
  const [key, setKey] = useState(
    roots.find(([k]) => config[k])?.[0] || "textbooksJunior",
  );
  return (
    <Modal title={title} onClose={onClose} wide>
      <Field label="资源来源">
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {roots.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
              {!config[k] ? "（未配置）" : ""}
            </option>
          ))}
        </select>
      </Field>
      <FileBrowser
        root={config[key]}
        title={title}
        viewKey={"picker_" + key}
        onSelect={(f) => {
          onSelect({ ...f, source: roots.find((r) => r[0] === key)?.[1] });
          onClose();
        }}
        allowFolders={allowFolders}
        compact
      />
    </Modal>
  );
}
