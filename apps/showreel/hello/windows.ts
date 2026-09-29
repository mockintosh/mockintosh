/**
 * The window storm: ten windows the Finder throws open in a burst, each with
 * something of the Mac going on inside — a desk accessory, a document, a
 * dialog — all drawn with the real fonts and icons.
 */
import { easeOutCubic, hash, seg } from "../ease";
import type { PixelRect } from "../painter";
import type { Cast } from "./cast";
import { PATTERNS, button, dialogFrame, progressBar, windowFrame } from "../desktop";
import type { Pattern, Screen } from "../screen";

/** A window in the storm, placed on the stage; `paint` gets seconds since it opened. */
export interface StormWindow {
  title: string;
  /** Stage rect: u0, v0, u1, v1. */
  at: readonly [number, number, number, number];
  dialog?: boolean;
  scroll?: boolean;
  paint(sc: Screen, content: PixelRect, t: number, cast: Cast): void;
}

function disc(sc: Screen, cx: number, cy: number, r: number, pattern: Pattern): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    const half = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
    sc.pattern(cx - half, y, cx + half, y + 1, pattern);
  }
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    sc.fill(
      Math.round(cx + Math.cos(rad) * r),
      Math.round(cy + Math.sin(rad) * r),
      Math.round(cx + Math.cos(rad) * r) + sc.z,
      Math.round(cy + Math.sin(rad) * r) + sc.z,
      1,
    );
  }
}

function icons(sc: Screen, c: PixelRect, t: number, cast: Cast): void {
  const z = sc.z;
  const cols = 3;
  const cw = (c.x1 - c.x0) / cols;
  for (let i = 0; i < 6; i++) {
    const app = cast.apps[i]!;
    const cx = c.x0 + cw * ((i % cols) + 0.5);
    const top = c.y0 + 6 * z + Math.floor(i / cols) * 50 * z;
    const k = Math.round(z * Math.min(1, t * 8 - i * 0.6 + 1)) || 0;
    if (k <= 0) continue;
    const x = Math.round(cx - (app.icon.width * z) / 2);
    sc.sprite(app.icon, x, top, z);
    sc.centered(app.label, cx, top + 34 * z, { font: "geneva", size: 9 });
  }
}

const README = ["Welcome to Mockintosh,", "a Macintosh that never", "shipped, booting in", "your browser at 512 by", "342, in one bit."];

function readMe(sc: Screen, c: PixelRect, t: number): void {
  const z = sc.z;
  let budget = Math.floor(t * 70);
  let y = c.y0 + 4 * z;
  for (const line of README) {
    if (budget <= 0) break;
    const shown = line.slice(0, budget);
    budget -= line.length;
    const w = sc.text(shown, c.x0 + 6 * z, y, { font: "newYork", size: 12 });
    if (budget < 0 && Math.floor(t * 4) % 2 === 0) sc.fill(c.x0 + 7 * z + w, y, c.x0 + 8 * z + w, y + 13 * z, 1);
    y += 15 * z;
  }
}

function paint(sc: Screen, c: PixelRect, t: number): void {
  const z = sc.z;
  const w = c.x1 - c.x0;
  const h = c.y1 - c.y0;
  disc(sc, c.x0 + w * 0.3, c.y0 + h * 0.45, Math.min(w, h) * 0.3 * easeOutCubic(seg(t, 0, 0.25)), PATTERNS.gray);
  const bw = Math.round(w * 0.36 * easeOutCubic(seg(t, 0.1, 0.35)));
  if (bw > 0) {
    const r = { x0: c.x0 + Math.round(w * 0.5), y0: c.y0 + Math.round(h * 0.2), x1: c.x0 + Math.round(w * 0.5) + bw, y1: c.y0 + Math.round(h * 0.7) };
    sc.pattern(r.x0, r.y0, r.x1, r.y1, PATTERNS.bricks);
    sc.box(r, z);
  }
  // A brush stroke, painted on.
  const reach = seg(t, 0.2, 0.6);
  let last: [number, number] | null = null;
  for (let s = 0; s <= reach * 60; s++) {
    const x = c.x0 + w * (0.08 + (s / 60) * 0.84);
    const y = c.y0 + h * (0.82 + 0.08 * Math.sin(s * 0.3));
    if (last) sc.line(last[0], last[1], x, y, 3 * z);
    last = [x, y];
  }
}

