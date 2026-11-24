const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
};
function features(text, names) {
  let value = String(text || "");
  for (const name of names.filter(Boolean))
    value = value.split(name).join("学员");
  value = value
    .replace(/【[^】]+同学[^】]*】/g, "【课后反馈】")
    .replace(/\d+(?:[./年-]\d+)*(?:月|日|分)?/g, "#");
  return {
    length: value.replace(/\s/g, "").length,
    formal: /家长您好|家长，您好|家长，?你好[！!。]/.test(value),
    warm: /家长好[～~]|家长您好[～~]/.test(value),
    firstPerson: /我(?:这边|会|建议|观察|们|来)/.test(value),
    numbering: /^\s*\d+[.．]/m.test(text) ? "dot" : "chinese",
    averageSentence: median(
      value
        .split(/[。！？\n]/)
        .map((s) => s.trim().length)
        .filter((n) => n >= 8),
    ),
    signal: value,
  };
}
export function learnFeedbackStyle(data, original, edited) {
  if (!original || original.trim() === edited.trim()) return data;
  const names = (data.students || []).map((s) => s.name);
  const before = features(original, names),
    after = features(edited, names);
  const lengthChange =
    Math.abs(after.length - before.length) > Math.max(35, before.length * 0.15);
  if (
    !lengthChange &&
    before.formal === after.formal &&
    before.warm === after.warm &&
    before.firstPerson === after.firstPerson &&
    before.numbering === after.numbering
  )
    return data;
  const phrases = [
    "建议孩子",
    "继续加油",
    "亲爱的家长",
    "宝贝",
    "我这边",
    "整体表现不错",
  ];
  const removed = phrases.filter(
    (p) => original.includes(p) && !edited.includes(p),
  );
  const sample = {
    length: after.length,
    sentenceLength: after.averageSentence,
    formal: after.formal,
    warm: after.warm,
    firstPerson: after.firstPerson,
    numbering: after.numbering,
    removed,
  };
  const samples = [...(data.feedbackStyle?.samples || []), sample].slice(-12);
  const count = (key) => samples.filter((s) => s[key]).length;
  return {
    ...data,
    feedbackStyle: {
      samples,
      learnedCount: (data.feedbackStyle?.learnedCount || 0) + 1,
      targetLength: median(samples.map((s) => s.length)),
      sentenceLength: median(samples.map((s) => s.sentenceLength)),
      tone:
        count("formal") > samples.length / 2
          ? "formal"
          : count("warm") > samples.length / 2
            ? "warm"
            : "natural",
      firstPerson: count("firstPerson") >= samples.length / 2,
      numbering:
        samples.filter((s) => s.numbering === "dot").length > samples.length / 2
          ? "dot"
          : "chinese",
      avoidPhrases: phrases.filter(
        (p) => samples.filter((s) => s.removed.includes(p)).length >= 2,
      ),
      updatedAt: new Date().toISOString(),
    },
  };
}
export function feedbackStylePrompt(style) {
  if (!style?.learnedCount) return "";
  return `教师已保存反馈的表达偏好（仅影响写法，不是学生事实）：倾向${style.tone === "formal" ? "礼貌正式" : style.tone === "warm" ? "自然亲切" : "自然直接"}的语气；${style.firstPerson ? "使用教师第一人称" : "减少多余的自述"}；全文长度参考约${Math.max(160, Math.min(style.targetLength, 3500))}字，${style.sentenceLength < 35 ? "句子简洁，避免长段堆砌" : "分点解释具体，保持连贯"}。${style.avoidPhrases?.length ? "尽量避免习惯用语：" + style.avoidPhrases.join("、") + "。" : ""}表达偏好不能改变事实、补造表现或突破本次授课范围；资料不足时不凑优缺点条数。`;
}
