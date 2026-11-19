const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net,
  Menu,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const {
  DiskStorage,
  FileService,
  DocumentService,
  AIProvider,
  sanitizeConfig,
} = require("./core.cjs");
const dev = process.env.TEACHING_DEV === "1";
if (process.env.TEACHING_DATA_DIR)
  app.setPath("userData", process.env.TEACHING_DATA_DIR);
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
let win;
app
  .whenReady()
  .then(async () => {
    const store = await new DiskStorage(
      path.join(app.getPath("userData"), "workspace.json"),
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
        store.queue.finally(() => {
          quitting = true;
          app.quit();
        });
      }
    });
    const docs = new DocumentService(files);
    const ai = new AIProvider(store);
    const handlers = {
      bootstrap: () => ({
        config: store.get("sm_path_config_v1", {}),
        data: store.get("sm_workspace_v1", null),
        storagePath: store.file,
      }),
      storageGet: (_, key) => store.get(key),
      storageSet: (_, key, value) => {
        if (
          !["sm_workspace_v1", "sm_path_config_v1"].includes(key) &&
          !key.startsWith("sm_view_state_")
        )
          throw Error("不支持的存储键");
        return store.set(
          key,
          key === "sm_path_config_v1" ? sanitizeConfig(value) : value,
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
          properties: kind === "directory" ? ["openDirectory"] : ["openFile"],
          filters: filters || [],
        });
        const p = r.filePaths[0];
        if (p) files.grants.add(await require("./core.cjs").canonical(p));
        return p || null;
      },
      study: (_, a, b, f, e, o) => docs.study(a, b, f, e, o),
      readText: (_, p) => docs.text(p),
      sheet: (_, p) => docs.sheet(p),
      pdf: (_, p) => docs.pdf(p),
      word: (_, p, text, overwrite) => docs.word(p, text, overwrite),
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
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event, url) => {
        if (url !== win.webContents.getURL()) event.preventDefault();
      });
      if (dev) win.loadURL("http://127.0.0.1:5173/");
      else win.loadFile(path.join(__dirname, "../dist/index.html"));
    };
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: app.name, submenu: [{ role: "about" }, { role: "quit" }] },
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
            "questionBank",
            "books",
            "settings",
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
              "题库管理",
              "书籍",
              "配置中心",
            ][i],
            click: () => win.webContents.send("teaching:command", command),
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
    create();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) create();
    });
  })
  .catch((e) => {
    dialog.showErrorBox("启动失败", e.message);
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
