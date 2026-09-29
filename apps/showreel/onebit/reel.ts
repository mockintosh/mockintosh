/**
 * The edit: which shot plays when, and the transitions that join them. A
 * frame is a pure function of `t`, so the player can scrub, loop and pause
 * without keeping any animation state.
 */
import { easeInCubic, easeInExpo, easeInOutQuart, easeOutExpo, lerp, seg } from "../ease";
import { MICRO_HEIGHT, drawMicro, microWidth } from "../microtype";
import {
  INK,
  PAPER,
  Painter,
  STAGE_H,
  STAGE_W,
  XOR,
  createFrame,
  fitStage,
  invertRect,
  kaleidoscope,
  squeeze,
  stageRect,
  type Frame,
  type PixelRect,
  type Stage,
} from "../painter";
import { credits, depth, flow, knotCloseUp, microScale, powerOn, shape, title, titleCloseUp, tunnel, type Shot } from "./scenes";
import { oneBitScore } from "./score";
import type { ReelChapter, ReelDefinition, ReelPlayer } from "../reels";

export const REEL_DURATION = 15;
export const REEL_FPS = 30;

export const CHAPTERS: readonly ReelChapter[] = [
  { number: 1, title: "Type", start: 0, end: 2 },
  { number: 2, title: "Shape", start: 2, end: 4.5 },
  { number: 3, title: "Depth", start: 4.5, end: 7 },
  { number: 4, title: "Particles", start: 7, end: 9.5 },
  { number: 5, title: "Rhythm", start: 9.5, end: 12 },
  { number: 6, title: "Edit", start: 12, end: 13.5 },
  { number: 7, title: "Credits", start: 13.5, end: REEL_DURATION },
];

/** Single inverted frames that punctuate the cuts. */
const FLASH_FRAMES = [6.94, 10.5, 11.5, 12.0, 13.5];

/** The montage: quarter-second cuts, each a shot re-used with a treatment. */
interface EditCut {
  shot: Shot;
  /** Where in the source shot this cut starts. */
  from: number;
  treatment?: "invert" | "kaleidoscope" | "strobe" | { split: Shot; from: number };
}

const EDIT: readonly EditCut[] = [
  { shot: depth, from: 1.5, treatment: "invert" },
  { shot: shape, from: 1.8, treatment: { split: tunnel, from: 1.2 } },
  { shot: flow, from: 0.55, treatment: "kaleidoscope" },
  { shot: titleCloseUp, from: 0 },
  { shot: shape, from: 0.62, treatment: "invert" },
  { shot: knotCloseUp, from: 0, treatment: "strobe" },
];
const CUT = 0.25;

/**
 * Renders reel frames into caller-owned frames. Holds the scratch buffers
 * the transitions need, sized to the last frame it was given.
 */
export class ReelRenderer implements ReelPlayer {
  private layer: Frame = createFrame(0, 0);
  private scratch: Frame = createFrame(0, 0);

  render(frame: Frame, time: number): void {
    const t = ((time % REEL_DURATION) + REEL_DURATION) % REEL_DURATION;
    if (this.layer.width !== frame.width || this.layer.height !== frame.height) {
      this.layer = createFrame(frame.width, frame.height);
      this.scratch = createFrame(frame.width, frame.height);
    }
    const stage = fitStage(frame.width, frame.height);
    const rect = stageRect(stage);
    frame.pixels.fill(1);
    const p = new Painter(frame, stage, rect);

    this.compose(p, rect, t);

    for (const flash of FLASH_FRAMES) {
      if (t >= flash && t < flash + 1 / REEL_FPS) invertRect(frame, rect);
    }
    chapterTag(p, rect, t);
  }

  private compose(p: Painter, rect: PixelRect, t: number): void {
    const { frame } = p;
    if (t < 0.65) return powerOn(p, t);
    if (t < 2) {
      title(p, t);
      // The tube warms up: the picture opens out of the scan line.
      if (t < 0.95) {
        const open = easeInOutQuart(seg(t, 0.65, 0.95));
        squeeze(frame, this.scratch, rect, 1, Math.max(1.5 / (rect.y1 - rect.y0), open), 1);
      }
      return;
    }
    if (t < 4.5) return shape(p, t - 2);
    if (t < 7) return depth(p, t - 4.5);
    if (t < 9.5) {
      flow(p, t - 7);
      // An iris opens onto the tunnel as the last particles blow through.
      const iris = easeInExpo(seg(t, 9.22, 9.5));
      if (iris > 0) {
        this.renderShot(tunnel, 0, p.stage, rect);
        irisReveal(frame, this.layer, rect, p, iris * 200);
      }
      return;
    }
    if (t < 12) return tunnel(p, t - 9.5);
    if (t < 13.5) return this.edit(p, rect, t - 12);
    credits(p, t - 13.5);
    this.powerOff(p, rect, t - 13.5);
  }

  /** Render `shot` at local time `t` into the layer buffer. */
  private renderShot(shot: Shot, t: number, stage: Stage, rect: PixelRect): Frame {
    this.layer.pixels.fill(1);
    shot(new Painter(this.layer, stage, rect), t);
    return this.layer;
  }

