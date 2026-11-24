const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const JSZip = require("jszip");
const { DiskStorage, FileService } = require("../desktop/core.cjs");
const {
  LessonDocumentService,
  openBuffer,
  planFor,
  organize,
  sibling,
} = require("../desktop/lessonDocuments.cjs");
const { transformStudy, ANSWER } = require("../desktop/lessonStudy.cjs");
const X = require("../desktop/lessonXml.cjs");
const { lessonFixture, content } = require("./helpers/lessonFixture.cjs");
async function fixture(t, opts = {}) {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-lesson-")),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = await new DiskStorage(path.join(dir, "profile.json")).init();
  await store.set("sm_path_config_v1", { lessonsRoot: dir });
  const files = new FileService(store),
    source = path.join(dir, "对数（教案）.docx");
  await fs.writeFile(source, await lessonFixture(opts));
  const calls = [];
  const ai = {
    generate: async (r) => {
      calls.push(r);
      return { text: JSON.stringify(content), model: "test-model" };
    },
  };
  return {
    dir,
    source,
    files,
    calls,
    service: new LessonDocumentService(files, ai),
  };
}
const options = (p) => ({
  token: p.token,
  organizeQuestions: true,
  questionPlan: p.categories,
  updateIntro: false,
  updateSummary: false,
});
test("参照原项目识别例题、变式和考点分类，默认数量与完整性检查一致", async () => {
  for (const alternate of [false, true]) {
    const doc = await openBuffer(await lessonFixture({ alternate }));
    const plan = planFor(doc.doc);
    assert.deepEqual(
      plan.categories.map((c) => c.available),
      [4, 3],
    );
    assert.deepEqual(
      plan.categories.map((c) => [c.keep, c.practice]),
      [
        [2, 2],
        [1, 2],
      ],
    );
    assert.equal(plan.canOrganize, true);
  }
});
test("教案按原题分配、重新编号；更新对应单元格，保留原导入、总结、图片、公式和页眉页脚；反复完善可恢复未选题", async (t) => {
  const { source, service, calls } = await fixture(t),
    before = await openBuffer(await fs.readFile(source)),
    preview = await service.prepare(source);
  assert.equal(preview.complete, true);
  assert.equal(preview.updateIntro, false);
  preview.categories[0].keep = 1;
  preview.categories[0].practice = 1;
  preview.categories[1].selected = false;
  const request = options(preview),
    draft = await service.generate(request);
  assert.equal(draft.movedCount, 1);
  assert.match(calls[0].task, /TYPE1_Q1/);
  assert.ok(!calls[0].task.includes("TYPE2_Q1"));
  const result = await service.save({
      token: preview.token,
      content: draft.content,
    }),
    after = await openBuffer(await fs.readFile(source)),
    text = X.text(after.doc);
  assert.match(text, /原有趣味导入第一段/);
  assert.match(text, /原有总结第一条/);
  assert.match(text, /TYPE1_Q1/);
  assert.match(text, /TYPE1_Q4/);
  assert.ok(!text.includes("TYPE1_Q2"));
  assert.ok(!text.includes("TYPE2_Q1"));
  assert.ok(X.descendants(after.doc, "f", X.M).length > 0);
  assert.ok(X.descendants(after.doc, "sSup", X.M).length > 0);
  assert.deepEqual(
    await after.zip.file("word/media/pixel.png").async("nodebuffer"),
    await before.zip.file("word/media/pixel.png").async("nodebuffer"),
  );
  for (const name of Object.keys(before.zip.files).filter(
    (n) => /header|footer/.test(n) && !before.zip.files[n].dir,
  ))
    assert.deepEqual(
      await after.zip.file(name).async("nodebuffer"),
      await before.zip.file(name).async("nodebuffer"),
    );
  assert.deepEqual(await fs.readFile(result.backupPath), before.buffer);
  assert.deepEqual(await fs.readFile(result.basePath), before.buffer);
  const second = await service.prepare(source);
  assert.equal(second.hasBase, true);
  assert.deepEqual(
    second.categories.map((c) => c.available),
    [4, 3],
  );
  second.categories.forEach((c) => {
    c.keep = c.available;
    c.practice = 0;
  });
  const d2 = await service.generate(options(second));
  await service.save({ token: second.token, content: d2.content });
  const restored = await openBuffer(await fs.readFile(source));
  for (let type = 1; type <= 2; type++)
    for (let q = 1; q <= (type === 1 ? 4 : 3); q++)
      assert.ok(X.text(restored.doc).includes(`TYPE${type}_Q${q}`));
  assert.deepEqual(await fs.readFile(result.basePath), before.buffer);
});
test("关闭整理保留当前题目；现有章节按勾选更新，空章节自动生成", async (t) => {
  const { source, service } = await fixture(t, { empty: true }),
    before = await openBuffer(await fs.readFile(source)),
    p = await service.prepare(source);
  assert.equal(p.hasIntro, false);
  const d = await service.generate({
    ...options(p),
    organizeQuestions: false,
    updateIntro: false,
    updateSummary: false,
  });
  const result = await service.save({ token: p.token, content: d.content });
  const after = await openBuffer(await fs.readFile(source));
  assert.match(X.text(after.doc), /数量会很快扩大/);
  assert.match(X.text(after.doc), /核心结论/);
  assert.equal(result.basePath, "");
  assert.equal(
    (await fs.readdir(path.dirname(source))).some((n) => /原始题目/.test(n)),
    false,
  );
  assert.equal(
    X.serialize(
      X.section(X.findMain(after.doc), "知识典例", "随堂练习").items[0],
    ),
    X.serialize(
      X.section(X.findMain(before.doc), "知识典例", "随堂练习").items[0],
    ),
  );
  assert.match(X.text(after.doc), /TYPE2_Q3/);
});
test("外部修改、无效题量、占位输出和模型失败均不覆盖教案或原题；允许校验失败后自动重试", async (t) => {
  const { source, service } = await fixture(t),
    initial = await fs.readFile(source),
    p = await service.prepare(source);
  p.categories[0].keep = 100;
  await assert.rejects(service.generate(options(p)), /数量/);
  assert.deepEqual(await fs.readFile(source), initial);
  const p2 = await service.prepare(source);
  let count = 0;
  service.ai.generate = async () => ({
    text: JSON.stringify(
      ++count === 1
        ? { ...content, summary: ["信息不足", "无法生成", "缺少知识点"] }
        : content,
    ),
    model: "retry",
  });
  const d = await service.generate(options(p2));
  assert.equal(count, 2);
  await fs.writeFile(source, await lessonFixture({ empty: true }));
  await assert.rejects(
    service.save({ token: p2.token, content: d.content }),
    /已被其他程序修改/,
  );
  const p3 = await service.prepare(source),
    changed = await fs.readFile(source);
  service.ai.generate = async () => {
    throw Error("model failed");
  };
  await assert.rejects(service.generate(options(p3)), /model failed/);
  assert.deepEqual(await fs.readFile(source), changed);
});
test("兼容旧项目基础题库原件，只读取不修改；复刻学案删除整段解析和三类题留白，保留媒体与页面设置", async (t) => {
  const { dir, source, service } = await fixture(t);
  const original = await fs.readFile(source),
    legacy = sibling(source, "基础题库");
  await fs.writeFile(legacy, original);
  const p = await service.prepare(source);
  assert.equal(p.basePath, legacy);
  const draft = await service.generate(options(p));
  await service.save({ token: p.token, content: draft.content });
  assert.deepEqual(await fs.readFile(legacy), original);
  await fs.writeFile(source, original);
  const target = path.join(dir, "学案.docx"),
    result = await service.study(source, target, 0.75, 0.9, false, "process");
  assert.equal(result.choiceCount, 3);
  assert.equal(result.fillBlankCount, 2);
  assert.equal(result.longAnswerCount, 2);
  assert.equal(result.removedParagraphCount, 21);
  const out = await openBuffer(await fs.readFile(target)),
    text = X.text(out.doc);
  assert.ok(!text.includes("【答案】"));
  assert.ok(!text.includes("【解析】"));
  assert.ok(!text.includes("解析后续段落"));
  assert.match(text, /TYPE1_Q1/);
  assert.match(text, /TYPE2_Q3/);
  assert.equal(X.descendants(out.doc, "sectPr").length, 1);
  assert.ok(out.zip.file("word/media/pixel.png"));
  assert.ok(X.descendants(out.doc, "sSup", X.M).length);
  const tables = X.descendants(out.doc, "tbl");
  assert.ok(tables.length >= 8);
  assert.ok(X.descendants(out.doc, "cantSplit").length >= 7);
  await assert.rejects(
    service.study(source, target, 0.75, 0.9, false),
    /已存在/,
  );
  await service.study(source, target, 0.75, 0.9, true, "copy");
  assert.deepEqual(await fs.readFile(target), original);
  assert.ok((await fs.readdir(dir)).some((n) => n.endsWith(".bak")));
});
test("学案留白基于答案而非题干长度；大题超过一页允许跨页，无法识别时不创建文件", async (t) => {
  const { dir, source, service } = await fixture(t, { long: true });
  const doc = await openBuffer(await fs.readFile(source)),
    small = transformStudy(doc.doc, 0.1, 0.5);
  const doc2 = await openBuffer(await fs.readFile(source)),
    large = transformStudy(doc2.doc, 1.5, 1);
  assert.ok(large.blankLines > small.blankLines);
  const huge = await openBuffer(await lessonFixture());
  const first = X.children(X.findMain(huge.doc)).find((n) =>
    /TYPE1_Q1/.test(X.text(n)),
  );
  for (let i = 0; i < 45; i++)
    first.parentNode.insertBefore(
      X.paragraph(
        huge.doc,
        first,
        "题干补充条件：需要结合图示和已知条件进行判断，并说明依据。",
      ),
      first.nextSibling,
    );
  assert.ok(transformStudy(huge.doc, 0.75, 0.9).oversizedQuestionCount > 0);
  const emptyDoc = await openBuffer(await lessonFixture());
  for (const n of X.descendants(emptyDoc.doc, "t"))
    if (ANSWER.test(n.textContent)) n.textContent = "没有标记";
  emptyDoc.zip.file("word/document.xml", X.serialize(emptyDoc.doc));
  await fs.writeFile(
    source,
    await emptyDoc.zip.generateAsync({ type: "nodebuffer" }),
  );
  const target = path.join(dir, "不可生成.docx");
  await assert.rejects(service.study(source, target, 0.75, 0.9), /未识别到/);
  await assert.rejects(fs.access(target));
});

