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
import QuestionBank from "./pages/QuestionBank";
import Settings from "./pages/Settings";
export const NAV = [
  ["students", "学生管理", Users],
  ["followups", "回访管理", PhoneCall],
  ["studentNotes", "学生记录", NotebookPen],
  ["wrongQuestions", "错题报告", ChartNoAxesCombined],
  ["teachingResources", "教学资源", Library],
  ["teachingVideos", "教学视频", Video],
  ["lessonLibrary", "讲义库", BookOpen],
  ["questionBank", "题库管理", LayoutGrid],
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
  const { loading, fatal, desktop, config, syncStudents, run } = useApp();
  const [route, setRoute] = useView("route", "students"),
    [help, setHelp] = useState(false);
  const navigate = (key) => setRoute(key);
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
      setRoute("studentNotes");
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
  const pages = {
    students: <Students navigate={navigate} />,
    followups: <Followups />,
    studentNotes: <Notes />,
    wrongQuestions: <WrongQuestions />,
    teachingResources: <Resources />,
    teachingVideos: <Videos />,
    lessonLibrary: <Lessons />,
    questionBank: <QuestionBank />,
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
          <div className="teacher-avatar">师</div>
          <span>本地工作区</span>
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
        <main className="main-content">
          <Boundary key={route}>{pages[route] || pages.students}</Boundary>
        </main>
        <footer className="app-footer">
          <span>
            <span className="tiny-dot" />
            知序 · 教学有迹，成长有序
          </span>
          <span>LOCAL FIRST · 为每一次教学积累</span>
        </footer>
      </div>
      {help && (
        <Modal title="欢迎使用知序" onClose={() => setHelp(false)}>
          <Markdown>{`这是一个本地优先的教培工作台。\n\n1. 在配置中心选择学生、讲义与教学资源根目录。\n2. 学生文件夹自动扫描为档案，也可以直接新增。\n3. 选择学生后管理课程、作业、反馈、错题与报告。\n4. AI 与文档转换需要配置相应的服务和本地工具。\n\n**桌面版启动：** 在项目目录运行 npm install，再运行 npm run desktop。开发时使用 npm run desktop:dev。\n\n**快捷键：** 1 学生、2 回访、3 教学资源、4 学生记录、5 错题报告、6 视频、7 讲义库。输入时禁用。\n\n**书籍入口：** 桌面菜单「页面 → 书籍」。\n\n文件操作只作用于配置的根目录；删除进入系统废纸篓。配置与轻量记录保存到桌面应用用户数据目录，浏览器使用 localStorage。`}</Markdown>
        </Modal>
      )}
    </div>
  );
}
