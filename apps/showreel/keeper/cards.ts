/**
 * Silent-film intertitles: a paper card inside an engraved double rule,
 * lettered with the broad nib and written on stroke by stroke.
 */
import { easeInOutCubic, easeOutCubic, seg } from "../ease";
import { INK, PAPER, STAGE_H, STAGE_W, type Painter } from "../painter";
import { layoutText, type PlacedGlyph } from "../type";
import { drawNib, swash } from "./nib";

const CX = STAGE_W / 2;

interface CardText {
  glyphs: PlacedGlyph[];
  size: number;
  width: number;
  baseline: number;
}

function line(text: string, size: number, top: number, width: number, tracking = 2.4): CardText {
  return { glyphs: layoutText(text, { size, tracking }, { cx: CX, top }), size, width, baseline: top + size };
}

/** The ornamental border, drawing itself outward from the corners. */
function border(p: Painter, k: number): void {
  if (k <= 0) return;
  const rules = [
    { inset: 11, weight: 1.5 },
    { inset: 15, weight: 0.6 },
  ];
  p.with({ paint: INK }, () => {
    for (const { inset, weight } of rules) {
      const w = STAGE_W - inset * 2;
      const h = STAGE_H - inset * 2;
      const run = easeInOutCubic(k);
      // Each side grows from both of its corners toward the middle.
      p.rect(inset, inset, (w * run) / 2, weight);
      p.rect(STAGE_W - inset - (w * run) / 2, inset, (w * run) / 2, weight);
      p.rect(inset, STAGE_H - inset - weight, (w * run) / 2, weight);
      p.rect(STAGE_W - inset - (w * run) / 2, STAGE_H - inset - weight, (w * run) / 2, weight);
      p.rect(inset, inset, weight, (h * run) / 2);
      p.rect(inset, STAGE_H - inset - (h * run) / 2, weight, (h * run) / 2);
      p.rect(STAGE_W - inset - weight, inset, weight, (h * run) / 2);
      p.rect(STAGE_W - inset - weight, STAGE_H - inset - (h * run) / 2, weight, (h * run) / 2);
    }
    // Corner rosettes: a ring and a dot, tucked between the rules.
    const r = 5 * easeOutCubic(seg(k, 0.5, 1));
    for (const [x, y] of [
      [19, 19],
      [STAGE_W - 19, 19],
      [19, STAGE_H - 19],
      [STAGE_W - 19, STAGE_H - 19],
    ] as const) {
      p.ring(x, y, r, 0.7);
      p.circle(x, y, r * 0.3);
    }
    // Diamonds at the middle of the top and bottom rules.
    const d = 3.2 * easeOutCubic(seg(k, 0.7, 1));
    for (const y of [13, STAGE_H - 13]) {
      p.polygon([
        { x: CX, y: y - d },
        { x: CX + d * 1.6, y },
        { x: CX, y: y + d },
        { x: CX - d * 1.6, y },
      ]);
    }
  });
}

/** Letter `text` with the nib, each glyph written on in turn across `[start, end]`. */
function letter(p: Painter, text: CardText, t: number, start: number, end: number, exposure: number): void {
  const n = text.glyphs.length;
  const span = end - start;
  text.glyphs.forEach((glyph, i) => {
    const k = seg(t, start + (i / n) * span * 0.7, start + (i / n) * span * 0.7 + span * 0.3);
    if (k <= 0) return;
    drawNib(p, glyph.strokes, { width: text.width, slant: 0.24, baseline: text.baseline, tremble: 0.18, exposure }, easeInOutCubic(k));
  });
}

const TITLE = line("THE KEEPER", 26, 54, 4.6, 2.8);
const SUBTITLE = line("A SHORT FILM ABOUT LIGHT", 6, 110, 1.3, 2.6);
const TITLE_SWASH = swash(92, 226, 92, 2.4);

export function titleCard(p: Painter, t: number, exposure: number): void {
  p.with({ paint: PAPER }, () => p.fill());
  border(p, seg(t, 0.1, 0.7));
  p.with({ paint: INK }, () => {
    letter(p, TITLE, t, 0.3, 1.2, exposure);
    const sw = seg(t, 0.95, 1.35);
    if (sw > 0) drawNib(p, [TITLE_SWASH], { width: 1.9, tremble: 0.15, exposure }, easeInOutCubic(sw));
    letter(p, SUBTITLE, t, 1.1, 1.5, exposure);
  });
}

const FIN = line("FIN", 40, 50, 6.4, 3.2);
const FIN_SWASH = swash(118, 204, 102, 2.2);
const CREDIT = line("A FILM BY CLAUDE", 6, 116, 1.3, 2.8);

export function finCard(p: Painter, t: number, exposure: number): void {
  p.with({ paint: PAPER }, () => p.fill());
  border(p, seg(t, 0.05, 0.55));
  p.with({ paint: INK }, () => {
    letter(p, FIN, t, 0.15, 0.8, exposure);
    const sw = seg(t, 0.6, 0.95);
    if (sw > 0) drawNib(p, [FIN_SWASH], { width: 1.9, tremble: 0.15, exposure }, easeInOutCubic(sw));
    letter(p, CREDIT, t, 0.75, 1.1, exposure);
  });
}
