const path = require("node:path"),
  fs = require("node:fs/promises"),
  crypto = require("node:crypto"),
  JSZip = require("jszip");
const VERSIONS = {
  高中: ["人教A版", "人教B版", "苏教版", "浙教版", "北师大版"],
  初中: ["人教版", "浙教版", "苏科版", "北师大版"],
  小学: ["人教版", "苏教版", "北师大版"],
};
const GRADES = {
  高中: ["高一", "高二", "高三"],
  初中: ["初一", "初二", "初三", "七年级", "八年级", "九年级"],
  小学: ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"],
};
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
function normalizedGrade(g, stage) {
  return stage === "初中"
    ? { 初一: "七年级", 初二: "八年级", 初三: "九年级" }[g] || g
    : g;
}
function buildName({ stage, version, grade, year, name }) {
  if (!VERSIONS[stage]?.includes(version) || !GRADES[stage]?.includes(grade))
    throw Error("请选择该学段的教材版本与年级");
  if (
    !Number.isInteger(+year) ||
    +year < 2020 ||
    +year > new Date().getFullYear() + 5
  )
    throw Error("年份超出可选范围");
  if (
    typeof name !== "string" ||
    !name.trim() ||
    /[\\/:*?"<>|\x00-\x1f]/.test(name) ||
    name.startsWith(".")
  )
    throw Error("讲义名称无效");
  const g = normalizedGrade(grade, stage),
    esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let title = name
    .trim()
    .replace(/[（(](?:教案|学案)[）)]$/, "")
    .trim();
  const prefix = new RegExp(
    `^${esc(version)}\\s*${year}年?\\s*(?:${[...new Set([grade, g])].map(esc).join("|")})\\s*(?:数学\\s*)?`,
  );
  while (prefix.test(title)) title = title.replace(prefix, "").trim();
  if (!title) throw Error("讲义主题不能为空");
  return `${version}${year}${stage === "高中" ? "" : "年"}${g}数学 ${title}`;
}
class LessonPackService {
  constructor(files) {
    this.files = files;
    this.running = new Set();
  }
  async options(input) {
    const root = this.files.config().lessonsRoot;
    if (!root) throw Error("请先配置讲义根目录");
    const source = await this.files.guard(input.path),
      canonicalRoot = await this.files.guard(root);
    if (
      !source.startsWith(canonicalRoot + path.sep) ||
      !(await fs.stat(source)).isDirectory()
    )
      throw Error("请选择当前讲义库内的讲义目录");
    const stage = path.relative(canonicalRoot, source).split(path.sep)[0];
    if (!VERSIONS[stage]) throw Error("该讲义学段暂不支持标准打包");
    const defaults = {
      stage,
      version:
        stage === "高中" ? "人教A版" : stage === "初中" ? "浙教版" : "人教版",
      grade: GRADES[stage][0],
      year: new Date().getFullYear(),
      name: input.name || path.basename(source),
    };
    const folderGrade =
      path.relative(canonicalRoot, source).split(path.sep)[1] || "";
    defaults.grade =
      GRADES[stage].find((g) => folderGrade.includes(g)) || defaults.grade;
    const values = { ...defaults, ...input, stage },
      baseName = buildName(values);
    const entries = (await this.files.list(input.path, true)).filter(
      (f) =>
        !f.isDirectory &&
        f.relativePath.split("/").length <= 9 &&
        !/(?:^|\/)(?:[^/]*(?:历史|备份|原始题目|基础题库)[^/]*)(?:\/|$)/.test(
          f.relativePath,
        ) &&
        !/\.(zip|rar|bak)$/i.test(f.name),
    );
    const preferred = (f) => /\.(docx?|pdf|pptx?)$/i.test(f.name),
      pick = (type) =>
        entries.find((f) => f.name.includes(type) && preferred(f)) ||
        entries.find((f) => f.name.includes(type)) ||
        entries.find(preferred);
    const teaching = pick("教案"),
      actualLearning =
        entries.find((f) => f.name.includes("学案") && preferred(f)) ||
        entries.find((f) => f.name.includes("学案")),
      learning = actualLearning || teaching;
    if (!teaching) throw Error("未找到可打包的教案文件");
    const target = path.join(source, baseName + ".zip");
    if (Buffer.byteLength(path.basename(target), "utf8") > 225)
      throw Error("标准文件名过长，请先缩短讲义名称");
    if (
      (await this.files.guard(target, { write: true, allowRoot: false })) !==
      target
    )
      throw Error("ZIP目标不能是文件链接");
    let existingHash = "";
    try {
      existingHash = hash(await fs.readFile(target));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    return {
      ...values,
      baseName,
      target,
      teaching,
      learning,
      learningFallback: !actualLearning,
      existingHash,
      rootSetting: root,
      versions: VERSIONS[stage],
      grades: GRADES[stage],
    };
  }
  async create(input) {
    const p = await this.options(input);
    if (this.running.has(p.target)) throw Error("该讲义正在打包，请稍候");
    this.running.add(p.target);
    try {
      if (p.existingHash && !input.overwrite)
        throw Error("同名ZIP已存在，请确认备份后覆盖");
      if (
        input.existingHash !== undefined &&
        input.existingHash !== p.existingHash
      )
        throw Error("目标ZIP已发生变化，请重新预览");
      const zip = new JSZip(),
        folder = zip.folder(p.baseName),
        sources = [
          ["教案", p.teaching],
          ["学案", p.learning],
        ];
      for (const [type, file] of sources) {
        const real = await this.files.guard(file.path),
          stat = await fs.stat(real);
        if (stat.size > 256 * 1024 * 1024)
          throw Error("单份教案或学案超过256MB，请先缩小文件");
        folder.file(
          p.baseName + "（" + type + "）" + path.extname(file.name),
          await fs.readFile(real),
        );
      }
      const buffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      if (this.files.config().lessonsRoot !== p.rootSetting)
        throw Error("讲义目录配置已变化，请重新打包");
      if (p.existingHash) {
        if (hash(await fs.readFile(p.target)) !== p.existingHash)
          throw Error("打包期间ZIP已被修改，未覆盖");
        await this.files.write(p.target, buffer, {
          overwrite: true,
          backup: true,
        });
      } else {
        const handle = await fs.open(p.target, "wx", 0o600);
        try {
          await handle.writeFile(buffer);
          await handle.sync();
        } catch (e) {
          await fs.rm(p.target, { force: true });
          throw e;
        } finally {
          await handle.close();
        }
      }
      return {
        path: p.target,
        baseName: p.baseName,
        teaching: p.teaching.name,
        learning: p.learning.name,
        learningFallback: p.learningFallback,
      };
    } finally {
      this.running.delete(p.target);
    }
  }
}
module.exports = { LessonPackService, buildName, normalizedGrade };
