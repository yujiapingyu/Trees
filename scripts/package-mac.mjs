import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { packager } from "@electron/packager";

if (process.platform !== "darwin") throw Error("请在 macOS 上构建 Mac 应用");
const root = path.resolve(import.meta.dirname, "..");
const electronVersion = JSON.parse(
  await fs.readFile(
    path.join(root, "node_modules/electron/package.json"),
    "utf8",
  ),
).version;
// Reuse the exact installed runtime from the local cache before downloading.
const archiveName = `electron-v${electronVersion}-darwin-${process.arch}.zip`;
let electronZipDir;
const cacheRoot =
  process.env.ELECTRON_CACHE ||
  path.join(os.homedir(), "Library/Caches/electron");
const cacheEntries = await fs
  .readdir(cacheRoot, { withFileTypes: true })
  .catch(() => []);
for (const directory of [
  cacheRoot,
  ...cacheEntries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(cacheRoot, e.name)),
]) {
  try {
    await fs.access(path.join(directory, archiveName));
    electronZipDir = directory;
    break;
  } catch {}
}
const allowed = new Set([
  "dist",
  "desktop",
  "assets",
  "node_modules",
  "package.json",
  "src",
]);
// Sign outside Documents/iCloud: file providers may attach FinderInfo to .app
// folders there, which interferes with strict signing validation.
const buildRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-build-"));
try {
  const output = await packager({
    dir: root,
    name: "知序",
    appBundleId: "com.zhixu.teachingworkspace",
    appCategoryType: "public.app-category.education",
    executableName: "知序",
    platform: "darwin",
    arch: process.arch,
    electronVersion,
    ...(electronZipDir ? { electronZipDir } : {}),
    icon: path.join(root, "assets/icon.icns"),
    out: buildRoot,
    overwrite: true,
    asar: true,
    prune: true,
    ignore: (relative) => {
      const parts = relative.replace(/^[/\\]+/, "").split(/[/\\]/);
      if (!parts[0]) return false;
      if (!allowed.has(parts[0])) return true;
      if (parts[0] === "src")
        return (
          parts.length > 1 &&
          (parts[1] !== "shared" ||
            (parts.length > 2 && parts[2] !== "configKeys.json"))
        );
      return false;
    },
  });
  const signed = path.join(output[0], "知序.app");
  // Local builds use an ad-hoc signature; no certificate or system security changes.
  await promisify(execFile)("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    signed,
  ]);
  await promisify(execFile)("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    signed,
  ]);
  const published = path.join(root, "release", path.basename(output[0]));
  await fs.mkdir(path.dirname(published), { recursive: true });
  await fs.rm(published, { recursive: true, force: true });
  await fs.cp(output[0], published, {
    recursive: true,
    verbatimSymlinks: true,
  });
  const built = path.join(published, "知序.app");
  console.log(`已构建：${built}`);
  if (process.argv.includes("--install")) {
    const applications = path.join(os.homedir(), "Applications");
    const installed = path.join(applications, "知序.app");
    await fs.mkdir(applications, { recursive: true });
    // Preserve any previous installation, and never update a running app in place.
    const requireClosed = async () => {
      const { stdout } = await promisify(execFile)("/bin/ps", [
        "-axo",
        "comm=",
      ]);
      if (
        stdout.split("\n").includes(path.join(installed, "Contents/MacOS/知序"))
      )
        throw Error("请先保存内容，并从菜单退出已安装的知序，然后再次安装");
    };
    await requireClosed();
    const stage = `${installed}.install-${Date.now()}`;
    let backup = "";
    try {
      // Finish copying before moving the installed app, so a failed copy leaves it usable.
      await fs.cp(built, stage, { recursive: true, verbatimSymlinks: true });
      await promisify(execFile)("/usr/bin/codesign", [
        "--verify",
        "--deep",
        "--strict",
        stage,
      ]);
      await requireClosed();
      try {
        const candidate = `${installed}.backup-${Date.now()}`;
        await fs.rename(installed, candidate);
        backup = candidate;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        await fs.rename(stage, installed);
      } catch (error) {
        if (backup) await fs.rename(backup, installed);
        throw error;
      }
      if (backup) console.log(`旧应用已保留：${backup}`);
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
    console.log(`已安装：${installed}`);
  }
} finally {
  await fs.rm(buildRoot, { recursive: true, force: true });
}
