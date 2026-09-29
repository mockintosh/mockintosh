/**
 * The Mockintosh desktop's vocabulary — menubar, menus, windows, dialogs,
 * buttons, icons, cursors and the zoom rectangles that join them — drawn to
 * the proportions of the real chrome, in device pixels × `z`.
 */
import { MAC_CURSOR_FACES, type MacCursorName } from "@mockintosh/ui";
import { fromGrid, type Sprite } from "@mockintosh/sdk";
import type { PixelRect } from "./painter";
import type { Pattern, Screen } from "./screen";

export const PATTERNS = {
  gray: [0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55],
  ltGray: [0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22],
  dkGray: [0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd],
  bricks: [0xff, 0x80, 0x80, 0x80, 0xff, 0x08, 0x08, 0x08],
  weave: [0xf8, 0x74, 0x22, 0x47, 0x8f, 0x17, 0x22, 0x71],
  scales: [0x80, 0x80, 0x41, 0x3e, 0x08, 0x08, 0x14, 0xe3],
  diagonal: [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
  hearts: [0x00, 0x6c, 0xfe, 0xfe, 0x7c, 0x38, 0x10, 0x00],
  tiles: [0xff, 0x81, 0xbd, 0xa5, 0xa5, 0xbd, 0x81, 0xff],
  dots: [0x80, 0x00, 0x08, 0x00, 0x80, 0x00, 0x08, 0x00],
} as const satisfies Record<string, Pattern>;

const MENUBAR_H = 20;
const MENU_ITEM_H = 16;
const TITLE_H = 19;
const SCROLL_W = 16;

const APPLE = fromGrid(11, 12, [
  "......##...",
  ".....##....",
  ".....#.....",
  "..###.###..",
  ".#########.",
  "#########..",
  "#########..",
  "#########..",
  "##########.",
  ".##########",
  ".#########.",
  "..###.###..",
]);

/** Where a menu title sits on the bar, so its menu can drop beneath it. */
export interface MenuTitle {
  label: string;
  x0: number;
  x1: number;
}

/** The menubar across the top of the screen; `open` inverts one title. `drop` slides it in from above. */
export function menubar(sc: Screen, titles: readonly string[], open = -1, drop = 1): MenuTitle[] {
  const z = sc.z;
  const c = sc.clip;
  const h = MENUBAR_H * z;
  const top = c.y0 - Math.round(h * (1 - drop));
  sc.fill(c.x0, top, c.x1, top + h - z, 0);
  sc.fill(c.x0, top + h - z, c.x1, top + h, 1);
  const out: MenuTitle[] = [];
  let x = c.x0 + 10 * z;
  const labels = ["", ...titles];
  labels.forEach((label, i) => {
    const w = i === 0 ? APPLE.width * z : sc.measure(label, { font: "chicago" }).width;
    const x0 = x - 7 * z;
    const x1 = x + w + 7 * z;
    if (i - 1 === open) sc.fill(x0, top, x1, top + h - z, 1);
    const ink = i - 1 === open ? 0 : 1;
    if (i === 0) {
      sc.sprite(APPLE, x, top + 4 * z, z, ink === 0);
    } else {
      sc.text(label, x, top + 3 * z, { font: "chicago", ink });
    }
    out.push({ label, x0, x1 });
    x = x1 + 7 * z;
  });
  return out.slice(1);
}

export type MenuItem = string | { label: string; disabled?: boolean } | "-";

/** A pulled-down menu below `title`; `hilite` inverts an item, as the pointer drags over it. */
export function menu(sc: Screen, title: MenuTitle, items: readonly MenuItem[], hilite = -1): PixelRect {
  const z = sc.z;
  const labels = items.map((it) => (typeof it === "string" ? it : it.label));
  const width = Math.max(...labels.map((l) => sc.measure(l, { font: "chicago" }).width)) + 34 * z;
  const height = items.reduce((h, it) => h + (it === "-" ? 8 : MENU_ITEM_H) * z, 0) + 2 * z;
  const r = { x0: title.x0, y0: sc.clip.y0 + (MENUBAR_H - 1) * z, x1: title.x0 + width, y1: 0 };
  r.y1 = r.y0 + height;
  sc.fill(r.x0 + z, r.y0 + z, r.x1 + z, r.y1 + z, 1);
  sc.fillRect(r, 0);
  sc.box(r, z);
  let y = r.y0 + z;
  items.forEach((it, i) => {
    if (it === "-") {
      sc.fill(r.x0 + z, y + 4 * z - (z >> 1), r.x1 - z, y + 4 * z - (z >> 1) + z, "gray");
      y += 8 * z;
      return;
    }
    const label = typeof it === "string" ? it : it.label;
    const disabled = typeof it !== "string" && it.disabled;
    const on = i === hilite && !disabled;
    if (on) sc.fill(r.x0 + z, y, r.x1 - z, y + MENU_ITEM_H * z, 1);
    sc.text(label, r.x0 + 14 * z, y + 2 * z, { font: "chicago", ink: on ? 0 : disabled ? "gray" : 1 });
    y += MENU_ITEM_H * z;
  });
  return r;
}

export interface WindowOptions {
  active?: boolean;
  /** Thumb position 0…1 for scroll bars; omitted for a window without them. */
  scroll?: number;
}

/** A document window; returns its content rect. */
export function windowFrame(sc: Screen, r: PixelRect, title: string, options: WindowOptions = {}): PixelRect {
  const z = sc.z;
  const active = options.active ?? true;
  sc.fill(r.x0 + z, r.y0 + z, r.x1 + z, r.y1 + z, 1);
  sc.fillRect(r, 0);
  sc.box(r, z);
  const tb = r.y0 + TITLE_H * z;
  sc.fill(r.x0, tb - z, r.x1, tb, 1);
  if (active) {
    for (let k = 0; k < 6; k++) {
      const y = r.y0 + (4 + 2 * k) * z;
      sc.fill(r.x0 + 2 * z, y, r.x1 - 2 * z, y + z, 1);
    }
    // Close box, with its white moat.
    const bx = r.x0 + 8 * z;
    const by = r.y0 + 4 * z;
    sc.fill(bx - z, by, bx + 12 * z, by + 11 * z, 0);
    sc.box({ x0: bx, y0: by, x1: bx + 11 * z, y1: by + 11 * z }, z);
  }
  const tw = sc.measure(title, { font: "chicago" }).width;
  const cx = Math.round((r.x0 + r.x1) / 2);
  const tx0 = Math.max(r.x0 + 24 * z, cx - Math.round(tw / 2) - 6 * z);
  const tx1 = Math.min(r.x1 - 6 * z, tx0 + tw + 12 * z);
  if (tx1 > tx0 + 12 * z) {
    sc.fill(tx0, r.y0 + z, tx1, tb - z, 0);
    sc.text(title, tx0 + 6 * z, r.y0 + 3 * z, { font: "chicago" });
  }
  const content = { x0: r.x0 + z, y0: tb, x1: r.x1 - z, y1: r.y1 - z };
  if (options.scroll === undefined) return content;

  const s = SCROLL_W * z;
  const bar = { x0: r.x1 - s, y0: tb - z, x1: r.x1, y1: r.y1 - s + z };
  sc.box(bar, z);
  if (active) {
    sc.pattern(bar.x0 + z, bar.y0 + s, bar.x1 - z, bar.y1 - s, PATTERNS.gray);
    arrowBox(sc, bar.x0, bar.y0, s, -1);
    arrowBox(sc, bar.x0, bar.y1 - s, s, 1);
    const travel = bar.y1 - bar.y0 - 3 * s;
    const ty = bar.y0 + s + Math.round(travel * options.scroll);
    sc.fill(bar.x0 + z, ty, bar.x1 - z, ty + s, 0);
    sc.box({ x0: bar.x0, y0: ty - z, x1: bar.x1, y1: ty + s + z }, z);
  }
  const bottom = { x0: r.x0, y0: r.y1 - s, x1: r.x1, y1: r.y1 };
  sc.box(bottom, z);
  if (active) {
    // The grow box: two overlapping squares.
    const gx = r.x1 - s;
    const gy = r.y1 - s;
    sc.box({ x0: gx + 4 * z, y0: gy + 4 * z, x1: gx + 12 * z, y1: gy + 12 * z }, z);
    sc.box({ x0: gx + 2 * z, y0: gy + 2 * z, x1: gx + 9 * z, y1: gy + 9 * z }, z);
    sc.fill(gx + 3 * z, gy + 3 * z, gx + 8 * z, gy + 8 * z, 0);
  }
  return { x0: content.x0, y0: content.y0, x1: r.x1 - s, y1: r.y1 - s };
}

function arrowBox(sc: Screen, x: number, y: number, s: number, dir: 1 | -1): void {
  const z = sc.z;
  sc.fill(x + z, y + z, x + s - z, y + s - z, 0);
  sc.box({ x0: x, y0: y, x1: x + s, y1: y + s }, z);
  const cx = x + Math.round(s / 2);
  for (let k = 0; k < 5; k++) {
    const yy = dir < 0 ? y + (4 + k) * z : y + s - (5 + k) * z;
    sc.fill(cx - (k + 1) * z, yy, cx + (k + 1) * z, yy + z, 1);
  }
}

/** A modal dialog's double frame; returns the inside. */
export function dialogFrame(sc: Screen, r: PixelRect): PixelRect {
  const z = sc.z;
  sc.fillRect(r, 0);
  sc.box(r, z);
  sc.box({ x0: r.x0 + 2 * z, y0: r.y0 + 2 * z, x1: r.x1 - 2 * z, y1: r.y1 - 2 * z }, 2 * z);
  return { x0: r.x0 + 4 * z, y0: r.y0 + 4 * z, x1: r.x1 - 4 * z, y1: r.y1 - 4 * z };
}

/** A filled round-cornered rectangle. */
function roundRect(sc: Screen, r: PixelRect, radius: number, ink: 0 | 1 | "xor"): void {
  for (let y = r.y0; y < r.y1; y++) {
    const dy = Math.max(0, r.y0 + radius - y - 0.5, y + 0.5 - (r.y1 - radius));
    const inset = radius - Math.sqrt(Math.max(0, radius * radius - dy * dy));
    sc.fill(r.x0 + Math.round(inset), y, r.x1 - Math.round(inset), y + 1, ink);
  }
}

export interface ButtonOptions {
  isDefault?: boolean;
  pressed?: boolean;
}

/** A push button; the default one wears the thick outer ring. */
export function button(sc: Screen, r: PixelRect, label: string, options: ButtonOptions = {}): void {
  const z = sc.z;
  if (options.isDefault) {
    const o = 4 * z;
    roundRect(sc, { x0: r.x0 - o, y0: r.y0 - o, x1: r.x1 + o, y1: r.y1 + o }, 8 * z, 1);
    roundRect(sc, { x0: r.x0 - z, y0: r.y0 - z, x1: r.x1 + z, y1: r.y1 + z }, 5 * z, 0);
  }
  roundRect(sc, r, 5 * z, 1);
  roundRect(sc, { x0: r.x0 + z, y0: r.y0 + z, x1: r.x1 - z, y1: r.y1 - z }, 4 * z, options.pressed ? 1 : 0);
  const h = sc.measure(label, { font: "chicago" }).height;
  const top = Math.round((r.y0 + r.y1 - h) / 2);
  sc.centered(label, (r.x0 + r.x1) / 2, top, { font: "chicago", ink: options.pressed ? 0 : 1 });
}

/** A progress bar, filled to `fraction`. */
export function progressBar(sc: Screen, r: PixelRect, fraction: number): void {
  const z = sc.z;
  sc.fillRect(r, 0);
  sc.box(r, z);
  const fx = r.x0 + z + Math.round((r.x1 - r.x0 - 2 * z) * Math.max(0, Math.min(1, fraction)));
  sc.pattern(r.x0 + z, r.y0 + z, fx, r.y1 - z, PATTERNS.dkGray);
}

/** Linear blend of two rects. */
export function mixRect(a: PixelRect, b: PixelRect, f: number): PixelRect {
  return {
    x0: Math.round(a.x0 + (b.x0 - a.x0) * f),
    y0: Math.round(a.y0 + (b.y0 - a.y0) * f),
    x1: Math.round(a.x1 + (b.x1 - a.x1) * f),
    y1: Math.round(a.y1 + (b.y1 - a.y1) * f),
  };
}

/**
 * The Finder's zoom rectangles: a trail of hollow rects flying from `from`
 * to `to` as `f` runs 0…1, drawn in XOR so they read over anything.
 */
export function zoomRects(sc: Screen, from: PixelRect, to: PixelRect, f: number): void {
  if (f <= 0 || f >= 1) return;
  for (let k = 0; k < 5; k++) {
    const g = f - k * 0.09;
    if (g <= 0) continue;
    const r = mixRect(from, to, g * g * (3 - 2 * g));
    sc.box(r, sc.z, "xor");
  }
}

/** The system cursor, hot spot at (x, y). */
export function cursor(sc: Screen, name: MacCursorName, x: number, y: number): void {
  const face = MAC_CURSOR_FACES[name];
  const z = sc.z;
  sc.sprite(face.sprite, Math.round(x - face.hotSpot.h * z), Math.round(y - face.hotSpot.v * z), z);
}

/** The generic application icon, for apps whose own icon isn't on this machine. */
export const GENERIC_APP: Sprite = (() => {
  const rows: string[] = [];
  for (let y = 0; y < 32; y++) {
    let row = "";
    for (let x = 0; x < 32; x++) {
      const d = Math.abs(x - 15.5) + Math.abs(y - 15.5);
      row += d > 15.6 ? "." : d > 14.4 || (d < 9.6 && d > 8.4) ? "#" : "o";
    }
    rows.push(row);
  }
  return fromGrid(32, 32, rows);
})();

/**
 * A desktop icon with its label below, centred on `cx`; selected icons and
 * their labels invert, as the Finder draws them.
 */
export function desktopIcon(sc: Screen, sprite: Sprite, cx: number, top: number, label: string, selected = false, k = sc.z): void {
  const x = Math.round(cx - (sprite.width * k) / 2);
  sc.sprite(sprite, x, top, k, selected);
  if (!label) return;
  const z = sc.z;
  const style = { font: "geneva", size: 9, k: z };
  const { width, height } = sc.measure(label, style);
  const ly = top + sprite.height * k + 2 * z;
  const lx = Math.round(cx - width / 2);
  sc.fill(lx - 2 * z, ly - z, lx + width + 2 * z, ly + height, selected ? 1 : 0);
  sc.text(label, lx, ly - z, { ...style, ink: selected ? 0 : 1 });
}