function puzzle(sc: Screen, c: PixelRect, t: number): void {
  const z = sc.z;
  const size = Math.min(c.x1 - c.x0, c.y1 - c.y0) - 8 * z;
  const cell = Math.floor(size / 4);
  const ox = Math.round((c.x0 + c.x1 - cell * 4) / 2);
  const oy = Math.round((c.y0 + c.y1 - cell * 4) / 2);
  // Tile 12 slides into the hole, then 15 follows.
  const slideA = easeOutCubic(seg(t, 0.15, 0.3));
  const slideB = easeOutCubic(seg(t, 0.45, 0.6));
  for (let n = 1; n <= 15; n++) {
    let col = (n - 1) % 4;
    let row = Math.floor((n - 1) / 4);
    let dx = 0;
    let dy = 0;
    if (n === 12) dy = slideA;
    if (n === 11) dx = slideB;
    if (n === 15 || n === 14 || n === 13) {
      col = n - 13;
      row = 3;
    }
    const x = Math.round(ox + (col + dx) * cell);
    const y = Math.round(oy + (row + dy) * cell);
    const r = { x0: x + z, y0: y + z, x1: x + cell - z, y1: y + cell - z };
    sc.fillRect(r, 0);
    sc.box(r, z);
    sc.centered(String(n), (r.x0 + r.x1) / 2, Math.round((r.y0 + r.y1) / 2 - 6 * z), { font: "chicago" });
  }
}

const FONT_LIST: readonly (readonly [string, string, number])[] = [
  ["Chicago", "chicago", 12],
  ["New York", "newYork", 14],
  ["Geneva", "geneva", 12],
  ["Venice", "venice", 14],
  ["London", "london", 18],
  ["Athens", "athens", 18],
  ["San Francisco", "sanFrancisco", 18],
  ["Toronto", "toronto", 14],
  ["Los Angeles", "losAngeles", 12],
  ["Monaco", "monaco", 12],
  ["Cairo", "cairo", 18],
];

function fonts(sc: Screen, c: PixelRect, t: number): void {
  const z = sc.z;
  let y = c.y0 + 4 * z - Math.round(t * 60 * z);
  for (const [label, font, size] of FONT_LIST) {
    const style = { font, size };
    sc.text(font === "cairo" ? "abcdefgh" : label, c.x0 + 6 * z, y, style);
    y += sc.measure(label, style).height + 3 * z;
  }
}

const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const TYPED = "HELLO";

function keyCaps(sc: Screen, c: PixelRect, t: number): void {
  const z = sc.z;
  const n = Math.min(TYPED.length, Math.floor(t * 9));
  const pressed = Math.floor(t * 9) < TYPED.length && (t * 9) % 1 < 0.6 ? TYPED[n] : "";
  const field = { x0: c.x0 + 6 * z, y0: c.y0 + 4 * z, x1: c.x1 - 6 * z, y1: c.y0 + 18 * z };
  sc.box(field, z);
  sc.text(TYPED.slice(0, n).toLowerCase(), field.x0 + 4 * z, field.y0 + 2 * z, { font: "geneva", size: 12 });
  const key = Math.floor((c.x1 - c.x0 - 12 * z) / 10);
  KEY_ROWS.forEach((row, ri) => {
    [...row].forEach((ch, ci) => {
      const x = c.x0 + 6 * z + ci * key + ri * Math.round(key / 3);
      const y = field.y1 + 4 * z + ri * key;
      const r = { x0: x, y0: y, x1: x + key - z, y1: y + key - z };
      const down = ch === pressed;
      sc.fillRect(r, down ? 1 : 0);
      sc.box(r, z);
      sc.centered(ch, x + key / 2, y + Math.round(key / 2) - 5 * z, { font: "geneva", size: 9, ink: down ? 0 : 1 });
    });
  });
}

function scrapbook(sc: Screen, c: PixelRect, t: number): void {
  const z = sc.z;
  const pictures = "ahtwp";
  const ch = pictures[Math.floor(t * 5) % pictures.length]!;
  const k = 2 * z;
  const { height } = sc.measure(ch, { font: "cairo", size: 18, k });
  sc.centered(ch, (c.x0 + c.x1) / 2, Math.round((c.y0 + c.y1 - height) / 2), { font: "cairo", size: 18, k });
}

