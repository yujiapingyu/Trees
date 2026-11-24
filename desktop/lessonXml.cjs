const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const children = (n) =>
  Array.from(n?.childNodes || []).filter((x) => x.nodeType === 1);
const local = (n, name) => n?.namespaceURI === W && n.localName === name;
const direct = (n, name) => children(n).filter((x) => local(x, name));
const descendants = (n, name, ns = W) =>
  Array.from(n?.getElementsByTagNameNS(ns, name) || []);
function parse(xml) {
  if (
    typeof xml !== "string" ||
    xml.length > 32 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml)
  )
    throw Error("文档XML过大或包含不支持的声明");
  const errors = [];
  const doc = new DOMParser({
    errorHandler: {
      warning: (m) => errors.push(m),
      error: (m) => errors.push(m),
      fatalError: (m) => errors.push(m),
    },
  }).parseFromString(xml, "application/xml");
  if (errors.length || !doc?.documentElement) throw Error("无法解析文档XML");
  return doc;
}
const serialize = (n) => new XMLSerializer().serializeToString(n);
function linearMath(n) {
  const parts = children(n),
    get = (name) =>
      parts.find((p) => p.namespaceURI === M && p.localName === name),
    inner = (name) => linearMath(get(name));
  if (!n) return "";
  if (n.localName === "t") return n.textContent || "";
  if (n.localName.endsWith("Pr")) return "";
  if (n.localName === "f") return `\\frac{${inner("num")}}{${inner("den")}}`;
  if (["sSup", "sSub", "sSubSup"].includes(n.localName))
    return `{${inner("e")}}${get("sub") ? `_{${inner("sub")}}` : ""}${get("sup") ? `^{${inner("sup")}}` : ""}`;
  if (n.localName === "rad")
    return `\\sqrt${inner("deg") ? `[${inner("deg")}]` : ""}{${inner("e")}}`;
  if (n.localName === "d") return `(${inner("e")})`;
  if (n.localName === "eqArr" || n.localName === "mr")
    return parts.map(linearMath).join("; ");
  return parts.map(linearMath).join("");
}
function text(n) {
  function walk(node) {
    if (node.namespaceURI === M && node.localName === "oMath")
      return "$" + linearMath(node) + "$";
    if (node.namespaceURI === W && node.localName === "t")
      return node.textContent || "";
    if (node.namespaceURI === W && ["br", "cr", "tab"].includes(node.localName))
      return " ";
    return children(node).map(walk).join("");
  }
  return n
    ? walk(n)
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}
function el(doc, name, attrs = {}, ns = W, prefix = "w") {
  const n = doc.createElementNS(ns, prefix + ":" + name);
  for (const [k, v] of Object.entries(attrs))
    n.setAttributeNS(ns, prefix + ":" + k, String(v));
  return n;
}
function findValue(doc, label) {
  for (const row of descendants(doc, "tr")) {
    const cells = direct(row, "tc");
    for (let i = 0; i < cells.length - 1; i++)
      if (text(cells[i]) === label) return cells[i + 1];
  }
  throw Error(
    "教案中未找到“" + label + "”右侧内容单元格，请选择对应模板的教案",
  );
}
function findMain(doc) {
  const candidates = descendants(doc, "tc")
    .map((cell) => {
      const texts = children(cell).map(text);
      return {
        cell,
        score: ["趣味导入", "知识典例", "随堂练习", "翻转总结"].filter((x) =>
          texts.includes(x),
        ).length,
      };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length)
    throw Error("未找到包含趣味导入、知识典例、随堂练习和翻转总结的正文区域");
  return candidates[0].cell;
}
function section(cell, start, end) {
  const nodes = children(cell),
    a = nodes.findIndex((n) => text(n) === start),
    b = end
      ? nodes.findIndex((n, i) => i > a && text(n) === end)
      : nodes.length;
  if (a < 0 || b <= a) throw Error("教案章节缺失或顺序不正确：" + start);
  return {
    nodes,
    start: a,
    end: b,
    items: nodes.slice(a + 1, b),
    heading: nodes[a],
    after: nodes[b] || null,
  };
}
function replaceSection(cell, start, end, nodes) {
  const part = section(cell, start, end);
  for (const n of part.items) cell.removeChild(n);
  for (const n of nodes) cell.insertBefore(n, part.after);
}
const SYMBOLS = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  phi: "φ",
  omega: "ω",
  Delta: "Δ",
  Sigma: "Σ",
  Omega: "Ω",
  infty: "∞",
  partial: "∂",
  forall: "∀",
  exists: "∃",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  setminus: "∖",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  cdot: "⋅",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  mapsto: "↦",
  therefore: "∴",
  because: "∵",
  angle: "∠",
  triangle: "△",
  parallel: "∥",
  perp: "⊥",
  mid: "∣",
  sum: "∑",
  prod: "∏",
  int: "∫",
  circ: "°",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  log: "log",
  ln: "ln",
  lg: "lg",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  cot: "cot",
  lim: "lim",
  max: "max",
  min: "min",
  left: "",
  right: "",
  quad: "　",
  qquad: "　　",
};
Object.assign(SYMBOLS, {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  forall: "∀",
  exists: "∃",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  supset: "⊃",
  subseteq: "⊆",
  supseteq: "⊇",
  subsetneq: "⊊",
  supsetneq: "⊋",
  nsubseteq: "⊄",
  nsupseteq: "⊅",
  setminus: "∖",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  ncong: "≇",
  propto: "∝",
  cdot: "⋅",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  mapsto: "↦",
  wedge: "∧",
  vee: "∨",
  neg: "¬",
  therefore: "∴",
  because: "∵",
  angle: "∠",
  measuredangle: "∡",
  triangle: "△",
  parallel: "∥",
  nparallel: "∦",
  perp: "⊥",
  mid: "∣",
  nmid: "∤",
  sum: "∑",
  prod: "∏",
  int: "∫",
  iint: "∬",
  iiint: "∭",
  circ: "°",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  vdots: "⋮",
});
function mathNodes(doc, input) {
  let pos = 0;
  const m = (name, attrs = {}) => el(doc, name, attrs, M, "m");
  const run = (s) => {
    const n = m("r"),
      t = m("t");
    t.appendChild(doc.createTextNode(s));
    n.appendChild(t);
    return n;
  };
  const arg = (name, nodes) => {
    const n = m(name);
    for (const c of nodes) n.appendChild(c);
    return n;
  };
  function argument() {
    while (/\s/.test(input[pos] || "") && pos < input.length) pos++;
    if (input[pos] === "{") {
      pos++;
      return sequence("}");
    }
    if (input[pos] === "\\") return command();
    return [run(input[pos++] || "")];
  }
  function command() {
    pos++;
    const match = input.slice(pos).match(/^[A-Za-z]+/);
    if (!match) return [run(input[pos++] || "")];
    const name = match[0];
    pos += name.length;
    if (["frac", "dfrac", "tfrac"].includes(name)) {
      const f = m("f");
      f.appendChild(arg("num", argument()));
      f.appendChild(arg("den", argument()));
      return [f];
    }
    if (name === "sqrt") {
      let degree = [];
      if (input[pos] === "[") {
        pos++;
        degree = sequence("]");
      }
      const root = m("rad"),
        pr = m("radPr");
      pr.appendChild(m("degHide", { val: degree.length ? "0" : "1" }));
      root.appendChild(pr);
      root.appendChild(arg("deg", degree));
      root.appendChild(arg("e", argument()));
      return [root];
    }
    if (name === "mathbb") {
      const nodes = argument(),
        letters = nodes.map((n) => n.textContent || "").join("");
      return [
        run(
          { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ" }[letters] ||
            letters,
        ),
      ];
    }
    if (
      [
        "mathrm",
        "mathbf",
        "mathit",
        "text",
        "operatorname",
        "overline",
        "bar",
        "vec",
        "hat",
      ].includes(name)
    ) {
      const nodes = argument();
      if (["overline", "bar", "vec", "hat"].includes(name)) {
        const acc = m("acc"),
          pr = m("accPr");
        pr.appendChild(
          m("chr", { val: name === "vec" ? "→" : name === "hat" ? "̂" : "̅" }),
        );
        acc.appendChild(pr);
        acc.appendChild(arg("e", nodes));
        return [acc];
      }
      return nodes;
    }
    if (name === " " || name === ",") return [run(" ")];
    return [run(Object.hasOwn(SYMBOLS, name) ? SYMBOLS[name] : "\\" + name)];
  }
  function sequence(end) {
    const nodes = [];
    while (pos < input.length) {
      const ch = input[pos];
      if (ch === end) {
        pos++;
        break;
      }
      if (ch === "{") {
        pos++;
        nodes.push(...sequence("}"));
        continue;
      }
      if (ch === "\\") {
        nodes.push(...command());
        continue;
      }
      if (ch === "^" || ch === "_") {
        pos++;
        const value = argument(),
          base = nodes.pop() || run("");
        const prior = base.localName;
        let script;
        if (
          (ch === "^" && prior === "sSub") ||
          (ch === "_" && prior === "sSup")
        ) {
          script = m("sSubSup");
          const oldChildren = children(base);
          script.appendChild(oldChildren[0]);
          script.appendChild(ch === "^" ? oldChildren[1] : arg("sub", value));
          script.appendChild(ch === "^" ? arg("sup", value) : oldChildren[1]);
        } else {
          script = m(ch === "^" ? "sSup" : "sSub");
          script.appendChild(arg("e", [base]));
          script.appendChild(arg(ch === "^" ? "sup" : "sub", value));
        }
        nodes.push(script);
        continue;
      }
      pos++;
      nodes.push(run(ch));
    }
    return nodes;
  }
  return sequence();
}
function paragraph(doc, template, value, bold = false) {
  const p = el(doc, "p"),
    ppr = direct(template, "pPr")[0];
  const properties = ppr ? ppr.cloneNode(true) : el(doc, "pPr");
  for (const old of children(properties).filter((n) =>
    ["keepNext", "keepLines"].includes(n.localName),
  ))
    properties.removeChild(old);
  if (value.length < 900)
    properties.insertBefore(
      el(doc, "keepLines"),
      children(properties).find((n) => n.localName !== "pStyle") || null,
    );
  p.appendChild(properties);
  const addRun = (s) => {
    if (!s) return;
    const r = el(doc, "r");
    const templateRun = descendants(template, "r")[0];
    const originalProperties =
      direct(templateRun, "rPr")[0] ||
      direct(direct(template, "pPr")[0], "rPr")[0];
    const pr = originalProperties
      ? originalProperties.cloneNode(true)
      : el(doc, "rPr");
    if (bold) {
      for (const old of direct(pr, "b")) pr.removeChild(old);
      pr.insertBefore(
        el(doc, "b"),
        children(pr).find((n) => !["rStyle", "rFonts"].includes(n.localName)) ||
          null,
      );
    }
    if (pr.childNodes.length) r.appendChild(pr);
    const t = el(doc, "t");
    t.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve",
    );
    t.appendChild(doc.createTextNode(s));
    r.appendChild(t);
    p.appendChild(r);
  };
  let last = 0;
  for (const match of value.matchAll(
    /(?<!\\)\$([^$]+)(?<!\\)\$|\\\((.+?)\\\)/g,
  )) {
    addRun(value.slice(last, match.index));
    const math = el(doc, "oMath", {}, M, "m");
    for (const n of mathNodes(doc, match[1] || match[2])) math.appendChild(n);
    p.appendChild(math);
    last = match.index + match[0].length;
  }
  addRun(value.slice(last));
  return p;
}
function replaceCell(cell, lines, bold = true) {
  const doc = cell.ownerDocument,
    template = direct(cell, "p")[0] || el(doc, "p");
  for (const n of children(cell)) if (!local(n, "tcPr")) cell.removeChild(n);
  for (const line of lines)
    cell.appendChild(paragraph(doc, template, line, bold));
}
module.exports = {
  W,
  M,
  R,
  REL,
  children,
  local,
  direct,
  descendants,
  parse,
  serialize,
  text,
  el,
  findValue,
  findMain,
  section,
  replaceSection,
  paragraph,
  replaceCell,
  mathNodes,
};
