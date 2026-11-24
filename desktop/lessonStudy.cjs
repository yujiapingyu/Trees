const X = require("./lessonXml.cjs");
const QUESTION =
  /^(?:【\s*(?:例|例题|典例|变式|变形|练习|题组)\s*\d+(?:\s*[-－—–.]\s*\d+)*[^】]*】|(?:例|例题|典例|变式|变形|练习|题组)\s*\d+(?:\s*[-－—–.]\s*\d+)*|\d+\s*[.．、]\s*)/;
const ANSWER =
  /^(?:【?\s*(?:参考答案|答案|解析|解答过程|解答|详解|解题思路|思路点拨|点睛)\s*】?)\s*[：:]?/;
const BOUNDARY =
  /^(?:(?:#{1,6}\s*)?(?:\*{1,2}\s*)?【\s*(?:题型|类型|模型)\s*\d+[^】]*】|考点\s*[一二三四五六七八九十百千万\d]+|知识点\s*\d+|随堂练习|翻转总结|趣味导入|知识典例|课堂小结|课后作业|教学反思)/;
const hasImage = (node) =>
  Array.from(node.getElementsByTagName("*")).some((n) =>
    ["drawing", "pict", "imagedata", "blip", "OLEObject"].includes(n.localName),
  );
function classify(nodes) {
  const texts = nodes.map(X.text),
    joined = texts.join(" "),
    letters = new Set(
      Array.from(joined.matchAll(/(?:^|\s)([A-D])\s*[.．、)]/g), (m) => m[1]),
    );
  if (letters.size >= 2 || (joined.includes("A．") && joined.includes("D．")))
    return "choice";
  if (
    texts.some((t) => /^[（(]\s*\d+\s*[）)]/.test(t)) ||
    /(?:证明|求证|解答|计算|作出|画出|写出|求(?:出|解|证|数列|函数|方程|不等式|通项|前\s*n\s*项和|最值|最大值|最小值|范围|值))/.test(
      joined,
    )
  )
    return "longAnswer";
  return "fillBlank";
}
function lines(nodes, answers = false) {
  let total = 0;
  for (const n of nodes) {
    const t = X.text(n),
      weighted = Array.from(t).reduce(
        (v, c) => v + (c.codePointAt(0) > 127 ? 2 : 1),
        0,
      );
    let image = 0;
    for (const e of Array.from(n.getElementsByTagName("*")))
      if (e.localName === "extent")
        image = Math.max(
          image,
          Math.ceil(Number(e.getAttribute("cy") || 0) / 177800),
        );
    total += answers
      ? Math.max(1, Math.ceil(weighted / 84)) + (hasImage(n) ? 4 : 0)
      : Math.max(1, Math.ceil(weighted / 84), image || (hasImage(n) ? 8 : 0));
  }
  return Math.max(1, total);
}
function keep(p, next, whole = true) {
  if (!X.local(p, "p")) return;
  let pr = X.direct(p, "pPr")[0];
  if (!pr) {
    pr = X.el(p.ownerDocument, "pPr");
    p.insertBefore(pr, p.firstChild);
  }
  for (const n of X.children(pr))
    if (["keepNext", "keepLines"].includes(n.localName)) pr.removeChild(n);
  let anchor = X.children(pr).find((n) => n.localName !== "pStyle") || null;
  if (next) pr.insertBefore(X.el(p.ownerDocument, "keepNext"), anchor);
  if (whole) pr.insertBefore(X.el(p.ownerDocument, "keepLines"), anchor);
}
function blank(doc, template) {
  const p = X.paragraph(doc, template, " ");
  const pr = X.direct(p, "pPr")[0];
  if (pr)
    for (const n of X.children(pr))
      if (["numPr", "sectPr", "pageBreakBefore"].includes(n.localName))
        pr.removeChild(n);
  keep(p, false);
  return p;
}
function table(doc, questions, blanks, width, whole) {
  const tbl = X.el(doc, "tbl"),
    pr = X.el(doc, "tblPr");
  pr.appendChild(X.el(doc, "tblW", { w: 5000, type: "pct" }));
  const borders = X.el(doc, "tblBorders");
  for (const side of ["top", "left", "bottom", "right", "insideH", "insideV"])
    borders.appendChild(X.el(doc, side, { val: "nil" }));
  pr.appendChild(borders);
  pr.appendChild(X.el(doc, "tblLayout", { type: "fixed" }));
  const margins = X.el(doc, "tblCellMar");
  for (const side of ["top", "left", "bottom", "right"])
    margins.appendChild(X.el(doc, side, { w: 0, type: "dxa" }));
  pr.appendChild(margins);
  tbl.appendChild(pr);
  const grid = X.el(doc, "tblGrid");
  grid.appendChild(X.el(doc, "gridCol", { w: width }));
  tbl.appendChild(grid);
  for (const [nodes, noSplit] of [
    [questions, whole],
    [blanks, false],
  ]) {
    const tr = X.el(doc, "tr");
    if (noSplit) {
      const rpr = X.el(doc, "trPr");
      rpr.appendChild(X.el(doc, "cantSplit"));
      tr.appendChild(rpr);
    }
    const tc = X.el(doc, "tc"),
      cpr = X.el(doc, "tcPr");
    cpr.appendChild(X.el(doc, "tcW", { w: width, type: "dxa" }));
    tc.appendChild(cpr);
    for (const n of nodes) tc.appendChild(n);
    if (!X.local(X.children(tc).at(-1), "p")) tc.appendChild(X.el(doc, "p"));
    tr.appendChild(tc);
    tbl.appendChild(tr);
  }
  return tbl;
}
function transformStudy(doc, factor, exponent) {
  const stats = {
    choiceCount: 0,
    fillBlankCount: 0,
    longAnswerCount: 0,
    removedParagraphCount: 0,
    blankLines: 0,
    oversizedQuestionCount: 0,
    unprocessedQuestionCount: 0,
    questions: 0,
  };
  const sect = X.descendants(doc, "sectPr").at(-1),
    size = X.direct(sect, "pgSz")[0],
    margin = X.direct(sect, "pgMar")[0],
    get = (n, k, f) => Number(n?.getAttributeNS(X.W, k) || f);
  let width = Math.max(
      1440,
      get(size, "w", 12240) -
        get(margin, "left", 1440) -
        get(margin, "right", 1440),
    ),
    maxLines = Math.max(
      10,
      Math.floor(
        ((get(size, "h", 15840) -
          get(margin, "top", 1440) -
          get(margin, "bottom", 1440)) *
          0.9) /
          280,
      ),
    );
  let containers;
  try {
    const main = X.findMain(doc);
    containers = [main, ...X.descendants(main, "tc")];
  } catch {
    containers = [...X.descendants(doc, "body"), ...X.descendants(doc, "tc")];
  }
  for (const parent of containers) {
    const nodes = X.children(parent),
      texts = nodes.map(X.text),
      starts = nodes
        .map((n, i) => (X.local(n, "p") && QUESTION.test(texts[i]) ? i : -1))
        .filter((i) => i >= 0);
    const replacements = [];
    const tcWidth = get(
        X.direct(X.direct(parent, "tcPr")[0], "tcW")[0],
        "w",
        width,
      ),
      contentWidth = Math.min(width, tcWidth > 0 ? tcWidth : width);
    for (let qi = 0; qi < starts.length; qi++) {
      const start = starts[qi];
      let end = starts[qi + 1] ?? nodes.length;
      for (let i = start + 1; i < end; i++)
        if (X.local(nodes[i], "sectPr") || BOUNDARY.test(texts[i])) {
          end = i;
          break;
        }
      stats.questions++;
      const answer = nodes.findIndex(
        (n, i) => i > start && i < end && ANSWER.test(texts[i]),
      );
      if (answer < 0) {
        stats.unprocessedQuestionCount++;
        continue;
      }
      let group = start;
      let before = start - 1;
      while (before >= 0 && !texts[before] && X.local(nodes[before], "p"))
        before--;
      if (before >= 0 && BOUNDARY.test(texts[before])) group = before;
      const stem = nodes.slice(start, answer),
        kind = classify(stem),
        removed = nodes.slice(answer, end),
        estimated = lines(removed, true),
        count =
          kind === "longAnswer"
            ? Math.max(1, Math.ceil(factor * Math.pow(estimated, exponent)))
            : 1;
      if (count > 250)
        throw Error("单题答案过长，无法合理分配作答空间，请先检查教案结构");
      const kept = nodes.slice(group, answer).map((n) => n.cloneNode(true)),
        whole = lines(kept) <= maxLines;
      if (!whole) stats.oversizedQuestionCount++;
      kept.forEach((n, i) => keep(n, whole && i < kept.length - 1, whole));
      const blanks = Array.from({ length: count }, () =>
        blank(doc, nodes[answer]),
      );
      replacements.push({
        group,
        end,
        node: table(doc, kept, blanks, contentWidth, whole),
      });
      stats[kind + "Count"]++;
      stats.removedParagraphCount += removed.reduce(
        (n, p) => n + (X.local(p, "p") ? 1 : X.descendants(p, "p").length),
        0,
      );
      stats.blankLines += count;
    }
    for (const r of replacements.reverse()) {
      const anchor = nodes[r.group];
      parent.insertBefore(r.node, anchor);
      for (let i = r.group; i < r.end; i++)
        if (nodes[i].parentNode === parent) parent.removeChild(nodes[i]);
    }
    if (
      replacements.length &&
      X.local(parent, "tc") &&
      !X.local(X.children(parent).at(-1), "p")
    )
      parent.appendChild(X.el(doc, "p"));
  }
  const processed =
    stats.choiceCount + stats.fillBlankCount + stats.longAnswerCount;
  if (!processed)
    throw Error(
      "未识别到可移除答案解析的题目，未写入学案。请检查题号与答案标记，或选择“仅复制”。",
    );
  return { ...stats, processed };
}
module.exports = { QUESTION, ANSWER, BOUNDARY, classify, transformStudy };
