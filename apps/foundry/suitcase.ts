/**
 * Foundry's suitcase in progress: TTConverter's job. One family, its
 * outlines by style, and the sizes frozen as hand-editable bitmap strikes.
 */
import { OutlineFace, outlineStyleOf, type FontSuitcase } from "@mockintosh/sdk";

export const STYLE_NAMES = ["Plain", "Bold", "Italic", "Bold Italic"] as const;

/** A new suitcase around one outline, in the style the font says it is. */
export function suitcaseFromOutline(bytes: Uint8Array): FontSuitcase {
  const face = new OutlineFace(bytes);
  return { family: face.familyName, strikes: [], outlines: [{ style: outlineStyleOf(face), bytes }] };
}

/** An outline's own style bits, or plain when it can't be read. */
export function detectedStyle(bytes: Uint8Array): number {
  try {
    return outlineStyleOf(new OutlineFace(bytes));
  } catch {
    return 0;
  }
}

/** Put `bytes` in the `style` slot, replacing whatever was there. */
export function withOutline(suitcase: FontSuitcase, style: number, bytes: Uint8Array): FontSuitcase {
  const outlines = suitcase.outlines.filter((o) => o.style !== style);
  outlines.push({ style, bytes });
  outlines.sort((a, b) => a.style - b.style);
  return { ...suitcase, outlines };
}

/** Freeze a strike at `size` for `style`, replacing an older one. */
export function withStrike(suitcase: FontSuitcase, size: number, style: number, data: string): FontSuitcase {
  const strikes = suitcase.strikes.filter((s) => !(s.size === size && s.style === style));
  strikes.push({ size, style, data });
  strikes.sort((a, b) => a.style - b.style || a.size - b.size);
  return { ...suitcase, strikes };
}

/** The style slot an outline occupies (0 when it isn't in the suitcase). */
export function styleOfOutline(suitcase: FontSuitcase, bytes: Uint8Array | null): number {
  return suitcase.outlines.find((o) => o.bytes === bytes)?.style ?? 0;
}

/** One line for the window: what the suitcase holds. */
export function describeSuitcase(suitcase: FontSuitcase): string {
  const outlines = suitcase.outlines.map((o) => STYLE_NAMES[o.style & 3]).join(", ");
  const strikes = suitcase.strikes
    .map((s) => (s.style ? `${s.size} ${STYLE_NAMES[s.style & 3]}` : String(s.size)))
    .join(", ");
  const parts = [suitcase.family];
  parts.push(outlines ? `outlines: ${outlines}` : "no outlines");
  parts.push(strikes ? `bitmaps: ${strikes}` : "no bitmaps");
  return parts.join(" · ");
}
