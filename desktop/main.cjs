const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const {
  FileService,
  DocumentService,
  AIProvider,
  sanitizeConfig,
} = require("./core.cjs");
const {
  DEFAULT_SHORTCUT,
  validatePreferences,
  createShortcutManager,
  toggleWindow,
} = require("./lifecycle.cjs");
const { SQLiteStorage } = require("./storage.cjs");
const { StudentRecycleService } = require("./studentRecycle.cjs");
const { FullBackupService } = require("./fullBackup.cjs");
const { LessonDocumentService } = require("./lessonDocuments.cjs");
const { LessonPackService } = require("./lessonPack.cjs");
const { LessonCreationService } = require("./lessonCreation.cjs");
const dev = process.env.TEACHING_DEV === "1",
  testMode = !!process.env.TEACHING_DATA_DIR;
// Preserve the existing profile even though the packaged app has a Chinese name.
app.setPath(
  "userData",
  process.env.TEACHING_DATA_DIR ||
    path.join(app.getPath("appData"), "teaching-workspace"),
);
app.setName("知序");
const hasLock = app.requestSingleInstanceLock();
let showWindow = () => {};
app.on("second-instance", () => {
  if (app.isReady()) showWindow();
  else app.once("ready", () => showWindow());
});
if (!hasLock) app.quit();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "teaching-file",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
let win, tray;
if (hasLock)
  app
    .whenReady()
    .then(async () => {
      const store = await new SQLiteStorage(
        app.getPath("userData"),
        (state) => {
          if (win && !win.isDestroyed())
            win.webContents.send("teaching:storage-state", state);
        },
      ).init();
      const savedConfig = store.get("sm_path_config_v1", {}),
        cleanConfig = sanitizeConfig(savedConfig);
      if (JSON.stringify(cleanConfig) !== JSON.stringify(savedConfig))
        await store.set("sm_path_config_v1", cleanConfig);
      const files = new FileService(store, {
        openPath: shell.openPath,
        trashItem: shell.trashItem,
      });
      let quitting = false;
      app.on("before-quit", (event) => {
        if (!quitting) {
          event.preventDefault();
          store.close().finally(() => {
            quitting = true;
            app.quit();
          });
        }
      });
      const shortcutManager = createShortcutManager(globalShortcut, () =>
        toggleWindow(win, showWindow),
      );
      let shortcutError = "";
      const preferences = () => {
        try {
          return validatePreferences(
            store.get("sm_desktop_preferences_v1", {
              shortcut: DEFAULT_SHORTCUT,
              openAtLogin: false,
            }),
          );
        } catch {
          return { shortcut: DEFAULT_SHORTCUT, openAtLogin: false };
        }
      };
      const desktopState = () => ({
        ...preferences(),
        registered: !!shortcutManager.active,
        shortcutError,
        packaged: app.isPackaged,
        version: app.getVersion(),
        openAtLogin: app.isPackaged
          ? app.getLoginItemSettings().openAtLogin
          : false,
      });
      const docs = new DocumentService(files);
      const ai = new AIProvider(store);
      const lessonDocuments = new LessonDocumentService(files, ai);
      const lessonCreation = new LessonCreationService(files);
      const lessonPack = new LessonPackService(files);
      const fullBackups = new FullBackupService(store);
      const studentRecycle = new StudentRecycleService(store, files);
      await studentRecycle.recover();
      const handlers = {
        studentArchive: (_, id) => studentRecycle.archive(id),
        studentRestore: (_, id) => studentRecycle.restore(id),
        storageBackups: () => store.backupList(),
        storageBackupPreview: (_, name) => store.backupPreview(name),
        fullBackupExport: async (_, keys) => {
          const r = await dialog.showOpenDialog(win, {
            title: "选择完整备份保存文件夹（须在资料目录之外）",
            properties: ["openDirectory", "createDirectory"],
          });
          return r.canceled ? null : fullBackups.export(r.filePaths[0], keys);
        },
        fullBackupInspect: async () => {
          const r = await dialog.showOpenDialog(win, {
            title: "选择知序完整备份文件夹",
            properties: ["openDirectory"],
          });
          return r.canceled ? null : fullBackups.inspect(r.filePaths[0]);
        },
        fullBackupRestore: async (_, token) => {
          const r = await dialog.showOpenDialog(win, {
            title: "选择恢复资料的存放位置，将创建独立文件夹",
            properties: ["openDirectory", "createDirectory"],
          });
          return r.canceled ? null : fullBackups.restore(token, r.filePaths[0]);
        },
        desktopState: () => desktopState(),
        desktopSave: async (_, input) => {
          const next = validatePreferences(input),
            previousShortcut = shortcutManager.active,
            previousLogin = app.isPackaged
              ? app.getLoginItemSettings().openAtLogin
              : false;
          if (next.openAtLogin && !app.isPackaged)
            throw Error("登录自动启动请在安装后的知序应用中设置");
          shortcutManager.set(next.shortcut);
          try {
            if (app.isPackaged && next.openAtLogin !== previousLogin)
              app.setLoginItemSettings({
                openAtLogin: next.openAtLogin,
                path: process.execPath,
              });
            await store.set("sm_desktop_preferences_v1", next);
          } catch (error) {
            try {
              shortcutManager.set(previousShortcut);
            } catch (rollbackError) {
              shortcutError = rollbackError.message;
            }
            if (app.isPackaged && next.openAtLogin !== previousLogin) {
              try {
                app.setLoginItemSettings({
                  openAtLogin: previousLogin,
                  path: process.execPath,
                });
              } catch (rollbackError) {
                console.error(
                  "Login item rollback failed:",
                  rollbackError.message,
                );
              }
            }
            throw error;
          }
          shortcutError = "";
          return desktopState();
        },

        bootstrap: () => ({
          config: store.get("sm_path_config_v1", {}),
          data: store.get("sm_workspace_v1", null),
          storagePath: store.file,
          storageState: store.state(),
          storageEpoch: store.epoch,
        }),
        storageState: () => store.state(),
        storageChoose: async (_, kind) => {
          if (!["move", "open", "backup"].includes(kind))
            throw Error("不支持的数据操作");
          const result = await dialog.showOpenDialog(win, {
            title:
              kind === "open"
                ? "打开知序数据库"
                : kind === "move"
                  ? "选择数据保存文件夹"
                  : "选择备份文件夹",
            properties:
              kind === "open"
                ? ["openFile"]
                : ["openDirectory", "createDirectory"],
            filters:
              kind === "open"
                ? [{ name: "知序 SQLite 数据库", extensions: ["sqlite", "db"] }]
                : [],
          });
          if (result.canceled || !result.filePaths[0]) return null;
          return kind === "backup"
            ? store.backup(result.filePaths[0])
            : store.prepare(kind, result.filePaths[0]);
        },
        storageApply: (_, token) => store.apply(token),
        storageRetry: () => store.retry(),
        storageReveal: () => {
          shell.showItemInFolder(store.file);
        },
        storageGet: (_, key) => store.get(key),
        storageSet: (_, key, value, epoch) => {
          if (
            !["sm_workspace_v1", "sm_path_config_v1"].includes(key) &&
            !key.startsWith("sm_view_state_") &&
            !key.startsWith("sm_draft_")
          )
            throw Error("不支持的存储键");
          return store.set(
            key,
            key === "sm_path_config_v1" ? sanitizeConfig(value) : value,
            epoch,
          );
        },
        list: (_, p, recursive) => files.list(p, recursive),
        check: (_, p) => files.check(p),
        open: (_, p) => files.open(p),
        mkdir: (_, p) => files.mkdir(p),
        rename: (_, a, b) => files.rename(a, b),
        trash: (_, p, name) => files.trash(p, name),
        copy: (_, a, b) => files.copy(a, b),
        pick: async (_, kind, filters) => {
          const r = await dialog.showOpenDialog(win, {
            properties:
              kind === "directory"
                ? ["openDirectory"]
                : kind === "files"
                  ? ["openFile", "multiSelections"]
                  : ["openFile"],
            filters: filters || [],
          });
          const paths = r.filePaths || [];
          for (const p of paths)
            files.grants.add(await require("./core.cjs").canonical(p));
          return kind === "files" ? paths : paths[0] || null;
        },
        study: (_, a, b, f, e, o, mode) => docs.study(a, b, f, e, o, mode),
        lessonPackOptions: (_, input) => lessonPack.options(input),
        lessonPack: (_, input) => lessonPack.create(input),
        lessonCreateOptions: (_, stage) => lessonCreation.options(stage),
        lessonCreate: (_, input) => lessonCreation.create(input),
        lessonPrepare: (_, source) => lessonDocuments.prepare(source),
        lessonGenerate: (_, options) => lessonDocuments.generate(options),
        lessonSave: (_, options) => lessonDocuments.save(options),
        lessonDiscard: (_, token) => lessonDocuments.discard(token),
        readText: (_, p) => docs.text(p),
        sheet: (_, p) => docs.sheet(p),
        pdf: (_, p) => docs.pdf(p),
        word: (_, p, text, overwrite) => docs.word(p, text, overwrite),
        learningReport: (_, p, report) => docs.learningReport(p, report),
        writeJSON: (_, p, obj, overwrite) =>
          files.write(p, JSON.stringify(obj, null, 2), {
            overwrite,
            backup: overwrite,
          }),
        ai: (_, request) => ai.generate(request),
        cancelAI: (_, id) => ai.cancel(id),
        volumes: async () =>
          process.platform === "darwin"
            ? (await fs.readdir("/Volumes", { withFileTypes: true }))
                .filter((x) => x.isDirectory())
                .map((x) => "/Volumes/" + x.name)
            : [],
        mediaURL: async (_, p) => {
          const safe = await files.guard(p);
          await fs.access(safe);
          return "teaching-file://local/" + encodeURIComponent(safe);
        },
      };
      for (const [name, handler] of Object.entries(handlers))
        ipcMain.handle("teaching:" + name, (event, ...args) => {
          const url = event.senderFrame?.url || "";
          if (
            !(dev
              ? url.startsWith("http://127.0.0.1:5173/")
              : url.startsWith(
                  pathToFileURL(path.join(__dirname, "../dist/")).href,
                ))
          )
            throw Error("未授权来源");
          return handler(event, ...args);
        });
      protocol.handle("teaching-file", async (request) => {
        try {
          const p = await files.guard(
            decodeURIComponent(new URL(request.url).pathname.slice(1)),
          );
          return net.fetch(pathToFileURL(p).href, { headers: request.headers });
        } catch (e) {
          return new Response(e.message, { status: 403 });
        }
      });
      const create = () => {
        win = new BrowserWindow({
          title: "知序 · 教培管理",
          width: 1440,
          height: 940,
          minWidth: 440,
          minHeight: 600,
          backgroundColor: "#f4f6fa",
          webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        win.on("close", (event) => {
          if (!quitting) {
            event.preventDefault();
            win.hide();
          }
        });
        win.on("closed", () => {
          win = null;
        });
        win.webContents.on("render-process-gone", () => {
          if (win && !win.isDestroyed()) {
            win.reload();
            showWindow();
          }
        });
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", (event, url) => {
          if (url !== win.webContents.getURL()) event.preventDefault();
        });
        if (dev) win.loadURL("http://127.0.0.1:5173/");
        else win.loadFile(path.join(__dirname, "../dist/index.html"));
      };
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { label: "显示知序", click: () => showWindow() },
              {
                label: "隐藏窗口",
                accelerator: "CommandOrControl+W",
                click: () => win?.hide(),
              },
              { type: "separator" },
              {
                label: "退出知序",
                accelerator: "CommandOrControl+Q",
                click: () => app.quit(),
              },
            ],
          },
          {
            label: "页面",
            submenu: [
              "students",
              "followups",
              "studentNotes",
              "wrongQuestions",
              "textbooks",
              "planning",
              "teachingVideos",
              "lessonLibrary",
              "exams",
              "books",
              "settings",
              "search",
              "assistant",
            ].map((command, i) => ({
              label: [
                "学生管理",
                "回访管理",
                "学生记录",
                "错题报告",
                "课本管理",
                "分层规划",
                "教学视频",
                "讲义库",
                "考试管理",
                "书籍",
                "配置中心",
                "全局搜索",
                "AI 教学助手",
              ][i],
              accelerator:
                command === "search"
                  ? "CommandOrControl+K"
                  : command === "assistant"
                    ? "CommandOrControl+Shift+A"
                    : undefined,
              click: () => {
                showWindow();
                win.webContents.send("teaching:command", command);
              },
            })),
          },
          {
            label: "编辑",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "视图",
            submenu: [
              { role: "reload" },
              { role: "toggleDevTools" },
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
            ],
          },
        ]),
      );
      showWindow = () => {
        if (!win || win.isDestroyed()) create();
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      };
      create();
      try {
        const icon = nativeImage
          .createFromPath(path.join(__dirname, "../assets/trayTemplate.png"))
          .resize({ width: 18, height: 18 });
        if (process.platform === "darwin") icon.setTemplateImage(true);
        tray = new Tray(icon);
        tray.setToolTip("知序 · 教培管理");
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: "打开知序", click: () => showWindow() },
            {
              label: "配置中心",
              click: () => {
                showWindow();
                win.webContents.send("teaching:command", "settings");
              },
            },
            { type: "separator" },
            { label: "退出知序", click: () => app.quit() },
          ]),
        );
        tray.on("double-click", () => showWindow());
      } catch (error) {
        console.error("Menu bar initialization failed:", error.message);
      }
      if (!testMode || process.env.TEACHING_ENABLE_SHORTCUTS === "1")
        try {
          shortcutManager.set(preferences().shortcut);
        } catch (error) {
          shortcutError = error.message;
        }
      app.on("will-quit", () => {
        shortcutManager.dispose();
        tray?.destroy();
      });
      app.on("activate", () => showWindow());
    })
    .catch((e) => {
      dialog.showErrorBox("启动失败", e.message);
      app.quit();
    });
// The app stays available from its tray and shortcut until the user explicitly quits.
app.on("window-all-closed", () => {});
