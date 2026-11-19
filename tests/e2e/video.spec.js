import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DiskStorage, run } = require("../../desktop/core.cjs");
test("真实本地视频播放、进度续播、笔记与观看历史持久化", async ({page:generator}) => {
  test.setTimeout(60000);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-video-e2e-"));
  const profile = path.join(tmp, "profile"),
    root = path.join(tmp, "视频");
  await fs.mkdir(root);
  const file = path.join(root, "函数入门.webm");
  await generator.goto('/');
  const base64=await generator.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#243852';ctx.fillRect(0,0,320,180);const stream=canvas.captureStream(10);const chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const complete=new Promise(resolve=>recorder.onstop=resolve);recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();let frame=0;const timer=setInterval(()=>{ctx.fillStyle='#243852';ctx.fillRect(0,0,320,180);ctx.fillStyle='#a4bfe5';ctx.fillText(String(frame++),20,30);},100);await new Promise(resolve=>setTimeout(resolve,11000));recorder.stop();clearInterval(timer);await complete;stream.getTracks().forEach(t=>t.stop());const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());let value='';for(const b of bytes)value+=String.fromCharCode(b);return btoa(value);
  });
  await fs.writeFile(file,Buffer.from(base64,'base64'));
  const store = await new DiskStorage(
    path.join(profile, "workspace.json"),
  ).init();
  await store.set("sm_path_config_v1", { videosRoot: root });
  let app;
  try {
    const launch = () =>
      electron.launch({
        args: ["."],
        cwd: process.cwd(),
        env: { ...process.env, TEACHING_DEV: "", TEACHING_DATA_DIR: profile },
      });
    app = await launch();
    const page = await app.firstWindow();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "教学视频" })
      .click();
    await page.getByRole("button", { name: /函数入门.webm/ }).click();
    await expect
      .poll(() => page.locator("video").evaluate((v) => v.readyState))
      .toBeGreaterThan(0);
    await page.locator("video").evaluate(async (v) => {
      v.currentTime = 7;
      await v.play();
      v.pause();
    });
    await page.getByRole("tab", { name: "视频笔记" }).click();
    await page.getByLabel("Markdown 正文").fill("函数讲解：先建立变量关系。");
    await page.getByRole("button", { name: "保存笔记", exact: true }).click();
    await expect(
      page.getByText("视频笔记已保存", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "学生管理" })
      .click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "教学视频" })
      .click();
    await expect
      .poll(() => page.locator("video").evaluate((v) => v.currentTime))
      .toBeGreaterThan(6);
    await expect(page.getByLabel("Markdown 正文")).toHaveValue(
      "函数讲解：先建立变量关系。",
    );
    await page.getByRole("tab", { name: "观看历史" }).click();
    await expect(page.locator(".history-row")).toHaveCount(1);
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await expect
      .poll(() => restored.locator("video").evaluate((v) => v.currentTime))
      .toBeGreaterThan(6);
    const saved = JSON.parse(
      await fs.readFile(path.join(profile, "workspace.json"), "utf8"),
    ).sm_workspace_v1;
    expect(saved.videoHistory).toHaveLength(1);
    expect(saved.videoHistory[0].time).toBeGreaterThan(6);
    expect(saved.videoNotes[file]).toContain("变量关系");
  } finally {
    if (app) await app.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
