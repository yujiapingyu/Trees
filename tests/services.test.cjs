const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  DiskStorage,
  FileService,
  DocumentService,
  AIProvider,
  within,
} = require("../desktop/core.cjs");
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-test-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "resources");
  await fs.mkdir(root);
  const store = await new DiskStorage(path.join(temp, "store.json")).init();
  await store.set("sm_path_config_v1", { studentsRoot: root });
  const files = new FileService(store, {
    openPath: async () => "",
    trashItem: async (p) => fs.rename(p, p + ".trashed"),
  });
  return { temp, root, store, files, docs: new DocumentService(files) };
}
test("边界检查拒绝相邻目录与 symlink 逃逸", async (t) => {
  const { temp, root, files } = await fixture(t);
  assert.equal(within(root, root + "-other"), false);
  await assert.rejects(() => files.list(temp), /不在当前配置/);
  const outside = path.join(temp, "outside");
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, "link"));
  await assert.rejects(
    () => files.write(path.join(root, "link", "x"), "oops"),
    /不在当前配置/,
  );
  await assert.rejects(
    () => files.write(path.join(root, "..", "escape"), "oops"),
    /不在当前配置/,
  );
});
test("目录新建、文件保存、备份、改名、重载、废纸篓完整闭环", async (t) => {
  const { root, store, files, temp } = await fixture(t);
  const student = path.join(root, "张三");
  await files.mkdir(student);
  const doc = path.join(student, "note.json");
  await files.write(doc, '{"ok":true}');
  await assert.rejects(() => files.write(doc, "bad"), /已存在/);
  await files.write(doc, '{"ok":2}', { overwrite: true, backup: true });
  assert.equal(
    (await files.list(student)).filter((f) => f.name.endsWith(".bak")).length,
    1,
  );
  await files.rename(student, path.join(root, "张三改名"));
  await store.set("student", { id: "same-id", name: "张三改名" });
  const reloaded = await new DiskStorage(path.join(temp, "store.json")).init();
  assert.equal(reloaded.get("student").id, "same-id");
  await files.trash(path.join(root, "张三改名"), "张三改名");
  assert.equal((await files.list(root))[0].name, "张三改名.trashed");
  await assert.rejects(
    () => files.trash(root, path.basename(root)),
    /资源根目录/,
  );
});
test("写入队列不会丢失并发键值，存储损坏不静默清空", async (t) => {
  const { store, temp } = await fixture(t);
  await Promise.all(
    Array.from({ length: 15 }, (_, i) => store.set("key" + i, i)),
  );
  const s = await new DiskStorage(store.file).init();
  assert.equal(s.get("key14"), 14);
  await fs.writeFile(path.join(temp, "broken.json"), "{broken");
  await assert.rejects(
    () => new DiskStorage(path.join(temp, "broken.json")).init(),
    /存储读取失败/,
  );
});
test("目录列举不显示系统文件和符号链接", async (t) => {
  const { files, root } = await fixture(t);
  await fs.writeFile(path.join(root, ".DS_Store"), "x");
  await fs.writeFile(path.join(root, "练习.txt"), "x");
  await fs.symlink(path.join(root, "练习.txt"), path.join(root, "link"));
  assert.deepEqual(
    (await files.list(root)).map((f) => f.name),
    ["练习.txt"],
  );
});
test("真实 DOCX 创建、提取、转学案与覆盖保护", async (t) => {
  const { docs, root, files } = await fixture(t);
  const file = path.join(root, "教案.docx");
  await docs.word(
    file,
    "教学目标\n1. 求函数 y=x+1 的值\n答案：2\n2. 解一元一次方程",
  );
  assert.match(await docs.text(file), /教学目标/);
  await docs.study(file, path.join(root, "学案.docx"), 0.6, 0.75);
  assert.ok(
    !(await docs.text(path.join(root, "学案.docx"))).includes("答案：2"),
  );
  await assert.rejects(
    () => docs.study(file, path.join(root, "学案.docx"), 0.6, 0.75),
    /已存在/,
  );
  await assert.rejects(
    () => docs.study(file, path.join(root, "bad.docx"), 2, 0.5),
    /范围/,
  );
});
test("XLSX 表格读取保留空白单元格与列结构", async (t) => {
  const { root, docs } = await fixture(t);
  const ExcelJS = require("exceljs");
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet("规划");
  s.addRow(["年级", "程度", "主题"]);
  s.addRow(["初一", null, "方程"]);
  const p = path.join(root, "规划.xlsx");
  await w.xlsx.writeFile(p);
  const result = await docs.sheet(p);
  assert.deepEqual(result[0].rows[1], ["初一", "", "方程"]);
});
test("AI 缺少凭据时必须失败，不能冒充成功", async (t) => {
  const { store } = await fixture(t);
  const ai = new AIProvider(store);
  await assert.rejects(() => ai.generate({ id: "x", task: "测试" }), /API Key/);
});
test("根目录包含其他配置目录时禁止删除", async (t) => {
  const { root, store, files } = await fixture(t);
  const a = path.join(root, "学生");
  await fs.mkdir(a);
  await fs.mkdir(path.join(a, "讲义库"));
  await store.set("sm_path_config_v1", {
    studentsRoot: root,
    lessonsRoot: path.join(a, "讲义库"),
  });
  await assert.rejects(() => files.trash(a, "学生"), /其他配置根目录/);
});
test("AI 成功响应、HTTP 错误、空输出与取消请求均可观测", async (t) => {
  const { store } = await fixture(t);
  const http = require("node:http");
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const text = request.messages.at(-1).content;
    if (text === "cancel") return;
    if (text === "fail") {
      res.writeHead(503);
      res.end("temporarily unavailable");
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: text === "empty" ? "" : "已完成真实 HTTP 测试",
            },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await store.set("sm_path_config_v1", {
    deepseekKey: "test-key",
    deepseekHost: `http://127.0.0.1:${server.address().port}/v1`,
  });
  const ai = new AIProvider(store);
  assert.equal(
    (await ai.generate({ id: "ok", task: "ok" })).text,
    "已完成真实 HTTP 测试",
  );
  await assert.rejects(
    () => ai.generate({ id: "fail", task: "fail" }),
    /HTTP 503/,
  );
  await assert.rejects(
    () => ai.generate({ id: "empty", task: "empty" }),
    /空内容/,
  );
  const pending = ai.generate({ id: "cancel", task: "cancel" });
  ai.cancel("cancel");
  await assert.rejects(() => pending, /取消/);
});

test("配置路径别名不会导致扫描路径与学生档案路径不一致", async (t) => {
  const { root, files, temp, store } = await fixture(t);
  const alias = path.join(temp, "alias");
  await fs.symlink(root, alias);
  await store.set("sm_path_config_v1", { studentsRoot: alias });
  await files.mkdir(path.join(alias, "测试"));
  const entries = await files.list(alias);
  assert.equal(entries[0].path, path.join(alias, "测试"));
  assert.equal(
    await files.guard(entries[0].path),
    await fs.realpath(path.join(root, "测试")),
  );
});
