import { parseJSONResult, validateQuestions, id } from "./domain.js";
import { services, join, basename } from "./services.js";
import { extractDocumentText } from "./documents.js";
export function mergeFragments(pages) {
  const out = [];
  for (const page of pages) {
    for (const q of page.questions) {
      const prior = out.at(-1);
      if (
        prior &&
        (q.continuesPrevious || (q.number && q.number === prior.number))
      ) {
        prior.stem += "\n" + (q.stem || "");
        prior.options = [
          ...(Array.isArray(prior.options)
            ? prior.options
            : prior.options
              ? [prior.options]
              : []),
          ...(Array.isArray(q.options)
            ? q.options
            : q.options
              ? [q.options]
              : []),
        ];
        prior.answer = q.answer || prior.answer;
        prior.explanation = [prior.explanation, q.explanation]
          .filter(Boolean)
          .join("\n");
        prior.images = [...(prior.images || []), ...(q.images || [])];
        prior.uncertain = prior.uncertain || q.uncertain;
      } else out.push({ ...q });
    }
  }
  return out;
}
export function pairAnswers(questions, answers) {
  return questions.map((q) => {
    const matches = answers.filter(
      (a) => String(a.number) === String(q.number),
    );
    const a = matches.length === 1 ? matches[0] : null;
    return {
      ...q,
      answer: a?.answer || q.answer || "",
      explanation: a?.explanation || q.explanation || "",
      uncertain: q.uncertain || matches.length !== 1 || !a?.answer,
    };
  });
}
export { renderPDF } from "./documents.js";
export async function importBank({ form, progress, checkCancel, request }) {
  const directory = join(form.root, form.name + "_" + id().slice(0, 8));
  const process = async (file, isAnswer) => {
    progress(isAnswer ? "读取解析版正文" : "读取原试题正文");
    const text = await extractDocumentText(file, checkCancel);
    checkCancel();
    if (text.length > 180000)
      throw Error("试卷正文过长，请拆分为较小文件再导入");
    progress(
      isAnswer ? "DeepSeek 提取题号、答案和解析" : "DeepSeek 提取试题正文",
    );
    request.current = id();
    const r = await services.ai({
      id: request.current,
      json: true,
      task: `从以下${isAnswer ? "解析版" : "原试题"}文字中提取实际题目，仅输出 JSON 数组，每项 number,stem,options（字符串数组）,answer,explanation,uncertain。保留题号和 LaTeX 公式。缺失答案留空，不要解题补造。涉及未提供图形的题目标记 uncertain=true，不得猜测图形。合并同一题的跨页文字。解析版也应保留对应题号，题干未知可写“解析版对应题目”。\n${text}`,
    });
    const parsed = parseJSONResult(r.text);
    if (!Array.isArray(parsed) || !parsed.length)
      throw Error("没有提取到题目，请检查文档编号或手工录入");
    return parsed;
  };
  const originals = await process(form.original, false),
    answers = form.mode === "paired" ? await process(form.answer, true) : [];
  checkCancel();
  progress("配对答案与校验题目");
  let questions = mergeFragments([{ questions: originals }]);
  if (form.mode === "paired") questions = pairAnswers(questions, answers);
  questions = validateQuestions(questions.map((q) => ({ ...q, id: id() })));
  progress("DeepSeek 分类、知识点与难度标注");
  request.current = id();
  const result = await services.ai({
    id: request.current,
    json: true,
    task:
      "为以下数学题标注类别、知识点 tags 数组和 difficulty（仅基础/中等/较难）。仅输出 JSON 数组，每项 id,category,tags,difficulty。保留全部题目 ID，不改写题干、不生成答案。\n" +
      JSON.stringify(questions.map((q) => ({ id: q.id, stem: q.stem }))),
  });
  const tags = parseJSONResult(result.text);
  if (
    !Array.isArray(tags) ||
    tags.length !== questions.length ||
    new Set(tags.map((t) => t.id)).size !== questions.length ||
    tags.some(
      (t) =>
        !questions.some((q) => q.id === t.id) ||
        !t.category ||
        !Array.isArray(t.tags) ||
        !t.difficulty,
    )
  )
    throw Error("分类结果结构不完整，未保存题库，请重试");
  questions = validateQuestions(
    questions.map((q) => {
      const tag = tags.find((t) => t.id === q.id);
      return {
        ...q,
        category: tag.category,
        tags: tag.tags,
        difficulty: tag.difficulty,
      };
    }),
  );
  checkCancel();
  progress("保存本地题库与原始文档");
  const savedOriginal = join(
    directory,
    "source",
    "original-" + basename(form.original),
  );
  await services.copy(form.original, savedOriginal);
  let savedAnswer = null;
  if (form.mode === "paired") {
    savedAnswer = join(directory, "source", "answer-" + basename(form.answer));
    await services.copy(form.answer, savedAnswer);
  }
  const bank = {
    id: id(),
    name: form.name,
    createdAt: new Date().toISOString(),
    questions: questions.map((q) => ({ ...q, sourceDocument: savedOriginal })),
    source: { original: savedOriginal, answer: savedAnswer },
    path: join(directory, "questions.json"),
  };
  await services.writeJSON(bank.path, bank, false);
  return bank;
}