function calculator(sc: Screen, c: PixelRect, t: number): void {
  const z = sc.z;
  const shown = t < 0.25 ? "512" : t < 0.5 ? "342" : "175104";
  const display = { x0: c.x0 + 4 * z, y0: c.y0 + 4 * z, x1: c.x1 - 4 * z, y1: c.y0 + 18 * z };
  sc.box(display, z);
  const w = sc.measure(shown, { font: "chicago" }).width;
  sc.text(shown, display.x1 - 4 * z - w, display.y0 + 2 * z, { font: "chicago" });
  const keys = "789/456x123-0.=+";
  const kw = Math.floor((c.x1 - c.x0 - 8 * z) / 4);
  const kh = Math.floor((c.y1 - display.y1 - 6 * z) / 4);
  const hot = t < 0.25 ? -1 : t < 0.5 ? 7 : 14;
  [...keys].forEach((ch, i) => {
    const x = c.x0 + 4 * z + (i % 4) * kw;
    const y = display.y1 + 3 * z + Math.floor(i / 4) * kh;
    const r = { x0: x, y0: y, x1: x + kw - z, y1: y + kh - z };
    const down = i === hot && t % 0.25 < 0.1;
    sc.fillRect(r, down ? 1 : 0);
    sc.box(r, z);
    sc.centered(ch, x + kw / 2, y + Math.round(kh / 2) - 6 * z, { font: "chicago", ink: down ? 0 : 1 });
  });
}

function copying(sc: Screen, c: PixelRect, t: number): void {
  const z = sc.z;
  sc.text("Copying 342 items to", c.x0 + 10 * z, c.y0 + 6 * z, { font: "chicago" });
  sc.text("Mockintosh HD", c.x0 + 10 * z, c.y0 + 22 * z, { font: "chicago" });
  const stutter = Math.floor(t * 10) + hash(Math.floor(t * 10), 5);
  progressBar(sc, { x0: c.x0 + 10 * z, y0: c.y1 - 20 * z, x1: c.x1 - 10 * z, y1: c.y1 - 10 * z }, stutter / 8);
}

function reality(sc: Screen, c: PixelRect, t: number, cast: Cast): void {
  const z = sc.z;
  sc.sprite(cast.stop, c.x0 + 10 * z, c.y0 + 8 * z, z);
  sc.text("The application Reality", c.x0 + 52 * z, c.y0 + 8 * z, { font: "chicago" });
  sc.text("has unexpectedly quit.", c.x0 + 52 * z, c.y0 + 24 * z, { font: "chicago" });
  button(sc, { x0: c.x1 - 70 * z, y0: c.y1 - 26 * z, x1: c.x1 - 12 * z, y1: c.y1 - 8 * z }, "OK", {
    isDefault: true,
    pressed: t > 0.45 && t < 0.55,
  });
}

export const STORM: readonly StormWindow[] = [
  { title: "Mockintosh HD", at: [14, 24, 152, 104], scroll: true, paint: icons },
  { title: "Read Me", at: [168, 28, 306, 106], scroll: true, paint: readMe },
  { title: "Untitled-1", at: [34, 74, 150, 166], paint },
  { title: "Puzzle", at: [238, 96, 306, 170], paint: puzzle },
  { title: "Fonts", at: [112, 36, 222, 128], scroll: true, paint: fonts },
  { title: "Key Caps", at: [10, 118, 150, 172], paint: keyCaps },
  { title: "Scrapbook", at: [226, 22, 312, 92], paint: scrapbook },
  { title: "Calculator", at: [158, 92, 226, 172], paint: calculator },
  { title: "", at: [68, 58, 252, 112], dialog: true, paint: copying },
  { title: "", at: [74, 66, 262, 124], dialog: true, paint: reality },
];

/** Draw one storm window at its place, open for `t` seconds. */
export function drawStormWindow(sc: Screen, w: StormWindow, rect: PixelRect, t: number, cast: Cast, active: boolean): void {
  const content = w.dialog ? dialogFrame(sc, rect) : windowFrame(sc, rect, w.title, { active, scroll: w.scroll ? Math.min(1, t * 0.8) : undefined });
  w.paint(sc.within(content), content, t, cast);
}