  private edit(p: Painter, rect: PixelRect, t: number): void {
    const index = Math.min(EDIT.length - 1, Math.floor(t / CUT));
    const cut = EDIT[index]!;
    const local = t - index * CUT;
    // Every cut lands with a jolt that settles within a few frames.
    const jolt = Math.exp(-local * 22) * 5;
    const angle = index * 2.4;
    const stage: Stage = {
      ...p.stage,
      x: p.stage.x + Math.cos(angle) * jolt * p.stage.scale,
      y: p.stage.y + Math.sin(angle) * jolt * p.stage.scale,
    };
    const { frame } = p;
    const shotPainter = new Painter(frame, stage, rect);
    cut.shot(shotPainter, cut.from + local);

    const treatment = cut.treatment;
    if (treatment === "invert") invertRect(frame, rect);
    else if (treatment === "kaleidoscope") kaleidoscope(frame, rect);
    else if (treatment === "strobe" && Math.floor(local * REEL_FPS) % 4 < 2) invertRect(frame, rect);
    else if (typeof treatment === "object") {
      // Split screen along a diagonal that sweeps across the cut.
      const layer = this.renderShot(treatment.split, treatment.from + local, stage, rect);
      const w = rect.x1 - rect.x0;
      const sweep = lerp(0.75, 0.25, easeOutExpo(local / CUT));
      for (let y = rect.y0; y < rect.y1; y++) {
        const edge = rect.x0 + w * sweep + (y - rect.y0) * 0.45;
        const row = y * frame.width;
        const from = Math.max(rect.x0, Math.ceil(edge));
        if (from >= rect.x1) continue;
        frame.pixels.set(layer.pixels.subarray(row + from, row + rect.x1), row + from);
        if (from - 1 >= rect.x0 && from - 1 < rect.x1) frame.pixels[row + from - 1] = 0;
      }
    }

    // A cut counter, burnt in like an offline edit.
    const k = microScale(p);
    const label = `CUT ${String(index + 1).padStart(2, "0")}/${String(EDIT.length).padStart(2, "0")}`;
    p.with({ paint: XOR }, () => drawMicro(p, label, rect.x1 - microWidth(label, k) - 6 * k, rect.y0 + 5 * k, k));
  }

  /** The tube switches off: squash to a line, the line to a dot. */
  private powerOff(p: Painter, rect: PixelRect, t: number): void {
    const { frame } = p;
    if (t < 1.2) return;
    const h = rect.y1 - rect.y0;
    if (t < 1.32) {
      const k = easeInExpo(seg(t, 1.2, 1.32));
      squeeze(frame, this.scratch, rect, lerp(1, 1.04, k), Math.max(2 / h, 1 - k), 1);
      // The phosphor flares as the picture collapses.
      if (k > 0.6) {
        const row = Math.floor((rect.y0 + rect.y1) / 2);
        for (let y = row - 1; y <= row; y++) frame.pixels.fill(0, y * frame.width + rect.x0, y * frame.width + rect.x1);
      }
      return;
    }
    p.with({ paint: INK }, () => p.fill());
    const shrink = easeInCubic(seg(t, 1.32, 1.46));
    const w = lerp(STAGE_W, 4, shrink);
    // Never thinner than a device pixel, or the line falls between rows.
    const lineH = Math.max(1.2 / p.stage.scale, lerp(1, 6, seg(t, 1.4, 1.48)));
    p.with({ paint: PAPER }, () => p.rect(STAGE_W / 2 - w / 2, STAGE_H / 2 - lineH / 2, w, lineH));
  }
}

/** Copy the layer's pixels inside a circle of `radius` stage units, centred. */
function irisReveal(frame: Frame, layer: Frame, rect: PixelRect, p: Painter, radius: number): void {
  const cx = p.dx(STAGE_W / 2);
  const cy = p.dy(STAGE_H / 2);
  const R = radius * p.stage.scale;
  for (let y = rect.y0; y < rect.y1; y++) {
    const d = y + 0.5 - cy;
    if (Math.abs(d) >= R) continue;
    const half = Math.sqrt(R * R - d * d);
    const x0 = Math.max(rect.x0, Math.ceil(cx - half));
    const x1 = Math.min(rect.x1, Math.floor(cx + half));
    if (x1 <= x0) continue;
    const row = y * frame.width;
    frame.pixels.set(layer.pixels.subarray(row + x0, row + x1), row + x0);
    // A white rim on the iris.
    frame.pixels[row + x0] = 0;
    frame.pixels[row + x1 - 1] = 0;
  }
}

/** "02 SHAPE" slides in at the start of each chapter, and back out. */
function chapterTag(p: Painter, rect: PixelRect, t: number): void {
  const chapter = CHAPTERS.find((c) => t >= c.start && t < c.end);
  if (!chapter || chapter.number === 1 || chapter.number === 7) return;
  const local = t - chapter.start;
  const open = easeOutExpo(seg(local, 0.15, 0.45)) * (1 - easeInExpo(seg(local, 1.3, 1.55)));
  if (open <= 0) return;
  const k = microScale(p);
  const number = String(chapter.number).padStart(2, "0");
  const name = chapter.title.toUpperCase();
  const pad = 2 * k;
  const x = rect.x0 + 6 * k;
  const y = rect.y1 - 6 * k - MICRO_HEIGHT * k - pad;
  const numberW = microWidth(number, k) + pad * 2;
  const full = numberW + pad * 2 + microWidth(name, k);
  const clip = p.clip;
  p.clip = { ...clip, x1: Math.min(clip.x1, Math.round(x + full * open)) };
  p.with({ paint: XOR }, () => {
    for (let row = y; row < y + MICRO_HEIGHT * k + pad * 2; row++) p.span(row, x, x + numberW);
    drawMicro(p, number, x + pad, y + pad, k);
    drawMicro(p, name, x + numberW + pad * 2, y + pad, k);
  });
  p.clip = clip;
}

/** Reel one: geometric, hard-cut, 30 fps — type, shape, depth, particles, rhythm, edit. */
export const ONE_BIT_REEL: ReelDefinition = {
  id: "one-bit",
  title: "One Bit",
  duration: REEL_DURATION,
  fps: REEL_FPS,
  chapters: CHAPTERS,
  createPlayer: () => new ReelRenderer(),
  createSoundtrack: oneBitScore,
};
