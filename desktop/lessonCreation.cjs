const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { within } = require("./core.cjs");
const STAGES = ["初中", "高中", "中职"];
const STANDARD = {
  初中: ["初一", "初二", "初三"],
  高中: ["高一", "高二", "高三"],
  中职: [],
};
const GRADE_NAMES = {
  初中: [
    "初一",
    "初二",
    "初三",
    "新七年级",
    "新八年级",
    "新九年级",
    "七年级",
    "八年级",
    "九年级",
    "总复习",
  ],
  高中: ["高一", "高二", "高三", "新高一", "新高二", "新高三", "总复习"],
};
function isGrade(stage, name) {
  return (GRADE_NAMES[stage] || []).some(
    (g) => name === g || name.startsWith(g + "（") || name.startsWith(g + "("),
  );
}
function validateTitle(value) {
  if (typeof value !== "string") throw Error("请输入讲义名称");
  const name = value.trim();
  if (
    !name ||
    name.startsWith(".") ||
    /[\\/:*?"<>|\x00-\x1f\x7f]/.test(name) ||
    name.endsWith(".")
  )
    throw Error("请输入有效讲义名称，不可包含路径分隔符、系统字符或以点开头");
  if (Buffer.byteLength(name, "utf8") > 200)
    throw Error("讲义名称过长，请缩短后重试");
  return name;
}
class LessonCreationService {
  constructor(files) {
    this.files = files;
  }
  async options(stage) {
    if (!STAGES.includes(stage)) throw Error("请选择初中、高中或中职学段");
    const config = this.files.config();
    if (!config.lessonsRoot || !config.templatesRoot)
      throw Error("请先在配置中心设置讲义库目录和讲义模板目录");
    const root = await this.files.guard(config.lessonsRoot),
      templateRoot = await this.files.guard(config.templatesRoot);
    const displayRoot = path.resolve(config.lessonsRoot),
      stageRoot = path.join(displayRoot, stage);
    const templates = (await this.files.list(config.templatesRoot))
      .filter((f) => !f.isDirectory)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    if (!templates.length) throw Error("讲义模板目录为空，请先放入模板文件");
    const safeStage = await this.files.guard(stageRoot);
    if (!within(root, safeStage))
      throw Error("学段目录超出当前讲义库，请检查目录链接");
    let entries = [];
    try {
      entries = await this.files.list(stageRoot);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const extra = entries
      .filter(
        (f) =>
          f.isDirectory &&
          isGrade(stage, f.name) &&
          !STANDARD[stage].includes(f.name),
      )
      .map((f) => f.name);
    const grades = [...STANDARD[stage], ...extra];
    const configurationKey = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          lessonsRoot: config.lessonsRoot,
          templatesRoot: config.templatesRoot,
          root,
          templateRoot,
        }),
      )
      .digest("hex");
    return {
      stage,
      stageRoot,
      grades,
      templates: templates.map(({ name, path }) => ({ name, path })),
      configurationKey,
    };
  }
  async create({ stage, grade = "", name, template, configurationKey } = {}) {
    const title = validateTitle(name),
      options = await this.options(stage);
    if (configurationKey !== options.configurationKey)
      throw Error("讲义目录配置已变化，请重新打开新建窗口");
    if (stage !== "中职" && !options.grades.includes(grade))
      throw Error("请选择当前学段的年级目录");
    if (stage === "中职" && grade)
      throw Error("中职讲义直接保存在中职目录下，无需年级");
    if (!options.templates.some((f) => f.path === template))
      throw Error("所选模板不在当前配置的模板目录中，请重新选择");
    const root = await this.files.guard(this.files.config().lessonsRoot),
      gradeDir = path.join(options.stageRoot, grade),
      displayDir = path.join(gradeDir, title);
    const destination = await this.files.guard(displayDir, {
      write: true,
      allowRoot: false,
    });
    if (!within(root, destination))
      throw Error("创建位置超出当前讲义库，请检查年级目录链接");
    const bytes = await this.files.read(template),
      ext = path.extname(template),
      fileName = title + "（教案）" + ext;
    let created = false,
      handle = null,
      ownsFile = false,
      output = "";
    try {
      // Reserve the directory exclusively: a second request never overwrites it.
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.mkdir(destination);
      created = true;
      const safe = await this.files.guard(displayDir, {
        write: true,
        allowRoot: false,
      });
      if (safe !== destination || !within(root, safe))
        throw Error("创建位置发生变化，请检查目录后重试");
      output = path.join(destination, fileName);
      handle = await fs.open(output, "wx", 0o600);
      ownsFile = true;
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      const stat = await fs.stat(destination);
      return {
        lesson: {
          id: crypto.randomUUID(),
          name: title,
          path: displayDir,
          relativePath: path.relative(
            path.resolve(this.files.config().lessonsRoot),
            displayDir,
          ),
          isDirectory: true,
          stage,
          grade,
          collection: "",
          tags: [],
          missing: false,
          createdAt: stat.birthtime.toISOString(),
          modifiedAt: stat.mtime.toISOString(),
        },
        filePath: path.join(displayDir, fileName),
      };
    } catch (e) {
      await handle?.close().catch(() => {});
      if (ownsFile) await fs.unlink(output).catch(() => {});
      // Only remove our empty new directory; never recursively delete content.
      if (created) await fs.rmdir(destination).catch(() => {});
      if (e.code === "EEXIST") throw Error("同名讲义或文件已存在，请更换标题");
      throw e;
    }
  }
}
module.exports = { LessonCreationService, isGrade, validateTitle };
