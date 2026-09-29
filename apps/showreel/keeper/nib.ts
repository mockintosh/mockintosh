/**
 * Broad-nib lettering: every stroke skeleton is swept by a flat pen held
 * at a fixed angle, so thick and thin fall out of the stroke's direction
 * the way they do with a real nib. The hand trembles a little on every
 * exposure, which is what makes lettering on film boil.
 */
import type { Painter, Vec } from "../painter";
import { partialStroke, type Stroke } from "../type";

export interface NibStyle {
  /** Pen width in stage units. */
  width: number;
  /** Pen angle in radians (y down, so negative leans up-right). */
  angle?: number;
  /** Italic slant: x shift per unit above `baseline`. */
  slant?: number;
  baseline?: number;
  /** Hand tremble, in stage units. */
  tremble?: number;
  /** Which exposure this is; the tremble changes with it. */
  exposure?: number;
}

function place(q: Vec, style: NibStyle): Vec {
  const slant = style.slant ?? 0;
  const tremble = style.tremble ?? 0;
  const e = style.exposure ?? 0;
  return {
    x: q.x + ((style.baseline ?? q.y) - q.y) * slant + Math.sin(q.y * 0.9 + e * 1.7) * tremble,
    y: q.y + Math.sin(q.x * 0.8 + e * 2.3) * tremble,
  };
}

/** Sweep the nib along `strokes`, each written on to `fraction`. */
export function drawNib(p: Painter, strokes: readonly Stroke[], style: NibStyle, fraction = 1): void {
  const angle = style.angle ?? -0.7;
  const nx = (Math.cos(angle) * style.width) / 2;
  const ny = (Math.sin(angle) * style.width) / 2;
  const hairline = Math.max(0.35, style.width * 0.1);
  for (const skeleton of strokes) {
    const part = fraction >= 1 ? skeleton : partialStroke(skeleton, fraction);
    if (part.length === 0) continue;
    const pts = part.map((q) => place(q, style));
    if (pts.length === 1) p.circle(pts[0]!.x, pts[0]!.y, style.width / 2);
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      p.polygon([
        { x: a.x + nx, y: a.y + ny },
        { x: b.x + nx, y: b.y + ny },
        { x: b.x - nx, y: b.y - ny },
        { x: a.x - nx, y: a.y - ny },
      ]);
      // The ink's own width, so strokes parallel to the nib never vanish.
      p.capsule(a, b, hairline);
    }
  }
}

/** A swash: a sine ribbon from `x0` to `x1` that ends in a curl. */
export function swash(x0: number, x1: number, y: number, amplitude: number): Stroke {
  const out: Vec[] = [];
  const steps = 48;
  for (let k = 0; k <= steps; k++) {
    const s = k / steps;
    out.push({ x: x0 + (x1 - x0) * s, y: y + Math.sin(s * Math.PI * 2.5) * amplitude * Math.sin(s * Math.PI) });
  }
  // The curl at the end.
  const end = out[out.length - 1]!;
  for (let k = 1; k <= 14; k++) {
    const a = -Math.PI / 2 + (k / 14) * Math.PI * 1.6;
    out.push({ x: end.x + Math.cos(a) * 3, y: end.y + 3 + Math.sin(a) * 3 });
  }
  return out;
}
