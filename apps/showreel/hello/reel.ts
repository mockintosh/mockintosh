/**
 * Hello: the launch film for Mockintosh, made of nothing but the machine
 * itself — its system fonts, its icons, its cursors, its windows, menus and
 * zoom rectangles — at its own pixels. It boots, says hello, throws open every
 * window it has, lets its menus talk, parades its apps and shuts down.
 */
import type { MacCursorName } from "@mockintosh/ui";
import { easeInOutCubic, easeOutCubic, easeOutExpo, hash, lerp, seg } from "../ease";
import { fitStage, stageRect, type Frame, type PixelRect } from "../painter";
import type { ReelAssets, ReelChapter, ReelDefinition, ReelPlayer } from "../reels";
import { castFrom, type Cast } from "./cast";
import {
  PATTERNS,
  button,
  cursor,
  desktopIcon,
  dialogFrame,
  menu,
  menubar,
  mixRect,
  progressBar,
  windowFrame,
  zoomRects,
  type MenuItem,
  type MenuTitle,
} from "../desktop";
import { helloScore } from "./score";
import { Screen, type FontStyle, type Pattern } from "../screen";
import {
  CARDS,
  CLOSE_GAP,
  CLOSE_START,
  FLICKER,
  FLICKER_AT,
  FLICKER_STEP,
  HELLO_OPENS,
  LAND_AT,
  LAND_GAP,
  STORM_GAP,
  STORM_OPEN,
  TAGLINE,
  WORDMARK,
} from "./cues";
import { STORM, drawStormWindow } from "./windows";

export const HELLO_DURATION = 15;
export const HELLO_FPS = 30;

export const HELLO_CHAPTERS: readonly ReelChapter[] = [
  { number: 1, title: "Power On", start: 0, end: 2 },
  { number: 2, title: "Hello", start: 2, end: 4.4 },
  { number: 3, title: "Windows", start: 4.4, end: 7.2 },
  { number: 4, title: "Type", start: 7.2, end: 9.8 },
  { number: 5, title: "Apps", start: 9.8, end: 12.4 },
  { number: 6, title: "Shut Down", start: 12.4, end: HELLO_DURATION },
];

const MENUS = ["File", "Edit", "View", "Special"] as const;
const SPECIAL = 3;

/** Where the desktop's own icons stand, on the stage. */
const HD_AT = { u: 292, v: 24 };
const TRASH_AT = { u: 292, v: 138 };

// —— Shared pieces ——————————————————————————————————————————————

interface Key {
  t: number;
  x: number;
  y: number;
  face?: MacCursorName;
}

/** Glide the pointer through keyframes; hidden before the first. */
function track(keys: readonly Key[], t: number): Key | null {
  if (keys.length === 0 || t < keys[0]!.t) return null;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t < b.t) {
      const f = easeInOutCubic((t - a.t) / (b.t - a.t));
      return { t, x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), face: a.face };
    }
  }
  return keys[keys.length - 1]!;
}

function pointer(sc: Screen, keys: readonly Key[], t: number): void {
  const k = track(keys, t);
  if (k) cursor(sc, k.face ?? "arrow", k.x, k.y);
}

function desk(sc: Screen, pattern: Pattern = PATTERNS.gray): void {
  const c = sc.clip;
  sc.pattern(c.x0, c.y0, c.x1, c.y1, pattern, c.x0, c.y0);
}

function iconRect(sc: Screen, u: number, v: number): PixelRect {
  const half = 16 * sc.z;
  const x = sc.x(u);
  return { x0: x - half, y0: sc.y(v), x1: x + half, y1: sc.y(v) + 32 * sc.z };
}

function desktopIcons(sc: Screen, cast: Cast, hdSelected = false, trashSelected = false, trashShake = 0): void {
  desktopIcon(sc, cast.hd, sc.x(HD_AT.u), sc.y(HD_AT.v), "Mockintosh HD", hdSelected);
  desktopIcon(sc, cast.trash, sc.x(TRASH_AT.u) + trashShake, sc.y(TRASH_AT.v), "Trash", trashSelected);
}

