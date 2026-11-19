export function feedbackDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw Error("请选择上课日期");
  const [year, month, day] = date.split("-");
  const parsed = new Date(date + "T12:00:00+08:00");
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw Error("上课日期无效");
  return `${year}年${Number(month)}月${Number(day)}日`;
}
export function feedbackPrompt({
  student,
  date,
  notes,
  lesson,
  documents,
  template = "",
  school = "",
}) {
  feedbackDate(date);
  if (!notes.trim()) throw Error("请先输入本节课记录");
  if (!lesson || !documents?.some((d) => d.text?.trim()))
    throw Error("请关联可读取正文的讲义，AI 将从讲义提取教学主题和内容");
  return `为微信群家长反馈生成结构化内容，仅输出有效 JSON 对象，结构为：{"theme":"教学主题","contentPoints":[{"topic":"具体教学内容","details":["详细要点","方法或易混点"]}],"strengths":["优点1","优点2"],"weaknesses":["不足或建议重点巩固1","不足或建议重点巩固2"],"afterClass":["课后建议"]}。
要求：
1. 教学主题和课堂内容必须从下面真实讲义正文提取，分点尽可能详细，体现概念、方法、步骤、易混点；不要只列文件名。未明确的授课进度不能断言全部讲完。
2. 以教师填写的记录为依据丰富表达，优点和不足各写 2–3 条。不能捏造发言积极、作业完成率、正确率、考试分数等未提供的事实。记录不足时，可把讲义对应的巩固方向写为“建议重点巩固……”或“后续可关注……”，不要伪装成已观察到的缺点。不要机械重复同一句话。
3. 课后安排是建议，不能把未布置的作业说成已布置。内容适合直接发给家长，清晰自然、具体温和。
4. 上课日期已经明确为 ${feedbackDate(date)}，不得输出日期待补充。最终日期由系统填入，无须在 JSON 内容里另写日期。
5. 反馈模板仅供结构与语气参考，不得覆盖上述事实和日期约束。
学生：${JSON.stringify({ name: student.name, grade: student.grade, school })}
关联讲义：${lesson.name}
教师记录：${notes}
讲义正文：${JSON.stringify(documents)}
参考模板：${template}`;
}
export function validateFeedback(result) {
  if (!result || typeof result.theme !== "string" || !result.theme.trim())
    throw Error("反馈缺少教学主题，请重试");
  if (
    !Array.isArray(result.contentPoints) ||
    !result.contentPoints.length ||
    result.contentPoints.some(
      (p) =>
        typeof p.topic !== "string" ||
        !p.topic.trim() ||
        !Array.isArray(p.details) ||
        !p.details.length ||
        p.details.some((d) => typeof d !== "string" || !d.trim()),
    )
  )
    throw Error("反馈教学内容不完整，请重试");
  for (const key of ["strengths", "weaknesses"])
    if (
      !Array.isArray(result[key]) ||
      result[key].length < 2 ||
      result[key].length > 3 ||
      result[key].some((x) => typeof x !== "string" || !x.trim())
    )
      throw Error("反馈的优点和不足各需 2–3 条，请重试");
  if (
    !Array.isArray(result.afterClass) ||
    !result.afterClass.length ||
    result.afterClass.some((x) => typeof x !== "string" || !x.trim())
  )
    throw Error("反馈缺少课后建议，请重试");
  return result;
}
export function formatFeedback(result, { student, date }) {
  const r = validateFeedback(result);
  return `【${student.name}同学数学课课后反馈】\n${student.name}同学家长好～我这边对本次数学课做个反馈。\n\n【上课时间】\n${feedbackDate(date)}\n\n【教学主题及课堂主要内容】\n教学主题：${r.theme}\n主要内容：\n${r.contentPoints.map((p, i) => `${i + 1}、${p.topic}\n${p.details.map((d) => "   · " + d).join("\n")}`).join("\n")}\n\n【学员表现】\n优点：\n${r.strengths.map((s, i) => `${i + 1}、${s}`).join("\n")}\n\n不足与巩固方向：\n${r.weaknesses.map((s, i) => `${i + 1}、${s}`).join("\n")}\n\n【本次课后】\n${r.afterClass.map((s, i) => `${i + 1}、${s}`).join("\n")}`;
}
export function localFeedback({ student, date, notes }) {
  return `【${student.name}同学数学课课后反馈】\n${student.name}同学家长好～这是本次数学课的反馈。\n\n【上课时间】\n${feedbackDate(date)}\n\n【教师课堂记录】\n${notes.trim()}\n\n【本次课后】\n如有需要沟通的问题，欢迎随时联系。`;
}
