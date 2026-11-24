export const TEACHER_FIELDS = [
  ["name", "教师姓名", 50],
  ["displayName", "显示称呼", 50],
  ["subjects", "任教学科", 100],
  ["institution", "任教机构", 100],
  ["phone", "联系电话", 40],
  ["wechat", "微信号", 80],
  ["bio", "个人简介", 1000],
];
export function teacherProfile(value) {
  return Object.fromEntries(
    TEACHER_FIELDS.map(([key]) => [
      key,
      typeof value?.[key] === "string" ? value[key] : "",
    ]),
  );
}
export function teacherDisplayName(profile) {
  return profile?.displayName?.trim() || profile?.name?.trim() || "教师信息";
}
export function saveTeacherProfile(data, form) {
  const profile = {};
  for (const [key, label, limit] of TEACHER_FIELDS) {
    const value = form?.[key] ?? "";
    if (typeof value !== "string" || value.trim().length > limit)
      throw Error(label + `请控制在${limit}字以内`);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
      throw Error(label + "包含无效字符");
    profile[key] = value.trim();
  }
  return {
    ...data,
    teacherProfile: {
      ...(typeof data.teacherProfile === "object" &&
      !Array.isArray(data.teacherProfile)
        ? data.teacherProfile
        : {}),
      ...profile,
      updatedAt: new Date().toISOString(),
    },
  };
}
const realName = (value) =>
  typeof value === "string" &&
  value.trim() &&
  !/待确认|待填写|未记录|待补充|^_+$/.test(value)
    ? value.trim()
    : "";
export function defaultReportTeacher(student, data, prior) {
  return (
    realName(student.reportSettings?.teacher) ||
    realName(data.teacherProfile?.name) ||
    realName(data.teacherProfile?.displayName) ||
    realName(prior?.meta?.teacher) ||
    ""
  );
}