/** Whole-number steps that overshoot and settle: a pixel-true pop. */
function pop(frames: number, settle: number, z: number): number {
  const steps = [0.5, 1.5, 1.2, 1];
  const f = steps[Math.min(steps.length - 1, Math.max(0, Math.floor(frames)))]!;
  return Math.max(z, Math.round(settle * f));
}

/** The item the pointer is on while it drags down a menu, blinking once chosen. */
function menuDrag(items: readonly MenuItem[], target: number, t: number, t0: number, t1: number): number {
  if (t < t0) return -1;
  const live = items.map((it, i) => (it === "-" ? -1 : i)).filter((i) => i >= 0 && i <= target);
  if (t < t1) return live[Math.min(live.length - 1, Math.floor(((t - t0) / (t1 - t0)) * live.length))]!;
  // The choose blink: three flashes.
  return Math.floor((t - t1) / 0.04) % 2 === 1 ? -1 : target;
}

function menuItemY(sc: Screen, items: readonly MenuItem[], index: number): number {
  let y = sc.clip.y0 + 20 * sc.z;
  for (let i = 0; i < index; i++) y += (items[i] === "-" ? 8 : 16) * sc.z;
  return y + 8 * sc.z;
}

// —— 1. Power On ————————————————————————————————————————————————

function powerOn(sc: Screen, t: number, cast: Cast): void {
  if (t < 0.25) return;
  const c = sc.clip;
  const z = sc.z;
  const warm = seg(t, 0.25, 0.52);
  if (warm < 1) {
    // The tube warms: a hot line opens across, then the picture rolls open.
    const wf = easeOutExpo(Math.min(1, warm / 0.4));
    const hf = easeOutExpo(Math.max(0, (warm - 0.4) / 0.6));
    const cx = (c.x0 + c.x1) / 2;
    const cy = (c.y0 + c.y1) / 2;
    const hw = ((c.x1 - c.x0) / 2) * wf;
    const hh = Math.max(z, ((c.y1 - c.y0) / 2) * hf);
    const open = {
      x0: Math.round(cx - hw),
      y0: Math.round(cy - hh),
      x1: Math.round(cx + hw),
      y1: Math.round(cy + hh),
    };
    if (hf <= 0) sc.fillRect(open, 0);
    else desk(sc.within(open));
    return;
  }
  desk(sc);
  const cx = sc.x(160);
  if (t < 1.05) {
    const k = pop((t - 0.56) * 30, 2 * z, z);
    if (t >= 0.56) sc.sprite(cast.happy, cx - 16 * k, sc.y(84) - 16 * k, k);
    return;
  }
  if (t >= 1.97) return;
  // "Welcome to Mockintosh." and the extensions marching in along the bottom.
  const text = "Welcome to Mockintosh.";
  const tw = sc.measure(text, { font: "chicago" }).width;
  const box = {
    x0: cx - Math.round(tw / 2) - 28 * z,
    y0: sc.y(84) - 34 * z,
    x1: cx + Math.round(tw / 2) + 28 * z,
    y1: sc.y(84) + 26 * z,
  };
  const inside = dialogFrame(sc, box);
  sc.centered(text, cx, inside.y0 + 12 * z, { font: "chicago" });
  const f = seg(t, 1.15, 1.9);
  const stepped = Math.floor(f * 9 + hash(Math.floor(f * 9), 3) * 0.9) / 9;
  progressBar(
    sc,
    {
      x0: inside.x0 + 20 * z,
      y0: inside.y0 + 32 * z,
      x1: inside.x1 - 20 * z,
      y1: inside.y0 + 42 * z,
    },
    stepped,
  );
  for (let i = 0; i < cast.apps.length; i++) {
    if (t < 1.15 + i * 0.055) break;
    const x = c.x0 + 6 * z + i * 36 * z;
    if (x + 32 * z > c.x1) break;
    sc.sprite(cast.apps[i]!.icon, x, c.y1 - 38 * z, z);
  }
}

// —— 2. Hello ——————————————————————————————————————————————————

interface Word {
  style: FontStyle;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Glyph pixels in the order the pen reaches them. */
  pixels: readonly { x: number; y: number }[];
}

const wordCache = new Map<string, Word>();

