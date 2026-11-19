// gta6-meme-x-01 — "Post a GTA 6 meme on X" (make.fun bounty).
//
// What this program does, in order:
//   1. Copies POST.json from the repository root to the output directory,
//      where the make.fun gate reads it (the entry itself is the X post
//      that POST.json names: its first picture plus its text).
//   2. Renders the meme picture itself — a 1024x1024 PNG drawn entirely
//      with this file's own tiny rasterizer and PNG encoder (Node standard
//      library only: node:fs, node:path, node:zlib). No network, no wall
//      clock, no randomness beyond a fixed-seed generator, so the two runs
//      the grader makes write byte-identical output.
//
// The meme: a Vice City sunset. You waited 13 years to visit Vice City;
// the make.fun ghost — white, black sparkle-star eyes, holding its magenta
// star coin — used its bounty money to buy the beach house first, planted
// a SOLD sign in the sand, and is holding up the keys.
//
// Outside the grader's container, MAKEFUN_BOT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /bot and /output:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(OUTPUT_DIR, { recursive: true });
try {
  copyFileSync(join(BOT_DIR, 'POST.json'), join(OUTPUT_DIR, 'POST.json'));
} catch (err) {
  console.error(`POST.json could not be copied from ${BOT_DIR}: ${(err as Error).message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Frame buffer. The scene is painted at 2x (2048x2048) and box-downsampled
// to 1024x1024 at the end, which anti-aliases every edge for free. All
// drawing functions below take design coordinates on a 1024x1024 canvas.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const SS = 2; // supersampling factor
const DW = 1024; // design width/height
const PW = DW * SS; // pixel width/height
const img = new Uint8ClampedArray(PW * PW * 3);

function setPx(px: number, py: number, c: RGB): void {
  if (px < 0 || py < 0 || px >= PW || py >= PW) return;
  const i = (py * PW + px) * 3;
  img[i] = c[0];
  img[i + 1] = c[1];
  img[i + 2] = c[2];
}

function blendPx(px: number, py: number, c: RGB, a: number): void {
  if (px < 0 || py < 0 || px >= PW || py >= PW || a <= 0) return;
  const i = (py * PW + px) * 3;
  img[i] = img[i] * (1 - a) + c[0] * a;
  img[i + 1] = img[i + 1] * (1 - a) + c[1] * a;
  img[i + 2] = img[i + 2] * (1 - a) + c[2] * a;
}

// Paint every pixel of a design-space bounding box whose centre satisfies
// fn; fn returns a colour, or null to leave the pixel alone. This is the
// one primitive every curved shape below is built from.
function paint(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fn: (x: number, y: number) => RGB | null,
): void {
  const px0 = Math.max(0, Math.floor(x0 * SS));
  const py0 = Math.max(0, Math.floor(y0 * SS));
  const px1 = Math.min(PW - 1, Math.ceil(x1 * SS));
  const py1 = Math.min(PW - 1, Math.ceil(y1 * SS));
  for (let py = py0; py <= py1; py++) {
    const y = (py + 0.5) / SS;
    for (let px = px0; px <= px1; px++) {
      const x = (px + 0.5) / SS;
      const c = fn(x, y);
      if (c !== null) setPx(px, py, c);
    }
  }
}

function paintBlend(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fn: (x: number, y: number) => { c: RGB; a: number } | null,
): void {
  const px0 = Math.max(0, Math.floor(x0 * SS));
  const py0 = Math.max(0, Math.floor(y0 * SS));
  const px1 = Math.min(PW - 1, Math.ceil(x1 * SS));
  const py1 = Math.min(PW - 1, Math.ceil(y1 * SS));
  for (let py = py0; py <= py1; py++) {
    const y = (py + 0.5) / SS;
    for (let px = px0; px <= px1; px++) {
      const x = (px + 0.5) / SS;
      const r = fn(x, y);
      if (r !== null) blendPx(px, py, r.c, r.a);
    }
  }
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  paint(x, y, x + w, y + h, (px, py) => (px >= x && px < x + w && py >= y && py < y + h ? c : null));
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  paint(cx - r, cy - r, cx + r, cy + r, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r ? c : null;
  });
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  paint(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1 ? c : null;
  });
}

function ring(cx: number, cy: number, r: number, halfWidth: number, c: RGB): void {
  paint(cx - r - halfWidth, cy - r - halfWidth, cx + r + halfWidth, cy + r + halfWidth, (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return Math.abs(d - r) <= halfWidth ? c : null;
  });
}

function fillPoly(pts: [number, number][], c: RGB): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  paint(x0, y0, x1, y1, (x, y) => {
    // Even-odd point-in-polygon.
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside ? c : null;
  });
}

function strokeSeg(xa: number, ya: number, xb: number, yb: number, halfWidth: number, c: RGB): void {
  const pad = halfWidth + 1;
  paint(
    Math.min(xa, xb) - pad,
    Math.min(ya, yb) - pad,
    Math.max(xa, xb) + pad,
    Math.max(ya, yb) + pad,
    (x, y) => {
      const dx = xb - xa;
      const dy = yb - ya;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((x - xa) * dx + (y - ya) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (xa + t * dx), y - (ya + t * dy));
      return d <= halfWidth ? c : null;
    },
  );
}

// Vertical gradient over a rectangle; stops are [at, colour] pairs, at in 0..1.
function vGrad(x: number, y: number, w: number, h: number, stops: [number, RGB][]): void {
  paint(x, y, x + w, y + h, (px, py) => {
    if (px < x || px >= x + w || py < y || py >= y + h) return null;
    const t = (py - y) / h;
    return gradAt(stops, t);
  });
}

function gradAt(stops: [number, RGB][], t: number): RGB {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// Fixed-seed PRNG (mulberry32): the scene's "random" details — lit windows,
// sea glitter, sand speckle — are identical on every run.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// PNG encoder. Downsamples the 2x buffer to 1024x1024, then writes a PNG
// with per-row adaptive filtering (the standard minimum-sum-of-absolute-
// differences heuristic over None/Sub/Up/Average/Paeth) and zlib deflate.
// ---------------------------------------------------------------------------

const CRC_TABLE = ((): Int32Array => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function encodePng(): Buffer {
  // Box-downsample 2048 -> 1024.
  const W = DW;
  const raw = Buffer.alloc(W * W * 3);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * PW + (x * SS + dx)) * 3;
          r += img[i];
          g += img[i + 1];
          b += img[i + 2];
        }
      }
      const o = (y * W + x) * 3;
      raw[o] = Math.round(r / (SS * SS));
      raw[o + 1] = Math.round(g / (SS * SS));
      raw[o + 2] = Math.round(b / (SS * SS));
    }
  }

  const bpp = 3;
  const stride = W * bpp;
  const filtered = Buffer.alloc(W * (stride + 1));
  let prev: Buffer | null = null;
  for (let y = 0; y < W; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    let bestType = 0;
    let bestScore = Infinity;
    let bestRow: Buffer | null = null;
    for (let type = 0; type <= 4; type++) {
      const out = Buffer.alloc(stride);
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= bpp ? prev[i - bpp] : 0;
        let pred = 0;
        if (type === 1) pred = a;
        else if (type === 2) pred = b;
        else if (type === 3) pred = (a + b) >> 1;
        else if (type === 4) pred = paeth(a, b, c);
        const v = (row[i] - pred) & 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        bestRow = out;
      }
    }
    const off = y * (stride + 1);
    filtered[off] = bestType;
    (bestRow as Buffer).copy(filtered, off + 1);
    prev = row;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(filtered, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Type. A hand-drawn 5x9 grid font (each glyph is 9 strings of 5 cells).
// Text is rendered into a coverage mask first; the caption style — bold
// white letters with a thick black outline — is the mask dilated for the
// outline pass, then the mask itself for the fill pass. Cells are drawn
// slightly oversized (BOLD_X / BOLD_Y) so one-cell strokes read as bold.
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '#...#', '####.', '#...#', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '#....', '####.', '#....', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '#....', '####.', '#....', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#....', '#.###', '#...#', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['#####', '....#', '....#', '....#', '....#', '....#', '....#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '#...#', '####.', '#....', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '#...#', '.##.#'],
  R: ['####.', '#...#', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#', '#...#'],
  S: ['.####', '#....', '#....', '#....', '.###.', '....#', '....#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '.#.#.', '..#..', '..#..', '.#.#.', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '.#.#.', '.#.#.', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '..#..', '.#...', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '#.#..', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '.#...', '#....', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '....#', '#...#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.', '...#.', '...#.'],
  '5': ['#####', '#....', '#....', '####.', '....#', '....#', '....#', '#...#', '.###.'],
  '6': ['.####', '#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '...#.', '..#..', '..#..', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '#...#', '.####', '....#', '....#', '....#', '####.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '..#..', '.....', '..#..', '..#..'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '.....', '.####', '.....', '.....', '.....', '.....'],
  ':': ['.....', '.....', '..#..', '..#..', '.....', '.....', '..#..', '..#..', '.....'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..', '..#..', '..#..'],
  '%': ['##..#', '##.#.', '....#', '...#.', '..#..', '.#...', '#..##', '#..##', '#....'],
  '(': ['...##', '..#..', '.#...', '.#...', '.#...', '.#...', '.#...', '..#..', '...##'],
  ')': ['.##..', '..#..', '...#.', '...#.', '...#.', '...#.', '...#.', '..#..', '.##..'],
  '/': ['....#', '....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....', '#....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '.#.#.', '#..#.', '#.#.#', '.#..#', '.##.#'],
};

// Advance widths in cells (the grid is 5 cells wide; narrow glyphs and
// spaces take less). Anything unlisted advances 6.3 cells.
const ADVANCE: Record<string, number> = {
  ' ': 3.6,
  '.': 3.2,
  ',': 3.2,
  "'": 3.0,
  ':': 3.4,
  '!': 3.6,
  I: 5.6,
};
const DEFAULT_ADVANCE = 6.3;
const BOLD_X = 1.38; // cell oversize, horizontal (fattens vertical strokes)
const BOLD_Y = 1.24; // cell oversize, vertical (fattens horizontal strokes)

function textWidthCells(text: string): number {
  let w = 0;
  for (const ch of text) w += ADVANCE[ch] ?? DEFAULT_ADVANCE;
  return w - 1.3; // no tracking after the last glyph
}

// Rasterise one line of text into a coverage mask at pixel resolution.
// Returns the mask, its size, and the design-space box it was drawn for.
function textMask(
  text: string,
  cx: number,
  topY: number,
  cell: number,
  squeeze: number,
): { mask: Uint8Array; w: number; h: number; x0: number; y0: number } {
  const widthDesign = textWidthCells(text) * cell * squeeze;
  const heightDesign = 9 * cell * 1.02;
  const x0 = Math.max(0, Math.floor((cx - widthDesign / 2 - 14) * SS));
  const y0 = Math.max(0, Math.floor((topY - 8) * SS));
  const x1 = Math.min(PW, Math.ceil((cx + widthDesign / 2 + 14) * SS));
  const y1 = Math.min(PW, Math.ceil((topY + heightDesign + 8) * SS));
  const w = x1 - x0;
  const h = y1 - y0;
  const mask = new Uint8Array(w * h);
  let penX = cx - widthDesign / 2;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    const adv = (ADVANCE[ch] ?? DEFAULT_ADVANCE) * cell * squeeze;
    if (glyph) {
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row][col] !== '#') continue;
          const gx = penX + col * cell * squeeze;
          const gy = topY + row * cell;
          const cw = cell * squeeze * BOLD_X;
          const chh = cell * BOLD_Y;
          const px0 = Math.round((gx - (cw - cell * squeeze) / 2) * SS) - x0;
          const py0 = Math.round((gy - (chh - cell) / 2) * SS) - y0;
          const px1 = Math.round((gx - (cw - cell * squeeze) / 2 + cw) * SS) - x0;
          const py1 = Math.round((gy - (chh - cell) / 2 + chh) * SS) - y0;
          for (let py = Math.max(0, py0); py < Math.min(h, py1); py++) {
            for (let px = Math.max(0, px0); px < Math.min(w, px1); px++) {
              mask[py * w + px] = 255;
            }
          }
        }
      }
    }
    penX += adv;
  }
  return { mask, w, h, x0, y0 };
}

// Separable max-filter dilation of a mask by r pixels.
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w) m = Math.max(m, mask[y * w + xx]);
      }
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h) m = Math.max(m, tmp[yy * w + x]);
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

function compositeMask(
  mask: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  c: RGB,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 0) setPx(x0 + x, y0 + y, c);
    }
  }
}

// A caption line: white fill, thick black outline, centred at cx, shrunk
// (uniformly, then squeezed if needed) until it fits maxWidth.
function drawCaption(
  text: string,
  cx: number,
  topY: number,
  targetHeight: number,
  maxWidth: number,
): void {
  let cell = targetHeight / 9;
  let squeeze = 1;
  const width = textWidthCells(text) * cell;
  if (width > maxWidth) {
    squeeze = Math.max(0.72, maxWidth / width / 1.12);
    if (width * squeeze > maxWidth) cell = (maxWidth / textWidthCells(text)) * 1.0;
  }
  const t = textMask(text, cx, topY, cell, squeeze);
  const outlinePx = Math.max(3, Math.round(cell * 0.85 * SS));
  const grown = dilate(t.mask, t.w, t.h, outlinePx);
  compositeMask(grown, t.w, t.h, t.x0, t.y0, [10, 8, 14]);
  compositeMask(t.mask, t.w, t.h, t.x0, t.y0, [255, 255, 255]);
}

// A plain line of scene type (the SOLD sign, the neon wordmark): one
// colour, no outline, centred at cx.
function drawTextSolid(
  text: string,
  cx: number,
  topY: number,
  height: number,
  c: RGB,
  squeeze = 1,
): void {
  const cell = height / 9;
  const t = textMask(text, cx, topY, cell, squeeze);
  compositeMask(t.mask, t.w, t.h, t.x0, t.y0, c);
}

// ---------------------------------------------------------------------------
// The scene. Vice City at sunset: gradient sky, striped retro sun, skyline
// silhouette, glittering sea, sand. On the sand: a beach house with a neon
// make.fun sign, and in front of it the make.fun ghost — sparkle-star
// eyes, magenta star coin held high, house keys in the other hand — next
// to the SOLD sign it just planted.
// ---------------------------------------------------------------------------

const INK: RGB = [10, 8, 14];
const MAGENTA: RGB = [255, 46, 136];
const MAGENTA_DARK: RGB = [214, 28, 105];
const GOLD: RGB = [255, 201, 60];
const GOLD_DARK: RGB = [146, 96, 10];
const RED: RGB = [230, 57, 70];
const NAVY: RGB = [35, 44, 78];

function sparkle(cx: number, cy: number, r: number, c: RGB): void {
  const w = r * 0.17;
  fillPoly(
    [
      [cx, cy - r],
      [cx + w, cy - w],
      [cx + r, cy],
      [cx + w, cy + w],
      [cx, cy + r],
      [cx - w, cy + w],
      [cx - r, cy],
      [cx - w, cy - w],
    ],
    c,
  );
}

function star5(cx: number, cy: number, rOuter: number, rInner: number, c: RGB): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  fillPoly(pts, c);
}

function palm(x: number, baseY: number, h: number, lean: number, trunk: RGB, frond: RGB): void {
  const topX = x + lean;
  const topY = baseY - h;
  let px = x;
  let py = baseY;
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    const nx = x + lean * t * t;
    const ny = baseY - h * t;
    strokeSeg(px, py, nx, ny, 6.5, trunk);
    px = nx;
    py = ny;
  }
  for (const deg of [-168, -134, -100, -66, -32, 2]) {
    const a = (deg * Math.PI) / 180;
    const len = 98;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const p1: [number, number] = [topX + dx * len * 0.4, topY + dy * len * 0.4];
    const p2: [number, number] = [topX + dx * len * 0.75, topY + dy * len * 0.75 + len * 0.13];
    const p3: [number, number] = [topX + dx * len, topY + dy * len + len * 0.34];
    strokeSeg(topX, topY, p1[0], p1[1], 5, frond);
    strokeSeg(p1[0], p1[1], p2[0], p2[1], 4.4, frond);
    strokeSeg(p2[0], p2[1], p3[0], p3[1], 3.6, frond);
  }
  fillCircle(topX, topY + 4, 7, trunk);
}

function roundedRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  paint(x, y, x + w, y + h, (px, py) => {
    const qx = Math.max(x + r - px, px - (x + w - r), 0);
    const qy = Math.max(y + r - py, py - (y + h - r), 0);
    const inRect = px >= x && px < x + w && py >= y && py < y + h;
    return inRect && qx * qx + qy * qy <= r * r + r ? c : null;
  });
}

function ghost(): void {
  const gx = 310;
  const domeCy = 636;
  const rx = 132;
  const ry = 208;
  const bodyBottom = 768;
  const inside = (x: number, y: number, grow: number): boolean => {
    const rxx = rx + grow;
    if (y < domeCy) {
      const dx = (x - gx) / rxx;
      const dy = (y - domeCy) / (ry + grow);
      return dx * dx + dy * dy <= 1;
    }
    if (Math.abs(x - gx) > rxx) return false;
    if (y <= bodyBottom) return true;
    const t = (x - (gx - rxx)) / (2 * rxx);
    const bottom = bodyBottom + 30 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t * 4)) + grow;
    return y <= bottom;
  };
  paint(gx - rx - 16, 380, gx + rx + 16, 812, (x, y) => (inside(x, y, 9) ? INK : null));
  paint(gx - rx - 4, 388, gx + rx + 4, 806, (x, y) => (inside(x, y, 0) ? [255, 255, 255] as RGB : null));

  // Sparkle-star eyes — the mascot's signature.
  sparkle(gx - 48, 580, 31, INK);
  sparkle(gx + 48, 580, 31, INK);
  // A small smile.
  paint(gx - 30, 600, gx + 30, 636, (x, y) => {
    const d = Math.hypot(x - gx, y - 602);
    return d >= 21 && d <= 27 && y > 606 ? INK : null;
  });

  // Left hand (a round nub, like the logo) holding the house keys.
  fillCircle(gx - 138, 662, 26, INK);
  fillCircle(gx - 138, 662, 21, [255, 255, 255]);
  ring(gx - 148, 706, 14, 5.5, INK);
  ring(gx - 148, 706, 14, 3, GOLD);
  // Key one, hanging straight down.
  ring(gx - 156, 740, 10, 4.5, INK);
  ring(gx - 156, 740, 10, 2.8, GOLD);
  strokeSeg(gx - 156, 748, gx - 156, 802, 4.6, INK);
  strokeSeg(gx - 156, 748, gx - 156, 802, 2.8, GOLD);
  fillRect(gx - 156, 780, 15, 7, GOLD_DARK);
  fillRect(gx - 156, 780, 13, 5.5, GOLD);
  fillRect(gx - 156, 791, 12, 7, GOLD_DARK);
  fillRect(gx - 156, 791, 10, 5.5, GOLD);
  // Key two, swinging at an angle.
  strokeSeg(gx - 138, 716, gx - 106, 778, 4.6, INK);
  strokeSeg(gx - 138, 716, gx - 106, 778, 2.8, GOLD);
  strokeSeg(gx - 106, 778, gx - 92, 770, 4.2, INK);
  strokeSeg(gx - 106, 778, gx - 92, 770, 2.6, GOLD);
  strokeSeg(gx - 114, 762, gx - 101, 754, 4.2, INK);
  strokeSeg(gx - 114, 762, gx - 101, 754, 2.6, GOLD);

  // Right hand raised, holding the magenta star coin high.
  fillCircle(gx + 140, 598, 28, INK);
  fillCircle(gx + 140, 598, 23, [255, 255, 255]);
  fillCircle(gx + 174, 530, 48, MAGENTA_DARK);
  fillCircle(gx + 174, 530, 40, MAGENTA);
  star5(gx + 174, 530, 22, 9.5, [255, 255, 255]);
}

function render(): void {
  const rng = mulberry32(20261119);

  // Sky.
  vGrad(0, 0, DW, DW, [
    [0, [30, 12, 66]],
    [0.3, [88, 32, 120]],
    [0.52, [178, 54, 121]],
    [0.62, [255, 94, 98]],
    [0.72, [255, 154, 92]],
    [1, [255, 154, 92]],
  ]);
  // Early stars in the purple.
  for (let i = 0; i < 70; i++) {
    fillRect(rng() * 1024, rng() * 180, 2.5, 2.5, [255, 240, 220]);
  }

  // The striped retro sun, setting into the sea.
  paint(310, 314, 714, 718, (x, y) => {
    const d = Math.hypot(x - 512, y - 516);
    if (d > 192) return null;
    if (y > 486) {
      const rel = y - 486;
      if (rel % 30 < 2 + rel / 13) return null;
    }
    return gradAt(
      [
        [0, [255, 211, 25]],
        [1, [255, 41, 117]],
      ],
      (y - 324) / 384,
    );
  });

  // Skyline silhouette along the horizon, windows lit.
  let bx = -12;
  while (bx < 1036) {
    const bw = 34 + rng() * 46;
    const bh = 48 + rng() * 112;
    fillRect(bx, 604 - bh, bw, bh, [26, 13, 48]);
    for (let wy = 604 - bh + 10; wy < 592; wy += 13) {
      for (let wx = bx + 6; wx < bx + bw - 7; wx += 11) {
        if (rng() < 0.26) fillRect(wx, wy, 5, 7, [255, 205, 110]);
      }
    }
    bx += bw + 4 + rng() * 14;
  }

  // Sea, with the sun's glitter path.
  vGrad(0, 604, DW, 88, [
    [0, [255, 126, 95]],
    [0.35, [214, 81, 132]],
    [1, [38, 52, 110]],
  ]);
  for (let i = 0; i < 90; i++) {
    const y = 610 + rng() * 74;
    const len = 8 + rng() * 36 * (1 - (y - 610) / 100);
    const x = 512 + (rng() * 2 - 1) * (60 + (y - 604) * 1.6);
    fillRect(x, y, len, 2.5, [255, 209, 148]);
  }

  // Sand.
  vGrad(0, 692, DW, 332, [
    [0, [250, 214, 141]],
    [1, [231, 162, 95]],
  ]);
  for (let i = 0; i < 500; i++) {
    fillRect(rng() * 1024, 698 + rng() * 318, 3, 2, [214, 144, 84]);
  }

  // Palms: a dark silhouette on the left, a lit one by the house.
  palm(68, 706, 238, -30, [30, 14, 54], [30, 14, 54]);
  palm(962, 700, 214, -16, [107, 66, 38], [20, 120, 70]);

  // The beach house.
  fillEllipse(756, 696, 212, 16, [214, 144, 84]);
  vGrad(596, 484, 320, 206, [
    [0, [255, 246, 230]],
    [1, [255, 227, 186]],
  ]);
  fillRect(578, 456, 356, 28, NAVY);
  fillRect(578, 484, 356, 7, MAGENTA);
  drawTextSolid('MAKE.FUN', 756, 497, 23, [255, 93, 162]);
  fillRect(632, 520, 158, 128, NAVY);
  vGrad(640, 528, 142, 112, [
    [0, [143, 245, 230]],
    [1, [31, 138, 128]],
  ]);
  fillPoly(
    [
      [658, 640],
      [718, 528],
      [748, 528],
      [688, 640],
    ],
    [178, 246, 234],
  );
  fillRect(706, 528, 4, 112, NAVY);
  fillRect(640, 580, 142, 4, NAVY);
  fillRect(826, 538, 62, 152, [43, 58, 110]);
  fillRect(838, 552, 38, 44, [143, 245, 230]);
  fillCircle(878, 616, 5, GOLD);
  fillRect(812, 690, 90, 10, [217, 200, 169]);

  // The SOLD sign, planted in the sand in front of the house.
  fillEllipse(748, 808, 150, 13, [214, 144, 84]);
  fillRect(736, 690, 24, 112, [122, 74, 33]);
  roundedRect(592, 590, 312, 112, 18, RED);
  roundedRect(602, 600, 292, 92, 12, [255, 255, 255]);
  drawTextSolid('SOLD', 748, 606, 56, RED);
  drawTextSolid('VIA MAKE.FUN BOUNTIES', 748, 666, 19, NAVY, 0.92);

  // The ghost of make.fun, keys in hand, coin held high.
  paintBlend(150, 776, 470, 824, (x, y) => {
    const dx = (x - 310) / 152;
    const dy = (y - 800) / 20;
    return dx * dx + dy * dy <= 1 ? { c: [40, 16, 40] as RGB, a: 0.2 } : null;
  });
  ghost();

  // A soft shade along the bottom so the caption sits on it cleanly.
  paintBlend(0, 792, DW, 232, (x, y) => {
    const t = (y - 792) / 232;
    return { c: [16, 6, 24] as RGB, a: 0.36 * t * t };
  });

  // Captions: the joke, top and bottom, in bold meme type.
  drawCaption('YOU WAITED 13 YEARS', 512, 28, 92, 984);
  drawCaption('TO VISIT VICE CITY', 512, 134, 92, 984);
  drawCaption('THE MAKE.FUN GHOST BOUGHT IT', 512, 822, 68, 984);
  drawCaption('WITH BOUNTY MONEY', 512, 902, 68, 984);
}

render();
writeFileSync(join(OUTPUT_DIR, 'meme.png'), encodePng());
