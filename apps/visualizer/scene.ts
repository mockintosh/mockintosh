/**
 * A visualization: something that paints a whole frame from what the
 * speaker is playing now. Unlike a reel's shot, a scene is live, so it may
 * keep state from frame to frame (trails, particles, a simulation); the app
 * creates a fresh one each time the scene is chosen.
 */
import { Painter, type Frame } from "../showreel/painter";
import type { Listening } from "./listen";

export type { Frame };

export interface Scene {
  /** Paint every pixel of `frame` (`1` = black), which may change size between calls. */
  render(frame: Frame, sound: Listening): void;
}

export interface SceneDefinition {
  id: string;
  title: string;
  create(): Scene;
}

/** A menu of scenes: one submenu of the Visualization menu, one stop for ↑ and ↓. */
export interface SceneGroup {
  id: string;
  title: string;
  scenes: readonly SceneDefinition[];
}

/** Device pixels per unit of a 180-unit design height, for sizing strokes and type. */
export function unitOf(frame: Frame): number {
  return Math.min(frame.width, frame.height) / 180;
}

/** A painter whose units are device pixels. */
export function devicePainter(frame: Frame): Painter {
  return new Painter(frame, { scale: 1, x: 0, y: 0 });
}

/** Integer pixel size for micro type: 1 in a small window, 2 once the frame is big. */
export function microScaleOf(frame: Frame): number {
  return unitOf(frame) >= 1.6 ? 2 : 1;
}

/** mulberry32: seeded, so a scene's randomness is the same in every test run. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Exponential smoothing toward `target` with time constant `tau` seconds. */
export function approach(value: number, target: number, dt: number, tau: number): number {
  return value + (target - value) * (1 - Math.exp(-dt / tau));
}

/** Twelve-tone name of a MIDI note, split so the sharp can be drawn as a superscript. */
export interface NoteLabel {
  letter: string;
  sharp: boolean;
  octave: number;
  /** Signed cents from the nearest equal-tempered note. */
  cents: number;
}

const LETTERS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"] as const;
const SHARPS = [false, true, false, true, false, false, true, false, true, false, true, false] as const;

export function noteLabel(note: number): NoteLabel {
  const nearest = Math.round(note);
  const pc = ((nearest % 12) + 12) % 12;
  return {
    letter: LETTERS[pc]!,
    sharp: SHARPS[pc]!,
    octave: Math.floor(nearest / 12) - 1,
    cents: Math.round((note - nearest) * 100),
  };
}

export function noteText(label: NoteLabel): string {
  return `${label.letter}${label.sharp ? "#" : ""}${label.octave}`;
}
