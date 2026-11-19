import { parseJSONResult, validateQuestions, id } from "./domain.js";
import { services, join, fromBase64 } from "./services.js";
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
export async function renderPDF(file, onPage, checkCancel) {
  const { base64 } = await services.pdf(file);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  const loadingTask = pdfjs.getDocument({
    data: fromBase64(base64),
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      checkCancel();
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise;
      await onPage(
        canvas.toDataURL("image/jpeg", 0.88),
        p,
        doc.numPages,
        canvas,
      );
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
}
export async function importBank({ form, progress, checkCancel, request }) {
  const pages = [],
    answerPages = [];
  const directory = join(form.root, form.name + "_" + id().slice(0, 8));
  const process = async (file, isAnswer) =>
    renderPDF(
      file,
      async (image, page, total, canvas) => {
        checkCancel();
        progress(
          `${isAnswer ? "解析版" : "原试题"}：识别第 ${page}/${total} 页`,
        );
        const imagePath = join(
          directory,
          "images",
          `${isAnswer ? "answer" : "paper"}-${page}.jpg`,
        );
        await services.writeBytes(imagePath, image.split(",")[1]);
        request.current = id();
        const r = await services.ai({
          id: request.current,
          qwen: true,
          vision: true,
          json: true,
          images: [image],
          task: `准确提取这一页${isAnswer ? "解析版中的题号、答案和解析" : "试题中的题目"}。仅输出 JSON 数组，每题含 number,stem,options(数组),answer,explanation,continuesPrevious(是否接续上一页题干),uncertain(识别有疑问),figures(题目图形在页面上的归一化矩形数组 [x,y,width,height]，0到1，无图则空数组)。不要编造未知答案；有无法辨认的部分标记待确认。保留数学公式为 LaTeX。当前页 ${page}。`,
        });
        const parsed = parseJSONResult(r.text);
        if (!Array.isArray(parsed)) throw Error(`第 ${page} 页输出不是数组`);
        const questions = [];
        for (const q of parsed) {
          const images = [];
          if (!isAnswer) {
            for (const [index, box] of (q.figures || []).entries()) {
              if (
                !Array.isArray(box) ||
                box.length !== 4 ||
                box.some((v) => !Number.isFinite(v) || v < 0 || v > 1) ||
                box[2] <= 0 ||
                box[3] <= 0 ||
                box[0] + box[2] > 1.01 ||
                box[1] + box[3] > 1.01
              )
                continue;
              const crop = document.createElement("canvas");
              crop.width = Math.ceil(box[2] * canvas.width);
              crop.height = Math.ceil(box[3] * canvas.height);
              crop
                .getContext("2d")
                .drawImage(
                  canvas,
                  box[0] * canvas.width,
                  box[1] * canvas.height,
                  crop.width,
                  crop.height,
                  0,
                  0,
                  crop.width,
                  crop.height,
                );
              const imageFile = join(
                directory,
                "images",
                `q-${page}-${id()}-${index}.png`,
              );
              await services.writeBytes(
                imageFile,
                crop.toDataURL("image/png").split(",")[1],
              );
              images.push(imageFile);
            }
          }
          questions.push({
            ...q,
            id: id(),
            images,
            page,
            sourceImage: imagePath,
          });
        }
        (isAnswer ? answerPages : pages).push({ questions });
      },
      checkCancel,
    );
  await process(form.original, false);
  if (form.mode === "paired") await process(form.answer, true);
  checkCancel();
  progress("合并跨页题目与配对答案");
  let questions = mergeFragments(pages);
  if (form.mode === "paired")
    questions = pairAnswers(questions, mergeFragments(answerPages));
  questions = validateQuestions(questions);
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
    questions.map((q) => ({
      ...q,
      category: tags.find((t) => t.id === q.id).category,
      tags: tags.find((t) => t.id === q.id).tags,
      difficulty: tags.find((t) => t.id === q.id).difficulty,
    })),
  );
  checkCancel();
  progress("保存本地题库与图片资源");
  const bank = {
    id: id(),
    name: form.name,
    createdAt: new Date().toISOString(),
    questions,
    source: { original: form.original, answer: form.answer || null },
    path: join(directory, "questions.json"),
  };
  await services.writeJSON(bank.path, bank, false);
  return bank;
}
