import { fromGrid, type Sprite } from "@mockintosh/sdk";
import { INK, PAPER, Painter, createFrame, type Paint, type Vec } from "./painter";

const SIZE = 32;

/** Diagonal clapper stripes. */
const STRIPES: Paint = (x, y) => ((((x + y) % 8) + 8) % 8 < 4 ? 1 : 0);

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
    [
      { x: 3, y: 8 },
      { x: 29, y: 8 },
      { x: 29, y: 12 },
      { x: 3, y: 12 },
    ],
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
    [
      { x: 4, y: 9 },
      { x: 28, y: 9 },
      { x: 28, y: 11 },
      { x: 4, y: 11 },
    ],
    hinge,
    -0.36,
  );
  draw.with({ paint: STRIPES }, () => draw.polygon(inset));

  return { width: SIZE, height: SIZE, data: art.pixels, mask: silhouette.pixels };
}

/**
 * The System Error bomb. It lived in the ROM's error resources rather than
 * any icon file, so no catalog has it: drawn here as the alert showed it.
 */
function bomb(): Sprite {
  const art = createFrame(SIZE, SIZE);
  const silhouette = createFrame(SIZE, SIZE);
  const pixelStage = { scale: 1, x: 0, y: 0 };
  const draw = new Painter(art, pixelStage);
  const mask = new Painter(silhouette, pixelStage);
  const both = (f: (p: Painter) => void) => {
    f(draw);
    f(mask);
  };
  const neck = rotateAbout(
    [
      { x: 18, y: 10 },
      { x: 24, y: 10 },
      { x: 24, y: 15 },
      { x: 18, y: 15 },
    ],
    { x: 21, y: 12.5 },
    Math.PI / 4,
  );
  const fuse: Vec[] = [
    { x: 23, y: 9 },
    { x: 24.5, y: 6.5 },
    { x: 27, y: 5.5 },
  ];
  const spark = { x: 28.5, y: 3.5 };
  const rays = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4);

  both((p) => p.circle(13.5, 19.5, 10.8));
  both((p) => p.polygon(neck));
  both((p) => p.stroke(fuse, 1.4));
  for (const a of rays) {
    const r = a % (Math.PI / 2) === 0 ? 3.2 : 2.2;
    both((p) =>
      p.line({ x: spark.x + Math.cos(a) * 1.2, y: spark.y + Math.sin(a) * 1.2 }, { x: spark.x + Math.cos(a) * r, y: spark.y + Math.sin(a) * r }),
    );
  }
  // A seam of paper where the neck meets the casing.
  const seam = rotateAbout(
    [
      { x: 18, y: 13.2 },
      { x: 24, y: 13.2 },
      { x: 24, y: 14.2 },
      { x: 18, y: 14.2 },
    ],
    { x: 21, y: 12.5 },
    Math.PI / 4,
  );
  draw.with({ paint: PAPER }, () => draw.polygon(seam));
  // The shine on the casing.
  draw.with({ paint: PAPER }, () =>
    draw.stroke(
      [
        { x: 6.5, y: 18 },
        { x: 7.5, y: 14.5 },
        { x: 10, y: 12 },
      ],
      1.6,
    ),
  );

  return { width: SIZE, height: SIZE, data: art.pixels, mask: silhouette.pixels };
}

/** The clapperboard: the striped stick lifted open, the striped band, and the lens ring. */
const CLAPPERBOARD_16: Sprite = fromGrid(16, 16, [
  "...........####.",
  ".......####oo##.",
  "...####oo####...",
  ".#oo####........",
  ".##.............",
  ".##############.",
  ".##oo###oo###o#.",
  ".#oo###oo###oo#.",
  ".##############.",
  ".#oooooooooooo#.",
  ".#oooo####oooo#.",
  ".#ooo##oo##ooo#.",
  ".#ooo##oo##ooo#.",
  ".#oooo####oooo#.",
  ".#oooooooooooo#.",
  ".##############.",
]);

export const sprites: Record<string, Sprite> = {
  "showreel/icon": clapperboard(),
  "showreel/icon-16x16": CLAPPERBOARD_16,
  "showreel/bomb": bomb(),
};
