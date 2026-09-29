/**
 * The cassette's window: three lanes of the bar under the playhead — drums,
 * chords, then the hummed line. Downbeats stay visible when a lane is empty,
 * so the grid reads before anything is recorded.
 */
import { STEPS_PER_BAR, type Loop } from "./loop";
import { rect, type Frame } from "../synth/pixels";

export const GRID_W = 220;
export const GRID_H = 54;

const LANES = 3;

export function drawTape(frame: Frame, loop: Loop, step: number): void {
  frame.pixels.fill(1);
  const bars = loop.bars;
  const bar = step < 0 ? 0 : Math.floor(step / STEPS_PER_BAR) % bars;
  const origin = bar * STEPS_PER_BAR;
  const padX = 2;
  const padY = 2;
  const cellW = (frame.width - padX * 2) / STEPS_PER_BAR;
  const laneH = (frame.height - padY * 2) / LANES;

  for (let s = 0; s < STEPS_PER_BAR; s++) {
    const index = origin + s;
    const x = Math.round(padX + s * cellW);
    const w = Math.max(1, Math.round(padX + (s + 1) * cellW) - x - 1);
    const drum =
      (loop.kick[index] ?? 0) + (loop.snare[index] ?? 0) + (loop.hat[index] ?? 0) + (loop.open[index] ?? 0) > 0;
    const marks = [drum, (loop.chords[index] ?? -1) >= 0, (loop.lead[index] ?? -1) >= 0];
    for (let lane = 0; lane < LANES; lane++) {
      const y = Math.round(padY + lane * laneH);
      const h = Math.max(1, Math.round(padY + (lane + 1) * laneH) - y - 1);
      if (marks[lane]) rect(frame, x, y + 1, w, Math.max(1, h - 1), 0);
      else if (s % 4 === 0) rect(frame, x + Math.floor(w / 2), y + h - 2, 1, 2, 0);
    }
    if (index === step) rect(frame, x, padY, 1, frame.height - padY * 2, 0);
  }
}
