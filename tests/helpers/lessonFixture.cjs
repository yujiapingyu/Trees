const JSZip = require("jszip");
const { Document, Packer, Paragraph, Header, Footer, TextRun } = require("docx");
const X = require("../../desktop/lessonXml.cjs");
const esc = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const p = (s) =>
  `<w:p><w:pPr><w:spacing w:after="80"/><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Songti SC"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Songti SC"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${esc(s)}</w:t></w:r></w:p>`;
const cell = (s, width = 2200) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${s}</w:tc>`;
async function lessonFixture({
  long = false,
  empty = false,
  alternate = false,
} = {}) {
  const zip = await JSZip.loadAsync(
    await Packer.toBuffer(
      new Document({
        sections: [
          {
            headers: {
              default: new Header({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: "原始页眉保留验证",
                        font: "Songti SC",
                      }),
                    ],
                  }),
                ],
              }),
            },
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: "原始页脚保留验证",
                        font: "Songti SC",
                      }),
                    ],
                  }),
                ],
              }),
            },
            children: [new Paragraph("模板")],
          },
        ],
      }),
    ),
  );
  const original = X.parse(await zip.file("word/document.xml").async("string")),
    sect = X.serialize(X.descendants(original, "sectPr")[0]);
  const math = `<w:p><m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></w:p>`;
  const image = `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="300000" cy="300000"/><wp:docPr id="123" name="原题图片"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="pixel.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdFixtureImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="300000" cy="300000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  let body =
    p("趣味导入") +
    (empty
      ? ""
      : p("原有趣味导入第一段，应在未勾选时保留。") +
        p("原有趣味导入第二段。")) +
    p("知识典例") +
    p("知识点1 对数定义与运算条件");
  for (let type = 1; type <= 2; type++) {
    body += p(
      alternate
        ? `考点${type === 1 ? "一" : "二"}　对数${type === 1 ? "定义" : "运算"}`
        : `【题型${type}　对数${type === 1 ? "互化" : "运算"}】`,
    );
    for (let q = 1; q <= (type === 1 ? 4 : 3); q++) {
      const label = alternate
        ? `${q}．`
        : `${q === 1 ? "【例" + type + "】" : "【变式" + type + "-" + (q - 1) + "】"}`;
      const kind =
        q % 3 === 1
          ? "选择满足底数条件的结果（　　）"
          : q % 3 === 2
            ? "填空：定义域为_____"
            : "计算对数并写出条件";
      body += p(`${label}TYPE${type}_Q${q} ${kind}`);
      if (q % 3 === 1) body += p("A．0　B．1　C．2　D．3");
      if (q === 1 && type === 1) body += math + image;
      if (q % 3 === 0)
        body += p("（1）求出底数的取值范围。") + p("（2）计算并检验真数条件。");
      body +=
        p("【答案】" + (q % 3 === 1 ? "B" : "见解答")) +
        p("【解析】先检查底数与真数条件，再利用定义转换。") +
        p("解析后续段落_" + type + "_" + q);
      if (long && q === 3)
        body += Array.from({ length: 35 }, (_, i) =>
          p(
            `解答第${i + 1}步：通过指数式与对数式的互化，检查定义域与底数条件，并逐步完成计算。`,
          ),
        ).join("");
    }
  }
  body +=
    p("随堂练习") +
    p("") +
    p("翻转总结") +
    (empty
      ? ""
      : p("原有总结第一条。") + p("原有总结第二条。") + p("原有总结第三条。"));
  const rows = [
    ["授课主题", p("对数定义与运算")],
    [
      "教学目标",
      empty
        ? p("")
        : p("1. 原有目标一。") + p("2. 原有目标二。") + p("3. 原有目标三。"),
    ],
    [
      "教学重难点",
      empty ? p("") : p("重点：原有重点。") + p("难点：原有难点。"),
    ],
  ]
    .map(
      ([label, value]) => `<w:tr>${cell(p(label))}${cell(value, 6800)}</w:tr>`,
    )
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${X.W}" xmlns:m="${X.M}" xmlns:r="${X.R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:color="000000"/>`).join("")}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2200"/><w:gridCol w:w="6800"/></w:tblGrid>${rows}<w:tr><w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr>${body}</w:tc></w:tr></w:tbl><w:p/>${sect}</w:body></w:document>`;
  zip.file("word/document.xml", xml);
  zip.file(
    "word/media/pixel.png",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  let rel = await zip.file("word/_rels/document.xml.rels").async("string");
  rel = rel.replace(
    "</Relationships>",
    '<Relationship Id="rIdFixtureImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pixel.png"/></Relationships>',
  );
  zip.file("word/_rels/document.xml.rels", rel);
  let ct = await zip.file("[Content_Types].xml").async("string");
  if (!ct.includes('Extension="png"'))
    ct = ct.replace(
      "</Types>",
      '<Default Extension="png" ContentType="image/png"/></Types>',
    );
  zip.file("[Content_Types].xml", ct);
  return zip.generateAsync({ type: "nodebuffer" });
}
const content = {
  goals: [
    "理解对数的定义，将 $a^x=N$ 与 $x=\\log_a N$ 联系起来。",
    "掌握对数积、商、幂的运算条件与基本方法。",
    "能够使用换底公式并检验真数与底数条件。",
  ],
  key_point: "对数定义、条件与公式 $\\log_a b=\\frac{\\ln b}{\\ln a}$。",
  difficulty: "区分底数与真数的限制，完成转换并验算。",
  fun_intro: [
    "同样的增长速度下，数量会很快扩大。我们可以反过来想，已知结果怎样寻找增长所需的次数？",
    "今天用对数回答这一问题，观察指数式与对数式之间的对应关系。",
  ],
  summary: [
    "核心结论：指数式与对数式表示同一数量关系，底数为正且不为1，真数必须大于0；积、商、幂的对数性质都建立在这些条件之上。",
    "操作流程：先写出底数和真数的限制，再根据式子结构选择互化、运算法则或换底公式，最后把结果代入原条件检验。",
    "易错提醒：不能将和的对数错误拆开，也不能颠倒换底公式的分子分母；应通过特殊值与定义检查公式使用是否合理。",
  ],
};
module.exports = { lessonFixture, content, p };
