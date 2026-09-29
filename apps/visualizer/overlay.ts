/**
 * What the app burns in over a scene: the reel's chapter tag when the scene
 * changes ("07 TUNNEL"), and a test card while nothing is playing.
 */
import { easeInExpo, easeOutExpo, seg } from "../showreel/ease";
import { MICRO_HEIGHT, drawMicro, microWidth } from "../showreel/microtype";
import { INK, PAPER, type Frame } from "../showreel/painter";
import { devicePainter, microScaleOf } from "./scene";

export interface SceneTag {
  number: number;
  title: string;
  /** Seconds since the scene was chosen. */
  age: number;
}

/** Slides in from the left edge, holds, slides back out. */
export function drawSceneTag(frame: Frame, tag: SceneTag): void {
  const open = easeOutExpo(seg(tag.age, 0.05, 0.35)) * (1 - easeInExpo(seg(tag.age, 1.6, 1.85)));
  if (open <= 0) return;
  const p = devicePainter(frame);
  const k = microScaleOf(frame);
  const number = String(tag.number).padStart(2, "0");
  const name = tag.title.toUpperCase();
  const pad = 2 * k;
  const x = 6 * k;
  const y = frame.height - 6 * k - MICRO_HEIGHT * k - pad * 2;
  const numberW = microWidth(number, k) + pad * 2;
  const full = numberW + pad * 2 + microWidth(name, k);
  const bottom = y + MICRO_HEIGHT * k + pad * 2;
  const clip = p.clip;
  p.clip = { ...clip, x1: Math.min(clip.x1, Math.round(x + full * open)) };
  // Opaque, so a scene's own corner captions can't tangle with it.
  p.with({ paint: INK }, () => {
    for (let row = y - k; row < bottom + k; row++) p.span(row, x - k, x + full + k);
  });
  p.with({ paint: PAPER }, () => {
    for (let row = y; row < bottom; row++) p.span(row, x, x + numberW);
    drawMicro(p, name, x + numberW + pad * 2, y + pad, k);
  });
  p.with({ paint: INK }, () => drawMicro(p, number, x + pad, y + pad, k));
  p.clip = clip;
}

/** Two centred lines on an opaque card with a double rule, so busy scenes can't bleed through; the first blinks. */
export function drawNotice(frame: Frame, lines: readonly [string, string], time: number): void {
  const p = devicePainter(frame);
  const k = microScaleOf(frame);
  const width = Math.max(...lines.map((line) => microWidth(line, k))) + 16 * k;
  const height = MICRO_HEIGHT * k * 2 + 16 * k;
  const x = Math.round((frame.width - width) / 2);
  const y = Math.round((frame.height - height) / 2);
  const box = (inset: number, paint: typeof INK) =>
    p.with({ paint }, () => {
      for (let row = y + inset; row < y + height - inset; row++) p.span(row, x + inset, x + width - inset);
    });
  box(0, INK);
  box(k, PAPER);
  box(2 * k, INK);
  box(3 * k, PAPER);
  const [title, detail] = lines;
  p.with({ paint: INK }, () => {
    if (Math.floor(time * 1.5) % 2 === 0) drawMicro(p, title, x + (width - microWidth(title, k)) / 2, y + 6 * k, k);
    drawMicro(p, detail, x + (width - microWidth(detail, k)) / 2, y + 10 * k + MICRO_HEIGHT * k, k);
  });
}
