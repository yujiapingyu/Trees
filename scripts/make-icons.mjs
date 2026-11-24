import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const crc = (b) => {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type),
    n = Buffer.alloc(4),
    check = Buffer.alloc(4);
  n.writeUInt32BE(data.length);
  check.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([n, t, data, check]);
};
function inside(x, y, points) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a, b] = points[i],
      [c, d] = points[j];
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a) hit = !hit;
  }
  return hit;
}
function png(size, tray = false) {
  const rows = Buffer.alloc((size * 4 + 1) * size),
    header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const cap = [
      [180, 405],
      [512, 245],
      [844, 405],
      [512, 565],
    ],
    base = [
      [295, 490],
      [512, 595],
      [730, 490],
      [730, 625],
      [512, 740],
      [295, 625],
    ];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) * 1024) / size,
        py = ((y + 0.5) * 1024) / size;
      let color = [0, 0, 0, 0];
      if (!tray) {
        const dx = Math.max(210 - px, 0, px - 814),
          dy = Math.max(210 - py, 0, py - 814);
        if (
          px > 35 &&
          px < 989 &&
          py > 35 &&
          py < 989 &&
          dx * dx + dy * dy < 190 * 190
        )
          color = [37, 59, 83, 255];
      }
      if (
        inside(px, py, cap) ||
        inside(px, py, base) ||
        (px > 801 && px < 833 && py > 415 && py < 670)
      )
        color = tray ? [0, 0, 0, 255] : [172, 204, 255, 255];
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 4; c++) rows[offset + c] = color[c];
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
await fs.mkdir("assets", { recursive: true });
await fs.writeFile("assets/icon.png", png(1024));
await fs.writeFile("assets/trayTemplate.png", png(36, true));
if (process.platform === "darwin") {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zhixu-icon-"));
  try {
    const set = path.join(tmp, "App.iconset");
    await fs.mkdir(set);
    for (const size of [16, 32, 128, 256, 512])
      for (const scale of [1, 2]) {
        const output = path.join(
          set,
          `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
        );
        await exec("/usr/bin/sips", [
          "-z",
          String(size * scale),
          String(size * scale),
          "assets/icon.png",
          "--out",
          output,
        ]);
      }
    await exec("/usr/bin/iconutil", [
      "-c",
      "icns",
      set,
      "-o",
      path.resolve("assets/icon.icns"),
    ]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
console.log("App and menu-bar icons generated.");
