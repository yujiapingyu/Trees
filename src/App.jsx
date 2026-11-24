import TeachingAutomation from "./components/TeachingAutomation";
import React, { useEffect, useState } from "react";
import {
  Users,
  PhoneCall,
  NotebookPen,
  ChartNoAxesCombined,
  Library,
  Video,
  BookOpen,
  LayoutGrid,
  Settings2,
  GraduationCap,
  ChevronRight,
  HardDrive,
  HelpCircle,
  PanelLeft,
  ArrowUpRight,
  Search,
  Sparkles,
} from "lucide-react";
import { useApp, useView } from "./shared/store";
import { storage, services } from "./shared/services";
import { Loading, ErrorBox, Button, Modal, Markdown } from "./components/UI";
import Students from "./pages/Students";
import Followups from "./pages/Followups";
import Notes from "./pages/Notes";
import WrongQuestions from "./pages/WrongQuestions";
import Resources from "./pages/Resources";
import Videos from "./pages/Videos";
import Lessons from "./pages/Lessons";
import Exams from "./pages/Exams";
import Settings from "./pages/Settings";
import GlobalSearch from "./components/GlobalSearch";
import { Assistant } from "./components/AIPanel";
import TeacherProfile from "./components/TeacherProfile";
import { teacherDisplayName, teacherProfile } from "./shared/teacherProfile";
export const NAV = [
  ["students", "学生管理", Users],
  ["followups", "回访管理", PhoneCall],
  ["studentNotes", "学生记录", NotebookPen],
  ["wrongQuestions", "错题报告", ChartNoAxesCombined],
  ["teachingResources", "教学资源", Library],
  ["teachingVideos", "教学视频", Video],
  ["lessonLibrary", "讲义库", BookOpen],
  ["exams", "考试管理", LayoutGrid],
  ["settings", "配置中心", Settings2],
];
const shortcuts = [
  "students",
  "followups",
  "teachingResources",
  "studentNotes",
  "wrongQuestions",
  "teachingVideos",
  "lessonLibrary",
];
class Boundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = { error: "" };
  }
  static getDerivedStateFromError(e) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <ErrorBox message={"页面发生错误：" + this.state.error} />
        <Button onClick={() => this.setState({ error: "" })}>重试页面</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const {
    data,
    loading,
    fatal,
    desktop,
    config,
    syncStudents,
    run,
    storageState,
  } = useApp();
  const [route, setRoute] = useView("route", "students"),
    [help, setHelp] = useState(false),
    [search, setSearch] = useState(false),
    [assistant, setAssistant] = useState(false),
    [profileOpen, setProfileOpen] = useState(false),
    [destination, setDestination] = useState(null),
    [revision, setRevision] = useState(0);
  const navigate = (key) => setRoute(key);
  const openResult = (result) =>
    run(async () => {
      if (result.target?.file) {
        await services.open(result.target.file);
        setSearch(false);
        return;
      }
      const target = result.target;
      if (!target?.route) return;
      const previous = await storage.get("sm_view_state_" + target.route, {});
      await storage.set("sm_view_state_" + target.route, {
        ...previous,
        ...target.view,
      });
      setSearch(false);
      setAssistant(false);
      setDestination(target.record ? result.key : null);
      setRoute(target.route);
      setRevision((v) => v + 1);
    });
  useEffect(() => {
    const open = (e) => openResult(e.detail);
    const keys = (e) => {
      if (e.isComposing || e.repeat || e.altKey || !(e.metaKey || e.ctrlKey))
        return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key.toLowerCase() === "k" && !e.shiftKey) {
        e.preventDefault();
        setSearch(true);
      }
      if (e.key.toLowerCase() === "a" && e.shiftKey) {
        e.preventDefault();
        setAssistant(true);
      }
    };
    window.addEventListener("workspace:open", open);
    document.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("workspace:open", open);
      document.removeEventListener("keydown", keys);
    };
  }, []);
  useEffect(() => {
    if (!destination) return;
    let timer, highlighted;
    const find = () => {
      const el = [...document.querySelectorAll("[data-search-key]")].find(
        (e) => e.dataset.searchKey === destination,
      );
      if (!el) return;
      if (el.tagName === "DETAILS") el.open = true;
      el.scrollIntoView({ block: "center" });
      el.classList.add("search-highlight");
      highlighted = el;
      observer.disconnect();
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("search-highlight"), 4500);
    };
    const observer = new MutationObserver(find);
    observer.observe(document.querySelector("main"), {
      childList: true,
      subtree: true,
    });
    find();
    if (!highlighted) timer = setTimeout(() => observer.disconnect(), 6000);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      highlighted?.classList.remove("search-highlight");
    };
  }, [destination, revision]);
  const command = async (key) => {
    if (key === "textbooks" || key === "planning") {
      const current = await storage.get("sm_view_state_teachingResources", {
        stage: "Junior",
      });
      await storage.set("sm_view_state_teachingResources", {
        ...current,
        tab: key,
      });
      setRoute("teachingResources");
      window.dispatchEvent(new CustomEvent("resource:tab", { detail: key }));
    } else if (key === "assistant") {
      setAssistant(true);
    } else if (key === "search") {
      setSearch(true);
    } else if (NAV.some((n) => n[0] === key) || key === "books") setRoute(key);
  };
  useEffect(() => {
    const handler = (e) => {
      if (
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.shiftKey ||
        e.isComposing
      )
        return;
      const el = e.target;
      if (
        el.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      const target = shortcuts[Number(e.key) - 1];
      if (target) {
        e.preventDefault();
        navigate(target);
      }
    };
    document.addEventListener("keydown", handler);
    const off = services.onCommand?.(command);
    window.utools?.onPluginEnter?.(({ code }) => command(code));
    return () => {
      document.removeEventListener("keydown", handler);
      off?.();
    };
  }, []);
  useEffect(() => {
    if (!loading && desktop && config.studentsRoot) run(syncStudents);
  }, [loading, config.studentsRoot]);
  useEffect(() => {
    if (!loading && !NAV.some(([key]) => key === route) && route !== "books")
      setRoute("students");
  }, [route, loading]);
  if (loading) return <Loading text="正在打开本地教学工作区…" />;
  if (fatal)
    return (
      <div className="fatal">
        <ErrorBox message={fatal} />
      </div>
    );
  const label =
    NAV.find((n) => n[0] === route)?.[1] ||
    (route === "books" ? "书籍" : "学生管理");
  const profile = teacherProfile(data.teacherProfile),
    displayName = teacherDisplayName(profile);
  const pages = {
    students: <Students navigate={navigate} />,
    followups: <Followups />,
    studentNotes: <Notes />,
    wrongQuestions: <WrongQuestions />,
    teachingResources: <Resources />,
    teachingVideos: <Videos />,
    lessonLibrary: <Lessons />,
    exams: <Exams />,
    settings: <Settings />,
    books: <Resources books />,
  };
  return (
    <div className="app-shell">
      <nav className="main-nav" aria-label="主导航">
        <button
          className="brand"
          title="知序 · 教培管理"
          onClick={() => navigate("students")}
        >
          <GraduationCap size={28} />
          <span>知序</span>
        </button>
        <div className="nav-items">
          {NAV.map(([key, name, Icon], i) => (
            <button
              key={key}
              aria-current={route === key ? "page" : undefined}
              className={route === key ? "active" : ""}
              onClick={() => navigate(key)}
              title={
                name +
                (shortcuts.includes(key)
                  ? " · " + (shortcuts.indexOf(key) + 1)
                  : "")
              }
            >
              <Icon size={21} strokeWidth={1.6} />
              <span>{name}</span>
            </button>
          ))}
        </div>
        <div className="nav-footer">
          <button
            className="teacher-profile-entry"
            aria-label="教师个人信息"
            title={"教师个人信息 · " + displayName}
            onClick={() => setProfileOpen(true)}
          >
            <span className="teacher-avatar">
              {[...(profile.name || profile.displayName).trim()][0] || "师"}
            </span>
            <span className="teacher-profile-name">{displayName}</span>
            <small>个人设置</small>
          </button>
        </div>
      </nav>
      <div className="main-frame">
        <div className="topbar">
          <div>
            <span className="topbar-label">教学工作台</span>
            <ChevronRight size={13} />
            <span>{label}</span>
          </div>
          <div>
            <Button
              icon={Search}
              onClick={() => setSearch(true)}
              title="⌘/Ctrl + K"
            >
              全局搜索
            </Button>
            <Button
              icon={Sparkles}
              onClick={() => setAssistant(true)}
              title="⌘/Ctrl + Shift + A"
            >
              AI 助手
            </Button>
            <span className="current-date">
              {new Intl.DateTimeFormat("zh-CN", {
                timeZone: "Asia/Shanghai",
                month: "long",
                day: "numeric",
                weekday: "long",
              }).format(new Date())}
            </span>
            <span className="topbar-divider" />
            <span className={"connection " + (desktop ? "online" : "")}>
              <span />
              {desktop ? "本地服务已连接" : "浏览器预览"}
            </span>
            <button
              className="icon-button"
              aria-label="使用说明"
              onClick={() => setHelp(true)}
            >
              <HelpCircle size={18} />
            </button>
          </div>
        </div>
        {!desktop && (
          <div className="environment-banner">
            <HardDrive size={15} />
            <span>当前为浏览器模式，本地文件操作需要桌面服务。</span>
            <button onClick={() => setHelp(true)}>
              启动说明 <ArrowUpRight size={12} />
            </button>
          </div>
        )}
        {(storageState?.pending || storageState?.backupError) && (
          <div className="environment-banner storage-warning" role="alert">
            <HardDrive size={18} />
            <span>
              <strong>
                {storageState.pending
                  ? "改动已保存在本机，尚未写入所选数据文件。"
                  : "自动备份需要处理。"}
              </strong>{" "}
              {storageState.error || storageState.backupError}
            </span>
            <button
              onClick={async () => {
                await storage.set("sm_view_state_settings", "storage");
                navigate("settings");
                window.dispatchEvent(new Event("storage:settings"));
              }}
            >
              数据与备份
            </button>
          </div>
        )}
        <main className="main-content">
          <Boundary key={route + ":" + revision}>
            {pages[route] || pages.students}
          </Boundary>
        </main>
        <footer className="app-footer">
          <span>
            <span className="tiny-dot" />
            知序 · 教学有迹，成长有序
          </span>
          <span>LOCAL FIRST · 为每一次教学积累</span>
        </footer>
      </div>
      <TeachingAutomation key={storageState?.datasetId || "browser"} />
      <GlobalSearch
        open={search}
        onClose={() => setSearch(false)}
        onOpen={openResult}
      />
      {assistant && <Assistant onClose={() => setAssistant(false)} />}
      {profileOpen && <TeacherProfile onClose={() => setProfileOpen(false)} />}
      {help && (
        <Modal title="欢迎使用知序" onClose={() => setHelp(false)}>
          <Markdown>{`这是一个本地优先的教培工作台。\n\n1. 在配置中心选择学生、讲义与教学资源根目录。\n2. 学生文件夹自动扫描为档案，也可以直接新增。\n3. 选择学生后管理课程、作业、反馈、错题与报告。\n4. AI 与文档转换需要配置相应的服务和本地工具。\n\n**桌面版启动：** 双击已安装的「知序」应用，无需终端。关闭窗口后驻留菜单栏，默认 ⌘⇧J 随时唤起，前台时再按隐藏；在「配置中心 → 启动与快捷键」修改快捷键或开启登录自动启动。彻底退出使用 ⌘Q。开发时使用 npm run desktop:dev。\n\n**快捷键：** 1 学生、2 回访、3 教学资源、4 学生记录、5 错题报告、6 视频、7 讲义库。输入时禁用。\n\n**书籍入口：** 桌面菜单「页面 → 书籍」。\n\n文件操作只作用于配置的根目录；删除进入系统废纸篓。业务记录使用 SQLite，在「配置中心 → 数据与备份」选择保存文件夹，也可选择云同步文件夹。讲义、试卷等附件仍在原资源目录；本机配置与凭据不随数据库同步。多台设备请轮流使用，退出一台并等待云同步完成后再打开另一台。浏览器预览使用 localStorage。`}</Markdown>
        </Modal>
      )}
    </div>
  );
}
