const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("jszip");
const X = require("./lessonXml.cjs");
const { QUESTION, ANSWER, transformStudy } = require("./lessonStudy.cjs");
const { isLessonQuestionCategoryHeading } = require("./lessonQuestions.cjs");
const {
  collectLessonEnrichmentContext,
  buildLessonEnrichmentPrompt,
  validateLessonEnrichmentContent,
  LESSON_ENRICHMENT_PLACEHOLDER_RE,
} = require("./lessonPrompts.cjs");
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
function sibling(source, label) {
  const name = path.basename(source),
    stem = name.replace(/\.docx$/i, "");
  return path.join(
    path.dirname(source),
    (/（教案）|\(教案\)/.test(stem)
      ? stem.replace(/（教案）|\(教案\)/, "（" + label + "）")
      : stem.replace(/教案$/, "") + "（" + label + "）") + ".docx",
  );
}
async function openBuffer(buffer) {
  if (buffer.length > 128 * 1024 * 1024)
    throw Error("教案文件超过128MB，请先压缩图片");
  const zip = await JSZip.loadAsync(buffer),
    part = zip.file("word/document.xml");
  if (!part) throw Error("DOCX缺少正文");
  if (part._data?.uncompressedSize > 32 * 1024 * 1024)
    throw Error("教案正文过大");
  const xml = await part.async("string"),
    doc = X.parse(xml);
  if (doc.documentElement.namespaceURI !== X.W)
    throw Error("不是支持的Word文档格式");
  return { zip, doc, buffer, hash: hash(buffer) };
}
function categoryData(cell) {
  const nodes = X.children(cell),
    practice = nodes.findIndex((n) => X.text(n) === "随堂练习");
  const starts = nodes
    .map((n, i) =>
      i < practice && isLessonQuestionCategoryHeading(X.text(n)) ? i : -1,
    )
    .filter((i) => i >= 0);
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? practice,
      qs = nodes
        .map((n, j) =>
          j > start && j < end && X.local(n, "p") && QUESTION.test(X.text(n))
            ? j
            : -1,
        )
        .filter((j) => j >= 0),
      blocks = qs.map((q, j) => ({
        start: q,
        end: qs[j + 1] ?? end,
        answered: nodes
          .slice(q + 1, qs[j + 1] ?? end)
          .some((n) => ANSWER.test(X.text(n))),
      }));
    return {
      start,
      end,
      label: X.text(nodes[start]),
      blocks,
      available: blocks.filter((b) => b.answered).length,
      leading: nodes.slice(start, qs[0] ?? end),
    };
  });
}
function planFor(doc) {
  const main = X.findMain(doc);
  X.section(main, "趣味导入", "知识典例");
  X.section(main, "知识典例", "随堂练习");
  const practice = X.section(main, "随堂练习", "翻转总结");
  const cats = categoryData(main),
    n = cats.length,
    defaults =
      n <= 1
        ? { keep: 8, practice: 3 }
        : n === 2
          ? { keep: 6, practice: 2 }
          : n === 3
            ? { keep: 4, practice: 1 }
            : { keep: 3, practice: 1 };
  const categories = cats.map((c) => {
    const practice = Math.min(defaults.practice, Math.max(0, c.available - 1));
    return {
      label: c.label,
      available: c.available,
      selected: true,
      keep: Math.min(defaults.keep, c.available - practice),
      practice,
    };
  });
  let warning = "";
  if (!categories.length)
    warning = "未识别到可整理的题型，本次可只完善教学内容。";
  else if (cats.some((c) => !c.available || c.available !== c.blocks.length))
    warning =
      "部分题型的题号或答案标记未能完整识别，本次保留题目原样，只完善教学内容。";
  else if (practice.items.some((n) => QUESTION.test(X.text(n))))
    warning = "原始随堂练习中已有编号题目，本次保留题目原样，只完善教学内容。";
  return {
    categories,
    originalTotal: categories.reduce((n, c) => n + c.available, 0),
    warning,
    canOrganize: !!categories.length && !warning,
  };
}
function completeness(doc) {
  const goals = X.direct(X.findValue(doc, "教学目标"), "p")
      .map(X.text)
      .filter((t) => t && !LESSON_ENRICHMENT_PLACEHOLDER_RE.test(t)),
    difficulty = X.text(X.findValue(doc, "教学重难点")),
    main = X.findMain(doc);
  const intro = X.section(main, "趣味导入", "知识典例")
      .items.map(X.text)
      .filter((t) => t && !LESSON_ENRICHMENT_PLACEHOLDER_RE.test(t)),
    summary = X.section(main, "翻转总结", null)
      .items.map(X.text)
      .filter((t) => t && !LESSON_ENRICHMENT_PLACEHOLDER_RE.test(t));
  return {
    hasIntro: !!intro.length,
    hasSummary: !!summary.length,
    complete:
      goals.length >= 3 &&
      /重点\s*[：:]\s*\S/.test(difficulty) &&
      /难点\s*[：:]\s*\S/.test(difficulty) &&
      intro.length >= 2 &&
      summary.length >= 3,
  };
}
function replacePrefix(node, pattern, replacement) {
  const texts = X.descendants(node, "t"),
    combined = texts.map((t) => t.textContent || "").join(""),
    match = combined.match(pattern);
  if (!match) throw Error("题目编号无法重排，请检查题号");
  let remaining = match[0].length,
    written = false;
  for (const t of texts) {
    const value = t.textContent || "";
    if (!remaining && written) break;
    const consumed = Math.min(value.length, remaining);
    t.textContent = (written ? "" : replacement) + value.slice(consumed);
    written = true;
    remaining -= consumed;
  }
}
function organize(doc, request) {
  const plan = planFor(doc);
  if (!plan.canOrganize) throw Error(plan.warning);
  if (!Array.isArray(request) || request.length !== plan.categories.length)
    throw Error("题目分配方案已失效，请重新检查教案");
  const cell = X.findMain(doc),
    nodes = X.children(cell),
    cats = categoryData(cell),
    practice = X.section(cell, "随堂练习", "翻转总结"),
    removed = new Set(),
    moved = [],
    retained = [];
  let categoryNumber = 0;
  if (!request.some((c) => c.selected)) throw Error("请至少选择一个题型");
  cats.forEach((c, i) => {
    const item = request[i];
    if (
      typeof item?.selected !== "boolean" ||
      !Number.isInteger(item.keep) ||
      item.keep < 0 ||
      !Number.isInteger(item.practice) ||
      item.practice < 0 ||
      item.keep + item.practice > c.available
    )
      throw Error("题目分配数量超出当前题型范围");
    if (!item.selected) {
      for (let j = c.start; j < c.end; j++) removed.add(j);
      return;
    }
    categoryNumber++;
    const heading = nodes[c.start];
    const re =
      /^(\s*(?:#{1,6}\s*)?(?:\*{1,2}\s*)?【\s*(?:题型|类型|模型)\s*)\d+/;
    const match = X.text(heading).match(re);
    if (match) replacePrefix(heading, re, match[1] + categoryNumber);
    c.blocks.forEach((b, j) => {
      if (j < item.keep) {
        replacePrefix(
          nodes[b.start],
          new RegExp("^\\s*" + QUESTION.source.slice(1)),
          `${j + 1}. `,
        );
        retained.push(nodes[b.start]);
        return;
      }
      for (let k = b.start; k < b.end; k++) removed.add(k);
      if (j >= c.blocks.length - item.practice) {
        const block = nodes.slice(b.start, b.end).map((n) => n.cloneNode(true));
        replacePrefix(
          block[0],
          new RegExp("^\\s*" + QUESTION.source.slice(1)),
          `${moved.length + 1}. `,
        );
        moved.push(block);
      }
    });
  });
  for (const i of [...removed].sort((a, b) => b - a))
    cell.removeChild(nodes[i]);
  const anchor = practice.items[0] || practice.after;
  for (const block of moved)
    for (const n of block) cell.insertBefore(n, anchor);
  return {
    movedCount: moved.length,
    retainedCount: retained.length,
    removedCount: plan.originalTotal - moved.length - retained.length,
  };
}
async function importBlocks(source, destination, blocks) {
  // Copy relationships only for restored original question blocks; keep the current
  // document, page setup, headings and existing teacher-written sections intact.
  const sourcePart = source.zip.file("word/_rels/document.xml.rels"),
    destPart = destination.zip.file("word/_rels/document.xml.rels");
  const srels = sourcePart ? X.parse(await sourcePart.async("string")) : null,
    drels = destPart
      ? X.parse(await destPart.async("string"))
      : X.parse(`<Relationships xmlns="${X.REL}"/>`),
    sTypes = X.parse(
      await source.zip.file("[Content_Types].xml").async("string"),
    ),
    dTypes = X.parse(
      await destination.zip.file("[Content_Types].xml").async("string"),
    ),
    partMap = new Map(),
    ridMap = new Map();
  async function copyPart(sourceName) {
    const norm = path.posix.normalize(sourceName);
    if (norm.startsWith("../") || norm.startsWith("/"))
      throw Error("文档附件路径无效");
    if (partMap.has(norm)) return partMap.get(norm);
    const entry = source.zip.file(norm);
    if (!entry) throw Error("原题附件缺失：" + path.posix.basename(norm));
    const bytes = await entry.async("nodebuffer"),
      existing = destination.zip.file(norm);
    let target = norm;
    const hasRelations = !!source.zip.file(
      path.posix.join(
        path.posix.dirname(norm),
        "_rels",
        path.posix.basename(norm) + ".rels",
      ),
    );
    if (
      existing &&
      (hasRelations || hash(await existing.async("nodebuffer")) !== hash(bytes))
    )
      target = path.posix.join(
        path.posix.dirname(norm),
        "zx-" + crypto.randomUUID() + path.posix.extname(norm),
      );
    partMap.set(norm, target);
    destination.zip.file(target, bytes);
    const types = X.children(sTypes.documentElement);
    for (const type of types) {
      const isOverride = type.localName === "Override",
        match = isOverride
          ? type.getAttribute("PartName") === "/" + norm
          : type.getAttribute("Extension") ===
            path.posix.extname(norm).slice(1);
      if (!match) continue;
      const key = isOverride ? "PartName" : "Extension",
        value = isOverride ? "/" + target : type.getAttribute(key);
      if (
        !X.children(dTypes.documentElement).some(
          (n) => n.getAttribute(key) === value,
        )
      ) {
        const copy = dTypes.importNode(type, true);
        copy.setAttribute(key, value);
        dTypes.documentElement.appendChild(copy);
      }
    }
    const relName = path.posix.join(
        path.posix.dirname(norm),
        "_rels",
        path.posix.basename(norm) + ".rels",
      ),
      rels = source.zip.file(relName);
    if (rels) {
      const doc = X.parse(await rels.async("string"));
      for (const rel of X.children(doc.documentElement))
        if (rel.getAttribute("TargetMode") !== "External") {
          const child = path.posix.normalize(
              path.posix.join(
                path.posix.dirname(norm),
                rel.getAttribute("Target"),
              ),
            ),
            copied = await copyPart(child);
          rel.setAttribute(
            "Target",
            path.posix.relative(path.posix.dirname(target), copied),
          );
        }
      destination.zip.file(
        path.posix.join(
          path.posix.dirname(target),
          "_rels",
          path.posix.basename(target) + ".rels",
        ),
        X.serialize(doc),
      );
    }
    return target;
  }
  const imported = [];
  for (const block of blocks) {
    const copy = destination.doc.importNode(block, true);
    for (const node of [copy, ...Array.from(copy.getElementsByTagName("*"))])
      for (const attr of Array.from(node.attributes || [])) {
        if (attr.namespaceURI !== X.R) continue;
        const old = attr.value;
        if (!ridMap.has(old)) {
          const rel =
            srels &&
            X.children(srels.documentElement).find(
              (r) => r.getAttribute("Id") === old,
            );
          if (!rel) throw Error("原题中的图片或附件关系缺失");
          const id = "rIdZX" + crypto.randomUUID().replaceAll("-", ""),
            item = drels.importNode(rel, true);
          item.setAttribute("Id", id);
          if (item.getAttribute("TargetMode") !== "External") {
            const name = path.posix.normalize(
                path.posix.join("word", item.getAttribute("Target")),
              ),
              target = await copyPart(name);
            item.setAttribute("Target", path.posix.relative("word", target));
          }
          drels.documentElement.appendChild(item);
          ridMap.set(old, id);
        }
        node.setAttributeNS(X.R, attr.name, ridMap.get(old));
      }
    imported.push(copy);
  }
  destination.zip.file("word/_rels/document.xml.rels", X.serialize(drels));
  destination.zip.file("[Content_Types].xml", X.serialize(dTypes));
  return imported;
}
function normalizedContent(value) {
  const c = validateLessonEnrichmentContent(value);
  for (const v of [
    c.key_point,
    c.difficulty,
    ...c.goals,
    ...c.fun_intro,
    ...c.summary,
  ])
    if (typeof v !== "string" || !v.trim() || v.length > 12000)
      throw Error("教学内容字段为空、过长或格式无效");
  return structuredClone(c);
}
function applyContent(doc, c, options) {
  X.replaceCell(
    X.findValue(doc, "教学目标"),
    c.goals.map((t, i) => `${i + 1}. ${t}`),
  );
  X.replaceCell(X.findValue(doc, "教学重难点"), [
    `重点：${c.key_point}`,
    `难点：${c.difficulty}`,
  ]);
  const main = X.findMain(doc);
  for (const [enabled, start, end, lines] of [
    [options.updateIntro, "趣味导入", "知识典例", c.fun_intro],
    [
      options.updateSummary,
      "翻转总结",
      null,
      c.summary.map((t, i) => `${i + 1}. ${t}`),
    ],
  ])
    if (enabled) {
      const old = X.section(main, start, end),
        template = old.items.find((n) => X.local(n, "p")) || old.heading;
      const paragraphs = lines.map((t) => X.paragraph(doc, template, t));
      X.replaceSection(main, start, end, paragraphs);
    }
}
class LessonDocumentService {
  constructor(files, ai) {
    this.files = files;
    this.ai = ai;
    this.jobs = new Map();
    this.saving = new Set();
  }
  async read(source) {
    const file = await this.files.guard(source);
    if (!/\.docx$/i.test(file))
      throw Error("仅支持DOCX教案，请先将DOC另存为DOCX");
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 128 * 1024 * 1024)
      throw Error("请选择128MB以内的DOCX教案");
    return { ...(await openBuffer(await fs.readFile(file))), file };
  }
  prune() {
    for (const [k, v] of this.jobs)
      if (v.expires < Date.now()) this.jobs.delete(k);
    while (this.jobs.size >= 4) this.jobs.delete(this.jobs.keys().next().value);
  }
  async prepare(source) {
    this.prune();
    const current = await this.read(source);
    if (/原始题目|基础题库|备份|历史教案/.test(path.basename(current.file)))
      throw Error("请选择当前教案，不要选择原始题目或历史备份");
    const fixed = sibling(current.file, "原始题目"),
      legacy = sibling(current.file, "基础题库");
    let basePath = fixed,
      hasBase = false;
    for (const candidate of [fixed, legacy])
      if ((await this.files.check(candidate)).exists) {
        basePath = candidate;
        hasBase = true;
        break;
      }
    const base = hasBase ? await this.read(basePath) : current,
      plan = planFor(base.doc),
      complete = completeness(current.doc),
      token = crypto.randomUUID();
    this.jobs.set(token, {
      current,
      base,
      basePath,
      hasBase,
      plan,
      complete,
      expires: Date.now() + 30 * 60 * 1000,
    });
    return {
      token,
      source: current.file,
      basePath,
      hasBase,
      ...plan,
      ...complete,
      organizeQuestions: plan.canOrganize,
      updateIntro: !complete.hasIntro,
      updateSummary: !complete.hasSummary,
    };
  }
  job(token) {
    const job = this.jobs.get(token);
    if (!job || job.expires < Date.now())
      throw Error("教案预览已过期，请重新打开");
    return job;
  }
  async fresh(job) {
    if (hash(await this.files.read(job.current.file)) !== job.current.hash)
      throw Error("教案已被其他程序修改，请重新检查后生成");
    const checked = await this.files.check(job.basePath);
    if (
      checked.exists !== job.hasBase ||
      (job.hasBase &&
        hash(await this.files.read(job.basePath)) !== job.base.hash)
    )
      throw Error("原始题目文件已变化，请重新检查");
  }
  async generate({
    token,
    organizeQuestions = false,
    questionPlan = [],
    updateIntro = true,
    updateSummary = true,
    instructions = "",
  }) {
    const job = this.job(token);
    if (job.generating) throw Error("教案正在生成，请稍候");
    if (
      typeof organizeQuestions !== "boolean" ||
      typeof updateIntro !== "boolean" ||
      typeof updateSummary !== "boolean" ||
      typeof instructions !== "string" ||
      instructions.length > 6000
    )
      throw Error("教案完善选项无效");
    if (!job.complete.hasIntro) updateIntro = true;
    if (!job.complete.hasSummary) updateSummary = true;
    await this.fresh(job);
    job.generating = true;
    try {
      const selected = organizeQuestions
        ? await openBuffer(job.base.buffer)
        : await openBuffer(job.current.buffer);
      let organized = { movedCount: 0, retainedCount: 0, removedCount: 0 };
      if (organizeQuestions) organized = organize(selected.doc, questionPlan);
      const topic =
          X.text(X.findValue(job.current.doc, "授课主题")) ||
          path.basename(job.current.file, ".docx"),
        texts = X.descendants(selected.doc, "p").map(X.text).filter(Boolean),
        context = collectLessonEnrichmentContext(
          texts,
          topic,
          organizeQuestions
            ? questionPlan
                .map((p, i) => (p.selected ? job.plan.categories[i].label : ""))
                .filter(Boolean)
            : [],
        ),
        prompt =
          buildLessonEnrichmentPrompt(context) +
          "\n以下补充要求不能改变真实题目、数量和输出结构：" +
          instructions;
      let content, model, lastError;
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await this.ai.generate({
          id: crypto.randomUUID(),
          task:
            prompt +
            (attempt
              ? "\n上次结构校验失败：" +
                lastError.message +
                "。请重新输出完整有效JSON，不要输出占位内容。"
              : ""),
          json: true,
          thinking: false,
          maxTokens: 6000,
        });
        try {
          const raw = result.text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "");
          content = normalizedContent(JSON.parse(raw));
          model = result.model;
          break;
        } catch (e) {
          lastError = e;
        }
      }
      if (!content) throw lastError;
      await this.fresh(job);
      job.draft = {
        content,
        options: {
          organizeQuestions,
          questionPlan: structuredClone(questionPlan),
          updateIntro,
          updateSummary,
        },
        model,
        ...organized,
      };
      return { token, content, model, ...organized };
    } finally {
      job.generating = false;
    }
  }
  async save({ token, content }) {
    const job = this.job(token);
    if (!job.draft) throw Error("请先生成教学内容");
    if (this.saving.has(job.current.file)) throw Error("此教案正在保存");
    this.saving.add(job.current.file);
    try {
      const c = normalizedContent(content);
      await this.fresh(job);
      const output = await openBuffer(job.current.buffer),
        options = job.draft.options;
      if (options.organizeQuestions) {
        const original = await openBuffer(job.base.buffer);
        organize(original.doc, options.questionPlan);
        const from = X.findMain(original.doc),
          to = X.findMain(output.doc);
        for (const [start, end] of [
          ["知识典例", "随堂练习"],
          ["随堂练习", "翻转总结"],
        ]) {
          const blocks = await importBlocks(
            original,
            output,
            X.section(from, start, end).items,
          );
          X.replaceSection(to, start, end, blocks);
        }
      }
      applyContent(output.doc, c, options);
      const drawingIds = new Set();
      let nextDrawingId = 1;
      for (const node of Array.from(
        output.doc.getElementsByTagName("*"),
      ).filter((n) => n.localName === "docPr")) {
        let id = node.getAttribute("id");
        if (drawingIds.has(id)) {
          while (drawingIds.has(String(nextDrawingId))) nextDrawingId++;
          id = String(nextDrawingId++);
          node.setAttribute("id", id);
        }
        drawingIds.add(id);
      }
      output.zip.file("word/document.xml", X.serialize(output.doc));
      const buffer = await output.zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      });
      await openBuffer(buffer);
      await this.fresh(job);
      const backupPath = path.join(
        path.dirname(job.current.file),
        ".知序备份",
        path.basename(job.current.file, ".docx") +
          "-" +
          new Date().toISOString().replace(/[:.]/g, "-") +
          "-" +
          crypto.randomUUID().slice(0, 6) +
          ".docx",
      );
      await this.files.write(backupPath, job.current.buffer);
      let baseCreated = false;
      if (options.organizeQuestions && !job.hasBase) {
        const temp = path.join(
          path.dirname(job.current.file),
          ".知序原题-" + crypto.randomUUID() + ".tmp",
        );
        try {
          await this.files.write(temp, job.current.buffer);
          await this.files.copy(temp, job.basePath);
        } finally {
          await fs.rm(temp, { force: true });
        }
        baseCreated = true;
      }
      if (hash(await this.files.read(job.current.file)) !== job.current.hash)
        throw Error("保存前教案发生变化，已保留备份，请重新生成");
      await this.files.write(job.current.file, buffer, { overwrite: true });
      this.jobs.delete(token);
      return {
        path: job.current.file,
        backupPath,
        basePath: options.organizeQuestions ? job.basePath : "",
        baseCreated,
        movedCount: job.draft.movedCount,
        retainedCount: job.draft.retainedCount,
        removedCount: job.draft.removedCount,
      };
    } finally {
      this.saving.delete(job.current.file);
    }
  }
  discard(token) {
    this.jobs.delete(token);
  }
  async study(
    source,
    target,
    factor = 0.75,
    exponent = 0.9,
    overwrite = false,
    mode = "process",
  ) {
    if (
      mode === "process" &&
      (!Number.isFinite(factor) ||
        factor < 0.1 ||
        factor > 1.5 ||
        !Number.isFinite(exponent) ||
        exponent < 0.5 ||
        exponent > 1)
    )
      throw Error("学案空白参数超出范围");
    if (!["process", "copy"].includes(mode) || typeof overwrite !== "boolean")
      throw Error("学案生成选项无效");
    const input = await this.read(source),
      dest = await this.files.guard(target, { write: true, allowRoot: false });
    if (input.file === dest) throw Error("学案路径不能与原教案路径相同");
    if (!/\.docx$/i.test(dest)) throw Error("学案必须保存为DOCX");
    if (/原始题目|基础题库/.test(path.basename(dest)))
      throw Error("不能覆盖原始题目文件");
    const checked = await this.files.check(dest);
    if (checked.exists && !overwrite) throw Error("学案已存在，请确认覆盖");
    let stats = {
        questions: 0,
        processed: 0,
        choiceCount: 0,
        fillBlankCount: 0,
        longAnswerCount: 0,
        removedParagraphCount: 0,
        blankLines: 0,
        oversizedQuestionCount: 0,
        unprocessedQuestionCount: 0,
      },
      buffer = input.buffer;
    if (mode === "process") {
      stats = transformStudy(input.doc, factor, exponent);
      input.zip.file("word/document.xml", X.serialize(input.doc));
      buffer = await input.zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      });
      await openBuffer(buffer);
    }
    if (hash(await this.files.read(input.file)) !== input.hash)
      throw Error("生成时原教案发生变化，请重新生成");
    await this.files.write(dest, buffer, { overwrite, backup: overwrite });
    return {
      path: dest,
      mode,
      ...stats,
      layout:
        mode === "copy"
          ? "已原样复制教案为学案，答案和解析均保留"
          : "已移除识别到的整段答案解析，按题型留白并优化分页",
    };
  }
}
module.exports = {
  LessonDocumentService,
  openBuffer,
  planFor,
  organize,
  completeness,
  sibling,
  normalizedContent,
  applyContent,
};