/** "hello", in Los Angeles — the system's handwriting — as big as whole pixels allow. */
function helloWord(sc: Screen, u0: number, v0: number, u1: number, v1: number): Word {
  const key = `${sc.stage.scale}:${sc.stage.x}:${sc.stage.y}:${u0},${v0},${u1},${v1}`;
  const hit = wordCache.get(key);
  if (hit) return hit;
  const base = { font: "losAngeles", size: 24, k: 1 };
  const one = sc.measure("hello", base);
  const k = Math.max(1, Math.min(Math.floor(sc.len(u1 - u0) / one.width), Math.floor(sc.len(v1 - v0) / one.height)));
  const style = { ...base, k };
  const width = one.width * k;
  const height = one.height * k;
  const pixels = sc
    .glyphPixels("hello", base)
    .map((p) => ({ ...p, order: p.x + (one.height - p.y) * 0.45 }))
    .sort((a, b) => a.order - b.order);
  const word = {
    style,
    width,
    height,
    x: Math.round((sc.x(u0) + sc.x(u1) - width) / 2),
    y: Math.round((sc.y(v0) + sc.y(v1) - height) / 2),
    pixels,
  };
  wordCache.set(key, word);
  return word;
}

function drawWord(sc: Screen, word: Word, count = word.pixels.length, halo = true): void {
  const k = word.style.k ?? 1;
  const n = Math.min(count, word.pixels.length);
  if (halo) {
    for (let i = 0; i < n; i++) {
      const p = word.pixels[i]!;
      sc.fill(word.x + (p.x - 1) * k, word.y + (p.y - 1) * k, word.x + (p.x + 2) * k, word.y + (p.y + 2) * k, 0);
    }
  }
  for (let i = 0; i < n; i++) {
    const p = word.pixels[i]!;
    sc.fill(word.x + p.x * k, word.y + p.y * k, word.x + (p.x + 1) * k, word.y + (p.y + 1) * k, 1);
  }
}

function wordBounds(sc: Screen, word: Word): PixelRect {
  const m = 8 * sc.z;
  return {
    x0: word.x - m,
    y0: word.y - m,
    x1: word.x + word.width + m,
    y1: word.y + word.height + m,
  };
}

function hello(sc: Screen, t: number, cast: Cast): void {
  desk(sc);
  menubar(sc, MENUS, -1, easeOutCubic(seg(t, 2, 2.15)));
  if (t >= 2.1) desktopIcons(sc, cast);
  const word = helloWord(sc, 40, 44, 280, 150);
  const k = word.style.k ?? 1;
  const write = seg(t, 2.55, 3.85);
  const n = Math.floor(word.pixels.length * (write * 0.85 + 0.15 * easeInOutCubic(write)));
  drawWord(sc, word, n);

  const bounds = wordBounds(sc, word);
  const first = word.pixels[0]!;
  const last = word.pixels[word.pixels.length - 1]!;
  if (t >= 3.95) {
    const f = easeInOutCubic(seg(t, 3.95, 4.2));
    const r = mixRect({ x0: bounds.x0, y0: bounds.y0, x1: bounds.x0, y1: bounds.y0 }, bounds, f);
    sc.ants(r, Math.floor(t * 12));
  }
  if (write > 0 && write < 1) {
    const p = word.pixels[Math.max(0, n - 1)]!;
    cursor(sc, "cross", word.x + p.x * k + k / 2, word.y + p.y * k + k / 2);
    return;
  }
  pointer(
    sc,
    [
      { t: 2.2, x: sc.x(330), y: sc.y(190) },
      {
        t: 2.55,
        x: word.x + first.x * k,
        y: word.y + first.y * k,
        face: "cross",
      },
      { t: 3.85, x: word.x + last.x * k, y: word.y + last.y * k },
      { t: 3.95, x: bounds.x0, y: bounds.y0 },
      { t: 4.2, x: bounds.x1, y: bounds.y1 },
    ],
    t,
  );
}

// —— 3. Windows —————————————————————————————————————————————————

const HELLO_WINDOW: readonly [number, number, number, number] = [56, 30, 264, 126];

