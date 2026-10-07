/**
 * Characters drawn by rule instead of from the font: box drawing, block
 * elements, shades and Braille, which must meet exactly at cell edges, and
 * a few symbols terminal programs lean on (arrows, triangles, bullets) that
 * Monaco 9 never had. As xterm.js does, so lines join across cells and a
 * TUI's frames and spinners look right without hand-drawing 400 glyphs.
 *
 * A glyph is a 6×11 cell, one byte per pixel (1 = ink). Shades depend on
 * the cell's parity on screen, so patterns tile across cells.
 */

export const CELL_WIDTH = 6;
export const CELL_HEIGHT = 11;

const W = CELL_WIDTH, H = CELL_HEIGHT;
const CX = 2, CY = 5;

type Weight = 0 | 1 | 2 | 3; // none, light, heavy, double

/** Arms up, right, down, left for U+2500…U+257F; "" for the ones drawn otherwise. */
const BOX: readonly string[] = [
  "0101", "0202", "1010", "2020", "", "", "", "", "", "", "", "", "0110", "0210", "0120", "0220",
  "0011", "0012", "0021", "0022", "1100", "1200", "2100", "2200", "1001", "1002", "2001", "2002", "1110", "1210", "2110", "1120",
  "2120", "2210", "1220", "2220", "1011", "1012", "2011", "1021", "2021", "2012", "1022", "2022", "0111", "0112", "0211", "0212",
  "0121", "0122", "0221", "0222", "1101", "1102", "1201", "1202", "2101", "2102", "2201", "2202", "1111", "1112", "1211", "1212",
  "2111", "1121", "2121", "2112", "2211", "1122", "1221", "2212", "1222", "2122", "2221", "2222", "", "", "", "",
  "0303", "3030", "0310", "0130", "0330", "0013", "0031", "0033", "1300", "3100", "3300", "1003", "3001", "3003", "1310", "3130",
  "3330", "1013", "3031", "3033", "0313", "0131", "0333", "1303", "3101", "3303", "1313", "3131", "3333", "0110", "0011", "1001",
  "1100", "", "", "", "0001", "1000", "0100", "0010", "0002", "2000", "0200", "0020", "0201", "1020", "0102", "2010",
];

function blank(): Uint8Array {
  return new Uint8Array(W * H);
}

function rect(p: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) p[y * W + x] = 1;
}

function boxGlyph(spec: string, rounded: boolean): Uint8Array {
  const p = blank();
  const [up, right, down, left] = Array.from(spec, Number) as Weight[];
  const vDouble = up === 3 || down === 3;
  const hDouble = left === 3 || right === 3;
  // Single and heavy arms: from the edge to the centre, stopping short of a double line they meet.
  const thick = (w: Weight) => (w === 2 ? 1 : 0);
  if (up === 1 || up === 2) rect(p, CX, 0, CX + thick(up), hDouble ? CY - 1 : CY + thick(up));
  if (down === 1 || down === 2) rect(p, CX, hDouble ? CY + 1 : CY, CX + thick(down), H - 1);
  if (left === 1 || left === 2) rect(p, 0, CY, vDouble ? CX - 1 : CX + thick(left), CY + thick(left));
  if (right === 1 || right === 2) rect(p, vDouble ? CX + 1 : CX, CY, W - 1, CY + thick(right));
  // Double lines: two strokes, ending where the perpendicular strokes meet them.
  if (left === 3 || right === 3) {
    for (const [y, side] of [[CY - 1, "up"], [CY + 1, "down"]] as const) {
      const near = side === "up" ? up : down, far = side === "up" ? down : up;
      // Where this stroke stops at the centre when it doesn't run through.
      const startNoLeft = near ? (near === 3 ? CX + 1 : CX) : far ? (far === 3 ? CX - 1 : CX) : CX;
      const endNoRight = near ? (near === 3 ? CX - 1 : CX) : far ? (far === 3 ? CX + 1 : CX) : CX;
      if (left && right) {
        if (near === 3) {
          rect(p, 0, y, CX - 1, y);
          rect(p, CX + 1, y, W - 1, y);
        } else rect(p, 0, y, W - 1, y);
      } else if (right) rect(p, startNoLeft, y, W - 1, y);
      else rect(p, 0, y, endNoRight, y);
    }
  }
  if (up === 3 || down === 3) {
    for (const [x, side] of [[CX - 1, "left"], [CX + 1, "right"]] as const) {
      const near = side === "left" ? left : right, far = side === "left" ? right : left;
      const startNoUp = near ? (near === 3 ? CY + 1 : CY) : far ? (far === 3 ? CY - 1 : CY) : CY;
      const endNoDown = near ? (near === 3 ? CY - 1 : CY) : far ? (far === 3 ? CY + 1 : CY) : CY;
      if (up && down) {
        if (near === 3) {
          rect(p, x, 0, x, CY - 1);
          rect(p, x, CY + 1, x, H - 1);
        } else rect(p, x, 0, x, H - 1);
      } else if (down) rect(p, x, startNoUp, x, H - 1);
      else rect(p, x, 0, x, endNoDown);
    }
  }
  if (rounded) {
    // Take the corner's pixel out; the arms then meet on the diagonal.
    p[CY * W + CX] = 0;
  }
  return p;
}

