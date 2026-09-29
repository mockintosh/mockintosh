/**
 * Every OP-1 page is four parameters, one per encoder. A page is a `Quad` of
 * values read through a `QuadDefs` of Synthesizer parameter definitions, so
 * the display, clamping and persistence are shared.
 *
 * The encoders are endless: they turn in ticks, and `nudge` moves a value by
 * ticks — one option or step for detented parameters, a hundredth of the
 * travel for continuous ones.
 */
import { clampParam, fromTravel, toTravel, type ParamDef } from "../synth/params";

export type Quad = readonly [number, number, number, number];
export type QuadDefs = readonly [ParamDef, ParamDef, ParamDef, ParamDef];

/** Which encoder: 0 blue, 1 green, 2 white, 3 orange. */
export type EncoderIndex = 0 | 1 | 2 | 3;
export const ENCODERS: readonly EncoderIndex[] = [0, 1, 2, 3];

/** Ticks for the whole travel of a continuous parameter. */
const TICKS_PER_TRAVEL = 100;

export function isDetented(def: ParamDef): boolean {
  return def.kind === "choice" || (def.kind === "number" && def.step !== undefined);
}

/** `value` turned by `ticks`, clamped to the parameter's range. */
export function nudge(def: ParamDef, value: number, ticks: number): number {
  if (def.kind === "choice") return clampParam(def, Math.round(value) + ticks);
  if (def.step !== undefined) return clampParam(def, value + ticks * def.step);
  return fromTravel(def, toTravel(def, value) + ticks / TICKS_PER_TRAVEL);
}

export function defaultQuad(defs: QuadDefs): Quad {
  return [defs[0].default, defs[1].default, defs[2].default, defs[3].default];
}

/** A quad from untrusted JSON: four finite numbers, clamped; anything else defaulted. */
export function sanitizeQuad(defs: QuadDefs, value: unknown): Quad {
  const list = Array.isArray(value) ? (value as unknown[]) : [];
  const at = (i: EncoderIndex) => {
    const v = list[i];
    return typeof v === "number" && Number.isFinite(v) ? clampParam(defs[i], v) : defs[i].default;
  };
  return [at(0), at(1), at(2), at(3)];
}

export function withValue(quad: Quad, index: EncoderIndex, value: number): Quad {
  const next: [number, number, number, number] = [quad[0], quad[1], quad[2], quad[3]];
  next[index] = value;
  return next;
}

export const percent = (v: number): string => `${Math.round(v * 100)}`;
export const signed = (unit: string) => (v: number): string => `${v > 0 ? "+" : ""}${Math.round(v)}${unit}`;