function stormRect(sc: Screen, at: readonly [number, number, number, number]): PixelRect {
  return sc.rect(at[0], at[1], at[2], at[3]);
}

function windows(sc: Screen, t: number, cast: Cast): void {
  const z = sc.z;
  desk(sc);
  menubar(sc, MENUS);
  const shaking = t > 6.45 && t < 6.95;
  const shake = shaking ? Math.round((hash(Math.floor(t * 30), 9) - 0.5) * 3) * z : 0;
  const hdFlash = t >= HELLO_OPENS && t < HELLO_OPENS + 0.1 && Math.floor(t * 40) % 2 === 0;
  desktopIcons(sc, cast, t >= 4.5 && t < 6.3 && !hdFlash, t >= 6.4 && t < 7, shake);

  const word = helloWord(sc, 40, 44, 280, 150);
  const hd = iconRect(sc, HD_AT.u, HD_AT.v);
  const trash = iconRect(sc, TRASH_AT.u, TRASH_AT.v);
  const count = STORM.length + 1;
  // Index 0 is the hello window; 1… are the storm, in opening order.
  const all = [
    { rect: stormRect(sc, HELLO_WINDOW), opens: HELLO_OPENS },
    ...STORM.map((w, i) => ({
      rect: stormRect(sc, w.at),
      opens: STORM_OPEN + i * STORM_GAP,
    })),
  ];
  const closesAt = (i: number) => CLOSE_START + (count - 1 - i) * CLOSE_GAP;
  let top = -1;
  all.forEach((w, i) => {
    if (t >= w.opens && t < closesAt(i)) top = i;
  });

  all.forEach((w, i) => {
    const shut = closesAt(i);
    if (t < w.opens) {
      const from = i === 0 ? wordBounds(sc, word) : hd;
      zoomRects(sc, from, w.rect, seg(t, w.opens - 0.12, w.opens));
      return;
    }
    if (t >= shut) {
      zoomRects(sc, w.rect, trash, seg(t, shut, shut + 0.16));
      return;
    }
    if (i === 0) {
      const content = windowFrame(sc, w.rect, "hello", { active: top === 0 });
      const small = helloWord(sc, HELLO_WINDOW[0] + 20, HELLO_WINDOW[1] + 22, HELLO_WINDOW[2] - 20, HELLO_WINDOW[3] - 6);
      drawWord(sc.within(content), small, Infinity, false);
      return;
    }
    drawStormWindow(sc, STORM[i - 1]!, w.rect, t - w.opens, cast, top === i);
  });

  pointer(
    sc,
    [
      { t: 4.4, x: wordBounds(sc, word).x1, y: wordBounds(sc, word).y1 },
      { t: 4.54, x: hd.x0 + 16 * z, y: hd.y0 + 14 * z },
      { t: 6.1, x: hd.x0 + 16 * z, y: hd.y0 + 14 * z },
      { t: 6.4, x: trash.x0 + 16 * z, y: trash.y0 + 12 * z },
    ],
    t,
  );
}

// —— 4. Type ————————————————————————————————————————————————————

const SPECIAL_ITEMS: readonly MenuItem[] = ["512 x 342", "One Bit", "Every Pixel", "On Purpose", "-", { label: "Shut Down", disabled: true }];

function bigType(
  sc: Screen,
  text: string,
  font: string,
  size: number | undefined,
  fill: number,
  frames: number,
  ink: 0 | 1,
): { x: number; y: number; width: number; height: number; k: number } {
  const c = sc.clip;
  const one = sc.measure(text, { font, size, k: 1 });
  const settle = Math.max(1, Math.min(Math.floor(((c.x1 - c.x0) * fill) / one.width), Math.floor(((c.y1 - c.y0) * 0.6) / one.height)));
  const k = pop(frames, settle, 1);
  const width = one.width * k;
  const height = one.height * k;
  const x = Math.round((c.x0 + c.x1 - width) / 2);
  const y = Math.round((c.y0 + c.y1 - height) / 2);
  sc.text(text, x, y, { font, size, k, ink });
  return { x, y, width, height, k };
}