function dashes(horizontal: boolean, heavy: boolean, count: number): Uint8Array {
  const p = blank();
  const length = horizontal ? W : H;
  const period = length / count;
  for (let i = 0; i < length; i++) {
    if (i % period >= period * 0.6) continue;
    if (horizontal) rect(p, i, CY, i, CY + (heavy ? 1 : 0));
    else rect(p, CX, i, CX + (heavy ? 1 : 0), i);
  }
  return p;
}

function diagonal(p: Uint8Array, rising: boolean): void {
  for (let y = 0; y < H; y++) {
    const x = Math.round((y / (H - 1)) * (W - 1));
    p[y * W + (rising ? W - 1 - x : x)] = 1;
  }
}

/** Ink for a shade at screen parity: 25%, 50% or 75%. */
function shade(level: 1 | 2 | 3, ox: number, oy: number): Uint8Array {
  const p = blank();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ax = ox + x, ay = oy + y;
      const on = level === 2 ? (ax + ay) % 2 === 0 : level === 1 ? ax % 2 === 0 && ay % 2 === 0 : !(ax % 2 === 1 && ay % 2 === 1);
      if (on) p[y * W + x] = 1;
    }
  return p;
}

function blockGlyph(cp: number, ox: number, oy: number): Uint8Array {
  const p = blank();
  const eighthsDown = (n: number) => H - Math.round((H * n) / 8);
  const eighthsAcross = (n: number) => Math.round((W * n) / 8);
  const half = { x: W / 2, y: Math.ceil(H / 2) };
  const quad = (q: number) => {
    // 1 upper-left, 2 upper-right, 4 lower-left, 8 lower-right
    if (q & 1) rect(p, 0, 0, half.x - 1, half.y - 1);
    if (q & 2) rect(p, half.x, 0, W - 1, half.y - 1);
    if (q & 4) rect(p, 0, half.y, half.x - 1, H - 1);
    if (q & 8) rect(p, half.x, half.y, W - 1, H - 1);
  };
  if (cp === 0x2580) rect(p, 0, 0, W - 1, half.y - 1);
  else if (cp >= 0x2581 && cp <= 0x2588) rect(p, 0, eighthsDown(cp - 0x2580), W - 1, H - 1);
  else if (cp >= 0x2589 && cp <= 0x258f) rect(p, 0, 0, eighthsAcross(0x2590 - cp) - 1, H - 1);
  else if (cp === 0x2590) rect(p, half.x, 0, W - 1, H - 1);
  else if (cp >= 0x2591 && cp <= 0x2593) return shade((cp - 0x2590) as 1 | 2 | 3, ox, oy);
  else if (cp === 0x2594) rect(p, 0, 0, W - 1, H - eighthsDown(1) - 1);
  else if (cp === 0x2595) rect(p, W - 1, 0, W - 1, H - 1);
  else {
    const quads: Record<number, number> = { 0x2596: 4, 0x2597: 8, 0x2598: 1, 0x2599: 13, 0x259a: 9, 0x259b: 7, 0x259c: 11, 0x259d: 2, 0x259e: 6, 0x259f: 14 };
    quad(quads[cp] ?? 0);
  }
  return p;
}

