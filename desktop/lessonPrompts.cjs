const KNOWLEDGE_POINT_RE = /^(?:#{1,6}\s*)?(?:\*{1,2}\s*)?知识点\s*\d+/;
const PROBLEM_TYPE_RE =
  /^(?:#{1,6}\s*)?(?:\*{1,2}\s*)?(?:【\s*(?:题型|类型|模型)\s*\d+|考点\s*[一二三四五六七八九十百千万\d]+(?:\s|　|$))/;
const EXAMPLE_RE = /^【\s*例\s*\d+】/;
const NUMBERED_QUESTION_RE = /^\d+\s*[.．、]\s*\S/;
const ANALYSIS_RE =
  /^【\s*(?:分析|解析|详解|解答|解题思路|思路点拨|点睛)\s*】\s*[：:]?/;
const KNOWLEDGE_NOISE_RE =
  /false|解题的关键|解题关键|熟练掌握|本题考查|此题考查|理解题意|以上知识点|是解题|的关键$/;
const KNOWLEDGE_LEADING_NOISE_RE =
  /^(?:熟练|准确|灵活|掌握|理解|记住|学会|培养|体会|结合|利用|通过|根据|再|先|然后|最后|进而|求出|求得|推导|计算|判断)/;
const MAX_KNOWLEDGE_POINTS = 24;
const MAX_PROBLEM_TYPES = 20;
const MAX_EXAMPLES = 12;
const MAX_SOLUTION_HINTS = 10;

const LESSON_ENRICHMENT_PLACEHOLDER_RE =
  /缺少[^，。；\n]{0,8}(?:知识点|题型|例题|题目)|无法(?:生成|确定|提取|识别)|信息不足|未提供.{0,8}(?:知识点|题型|例题)/;

function normalizeTexts(texts) {
  return Array.from(texts || [], (text) =>
    String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).filter(Boolean);
}

function sectionTexts(texts, startHeading, endHeading) {
  const startIndex = texts.indexOf(startHeading);
  if (startIndex < 0) return [];
  const endIndex = endHeading ? texts.indexOf(endHeading) : -1;
  return texts.slice(
    startIndex + 1,
    endIndex > startIndex ? endIndex : texts.length,
  );
}

function lessonBodyTexts(texts) {
  const body = sectionTexts(texts, "知识典例", "翻转总结");
  if (body.length > 0) return body;
  return sectionTexts(texts, "趣味导入", "翻转总结");
}

function cleanKnowledgeCandidate(raw) {
  let candidate = String(raw || "").trim();
  const studyTarget = /的理解(?:和掌握)?$|的掌握$|的运用$|的应用$/;
  if (studyTarget.test(candidate)) {
    candidate = candidate.replace(studyTarget, "").replace(/^对/, "");
  }
  return candidate
    .replace(/等知识点?$|等知识$/, "")
    .replace(/[。．.]+$/, "")
    .trim();
}

function extractKnowledgePointsFromAnalysis(texts) {
  const points = [];
  const seen = new Set();
  for (const text of texts) {
    for (const match of text.matchAll(
      /(?:本题|此题|该题|本小题)?(?:主要)?考查(?:了|的是|到|的)?([^。．；;：:！!？?]{2,120})/g,
    )) {
      for (const raw of String(match[1] || "").split(/[、，,；;]/)) {
        const candidate = cleanKnowledgeCandidate(raw);
        if (candidate.length < 3 || candidate.length > 24) continue;
        if (
          KNOWLEDGE_LEADING_NOISE_RE.test(candidate) ||
          KNOWLEDGE_NOISE_RE.test(candidate)
        )
          continue;
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        points.push(candidate);
        if (points.length >= MAX_KNOWLEDGE_POINTS) return points;
      }
    }
  }
  return points;
}

function collectSolutionHints(texts) {
  const hints = [];
  const seen = new Set();
  const orderedTexts = [
    ...texts.filter((text) => /^【\s*(?:分析|点睛|思路点拨)\s*】/.test(text)),
    ...texts,
  ];
  for (const text of orderedTexts) {
    const matched = text.match(ANALYSIS_RE);
    if (!matched) continue;
    const sentence = text
      .slice(matched[0].length)
      .replace(/^解\s*[：:]/, "")
      .split(/[。；;]/)[0]
      .trim()
      .slice(0, 120);
    if (sentence.length < 6 || LESSON_ENRICHMENT_PLACEHOLDER_RE.test(sentence))
      continue;
    const key = sentence.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push(sentence);
    if (hints.length >= MAX_SOLUTION_HINTS) break;
  }
  return hints;
}

function collectLessonEnrichmentContext(
  texts,
  lessonName,
  selectedProblemTypes = [],
) {
  const normalizedTexts = normalizeTexts(texts);
  const bodyTexts = lessonBodyTexts(normalizedTexts);

  const knowledgePoints = normalizedTexts
    .filter((text) => KNOWLEDGE_POINT_RE.test(text))
    .slice(0, MAX_KNOWLEDGE_POINTS);
  const detectedProblemTypes = normalizedTexts
    .filter((text) => PROBLEM_TYPE_RE.test(text))
    .slice(0, MAX_PROBLEM_TYPES);
  const explicitExamples = normalizedTexts
    .filter((text) => EXAMPLE_RE.test(text))
    .map((text) => text.slice(0, 180))
    .slice(0, MAX_EXAMPLES);
  const questionDigests = bodyTexts
    .filter((text) => NUMBERED_QUESTION_RE.test(text) && !EXAMPLE_RE.test(text))
    .map((text) => text.slice(0, 180))
    .slice(0, MAX_EXAMPLES);
  const examples =
    explicitExamples.length > 0 ? explicitExamples : questionDigests;

  return {
    lessonName: String(lessonName || "").trim(),
    knowledgePoints:
      knowledgePoints.length > 0
        ? knowledgePoints
        : extractKnowledgePointsFromAnalysis(bodyTexts),
    problemTypes:
      selectedProblemTypes.length > 0
        ? selectedProblemTypes
        : detectedProblemTypes,
    examples,
    questionDigests,
    solutionHints: collectSolutionHints(bodyTexts),
  };
}

function buildLessonEnrichmentPrompt(context) {
  const {
    lessonName,
    knowledgePoints,
    problemTypes,
    examples,
    questionDigests,
    solutionHints,
  } = context;
  return (
    "请根据下面这份数学教案的真实内容，为教师备课生成教学补充内容。\n\n" +
    `课程主题：${lessonName || "未命名课程"}\n` +
    `知识点：${JSON.stringify(knowledgePoints)}\n` +
    `本次选用题型：${JSON.stringify(problemTypes)}\n` +
    `例题摘要：${JSON.stringify(examples)}\n` +
    `题目摘录：${JSON.stringify(questionDigests)}\n` +
    `解题要点：${JSON.stringify(solutionHints)}\n\n` +
    "要求：\n" +
    "1. 优先围绕“本次选用题型”和“题目摘录”生成内容；教学目标恰好3条，每条包含明确的知识理解、规范操作或数学思想，避免空泛口号。\n" +
    "2. 教学重点1条，教学难点1条；必须紧扣本教案出现的知识点和易错点。\n" +
    "3. 趣味导入2至3段，适合教师开场直接讲述；从现实情境或数学悬念切入，最后自然提出本课核心问题，不虚构统计数据。\n" +
    "4. 翻转总结恰好3条，每条80至150字，内容具体且适合课堂末尾直接回顾：第一条以“核心结论：”开头，串联本课定义、成立条件、关键公式及其含义；第二条以“操作流程：”开头，用“先…再…最后…”说明解题判断、计算和检验步骤；第三条以“易错提醒：”开头，至少指出2个典型错误，解释原因并给出检查或纠正方法。必须结合本教案的真实知识点、题型和例题，不写“认真审题”等空泛表述。\n" +
    "5. 当“知识点”或“本次选用题型”为空、或与题目不一致时，必须依据“题目摘录”和“解题要点”自行归纳本课真实的知识点、题型和易错点；严禁输出“缺少知识点、题型和例题摘要”“无法生成”“无法确定”“信息不足”等占位内容，也不要向用户索要材料。\n" +
    "6. 不使用Markdown标记，不输出标题。\n" +
    "7. 所有数学公式必须使用单个美元符号包裹的LaTeX，例如 $a^2+b^2=c^2$、$\\frac{x}{y}$；不要把公式写成无定界符的纯文本。\n\n" +
    '只输出JSON对象：{"goals":["目标1","目标2","目标3"],"key_point":"教学重点","difficulty":"教学难点","fun_intro":["导入段落1","导入段落2"],"summary":["总结1","总结2","总结3"]}'
  );
}

function validateLessonEnrichmentContent(parsed) {
  const requiredLists = [
    ["goals", 3, 3],
    ["fun_intro", 2, 3],
    ["summary", 3, 3],
  ];
  requiredLists.forEach(([key, minimum, maximum]) => {
    if (
      !Array.isArray(parsed?.[key]) ||
      parsed[key].length < minimum ||
      parsed[key].length > maximum
    ) {
      throw new Error(`AI 返回的 ${key} 数量不正确`);
    }
  });
  if (
    !String(parsed?.key_point || "").trim() ||
    !String(parsed?.difficulty || "").trim()
  ) {
    throw new Error("AI 返回内容缺少教学重点或教学难点");
  }
  const textValues = [
    parsed.key_point,
    parsed.difficulty,
    ...parsed.goals,
    ...parsed.fun_intro,
    ...parsed.summary,
  ];
  if (
    textValues.some((value) =>
      LESSON_ENRICHMENT_PLACEHOLDER_RE.test(String(value || "")),
    )
  ) {
    throw new Error("AI 返回了“缺少知识点”之类的占位内容");
  }
  return parsed;
}

module.exports = {
  LESSON_ENRICHMENT_PLACEHOLDER_RE,
  collectLessonEnrichmentContext,
  buildLessonEnrichmentPrompt,
  validateLessonEnrichmentContent,
};
