import type { Sprite } from "@mockintosh/sdk";
import { INK, PAPER, Painter, createFrame, type Paint, type Vec } from "./painter";

const SIZE = 32;

/** Diagonal clapper stripes. */
const STRIPES: Paint = (x, y) => (((x + y) % 8) + 8) % 8 < 4 ? 1 : 0;

function rotateAbout(points: Vec[], pivot: Vec, radians: number): Vec[] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return points.map((q) => ({
    x: pivot.x + (q.x - pivot.x) * c - (q.y - pivot.y) * s,
    y: pivot.y + (q.x - pivot.x) * s + (q.y - pivot.y) * c,
  }));
}

/** A clapperboard, snapped open, with the reel's knot as its slate: drawn by the reel's own painter. */
function clapperboard(): Sprite {
  const art = createFrame(SIZE, SIZE);
  const silhouette = createFrame(SIZE, SIZE);
  const pixelStage = { scale: 1, x: 0, y: 0 };
  const draw = new Painter(art, pixelStage);
  const mask = new Painter(silhouette, pixelStage);

  const hinge: Vec = { x: 3, y: 12 };
  const arm = rotateAbout(
    [{ x: 3, y: 8 }, { x: 29, y: 8 }, { x: 29, y: 12 }, { x: 3, y: 12 }],
    hinge,
    -0.36,
  );
  const both = (f: (p: Painter) => void) => {
    f(draw);
    f(mask);
  };

  // Body, bar and arm silhouettes.
  both((p) => p.rect(3, 12, 27, 17));
  both((p) => p.polygon(arm));

  // Body: outlined slate with a ring.
  draw.with({ paint: PAPER }, () => draw.rect(4, 17, 25, 11));
  draw.with({ paint: INK }, () => draw.ring(16.5, 22.5, 4.6, 1.8));

  // Fixed bar and the open arm, both striped inside a 1px frame.
  draw.with({ paint: STRIPES }, () => draw.rect(4, 13, 25, 3));
  const inset = rotateAbout(
    [{ x: 4, y: 9 }, { x: 28, y: 9 }, { x: 28, y: 11 }, { x: 4, y: 11 }],
    hinge,
    -0.36,
  );
  draw.with({ paint: STRIPES }, () => draw.polygon(inset));

  return { width: SIZE, height: SIZE, data: art.pixels, mask: silhouette.pixels };
}

export const sprites: Record<string, Sprite> = {
  "showreel/icon": clapperboard(),
};
