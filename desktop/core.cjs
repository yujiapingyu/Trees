const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
const CONFIG_KEYS = require("../src/shared/configKeys.json");
const PATH_KEYS = CONFIG_KEYS.roots;
function sanitizeConfig(value = {}) {
  return Object.fromEntries(
    [...CONFIG_KEYS.roots, ...CONFIG_KEYS.extras]
      .filter((key) => typeof value[key] === "string")
      .map((key) => [key, value[key]]),
  );
}
class DiskStorage {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.queue = Promise.resolve();
  }
  async init() {
    try {
      this.data = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT")
        throw Error(`本地存储读取失败，请保留原文件后修复：${e.message}`);
    }
    return this;
  }
  get(key, fallback = null) {
    return Object.hasOwn(this.data, key)
      ? structuredClone(this.data[key])
      : fallback;
  }
  async set(key, value) {
    const action = async () => {
      const next = { ...this.data, [key]: value };
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await fs.rename(tmp, this.file);
      this.data = next;
    };
    const p = this.queue.then(action);
    this.queue = p.catch(() => {});
    return p;
  }
}
function within(root, target) {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
async function canonical(file) {
  let current = path.resolve(file);
  const suffix = [];
  while (true) {
    try {
      return path.join(await fs.realpath(current), ...suffix.reverse());
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const parent = path.dirname(current);
      if (parent === current) throw e;
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}
class FileService {
  constructor(storage, { openPath, trashItem, pick } = {}) {
    this.storage = storage;
    this.openPath = openPath;
    this.trashItem = trashItem;
    this.pick = pick;
    this.grants = new Set();
  }
  config() {
    return this.storage.get("sm_path_config_v1", {});
  }
  async roots() {
    return Promise.all(
      PATH_KEYS.map((k) => this.config()[k])
        .filter(Boolean)
        .map(canonical),
    );
  }
  async guard(file, { write = false, allowRoot = true } = {}) {
    if (typeof file !== "string" || !path.isAbsolute(file))
      throw Error("请先配置有效的绝对路径");
    const target = await canonical(file);
    const roots = await this.roots();
    const root = roots.find((r) => within(r, target));
    if (
      !root &&
      !(this.grants.has(target) && !write) &&
      !(
        !write &&
        this.config().feedbackTemplate &&
        target === (await canonical(this.config().feedbackTemplate))
      )
    )
      throw Error(
        `该路径不在当前配置的资源目录内：${file}。若刚更换根目录，请重新选择当前目录中的学生或资源；旧记录仍保留。`,
      );
    if (!allowRoot && roots.some((r) => r === target))
      throw Error("禁止修改或删除资源根目录");
    return target;
  }
  async list(file, recursive = false) {
    const root = await this.guard(file);
    const displayRoot = path.resolve(file);
    const out = [];
    const visit = async (dir, depth) => {
      if (depth > 20 || out.length >= 10000) return;
      for (const ent of (await fs.readdir(dir, { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
      )) {
        if (ent.name.startsWith(".") || ent.isSymbolicLink()) continue;
        const p = path.join(dir, ent.name);
        const stat = await fs.stat(p);
        out.push({
          name: ent.name,
          path: path.join(displayRoot, path.relative(root, p)),
          relativePath: path.relative(root, p),
          isDirectory: ent.isDirectory(),
          size: stat.size,
          createdAt: stat.birthtime.toISOString(),
          modifiedAt: stat.mtime.toISOString(),
        });
        if (recursive && ent.isDirectory()) await visit(p, depth + 1);
      }
    };
    await visit(root, 0);
    return out;
  }
  async check(file) {
    try {
      await fs.access(file, require("node:fs").constants.R_OK);
      return { exists: true, readable: true };
    } catch (e) {
      return { exists: e.code !== "ENOENT", readable: false, error: e.message };
    }
  }
  async open(file) {
    const p = await this.guard(file);
    await fs.access(p);
    const err = await this.openPath(p);
    if (err) throw Error(err);
    return true;
  }
  async mkdir(file) {
    const p = await this.guard(file, { write: true, allowRoot: false });
    await fs.mkdir(p, { recursive: false });
    return p;
  }
  async rename(from, to) {
    const a = await this.guard(from, { write: true, allowRoot: false });
    const b = await this.guard(to, { write: true, allowRoot: false });
    try {
      await fs.access(b);
      throw Error("目标路径已存在，禁止覆盖");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await fs.rename(a, b);
    return b;
  }
  async trash(file, confirmation) {
    const p = await this.guard(file, { write: true, allowRoot: false });
    if (confirmation !== path.basename(p)) throw Error("确认名称不匹配");
    if ((await this.roots()).some((r) => within(p, r)))
      throw Error("目录包含其他配置根目录，禁止删除");
    if (!this.trashItem) throw Error("当前环境不支持系统废纸篓");
    await this.trashItem(p);
    return true;
  }
  async read(file) {
    return fs.readFile(await this.guard(file));
  }
  async write(file, content, { overwrite = false, backup = false } = {}) {
    const p = await this.guard(file, { write: true, allowRoot: false });
    const stat = await fs.stat(p).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (stat && !overwrite) throw Error("文件已存在，请确认覆盖");
    if (stat && backup) await fs.copyFile(p, p + "." + Date.now() + ".bak");
    await fs.mkdir(path.dirname(p), { recursive: true });
    const temp = p + "." + crypto.randomUUID() + ".tmp";
    await fs.writeFile(temp, content);
    await fs.rename(temp, p);
    return p;
  }
  async copy(from, to) {
    const source = await this.guard(from);
    const dest = await this.guard(to, { write: true, allowRoot: false });
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(source, dest, require("node:fs").constants.COPYFILE_EXCL);
    return dest;
  }
}
function run(exe, args, { timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      shell: false,
      env: {
        ...process.env,
        PATH: process.env.PATH + ":/opt/homebrew/bin:/usr/local/bin",
      },
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("处理超时，请检查工具配置"));
    }, timeout);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(Error(`无法运行 ${exe}：${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(stdout)
        : reject(Error(stderr.slice(-2500) || `工具退出码 ${code}`));
    });
  });
}
class AIProvider {
  constructor(storage) {
    this.storage = storage;
    this.tasks = new Map();
  }
  cancel(id) {
    this.tasks.get(id)?.abort();
  }
  async generate({ id, task, messages, json = false }) {
    const c = this.storage.get("sm_path_config_v1", {}),
      key = c.deepseekKey;
    if (!key) throw Error("请先在配置中心设置 DeepSeek API Key");
    const host = c.deepseekHost || "https://api.deepseek.com";
    const url = new URL(host.replace(/\/$/, "") + "/chat/completions");
    if (!["https:", "http:"].includes(url.protocol))
      throw Error("模型服务地址必须为 HTTP(S)");
    const model = c.deepseekModel || "deepseek-chat";
    const ctrl = new AbortController();
    this.tasks.set(id, ctrl);
    const timer = setTimeout(() => ctrl.abort(), 180000);
    try {
      const msgs = [
        {
          role: "system",
          content:
            "你是教师的教学助手。只依据当前任务提供的事实作答，不得编造学生表现、文件内容或题目答案。未知标注待确认。不确定识别应标记 uncertain。输出中文。" +
            (json ? "仅输出有效 JSON。" : ""),
        },
        ...(messages || [{ role: "user", content: task }]),
      ];
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages: msgs, temperature: 0.3 }),
        signal: ctrl.signal,
      });
      if (!res.ok)
        throw Error(
          `模型请求失败 HTTP ${res.status}：${(await res.text()).slice(0, 500)}`,
        );
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim())
        throw Error("模型返回空内容或格式异常");
      return { text, model };
    } catch (e) {
      if (e.name === "AbortError") throw Error("请求已取消或超时，可重试");
      throw e;
    } finally {
      clearTimeout(timer);
      this.tasks.delete(id);
    }
  }
}
class DocumentService {
  constructor(files) {
    this.files = files;
  }
  async text(file) {
    const p = await this.files.guard(file);
    if (/\.docx$/i.test(p)) {
      const mammoth = require("mammoth");
      return (await mammoth.extractRawText({ path: p })).value;
    }
    if (/\.(txt|md|json|csv)$/i.test(p)) return fs.readFile(p, "utf8");
    if (/\.doc$/i.test(p)) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-doc-"));
      try {
        await run(
          this.files.config().libreofficePath ||
            (process.platform === "darwin"
              ? "/Applications/LibreOffice.app/Contents/MacOS/soffice"
              : "libreoffice"),
          [
            "-env:UserInstallation=file://" + path.join(dir, "profile"),
            "--headless",
            "--convert-to",
            "txt:Text",
            "--outdir",
            dir,
            p,
          ],
        );
        return await fs.readFile(
          path.join(dir, path.basename(p, ".doc") + ".txt"),
          "utf8",
        );
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
    throw Error("正文读取支持 DOC、DOCX、TXT、Markdown；PDF 请使用按页识别");
  }
  async sheet(file) {
    const ExcelJS = require("exceljs");
    const book = new ExcelJS.Workbook();
    const buffer = await this.files.read(file);
    if (/\.csv$/i.test(file)) {
      await book.csv.read(require("node:stream").Readable.from([buffer]));
    } else if (/\.xlsx$/i.test(file)) {
      await book.xlsx.load(buffer);
    } else
      throw Error("表格预览支持 XLSX / CSV；XLS 请用系统应用打开并另存为 XLSX");
    return book.worksheets.map((s) => ({
      name: s.name,
      rows: s
        .getSheetValues()
        .slice(1)
        .map((r) =>
          Array.from(r || [])
            .slice(1)
            .map((v) =>
              v && typeof v === "object"
                ? v.text ||
                  v.result ||
                  v.richText?.map((x) => x.text).join("") ||
                  ""
                : (v ?? ""),
            ),
        ),
    }));
  }
  async word(file, text, overwrite = false) {
    const {
      Document,
      Packer,
      Paragraph,
      TextRun,
      HeadingLevel,
    } = require("docx");
    const children = text.split("\n").map(
      (line) =>
        new Paragraph({
          heading: /^#{1,3} /.test(line) ? HeadingLevel.HEADING_2 : undefined,
          children: [new TextRun(line.replace(/^#{1,6}\s/, ""))],
          spacing: { after: 120 },
        }),
    );
    const buffer = await Packer.toBuffer(
      new Document({ sections: [{ children }] }),
    );
    return this.files.write(file, buffer, { overwrite, backup: overwrite });
  }
  async pdf(file) {
    const p = await this.files.guard(file);
    if (/\.pdf$/i.test(p))
      return { base64: (await fs.readFile(p)).toString("base64") };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-pdf-"));
    try {
      await run(
        this.files.config().libreofficePath ||
          (process.platform === "darwin"
            ? "/Applications/LibreOffice.app/Contents/MacOS/soffice"
            : "libreoffice"),
        [
          "-env:UserInstallation=file://" + path.join(dir, "profile"),
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          dir,
          p,
        ],
      );
      const output = path.join(dir, path.basename(p, path.extname(p)) + ".pdf");
      return { base64: (await fs.readFile(output)).toString("base64") };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  async study(from, to, factor, exponent, overwrite = false) {
    if (!(factor >= 0.1 && factor <= 1.5 && exponent >= 0.5 && exponent <= 1))
      throw Error("学案空白参数超出范围");
    if (!/\.docx$/i.test(from))
      throw Error("保留版式转换仅支持 DOCX，请先将 DOC 另存为 DOCX");
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(await this.files.read(from));
    const part = zip.file("word/document.xml");
    if (!part) throw Error("DOCX 缺少正文");
    let xml = await part.async("string");
    let count = 0;
    xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => {
      const text = p.replace(/<[^>]*>/g, "");
      if (/^(?:【?(?:答案|解析|解答)】?[：:])/.test(text.trim())) return "";
      if (/^\s*(?:\d+[.、．]|[（(]\d+[)）])/.test(text)) {
        count++;
        const blanks = Math.min(
          12,
          Math.max(
            1,
            Math.round(factor * Math.pow(text.length / 30, exponent) * 3),
          ),
        );
        return (
          p +
          '<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>'.repeat(
            blanks,
          )
        );
      }
      return p;
    });
    if (!count) throw Error("未识别到编号题目，未写入文件。请检查教案题目编号");
    zip.file("word/document.xml", xml);
    await this.files.write(
      to,
      await zip.generateAsync({ type: "nodebuffer" }),
      { overwrite, backup: overwrite },
    );
    return {
      path: to,
      questions: count,
      layout: "保留原 DOCX 结构，已插入作答空白；请人工复核分页与答案残留",
    };
  }
}
module.exports = {
  DiskStorage,
  FileService,
  DocumentService,
  AIProvider,
  within,
  canonical,
  run,
  PATH_KEYS,
  sanitizeConfig,
};
