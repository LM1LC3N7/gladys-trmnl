// Generates cover.png (800x534) for gladys-trmnl: plain Node, no dependency.
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};

// Background: diagonal gradient, warm grey to slate.
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    set(x, y, [58 - 30 * t, 64 - 30 * t, 76 - 20 * t]);
  }
}
const white = [255, 255, 255];
const accent = [255, 132, 72];

const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
// Rounded rectangle, anti-aliased corners.
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x + 0.5, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y + 0.5, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const arc = (cx, cy, r, width, from, to, color) => {
  for (let y = Math.floor(cy - r - width); y <= cy + r + width; y += 1) {
    for (let x = Math.floor(cx - r - width); x <= cx + r + width; x += 1) {
      const ang = Math.atan2(y - cy, x - cx);
      if (ang < from || ang > to) continue;
      const a = Math.max(
        0,
        Math.min(1, width / 2 - Math.abs(Math.hypot(x - cx, y - cy) - r) + 0.5),
      );
      if (a > 0) set(x, y, color, a);
    }
  }
};

disc(400, 267, 260, white, 0.04);
const ink = [30, 30, 32];
const paper = [228, 226, 218];
const grey = [150, 148, 142];
// The display: a dark frame, the e-ink panel, a small stand.
box(150, 420, 650, 440, 10, [24, 24, 26], 0.5);
box(170, 90, 630, 420, 22, [36, 36, 40]);
box(190, 110, 610, 400, 6, paper);
const bar = (x, y, w, h, color) => box(x, y, x + w, y + h, 5, color);
// A calendar-like screen: a big time, lines of text, a small chart.
bar(220, 140, 170, 60, ink);
bar(220, 220, 240, 16, ink);
bar(220, 248, 200, 16, grey);
bar(220, 276, 220, 16, grey);
for (let i = 0; i < 7; i += 1) {
  const h = [40, 70, 55, 90, 60, 100, 75][i];
  bar(430 + i * 22, 370 - h, 14, h, ink);
}
bar(220, 330, 160, 40, grey);
// Battery icon on the panel.
box(520, 140, 576, 166, 4, ink);
box(576, 147, 582, 159, 2, ink);
box(524, 144, 556, 162, 2, paper);
// Wi-Fi arcs above the frame.
for (const r of [18, 34, 50]) {
  arc(660, 110, r, 7, -Math.PI * 0.8, -Math.PI * 0.2, accent);
}
disc(660, 110, 6, accent);
// Moon of the sleep mode.
disc(120, 120, 34, [250, 236, 190]);
disc(136, 108, 30, [52, 58, 70]);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