function typeCards(sc: Screen, t: number, cast: Cast): void {
  const z = sc.z;
  const c = sc.clip;
  if (t < 7.8) {
    desk(sc);
    const open = t >= 7.35;
    const titles = menubar(sc, MENUS, open ? SPECIAL : -1);
    desktopIcons(sc, cast);
    const special = titles[SPECIAL]!;
    const hilite = menuDrag(SPECIAL_ITEMS, 3, t, 7.42, 7.64);
    if (open) menu(sc, special, SPECIAL_ITEMS, hilite);
    const tx = Math.round((special.x0 + special.x1) / 2);
    pointer(
      sc,
      [
        { t: 7.2, x: sc.x(TRASH_AT.u), y: sc.y(TRASH_AT.v + 12) },
        { t: 7.35, x: tx, y: c.y0 + 10 * z },
        { t: 7.42, x: tx, y: c.y0 + 10 * z },
        { t: 7.64, x: tx + 6 * z, y: menuItemY(sc, SPECIAL_ITEMS, 3) },
      ],
      t,
    );
    return;
  }
  if (t < FLICKER_AT) {
    let card = CARDS[0]!;
    for (const k of CARDS) if (t >= k.at) card = k;
    sc.fillRect(c, card.inverse ? 1 : 0);
    const ink = card.inverse ? 0 : 1;
    const frames = (t - card.at) * 30;
    if (card.deco === "grid") {
      const g = 6 * z;
      for (let y = c.y0 + g; y < c.y1; y += g) for (let x = c.x0 + g; x < c.x1; x += g) sc.set(x, y, 1);
    }
    const box = bigType(sc, card.text, card.font, card.size, 0.84, frames, ink);
    if (card.deco === "dimensions" && frames >= 2) {
      // Dimension lines, as on an engineering drawing of the screen.
      const y = box.y - 12 * z;
      sc.fill(box.x, y, box.x + box.width, y + z, 1);
      sc.fill(box.x, y - 4 * z, box.x + z, y + 5 * z, 1);
      sc.fill(box.x + box.width - z, y - 4 * z, box.x + box.width, y + 5 * z, 1);
      sc.centered("512 pixels", box.x + box.width / 2, y - 12 * z, {
        font: "geneva",
        size: 9,
      });
      const x = box.x + box.width + 10 * z;
      sc.fill(x, box.y, x + z, box.y + box.height, 1);
      sc.fill(x - 4 * z, box.y, x + 5 * z, box.y + z, 1);
      sc.fill(x - 4 * z, box.y + box.height - z, x + 5 * z, box.y + box.height, 1);
      sc.centered("342", box.x + box.width / 2, box.y + box.height + 6 * z, {
        font: "geneva",
        size: 9,
      });
    }
    return;
  }
  const i = Math.min(FLICKER.length - 1, Math.floor((t - FLICKER_AT) / FLICKER_STEP));
  const inverse = i < FLICKER.length - 1 && i % 2 === 0;
  sc.fillRect(c, inverse ? 1 : 0);
  bigType(sc, "Mockintosh", FLICKER[i]!, undefined, 0.8, 3, inverse ? 0 : 1);
}

// —— 5. Apps ————————————————————————————————————————————————————

const PATTERN_CYCLE: readonly Pattern[] = [
  PATTERNS.gray,
  PATTERNS.bricks,
  PATTERNS.weave,
  PATTERNS.hearts,
  PATTERNS.scales,
  PATTERNS.tiles,
  PATTERNS.diagonal,
  PATTERNS.dots,
  PATTERNS.ltGray,
  PATTERNS.dkGray,
  PATTERNS.bricks,
  PATTERNS.gray,
  PATTERNS.gray,
];
const GRID_COLS = 5;
const GRID_ROWS = 3;

function slot(i: number): { u: number; v: number; order: number } {
  const col = i % GRID_COLS;
  const row = Math.floor(i / GRID_COLS);
  // Snake order, so the landings sweep back and forth like a typewriter.
  const order = row * GRID_COLS + (row % 2 === 0 ? col : GRID_COLS - 1 - col);
  return { u: 160 + (col - 2) * 58, v: 40 + row * 46, order };
}

