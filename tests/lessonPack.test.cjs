const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  JSZip = require("jszip");
const { DiskStorage, FileService } = require("../desktop/core.cjs"),
  { LessonPackService, buildName } = require("../desktop/lessonPack.cjs");
test("复刻标准命名：高中无年字，初中初一转七年级，已带版本前缀不重复", () => {
  assert.equal(
    buildName({
      stage: "高中",
      version: "人教A版",
      grade: "高一",
      year: 2026,
      name: "对数（教案）",
    }),
    "人教A版2026高一数学 对数",
  );
  assert.equal(
    buildName({
      stage: "初中",
      version: "浙教版",
      grade: "初一",
      year: 2026,
      name: "浙教版2026年七年级数学 整式（教案）",
    }),
    "浙教版2026年七年级数学 整式",
  );
  assert.throws(
    () =>
      buildName({
        stage: "高中",
        version: "浙教新版",
        grade: "初一",
        year: 2026,
        name: "错误",
      }),
    /年级/,
  );
});
test("ZIP只含按标准命名的教案学案且保留原字节，当前目录输出、备份覆盖、缺学案明确回退与越界拒绝", async (t) => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-pack-")),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "library"),
    folder = path.join(root, "高中/高二/对数");
  await fs.mkdir(path.join(folder, "历史教案"), { recursive: true });
  await fs.mkdir(path.join(folder, ".知序备份"));
  await fs.writeFile(
    path.join(folder, "对数（教案）.docx"),
    "原教案字节\0公式",
  );
  await fs.writeFile(path.join(folder, "对数（学案）.doc"), "原学案字节");
  await fs.writeFile(
    path.join(folder, "历史教案/很旧（教案）.docx"),
    "不要取历史",
  );
  await fs.writeFile(
    path.join(folder, ".知序备份/备份（学案）.docx"),
    "不要取备份",
  );
  const store = await new DiskStorage(
    path.join(dir, "preferences.json"),
  ).init();
  await store.set("sm_path_config_v1", { lessonsRoot: root });
  const service = new LessonPackService(new FileService(store)),
    input = { path: folder, name: "对数", year: 2026 };
  const preview = await service.options(input);
  assert.equal(preview.version, "人教A版");
  assert.equal(preview.grade, "高二");
  assert.equal(preview.learningFallback, false);
  const result = await service.create({ ...input, existingHash: "" });
  assert.equal(path.dirname(result.path), folder);
  const first = await fs.readFile(result.path),
    zip = await JSZip.loadAsync(first),
    files = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  assert.deepEqual(
    files.sort(),
    [
      "人教A版2026高二数学 对数/人教A版2026高二数学 对数（学案）.doc",
      "人教A版2026高二数学 对数/人教A版2026高二数学 对数（教案）.docx",
    ].sort(),
  );
  assert.equal(
    await zip.file(files.find((f) => f.includes("（教案）"))).async("string"),
    "原教案字节\0公式",
  );
  await assert.rejects(service.create(input), /已存在/);
  await assert.rejects(
    service.create({ ...input, overwrite: true, existingHash: "stale" }),
    /已发生变化/,
  );
  const current = await service.options(input);
  await service.create({
    ...input,
    overwrite: true,
    existingHash: current.existingHash,
  });
  const backup = (await fs.readdir(folder)).find((n) => n.endsWith(".bak"));
  assert.deepEqual(await fs.readFile(path.join(folder, backup)), first);
  await fs.rm(path.join(folder, "对数（学案）.doc"));
  assert.equal((await service.options(input)).learningFallback, true);
  const external = path.join(dir, "outside");
  await fs.mkdir(external);
  await assert.rejects(service.options({ path: external }), /配置|目录/);
});
