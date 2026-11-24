const CATEGORY_HEADING_RE =
  /^(?:#{1,6}\s*)?(?:\*{1,2}\s*)?(?:【\s*(?:题型|类型|模型)\s*\d+[^】]*】|考点\s*[一二三四五六七八九十百千万\d]+(?:\s|　|$).*)/;
const QUESTION_START_RE =
  /^(?:【\s*(?:例|例题|典例|变式|变形|练习|题组)\s*\d+(?:\s*[-－—–.]\s*\d+)*[^】]*】|(?:例|例题|典例|变式|变形|练习|题组)\s*\d+(?:\s*[-－—–.]\s*\d+)*|\d+\s*[.．、]\s*)/;
const ANSWER_MARKER_RE =
  /^(?:【?\s*(?:参考答案|答案|解析|解答过程|解答|详解|解题思路|思路点拨)\s*】?|(?:参考答案|答案|解析|解答过程|解答|详解|解题思路|思路点拨))\s*[：:]?/;

function isLessonQuestionCategoryHeading(text) {
  return CATEGORY_HEADING_RE.test(String(text || "").trim());
}

function buildLessonQuestionPlanFromTexts(texts) {
  const normalizedTexts = Array.from(texts || [], (text) =>
    String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const typeIndexes = normalizedTexts
    .map((text, index) => (isLessonQuestionCategoryHeading(text) ? index : -1))
    .filter((index) => index >= 0);

  if (typeIndexes.length === 0) return { categories: [], originalTotal: 0 };

  const practiceIndex = normalizedTexts.findIndex(
    (text) => text === "随堂练习",
  );
  const categoryCount = typeIndexes.length;
  const defaults =
    categoryCount <= 1
      ? { keep: 8, practice: 3 }
      : categoryCount === 2
        ? { keep: 6, practice: 2 }
        : categoryCount === 3
          ? { keep: 4, practice: 1 }
          : { keep: 3, practice: 1 };

  const categories = typeIndexes.map((typeIndex, position) => {
    const nextTypeIndex = typeIndexes[position + 1];
    const typeEnd =
      nextTypeIndex ??
      (practiceIndex > typeIndex ? practiceIndex : normalizedTexts.length);
    const questionIndexes = normalizedTexts
      .slice(typeIndex + 1, typeEnd)
      .map((text, index) =>
        QUESTION_START_RE.test(text) ? typeIndex + 1 + index : -1,
      )
      .filter((index) => index >= 0);
    const questionCount = questionIndexes.filter(
      (questionIndex, questionPosition) => {
        const questionEnd = questionIndexes[questionPosition + 1] ?? typeEnd;
        return normalizedTexts
          .slice(questionIndex + 1, questionEnd)
          .some((text) => ANSWER_MARKER_RE.test(text));
      },
    ).length;
    const practice = Math.min(
      defaults.practice,
      Math.max(0, questionCount - 1),
    );
    const keep = Math.min(defaults.keep, questionCount - practice);
    return {
      label: normalizedTexts[typeIndex],
      available: questionCount,
      selected: true,
      keep,
      practice,
    };
  });

  return {
    categories,
    originalTotal: categories.reduce(
      (total, item) => total + item.available,
      0,
    ),
  };
}

module.exports = {
  isLessonQuestionCategoryHeading,
  buildLessonQuestionPlanFromTexts,
};