function apps(sc: Screen, t: number, cast: Cast): void {
  const z = sc.z;
  const c = sc.clip;
  desk(sc, PATTERN_CYCLE[Math.min(PATTERN_CYCLE.length - 1, Math.floor((t - 9.8) / 0.2))]!);
  menubar(sc, MENUS);
  const select = { x0: sc.x(10), y0: sc.y(22) };
  const f = easeInOutCubic(seg(t, 11.15, 11.55));
  const marquee =
    t >= 11.15 && t < 11.8
      ? {
          ...select,
          x1: Math.round(lerp(select.x0, sc.x(310), f)),
          y1: Math.round(lerp(select.y0, sc.y(174), f)),
        }
      : null;
  const drag = easeInOutCubic(seg(t, 11.8, 12.3));
  const n = Math.min(cast.apps.length, GRID_COLS * GRID_ROWS);
  for (let i = 0; i < n; i++) {
    const s = slot(i);
    const lands = LAND_AT + s.order * LAND_GAP;
    if (t < lands) continue;
    const cx = sc.x(s.u);
    const cy = sc.y(s.v);
    const selected = t >= 11.55 || (marquee !== null && cx < marquee.x1 && cy < marquee.y1);
    const k = pop((t - lands) * 30 + 1, z, z);
    if (t < 12.3) desktopIcon(sc, cast.apps[i]!.icon, cx, cy - 16 * k, cast.apps[i]!.label, selected, k);
    if (drag > 0 && drag < 1) {
      // The Finder drags outlines, not icons.
      const gx = Math.round(lerp(cx, sc.x(160), drag));
      const gy = Math.round(lerp(cy, sc.y(80), drag));
      sc.box({ x0: gx - 16 * z, y0: gy - 16 * z, x1: gx + 16 * z, y1: gy + 16 * z }, z, "xor");
    }
  }
  if (marquee) sc.ants(marquee, Math.floor(t * 12));
  if (t >= 12.3) sc.fillRect(c, "xor");
  const last = slot(n - 1);
  pointer(
    sc,
    [
      { t: 10.9, x: sc.x(340), y: sc.y(10) },
      { t: 11.15, x: select.x0, y: select.y0 },
      { t: 11.55, x: sc.x(310), y: sc.y(174) },
      { t: 11.7, x: sc.x(last.u), y: sc.y(last.v) },
      { t: 11.8, x: sc.x(last.u), y: sc.y(last.v) },
      { t: 12.3, x: sc.x(160), y: sc.y(80) },
    ],
    t,
  );
}

// —— 6. Shut Down ———————————————————————————————————————————————

const SHUT_ITEMS: readonly MenuItem[] = ["512 x 342", "One Bit", "Every Pixel", "On Purpose", "-", "Shut Down"];

