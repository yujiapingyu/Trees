const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DiskStorage, FileService } = require("../desktop/core.cjs");
const { LessonCreationService } = require("../desktop/lessonCreation.cjs");
async function fixture(t) {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-create-")),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "讲义库"),
    templates = path.join(dir, "模板");
  await fs.mkdir(root);
  await fs.mkdir(templates);
  await fs.writeFile(
    path.join(templates, "2.普通模板.docx"),
    Buffer.from("原始模板完整字节\0公式与图片"),
  );
  await fs.writeFile(
    path.join(templates, "1.标准模板.DOC"),
    Buffer.from("DOC模板原字节"),
  );
  const store = await new DiskStorage(path.join(dir, "profile.json")).init();
  await store.set("sm_path_config_v1", {
    lessonsRoot: root,
    templatesRoot: templates,
  });
  const files = new FileService(store);
  return {
    dir,
    root,
    templates,
    store,
    files,
    service: new LessonCreationService(files),
  };
}
const input = (p, more = {}) => ({
  stage: p.stage,
  grade: p.grades[0] || "",
  name: "对数定义",
  template: p.templates[0].path,
  configurationKey: p.configurationKey,
  ...more,
});
test("新建选项沿用学段，提供标准和合法扩展年级，默认模板按名称排序；取消前不创建目录", async (t) => {
  const { service, root, templates } = await fixture(t);
  await fs.mkdir(path.join(root, "高中", "总复习"), { recursive: true });
  await fs.mkdir(path.join(root, "高中", "高一（同步）"));
  await fs.mkdir(path.join(root, "高中", "随意子目录"));
  const p = await service.options("高中");
  assert.deepEqual(p.grades, [
    "高一",
    "高二",
    "高三",
    "高一（同步）",
    "总复习",
  ]);
  assert.equal(p.templates[0].name, "1.标准模板.DOC");
  assert.equal(p.stageRoot, path.join(root, "高中"));
  assert.deepEqual((await service.options("初中")).grades, [
    "初一",
    "初二",
    "初三",
  ]);
  assert.deepEqual((await service.options("中职")).grades, []);
  await assert.rejects(fs.access(path.join(root, "初中")));
  await assert.rejects(fs.access(path.join(root, "中职")));
  await fs.rm(path.join(templates, "1.标准模板.DOC"));
  await fs.rm(path.join(templates, "2.普通模板.docx"));
  await assert.rejects(service.options("初中"), /模板目录为空/);
  await assert.rejects(fs.access(path.join(root, "初中")));
});
test("按标题创建教案文件并保留扩展名、完整模板和原件；中职不分年级", async (t) => {
  const { service, root, templates } = await fixture(t);
  for (const stage of ["初中", "高中", "中职"]) {
    const p = await service.options(stage),
      result = await service.create(input(p, { name: "  新讲义  " })),
      expected =
        stage === "中职"
          ? path.join(root, stage, "新讲义")
          : path.join(root, stage, p.grades[0], "新讲义");
    assert.equal(result.lesson.path, expected);
    assert.equal(result.filePath, path.join(expected, "新讲义（教案）.DOC"));
    assert.equal(result.lesson.grade, stage === "中职" ? "" : p.grades[0]);
    assert.deepEqual(
      await fs.readFile(result.filePath),
      await fs.readFile(p.templates[0].path),
    );
    assert.ok(result.lesson.id);
    assert.ok(result.lesson.createdAt);
  }
  const p = await service.options("高中"),
    result = await service.create(
      input(p, {
        grade: "高三",
        name: "DOCX讲义",
        template: path.join(templates, "2.普通模板.docx"),
      }),
    );
  assert.equal(path.basename(result.filePath), "DOCX讲义（教案）.docx");
  assert.deepEqual(
    await fs.readFile(result.filePath),
    await fs.readFile(path.join(templates, "2.普通模板.docx")),
  );
});
test("同名并发只创建一次，路径注入、错误年级/模板、过期配置与目录链接不会越界写入", async (t) => {
  const { service, root, templates, dir, store } = await fixture(t),
    p = await service.options("高中");
  for (const name of ["", "../外部", "A/B", "A\\B", ".隐藏", "坏\0名字"])
    await assert.rejects(service.create(input(p, { name })));
  await assert.rejects(
    service.create(input(p, { grade: "../../外部" })),
    /年级目录/,
  );
  await assert.rejects(
    service.create(input(p, { template: path.join(dir, "else.docx") })),
    /模板目录/,
  );
  assert.deepEqual(await fs.readdir(root), []);
  const outcomes = await Promise.allSettled([
    service.create(input(p)),
    service.create(input(p)),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    outcomes.find((r) => r.status === "rejected").reason.message,
    /同名/,
  );
  const created = outcomes.find((r) => r.status === "fulfilled").value;
  assert.deepEqual(
    await fs.readFile(created.filePath),
    await fs.readFile(p.templates[0].path),
  );
  const elsewhere = path.join(dir, "其他资源");
  await fs.mkdir(elsewhere);
  await store.set("sm_path_config_v1", {
    lessonsRoot: root,
    templatesRoot: templates,
    studentsRoot: elsewhere,
  });
  await fs.symlink(elsewhere, path.join(root, "高中", "高二"));
  const now = await service.options("高中");
  await assert.rejects(
    service.create(input(now, { grade: "高二", name: "越界" })),
    /超出/,
  );
  assert.deepEqual(await fs.readdir(elsewhere), []);
  const another = path.join(dir, "另一讲义库");
  await fs.mkdir(another);
  await store.set("sm_path_config_v1", {
    lessonsRoot: another,
    templatesRoot: templates,
  });
  await assert.rejects(service.create(input(p)), /配置已变化/);
  assert.deepEqual(await fs.readdir(another), []);
});
test("复制失败回收自己的新目录；并发加入的文件保持不变", async (t) => {
  const { service, root, files } = await fixture(t),
    p = await service.options("初中"),
    originalOpen = fs.open;
  try {
    fs.open = async function (file, ...args) {
      const handle = await originalOpen.call(fs, file, ...args);
      if (file.endsWith("失败（教案）.DOC"))
        return {
          writeFile: async () => {
            throw Error("模拟磁盘写入失败");
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      return handle;
    };
    await assert.rejects(
      service.create(input(p, { name: "失败" })),
      /磁盘写入失败/,
    );
  } finally {
    fs.open = originalOpen;
  }
  await assert.rejects(fs.access(path.join(root, "初中", "初一", "失败")));
  const guard = files.guard.bind(files),
    directory = path.join(root, "初中", "初一", "竞争");
  files.guard = async (file, options) => {
    const result = await guard(file, options);
    if (file === directory && options?.write) {
      try {
        if ((await fs.stat(directory)).isDirectory())
          await fs.writeFile(
            path.join(directory, "竞争（教案）.DOC"),
            "外部文件",
            { flag: "wx" },
          );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    return result;
  };
  await assert.rejects(service.create(input(p, { name: "竞争" })), /同名/);
  assert.equal(
    await fs.readFile(path.join(directory, "竞争（教案）.DOC"), "utf8"),
    "外部文件",
  );
});