test("恢复原题图片时避免覆盖当前导入中的同名附件，图形编号保持唯一", async (t) => {
  const { source, service } = await fixture(t),
    first = await service.prepare(source),
    draft = await service.generate(options(first));
  await service.save({ token: first.token, content: draft.content });
  const current = await openBuffer(await fs.readFile(source)),
    main = X.findMain(current.doc),
    image = X.descendants(main, "drawing")[0].parentNode.parentNode.cloneNode(
      true,
    );
  X.replaceSection(main, "趣味导入", "知识典例", [
    X.paragraph(current.doc, X.direct(main, "p")[0], "保留当前导入图片"),
    image,
  ]);
  current.zip.file(
    "word/media/pixel.png",
    Buffer.from("current-image-placeholder"),
  );
  current.zip.file("word/document.xml", X.serialize(current.doc));
  await fs.writeFile(
    source,
    await current.zip.generateAsync({ type: "nodebuffer" }),
  );
  const p = await service.prepare(source),
    d = await service.generate(options(p));
  await service.save({ token: p.token, content: d.content });
  const after = await openBuffer(await fs.readFile(source));
  assert.equal(
    await after.zip.file("word/media/pixel.png").async("string"),
    "current-image-placeholder",
  );
  assert.ok(
    Object.keys(after.zip.files).some((n) => /^word\/media\/zx-/.test(n)),
  );
  assert.match(X.text(after.doc), /保留当前导入图片/);
  const ids = Array.from(after.doc.getElementsByTagName("*"))
    .filter((n) => n.localName === "docPr")
    .map((n) => n.getAttribute("id"));
  assert.equal(ids.length, new Set(ids).size);
});
test("新增数学公式转为可编辑OMML，保留原字体并避免短段落拆页", () => {
  const doc = X.parse(
      `<w:document xmlns:w="${X.W}" xmlns:m="${X.M}"><w:body><w:p><w:r><w:rPr><w:rFonts w:eastAsia="Songti SC"/></w:rPr><w:t>模板</w:t></w:r></w:p></w:body></w:document>`,
    ),
    template = X.descendants(doc, "p")[0],
    p = X.paragraph(
      doc,
      template,
      "计算 $x_1^2+\\frac{a}{b}+\\sqrt[3]{c}$，实数集 $\\mathbb{R}$。",
    );
  assert.equal(X.descendants(p, "f", X.M).length, 1);
  assert.equal(X.descendants(p, "sSubSup", X.M).length, 1);
  assert.equal(X.descendants(p, "rad", X.M).length, 1);
  assert.match(X.text(p), /ℝ/);
  assert.equal(
    X.descendants(p, "rFonts")[0].getAttributeNS(X.W, "eastAsia"),
    "Songti SC",
  );
  assert.equal(X.descendants(p, "keepLines").length, 1);
});