function braille(cp: number): Uint8Array {
  const p = blank();
  const bits = cp - 0x2800;
  const xs = [1, 3], ys = [1, 4, 7, 9];
  const dots: [number, number][] = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];
  dots.forEach(([c, r], i) => {
    if (bits & (1 << i)) p[ys[r]! * W + xs[c]!] = 1;
  });
  return p;
}

/** Hand-drawn symbols, 5 columns wide, rows from the top of the cell; "#" is ink. */
const SYMBOLS: Record<number, string> = {
  0x2190: "..... ..... ..... ..#.. .#... ##### .#... ..#..", // ←
  0x2191: "..... ..... ..#.. .###. #.#.# ..#.. ..#.. ..#..", // ↑
  0x2192: "..... ..... ..... ..#.. ...#. ##### ...#. ..#..", // →
  0x2193: "..... ..... ..#.. ..#.. ..#.. #.#.# .###. ..#..", // ↓
  0x2194: "..... ..... ..... ..... .#.#. ##### .#.#.", // ↔
  0x2195: "..... ..#.. .###. #.#.# ..#.. #.#.# .###. ..#..", // ↕
  0x21b5: "..... ..... ....# ....# ..#.# .#..# ####. .#... ..#..", // ↵
  0x23ce: "..... ..... ....# ....# ..#.# .#..# ####. .#... ..#..", // ⏎
  0x25cf: "..... ..... ..... .###. ##### ##### ##### .###.", // ●
  0x25cb: "..... ..... ..... .###. #...# #...# #...# .###.", // ○
  0x25c9: "..... ..... ..... .###. #...# #.#.# #...# .###.", // ◉
  0x25ce: "..... ..... ..... .###. #...# #.#.# #...# .###.", // ◎
  0x25c6: "..... ..... ..#.. .###. ##### .###. ..#..", // ◆
  0x25c7: "..... ..... ..#.. .#.#. #...# .#.#. ..#..", // ◇
  0x25a0: "..... ..... ..... ##### ##### ##### ##### #####", // ■
  0x25a1: "..... ..... ..... ##### #...# #...# #...# #####", // □
  0x25aa: "..... ..... ..... ..... .###. .###. .###.", // ▪
  0x25ab: "..... ..... ..... ..... .###. .#.#. .###.", // ▫
  0x25b2: "..... ..... ..... ..#.. ..#.. .###. .###. #####", // ▲
  0x25b3: "..... ..... ..... ..#.. ..#.. .#.#. .#.#. #####", // △
  0x25bc: "..... ..... ..... ##### .###. .###. ..#.. ..#..", // ▼
  0x25bd: "..... ..... ..... ##### .#.#. .#.#. ..#.. ..#..", // ▽
  0x25b6: "..... ..... #.... ##... ###.. ####. ###.. ##... #....", // ▶
  0x25b7: "..... ..... #.... ##... #.#.. #..#. #.#.. ##... #....", // ▷
  0x25c0: "..... ..... ....# ...## ..### .#### ..### ...## ....#", // ◀
  0x25c1: "..... ..... ....# ...## ..#.# .#..# ..#.# ...## ....#", // ◁
  0x25b8: "..... ..... ..... .#... .##.. .###. .##.. .#...", // ▸
  0x25b9: "..... ..... ..... .#... .##.. .#.#. .##.. .#...", // ▹
  0x25c2: "..... ..... ..... ...#. ..##. .###. ..##. ...#.", // ◂
  0x25c3: "..... ..... ..... ...#. ..##. .#.#. ..##. ...#.", // ◃
  0x25b4: "..... ..... ..... ..... ..#.. .###. #####", // ▴
  0x25be: "..... ..... ..... ..... ##### .###. ..#..", // ▾
  0x23f5: "..... ..... ..... .#... .##.. .###. .##.. .#...", // ⏵
  0x2714: "..... ..... ....# ...## #.##. ###.. .#...", // ✔
  0x2717: "..... ..... ..... #...# .#.#. ..#.. .#.#. #...#", // ✗
  0x2718: "..... ..... ..... ##.## .###. ..#.. .###. ##.##", // ✘
  0x2715: "..... ..... ..... #...# .#.#. ..#.. .#.#. #...#", // ✕
  0x2605: "..... ..... ..#.. ..#.. ##### .###. .#.#. #...#", // ★
  0x2606: "..... ..... ..#.. .#.#. #...# .#.#. .#.#. ##.##", // ☆
  0x26a0: "..... ..#.. ..#.. .#.#. .#.#. .#.#. #...# #.#.# #####", // ⚠
  0x23fa: "..... ..... ..... .###. ##### ##### ##### .###.", // ⏺
  0x23bf: "#.... #.... #.... #.... #.... #.... #####", // ⎿
  0x2726: "..... ..... ..#.. ..#.. .###. ##### .###. ..#.. ..#..", // ✦
  0x2731: "..... ..... ..#.. #.#.# .###. #.#.# ..#..", // ✱
  0x273b: "..... ..... ..#.. #.#.# .###. #.#.# ..#..", // ✻
  0x2732: "..... ..... ..#.. #.#.# .###. #.#.# ..#..", // ✲
  0x2219: "..... ..... ..... ..... ..... .##.. .##..", // ∙
  0x22ef: "..... ..... ..... ..... ..... ..... #.#.#", // ⋯
};

