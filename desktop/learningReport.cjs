const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  JSZip = require("jszip");
const X = require("./lessonXml.cjs");
const TYPES = { entry: "入学学习力报告", stage: "阶段学习力报告" };
function validate(r) {
  if (
    !r ||
    r.schemaVersion !== 2 ||
    !TYPES[r.type] ||
    !r.meta?.studentName?.trim()
  )
    throw Error("学习力报告结构无效");
  if (
    r.planFormat === "fifteen-lessons" &&
    (!Array.isArray(r.plan) || r.plan.length !== 15)
  )
    throw Error("后续教学方案需完整安排15节课");
  for (const k of ["knowledge", "habits", "plan", "habitPlan"])
    if (!Array.isArray(r[k]) || r[k].length > 60)
      throw Error("报告表格结构无效");
  if (!r.goals || !r.comments || !r.motivationChoices)
    throw Error("报告内容缺失");
  for (const v of [
    r.meta,
    r.goals,
    r.comments,
    r.motivationChoices,
    ...r.knowledge,
    ...r.habits,
    ...r.plan,
    ...r.habitPlan,
  ]) {
    if (!v || typeof v !== "object") throw Error("报告字段结构无效");
    for (const text of Object.values(v))
      if (typeof text !== "string" || text.length > 12000)
        throw Error("报告字段过长或格式无效");
  }
  for (const k of ["requirements", "parentReceipt", "progress"])
    if (r[k] != null && (typeof r[k] !== "string" || r[k].length > 12000))
      throw Error("报告字段过长或格式无效");
  if ((r.parentReceipt || "").length > 240)
    throw Error("家长回执沟通参考超过原模板容量（240字），请精简后导出");
}
function setText(t, value) {
  const lines = String(value ?? "").split("\n"),
    run = t.parentNode,
    doc = t.ownerDocument;
  t.textContent = lines[0];
  t.setAttribute("xml:space", "preserve");
  let cursor = t;
  for (const line of lines.slice(1)) {
    const br = X.el(doc, "br"),
      next = X.el(doc, "t");
    next.textContent = line;
    next.setAttribute("xml:space", "preserve");
    run.insertBefore(br, cursor.nextSibling);
    run.insertBefore(next, br.nextSibling);
    cursor = next;
  }
}
function fill(node, values) {
  for (const t of X.descendants(node, "t")) {
    const original = t.textContent || "";
    if (original.includes("{{"))
      setText(
        t,
        original.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? ""),
      );
  }
}
function rows(table, values) {
  const existing = X.direct(table, "tr"),
    proto = existing[2];
  if (!proto) throw Error("学习报告模板表格缺少数据行");
  for (const row of existing.slice(2)) table.removeChild(row);
  for (const v of values.length ? values : [{}]) {
    const row = proto.cloneNode(true);
    fill(row, v);
    const pr =
      X.direct(row, "trPr")[0] ||
      row.insertBefore(X.el(row.ownerDocument, "trPr"), row.firstChild);
    if (!X.direct(pr, "cantSplit").length)
      pr.appendChild(X.el(row.ownerDocument, "cantSplit"));
    table.appendChild(row);
  }
}
function gradeDisplay(grade) {
  return (
    {
      初中一年级: "七年级",
      初中二年级: "八年级",
      初中三年级: "九年级",
      高中一年级: "高一",
      高中二年级: "高二",
      高中三年级: "高三",
    }[grade] || grade
  );
}
async function learningReportBuffer(r) {
  validate(r);
  const templateRoot = path.join(__dirname, "../assets/report-templates"),
    manifest = JSON.parse(
      await fs.readFile(path.join(templateRoot, "manifest.json"), "utf8"),
    ),
    buffer = await fs.readFile(path.join(templateRoot, r.type + ".docx"));
  if (
    crypto.createHash("sha256").update(buffer).digest("hex") !==
    manifest[r.type].sha256
  )
    throw Error("学习报告模板校验失败，请重新安装应用");
  const zip = await JSZip.loadAsync(buffer),
    doc = X.parse(await zip.file("word/document.xml").async("string")),
    body = X.descendants(doc, "body")[0],
    tables = X.direct(body, "tbl");
  if (tables.length !== (r.type === "entry" ? 4 : 5))
    throw Error("学习报告模板表格结构异常");
  rows(
    tables[0],
    r.knowledge.map((k) => ({
      knowledge_topic: k.topic,
      knowledge_difficulty: k.difficulty,
      knowledge_analysis: `评价：${k.strengths}\n提升空间：${k.needs}${k.evidence ? "\n依据：" + k.evidence : ""}`,
    })),
  );
  rows(
    tables[1],
    r.habits.map((h) => ({ habit_name: h.name, habit_rating: h.rating })),
  );
  rows(
    tables[2],
    r.plan.map((p, i) => ({
      plan_index: String(i + 1),
      plan_topic: p.topic,
      plan_objectives: p.objectives,
      plan_keyPoints: p.keyPoints,
      plan_hours:
        r.planFormat === "fifteen-lessons" ? "1节" : p.hours || "待定",
    })),
  );
  rows(
    tables[3],
    r.habitPlan.map((p, i) => ({
      habitPlan_index: String(i + 1),
      habitPlan_habit: p.habit,
      habitPlan_actions: p.actions,
      habitPlan_support: `达成标准：${p.criteria}\n所需支持：${p.support}`,
    })),
  );
  const m = r.meta,
    g = r.goals,
    requirements = String(r.requirements || "")
      .split("\n")
      .filter((v) => v.trim()),
    values = {
      studentName: m.studentName,
      grade: gradeDisplay(m.grade),
      school: m.school || "待确认",
      subject: m.subject,
      teacher: m.teacher || "待确认",
      advisor: m.advisor || "待确认",
      termOrdinal: /第二/.test(m.term) ? "二" : "一",
      lastScore: g.lastScore || "待确认",
      targetScore: g.targetScore || "待确认",
      lastRank: g.lastRank || "—",
      targetRank: g.targetRank || "—",
      parentReceipt: r.parentReceipt
        ? "沟通参考（待家长确认）：" + r.parentReceipt
        : "",
    };
  Object.values(r.motivationChoices).forEach((v, i) => {
    values["motivation" + i] =
      v === "是"
        ? "是☑     否□"
        : v === "否"
          ? "是□     否☑"
          : "是□     否□（" + (v === "未填写" ? "待确认" : v) + "）";
  });
  for (let i = 0; i < 8; i++) values["requirement" + i] = requirements[i] || "";
  if (requirements.length > 8)
    values.requirement7 = [requirements[7], ...requirements.slice(8)].join(
      "\n",
    );
  for (const [k, text] of Object.entries(r.comments))
    values["comment_" + k] = text;
  if (r.type === "stage" && r.progress)
    values.comment_overall =
      (values.comment_overall || "") + "\n阶段变化：" + r.progress;
  fill(doc, values);
  if (/\{\{\w+\}\}/.test(X.text(doc))) throw Error("学习报告模板存在未填字段");
  zip.file("word/document.xml", X.serialize(doc));
  const settings = X.parse(await zip.file("word/settings.xml").async("string"));
  const update =
    X.descendants(settings, "updateFields")[0] ||
    settings.documentElement.appendChild(X.el(settings, "updateFields"));
  update.setAttributeNS(X.W, "w:val", "true");
  zip.file("word/settings.xml", X.serialize(settings));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
module.exports = { learningReportBuffer, gradeDisplay };
