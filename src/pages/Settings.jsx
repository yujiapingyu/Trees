import React, { useEffect, useState } from "react";
import {
  Settings2,
  FolderOpen,
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  CheckCircle2,
  HardDrive,
  BookOpen,
  School,
  Library,
  FolderTree,
  Info,
  RefreshCw,
} from "lucide-react";
import { useApp, useView } from "../shared/store";
import { services } from "../shared/services";
import SchoolManager from "../components/SchoolManager";
import {
  PageHeader,
  Button,
  Field,
  Badge,
  ErrorBox,
  Markdown,
} from "../components/UI";
export const PATH_GROUPS = [
  {
    key: "student",
    label: "学生与讲义",
    icon: Library,
    description: "连接你的教学工作目录",
    fields: [
      ["studentsRoot", "学生根目录"],
      ["lessonsRoot", "个人讲义库目录"],
      ["templatesRoot", "DOC / DOCX 模板目录"],
      ["examsRoot", "考试资料根目录"],
      ["feedbackTemplate", "微信群反馈模板文件", "file"],
    ],
  },
  {
    key: "schools",
    label: "学校管理",
    icon: School,
    description: "按初中、高中管理自定义学校，供学生档案关联",
    fields: [],
  },
  {
    key: "documents",
    label: "文档转换",
    icon: FolderTree,
    description: "本地 Word 文档读取与转换工具",
    fields: [["libreofficePath", "LibreOffice 可执行文件", "file"]],
  },
  {
    key: "reference",
    label: "参考资料",
    icon: BookOpen,
    description: "保留你已有的资料组织方式",
    fields: [
      ["referenceJunior", "初中参考资料"],
      ["referenceSenior", "高中参考资料"],
      ["referenceVocational", "中职参考资料"],
    ],
  },
  {
    key: "materials",
    label: "教材与练习",
    icon: FolderOpen,
    description: "备课资源与视频书籍",
    fields: [
      ["textbooksJunior", "初中课本目录"],
      ["textbooksSenior", "高中课本目录"],
      ["exercisesJunior", "初中练习目录"],
      ["exercisesSenior", "高中练习目录"],
      ["videosRoot", "教学视频根目录"],
      ["booksRoot", "书籍根目录"],
    ],
  },
  {
    key: "planning",
    label: "分层规划与设备",
    icon: HardDrive,
    description: "规划表与外部存储设备",
    fields: [
      ["planningJunior", "初中规划表目录"],
      ["planningSenior", "高中规划表目录"],
      ["usbRoot", "U 盘挂载目录"],
    ],
  },
  {
    key: "ai",
    label: "AI 模型服务",
    icon: Settings2,
    description: "凭据只保存在本机配置中",
    fields: [
      ["deepseekKey", "DeepSeek API Key", "secret"],
      ["deepseekHost", "文本服务地址", "text"],
      ["deepseekModel", "文本模型名称", "text"],
    ],
  },
  {
    key: "guide",
    label: "目录说明",
    icon: Info,
    description: "本地优先，自由组织",
    fields: [],
  },
];
const defaults = {
  deepseekHost: "https://api.deepseek.com",
  deepseekModel: "deepseek-chat",
};
export default function Settings() {
  const { config, saveConfig, run, desktop } = useApp();
  const [tab, setTab] = useView("settings", "student");
  const [draft, setDraft] = useState({ ...defaults, ...config }),
    [checks, setChecks] = useState({}),
    [shown, setShown] = useState({}),
    [busy, setBusy] = useState(false),
    [volumes, setVolumes] = useState([]);
  useEffect(() => setDraft({ ...defaults, ...config }), [config]);
  const group = PATH_GROUPS.find((g) => g.key === tab) || PATH_GROUPS[0];
  useEffect(() => {
    if (!PATH_GROUPS.some((g) => g.key === tab)) setTab("student");
  }, [tab]);
  const set = (key, value) => setDraft((v) => ({ ...v, [key]: value }));
  const check = async (key) => {
    if (!draft[key] || !desktop) return;
    const result = await services.check(draft[key]);
    setChecks((v) => ({ ...v, [key]: result }));
  };
  return (
    <div className="page settings-page">
      <PageHeader
        title="配置中心"
        description="连接本地资料，让每一份教学积累都有归处。"
      >
        <Badge type={desktop ? "success" : "warning"}>
          {desktop ? "桌面服务已连接" : "浏览器 · 文件服务未连接"}
        </Badge>
      </PageHeader>
      <div className="settings-layout">
        <aside className="settings-nav">
          {PATH_GROUPS.map((g) => (
            <button
              className={g.key === tab ? "active" : ""}
              key={g.key}
              onClick={() => setTab(g.key)}
            >
              <g.icon size={18} />
              {g.label}
            </button>
          ))}
          <div className="local-note">
            <HardDrive size={20} />
            <strong>你的资料，留在本地</strong>
            <p>学生档案、资源与配置保存在自己的电脑中。</p>
          </div>
        </aside>
        <div className="settings-content card">
          <div className="settings-title">
            <h2>{group.label}</h2>
            <p>{group.description}</p>
          </div>
          {group.key === "schools" ? (
            <SchoolManager />
          ) : group.key === "guide" ? (
            <Markdown>{`### 建议目录结构

学生根目录 / 学生姓名 / 课程名称 / 教案.docx

讲义根目录 / 初中或高中 / 年级 / 讲义名称 / 教案.docx

学生目录中的“学习力报告”“错题本”“续费管理”不会识别成课程。

规划表支持 XLSX / CSV。DOC 正文、Word 转 PDF 和学案分页预览需要 LibreOffice。

学校在“学校管理”中按初中、高中自行添加，再在学生档案选择关联。

浏览器可保存轻量记录；本地文件、DeepSeek 请求及文档转换需要桌面版。使用 npm run desktop 启动。`}</Markdown>
          ) : (
            <>
              <div className="settings-fields">
                {group.fields.map(([key, label, type]) => (
                  <Field key={key} label={label}>
                    <div className="path-input">
                      <input
                        type={
                          type === "secret" && !shown[key] ? "password" : "text"
                        }
                        placeholder={
                          type === "text"
                            ? "输入配置值"
                            : type === "secret"
                              ? "输入 API Key"
                              : "选择或输入本地绝对路径"
                        }
                        value={draft[key] || ""}
                        onChange={(e) => set(key, e.target.value)}
                        onBlur={() =>
                          !type || type === "file" ? check(key) : null
                        }
                      />
                      {type === "secret" ? (
                        <Button
                          icon={shown[key] ? EyeOff : Eye}
                          onClick={() =>
                            setShown((v) => ({ ...v, [key]: !v[key] }))
                          }
                        >
                          {shown[key] ? "隐藏" : "显示"}
                        </Button>
                      ) : type !== "text" ? (
                        <Button
                          icon={FolderOpen}
                          onClick={() =>
                            run(async () => {
                              const p = await services.pick(
                                type === "file" ? "file" : "directory",
                              );
                              if (p) {
                                set(key, p);
                                setChecks((v) => ({
                                  ...v,
                                  [key]: { exists: true, readable: true },
                                }));
                              }
                            })
                          }
                        >
                          选择
                        </Button>
                      ) : null}
                    </div>
                    {checks[key] && (
                      <small
                        className={
                          checks[key].readable ? "text-success" : "text-danger"
                        }
                      >
                        {checks[key].readable
                          ? "✓ 路径存在且可读"
                          : "路径不可用：" + checks[key].error}
                      </small>
                    )}
                  </Field>
                ))}
              </div>
              {tab === "planning" && (
                <div className="volume-section">
                  <Button
                    icon={RefreshCw}
                    onClick={() =>
                      run(async () => setVolumes(await services.volumes()))
                    }
                  >
                    扫描 /Volumes
                  </Button>
                  {volumes.map((p) => (
                    <Button key={p} onClick={() => set("usbRoot", p)}>
                      {p}
                    </Button>
                  ))}
                </div>
              )}
              <div className="settings-footer">
                <span>更改后保存，将刷新关联资源。</span>
                <div>
                  <Button
                    icon={RotateCcw}
                    onClick={() => {
                      setDraft({ ...defaults, ...config });
                      setChecks({});
                    }}
                  >
                    重置草稿
                  </Button>
                  <Button
                    icon={Save}
                    variant="primary"
                    busy={busy}
                    onClick={() =>
                      run(async () => {
                        setBusy(true);
                        try {
                          for (const g of PATH_GROUPS)
                            for (const [key, , type] of g.fields)
                              if (
                                (!type || type === "file") &&
                                draft[key] &&
                                !draft[key].startsWith("/") &&
                                !/^[A-Z]:[\\/]/i.test(draft[key])
                              )
                                throw Error("本地路径必须为绝对路径：" + key);
                          const normalized = { ...draft };
                          for (const g of PATH_GROUPS)
                            for (const [key, , type] of g.fields)
                              if ((!type || type === "file") && normalized[key])
                                normalized[key] =
                                  normalized[key].trim().replace(/\/+$/, "") ||
                                  "/";
                          await saveConfig(normalized);
                        } finally {
                          setBusy(false);
                        }
                      })
                    }
                  >
                    保存配置
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