function symbol(art: string): Uint8Array {
  const p = blank();
  art.split(" ").forEach((row, y) => {
    for (let x = 0; x < Math.min(5, row.length); x++) if (row[x] === "#") p[y * W + x] = 1;
  });
  return p;
}

const cache = new Map<number, Uint8Array | null>();

/**
 * The pixels for `cp` if it is drawn by rule, else null (draw it from the
 * font). `ox`/`oy` are the cell's screen position; only shades use them.
 */
export function proceduralGlyph(cp: number, ox = 0, oy = 0): Uint8Array | null {
  if (cp >= 0x2591 && cp <= 0x2593) return blockGlyph(cp, ox, oy);
  const key = cp;
  if (cache.has(key)) return cache.get(key)!;
  let glyph: Uint8Array | null = null;
  if (cp >= 0x2500 && cp <= 0x257f) {
    const spec = BOX[cp - 0x2500]!;
    if (spec) glyph = boxGlyph(spec, cp >= 0x256d && cp <= 0x2570);
    else if (cp >= 0x2504 && cp <= 0x250b) {
      const i = cp - 0x2504;
      glyph = dashes(i % 4 < 2, i % 2 === 1, i < 4 ? 3 : 4);
    } else if (cp >= 0x254c && cp <= 0x254f) {
      const i = cp - 0x254c;
      glyph = dashes(i < 2, i % 2 === 1, 2);
    } else if (cp >= 0x2571 && cp <= 0x2573) {
      glyph = blank();
      if (cp !== 0x2572) diagonal(glyph, true);
      if (cp !== 0x2571) diagonal(glyph, false);
    }
  } else if (cp >= 0x2580 && cp <= 0x259f) glyph = blockGlyph(cp, ox, oy);
  else if (cp >= 0x2800 && cp <= 0x28ff) glyph = braille(cp);
  else if (SYMBOLS[cp]) glyph = symbol(SYMBOLS[cp]!);
  cache.set(key, glyph);
  return glyph;
}
