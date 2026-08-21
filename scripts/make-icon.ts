/**
 * bun run scripts/make-icon.ts
 *
 * Writes a 1024x1024 source PNG for `tauri icon` to slice up. Hand-rolled
 * encoder so the project keeps zero image dependencies — a rounded dark tile
 * with the Voltage bolt in --gain.
 */

import { deflateSync } from "node:zlib";

const SIZE = 1024;
const RADIUS = 184;

/* ── PNG encoding ────────────────────────────────────────────────── */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

/* ── drawing ─────────────────────────────────────────────────────── */

type Point = [number, number];

/** The same bolt as the page eyebrow, in its original 12x12 box. */
const BOLT: Point[] = [
  [6.8, 1], [2.4, 6.9], [5.3, 6.9], [4.9, 11], [9.5, 4.9], [6.4, 4.9],
];
const SCALE = SIZE / 12;
const bolt: Point[] = BOLT.map(([x, y]) => [x * SCALE, y * SCALE]);

function inPolygon(px: number, py: number, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

/** Distance outside a rounded rect; <= 0 means inside. */
function roundedRect(px: number, py: number): number {
  const cx = Math.abs(px - SIZE / 2) - (SIZE / 2 - RADIUS);
  const cy = Math.abs(py - SIZE / 2) - (SIZE / 2 - RADIUS);
  const dx = Math.max(cx, 0);
  const dy = Math.max(cy, 0);
  return Math.hypot(dx, dy) - RADIUS + Math.min(Math.max(cx, cy), 0) * 0;
}

const px = new Uint8Array(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE;
  // Vertical tile gradient, roughly the wallpaper's dark floor.
  const bg: [number, number, number] = [
    Math.round(27 - 14 * t),
    Math.round(32 - 16 * t),
    Math.round(48 - 24 * t),
  ];

  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;

    // Antialias the tile edge over one pixel.
    const d = roundedRect(x + 0.5, y + 0.5);
    const cover = Math.min(1, Math.max(0, 0.5 - d));
    if (cover <= 0) continue;

    let r = bg[0];
    let g = bg[1];
    let b = bg[2];

    // 2x2 supersample of the bolt so its diagonals stay clean.
    let lit = 0;
    for (const oy of [0.25, 0.75]) {
      for (const ox of [0.25, 0.75]) {
        if (inPolygon(x + ox, y + oy, bolt)) lit++;
      }
    }
    if (lit > 0) {
      const a = lit / 4;
      r = Math.round(r * (1 - a) + 0x9e * a);
      g = Math.round(g * (1 - a) + 0xf0 * a);
      b = Math.round(b * (1 - a) + 0x1a * a);
    }

    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = Math.round(255 * cover);
  }
}

const out = "scripts/icon-source.png";
await Bun.write(out, encodePng(px, SIZE, SIZE));
console.log(`Wrote ${out} (${SIZE}x${SIZE}).`);