function shutDown(sc: Screen, t: number, cast: Cast): void {
  const z = sc.z;
  const c = sc.clip;
  if (t < 13.95) {
    sc.fillRect(c, 0);
    // Sized to the stage, in whole pixels, so the lockup holds at any window size.
    const k = pop((t - 12.4) * 30, Math.max(z, Math.round(sc.len(60) / cast.happy.height)), z);
    const cx = sc.x(160);
    sc.sprite(cast.happy, cx - Math.round((cast.happy.width * k) / 2), sc.y(82) - cast.happy.height * k, k);
    // The wordmark drops in a letter at a time.
    const markHeight = sc.measure(WORDMARK, { font: "chicago", k: 1 }).height;
    const style = {
      font: "chicago",
      k: Math.max(z, Math.round(sc.len(34) / markHeight)),
    };
    const width = sc.measure(WORDMARK, style).width;
    let x = Math.round(cx - width / 2);
    for (let i = 0; i < WORDMARK.length; i++) {
      const ch = WORDMARK[i]!;
      const at = 12.6 + i * 0.045;
      const w = sc.measure(ch, style).width + 3 * z;
      if (t >= at) {
        const frames = (t - at) * 30;
        const lift = frames < 3 ? (3 - Math.floor(frames)) * 5 * z : 0;
        sc.text(ch, x, sc.y(90) - lift, style);
      }
      x += w;
    }
    const typed = Math.floor(seg(t, 13.12, 13.45) * TAGLINE.length);
    if (typed > 0)
      sc.centered(TAGLINE.slice(0, typed), cx, sc.y(132), {
        font: "geneva",
        size: 12,
      });
    if (t >= 13.4) {
      const open = t >= 13.6;
      const titles = menubar(sc, MENUS, open ? SPECIAL : -1, easeOutCubic(seg(t, 13.4, 13.5)));
      const special = titles[SPECIAL]!;
      if (open) menu(sc, special, SHUT_ITEMS, menuDrag(SHUT_ITEMS, 5, t, 13.64, 13.8));
      const tx = Math.round((special.x0 + special.x1) / 2);
      pointer(
        sc,
        [
          { t: 13.42, x: sc.x(250), y: sc.y(150) },
          { t: 13.6, x: tx, y: c.y0 + 10 * z },
          { t: 13.64, x: tx, y: c.y0 + 10 * z },
          { t: 13.8, x: tx + 6 * z, y: menuItemY(sc, SHUT_ITEMS, 5) },
        ],
        t,
      );
    }
    return;
  }
  if (t < 14.05) {
    desk(sc);
    return;
  }
  desk(sc);
  const lines = ["It is now safe to switch off", "your Mockintosh."];
  const tw = Math.max(...lines.map((l) => sc.measure(l, { font: "chicago" }).width));
  const cx = sc.x(160);
  const cy = sc.y(90);
  const box = {
    x0: cx - Math.round(tw / 2) - 34 * z,
    y0: cy - 40 * z,
    x1: cx + Math.round(tw / 2) + 34 * z,
    y1: cy + 40 * z,
  };
  const inside = dialogFrame(sc, box);
  sc.sprite(cast.happy, inside.x0 + 8 * z, inside.y0 + 8 * z, z);
  lines.forEach((l, i) =>
    sc.text(l, inside.x0 + 48 * z, inside.y0 + 10 * z + i * 16 * z, {
      font: "chicago",
    }),
  );
  button(
    sc,
    {
      x0: inside.x1 - 78 * z,
      y0: inside.y1 - 26 * z,
      x1: inside.x1 - 12 * z,
      y1: inside.y1 - 8 * z,
    },
    "Restart",
  );
  // The picture dies on the phosphor: pixels drop out to black.
  const fade = seg(t, 14.6, 14.9);
  if (fade > 0) {
    for (let y = c.y0; y < c.y1; y++) {
      for (let x = c.x0; x < c.x1; x++) if (hash(x >> (z - 1), (y >> (z - 1)) * 3 + 1) < fade * 1.05) sc.frame.pixels[y * sc.frame.width + x] = 1;
    }
  }
}

// —— The reel ———————————————————————————————————————————————————

function paintHello(frame: Frame, t: number, cast: Cast): void {
  frame.pixels.fill(1);
  const stage = fitStage(frame.width, frame.height);
  const sc = new Screen(frame, stage, stageRect(stage));
  if (t < 2) powerOn(sc, t, cast);
  else if (t < 4.4) hello(sc, t, cast);
  else if (t < 7.2) windows(sc, t, cast);
  else if (t < 9.8) typeCards(sc, t, cast);
  else if (t < 12.4) apps(sc, t, cast);
  else if (t < 14.9) shutDown(sc, t, cast);
}

class HelloPlayer implements ReelPlayer {
  private readonly cast: Cast;

  constructor(assets: ReelAssets) {
    this.cast = castFrom(assets);
  }

  render(frame: Frame, time: number): void {
    const t = ((time % HELLO_DURATION) + HELLO_DURATION) % HELLO_DURATION;
    paintHello(frame, t, this.cast);
  }
}

/** Reel three: Mockintosh introducing itself, in its own pixels. */
export const HELLO_REEL: ReelDefinition = {
  id: "hello",
  title: "Hello, Mockintosh",
  duration: HELLO_DURATION,
  fps: HELLO_FPS,
  chapters: HELLO_CHAPTERS,
  createPlayer: (assets) => new HelloPlayer(assets),
  createSoundtrack: helloScore,
};
