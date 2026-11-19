// Renderer-side browsing policy. The desktop service independently resolves
// symlinks and enforces the actual filesystem boundary before each operation.
export function normalizePath(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const input = value.trim().replace(/\\/g, "/");
  const absolute = input.startsWith("/") || /^[a-z]:\//i.test(input);
  if (!absolute) return "";
  const parts = [];
  for (const part of input.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && !/^[a-z]:$/i.test(parts.at(-1))) parts.pop();
    } else parts.push(part);
  }
  const normalized = (input.startsWith("/") ? "/" : "") + parts.join("/");
  return normalized || "/";
}
export function isWithinRoot(file, root) {
  const target = normalizePath(file),
    base = normalizePath(root);
  return (
    !!target &&
    !!base &&
    (target === base || target.startsWith(base === "/" ? "/" : base + "/"))
  );
}
export function studentDirectoryState(student, root) {
  if (!root) return "unconfigured";
  if (!isWithinRoot(student?.directoryPath, root)) return "outside";
  return student?.missing ? "missing" : "available";
}
