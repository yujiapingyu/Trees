import { services, fromBase64 } from "./services.js";
async function loadPDF(file) {
  const { base64 } = await services.pdf(file);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  return pdfjs.getDocument({
    data: fromBase64(base64),
    isEvalSupported: false,
  });
}
export async function extractDocumentText(file, checkCancel = () => {}) {
  checkCancel();
  if (!/\.pdf$/i.test(file)) {
    const text = await services.readText(file);
    checkCancel();
    if (!text.trim()) throw Error("文档未提取到文字，请检查正文内容");
    return text;
  }
  const task = await loadPDF(file);
  let doc;
  try {
    doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      checkCancel();
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (typeof item.str === "string")
          text += item.str + (item.hasEOL ? "\n" : " ");
      }
      pages.push(`【第 ${i} 页】\n${text}`);
      page.cleanup();
    }
    if (!pages.some((p) => p.replace(/【第 \d+ 页】/, "").trim()))
      throw Error(
        "PDF 没有可提取的文字层，请先进行 OCR 或改用文字版文件；本应用不再提供扫描图片识别",
      );
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}
export async function readLessonDocuments(lesson) {
  if (!lesson?.path || lesson.missing)
    throw Error("关联讲义路径不可用，请重新选择讲义");
  const entries = await services.list(lesson.path, true);
  const files = entries.filter(
    (f) =>
      !f.isDirectory &&
      /\.(docx?|txt|md|pdf)$/i.test(f.name) &&
      !/(历史|备份|\.bak)/.test(f.relativePath),
  );
  const plans = files.filter((f) => /教案/.test(f.name));
  const chosen = (
    plans.length ? plans : files.filter((f) => !/答案|解析|学案/.test(f.name))
  ).slice(0, 3);
  if (!chosen.length)
    throw Error(
      "关联讲义中没有可读取的教案或讲义正文，请添加 DOC、DOCX、PDF、TXT 或 Markdown 文件",
    );
  const documents = [];
  for (const f of chosen) {
    try {
      const text = await extractDocumentText(f.path);
      documents.push({
        name: f.name,
        path: f.path,
        text: text.slice(0, 60000),
        excerpt: text.length > 60000,
      });
    } catch (error) {
      throw Error(`讲义“${f.name}”读取失败：${error.message}`);
    }
  }
  return documents;
}
export async function renderPDF(file, onPage, checkCancel) {
  const loadingTask = await loadPDF(file);
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
