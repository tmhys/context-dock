// アプリのアイコン（PNG）を作る。node tools/make-icons.cjs
// 黒地に 2×2 のタイル。左上だけオレンジ（ウィジェットの見た目と同じ）。
"use strict";
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

function png(size) {
  const bg = [0x0a, 0x0a, 0x0b], tile = [0x2a, 0x2a, 0x2d], accent = [0xff, 0x6b, 0x1a];
  // maskable アイコンは外側 20% が切られることがあるので、中央 60% に描く
  const inner = size * 0.6, off = size * 0.2, gap = inner * 0.08;
  const t = (inner - gap) / 2, r = t * 0.28;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const o = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      let px = bg;
      for (let k = 0; k < 4; k++) {
        const bx = off + (k % 2) * (t + gap), by = off + Math.floor(k / 2) * (t + gap);
        const dx = Math.max(bx + r - x, 0, x - (bx + t - r)), dy = Math.max(by + r - y, 0, y - (by + t - r));
        if (x >= bx && x < bx + t && y >= by && y < by + t && dx * dx + dy * dy <= r * r) px = k === 0 ? accent : tile;
      }
      raw[o + 1 + x * 3] = px[0]; raw[o + 2 + x * 3] = px[1]; raw[o + 3 + x * 3] = px[2];
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

for (const s of [192, 512]) fs.writeFileSync(path.join(__dirname, "..", `icon-${s}.png`), png(s));
console.log("icon-192.png / icon-512.png");
