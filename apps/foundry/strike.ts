import {
  deckerOrdinalForCharCode,
  type FontStrikeDraft,
  type FontStrikeGlyph,
} from "@mockintosh/sdk";

export const PREVIEW_LINES = [
  "Think different.",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789 $€@?",
];

export function glyphOf(draft: FontStrikeDraft, ordinal: number): FontStrikeGlyph | undefined {
  return draft.glyphs.find((g) => g.ordinal === ordinal);
}

export function toggleDraftPixel(
  draft: FontStrikeDraft,
  ordinal: number,
  x: number,
  y: number,
): FontStrikeDraft {
  return {
    ...draft,
    glyphs: draft.glyphs.map((glyph) => {
      if (glyph.ordinal !== ordinal) return glyph;
      if (x < 0 || y < 0 || x >= glyph.width || y >= draft.glyphHeight) return glyph;
      const pixels = glyph.pixels.slice();
      const i = y * glyph.width + x;
      pixels[i] = pixels[i] ? 0 : 1;
      return { ...glyph, pixels };
    }),
  };
}

export function blitDraftLines(
  draft: FontStrikeDraft,
  lines: readonly string[],
  gap = 3,
): { width: number; height: number; pixels: Uint8Array } {
  const byOrd = new Map(draft.glyphs.map((g) => [g.ordinal, g]));
  const widths = lines.map((line) => {
    let w = 0;
    for (const ch of line) {
      const g = byOrd.get(deckerOrdinalForCharCode(ch.charCodeAt(0)));
      w += (g?.width ?? 0) + draft.spacing;
    }
    return w;
  });
  const width = Math.max(1, ...widths);
  const height = Math.max(1, lines.length * draft.glyphHeight + Math.max(0, lines.length - 1) * gap);
  const pixels = new Uint8Array(width * height);
  let y = 0;
  for (let i = 0; i < lines.length; i++) {
    let x = 0;
    for (const ch of lines[i]!) {
      const g = byOrd.get(deckerOrdinalForCharCode(ch.charCodeAt(0)));
      if (!g) continue;
      for (let gy = 0; gy < draft.glyphHeight; gy++) {
        for (let gx = 0; gx < g.width; gx++) {
          if (g.pixels[gy * g.width + gx]) pixels[(y + gy) * width + x + gx] = 1;
        }
      }
      x += g.width + draft.spacing;
    }
    y += draft.glyphHeight + gap;
  }
  return { width, height, pixels };
}

export function uniqueDesktopName(existing: readonly string[], wanted: string): string {
  if (!existing.includes(wanted)) return wanted;
  const dot = wanted.lastIndexOf(".");
  const stem = dot > 0 ? wanted.slice(0, dot) : wanted;
  const ext = dot > 0 ? wanted.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

/** Character-strip chrome. Border is always reserved so selection does not shrink ink. */
export const STRIP_GAP = 1;
export const STRIP_PAD = 1;
export const STRIP_BORDER = 1;
export const STRIP_PANE_PAD = 4;
/** Overlay thumb from `overflow: scroll` (`THUMB_W` + inset). */
export const STRIP_TRACK = 4;
/** Strike thumbnail inside a cell — large drafts scale down to this box. */
export const STRIP_INK = 12;

export function stripCellSize(inkWidth: number, inkHeight: number): { width: number; height: number } {
  const chrome = (STRIP_PAD + STRIP_BORDER) * 2;
  return {
    width: Math.max(1, Math.ceil(inkWidth)) + chrome,
    height: Math.max(1, Math.ceil(inkHeight)) + chrome,
  };
}

/** Nearest-neighbor fit of a glyph into a `thumbW`×`thumbH` cell. Ink is centered. */
export function scaleGlyphToThumb(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  thumbW: number,
  thumbH: number,
): Uint8Array {
  const dest = new Uint8Array(Math.max(0, thumbW) * Math.max(0, thumbH));
  if (srcW < 1 || srcH < 1 || thumbW < 1 || thumbH < 1) return dest;
  const destW = Math.max(1, Math.min(thumbW, Math.round(srcW * Math.min(thumbW / srcW, thumbH / srcH))));
  const destH = Math.max(1, Math.min(thumbH, Math.round(srcH * Math.min(thumbW / srcW, thumbH / srcH))));
  const ox = Math.floor((thumbW - destW) / 2);
  const oy = Math.floor((thumbH - destH) / 2);
  for (let y = 0; y < destH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) / destH) * srcH));
    for (let x = 0; x < destW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) / destW) * srcW));
      dest[(oy + y) * thumbW + (ox + x)] = src[sy * srcW + sx] ? 1 : 0;
    }
  }
  return dest;
}

export function stripGlyphs(draft: FontStrikeDraft): FontStrikeGlyph[] {
  return draft.glyphs.slice().sort((a, b) => a.ordinal - b.ordinal);
}

/** How many uniform cells fit on one row, including `gap` between them. */
export function cellsPerRow(innerWidth: number, cellWidth: number, gap = STRIP_GAP): number {
  return Math.max(1, Math.floor((innerWidth + gap) / (cellWidth + gap)));
}

export function stripInnerWidth(windowWidth: number): number {
  return Math.max(0, windowWidth - STRIP_PANE_PAD * 2 - STRIP_TRACK);
}
