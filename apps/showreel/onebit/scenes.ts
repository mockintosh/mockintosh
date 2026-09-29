/**
 * The shots of the reel. Each is a pure function of its own local time that
 * paints the whole stage; cuts, wipes and the CRT effects that join them are
 * the reel's business (`reel.ts`), so any shot can be re-used in the edit.
 */
import { drawKnot, projectKnotCurve, type KnotPose } from "./depth";
import { clamp01, easeInCubic, easeInExpo, easeInOutBack, easeInOutCubic, easeOutBack, easeOutCubic, easeOutExpo, hash, lerp, seg } from "../ease";
import { drawMicro, microWidth } from "../microtype";
import { INK, PAPER, STAGE_H, STAGE_W, XOR, bayer, tone, toneOver, toneUnder, zoomStage, type Painter, type Vec } from "../painter";
import { drawStrokes, layoutText, mapGlyph, sampleStrokes } from "../type";

export type Shot = (p: Painter, t: number) => void;

const CX = STAGE_W / 2;
const CY = STAGE_H / 2;

/** Integer pixel scale for micro type: 1 in a window, 2 once the stage is big. */
export function microScale(p: Painter): number {
  return Math.max(1, Math.floor(p.stage.scale * 0.75));
}

/** Micro type centred on a stage point, in the current paint. */
function microCentered(p: Painter, text: string, x: number, y: number): void {
  const k = microScale(p);
  drawMicro(p, text, p.dx(x) - microWidth(text, k) / 2, p.dy(y), k);
}

// ── 00 · Power on ─────────────────────────────────────────────────────────

/** A blinking cursor on a dark tube, stretching into the scan line. */
export const powerOn: Shot = (p, t) => {
  p.with({ paint: INK }, () => p.fill());
  p.with({ paint: PAPER }, () => {
    if (t < 0.35) {
      if (t < 0.12 || t > 0.22) p.rect(CX - 2, CY - 3, 4, 6);
      return;
    }
    const k = easeOutExpo(seg(t, 0.35, 0.65));
    const w = lerp(4, STAGE_W + 4, k);
    const h = lerp(6, 1, easeOutCubic(seg(t, 0.35, 0.45)));
    p.rect(CX - w / 2, CY - h / 2, w, h);
  });
};

// ── 01 · Type ─────────────────────────────────────────────────────────────

const TITLE = layoutText("SHOWREEL", { size: 34, tracking: 3 }, { cx: CX, top: 58 });
const TITLE_STROKE = 6.5;
const TITLE_BASELINE = 58 + 34;
/** The left edge of the O's stroke: the camera flies into the ink. */
const TITLE_O = TITLE.find((g) => g.char === "O")!;
const ZOOM_FOCUS: Vec = { x: TITLE_O.center.x - 17, y: TITLE_O.center.y };

/** Letters rise out of a mask line, a rule draws, the camera dives into the O. */
export const title: Shot = (p, t) => {
  const zoom = 1 + easeInExpo(seg(t, 1.55, 2.0)) * 90;
  const stage = zoomStage(p.stage, ZOOM_FOCUS, zoom);
  p.with({ paint: PAPER }, () => p.fill());

  p.with({ stage }, () => {
    // Registration dots, like a layout grid under the art.
    const grid = 12;
    p.with({ paint: INK }, () => {
      for (let gx = grid / 2; gx < STAGE_W; gx += grid) {
        for (let gy = grid / 2; gy < STAGE_H; gy += grid) {
          const appear = seg(t, 0.62 + (Math.abs(gx - CX) + Math.abs(gy - CY)) / 900, 0.9);
          if (appear > 0) p.circle(gx, gy, 0.45 * appear);
        }
      }
    });

    // Each letter rises from behind the baseline with an overshoot.
    const savedClip = p.clip;
    p.clip = { ...savedClip, y1: Math.min(savedClip.y1, Math.ceil(p.dy(TITLE_BASELINE + TITLE_STROKE / 2 + 0.5))) };
    TITLE.forEach((glyph, i) => {
      const k = seg(t, 0.72 + i * 0.05, 1.12 + i * 0.05);
      if (k <= 0) return;
      const lift = (1 - easeOutBack(k, 2.2)) * 48;
      const skew = (1 - easeOutCubic(k)) * 0.35;
      const strokes = mapGlyph(glyph, (q) => ({
        x: q.x + (TITLE_BASELINE - q.y) * skew,
        y: q.y + lift,
      }));
      p.with({ paint: INK }, () => drawStrokes(p, strokes, TITLE_STROKE));
    });
    p.clip = savedClip;

    // The rule grows out from the centre, then the credit types on under it.
    const rule = easeOutExpo(seg(t, 1.05, 1.4));
    const ruleW = 212 * rule;
    p.with({ paint: INK }, () => p.rect(CX - ruleW / 2, TITLE_BASELINE + 9, ruleW, 1.6));

    const credit = "MOTION DESIGN IN ONE BIT";
    const typed = Math.floor(seg(t, 1.12, 1.45) * credit.length);
    p.with({ paint: INK }, () => {
      microCentered(p, credit.slice(0, typed) + (typed < credit.length && typed > 0 ? "_" : ""), CX, TITLE_BASELINE + 16);
    });

    // Editorial corner marks.
    const corners = seg(t, 0.95, 1.2);
    if (corners > 0) {
      const k = microScale(p);
      p.with({ paint: INK }, () => {
        drawMicro(p, "REEL 2026".slice(0, Math.ceil(corners * 9)), p.dx(10), p.dy(10), k);
        const right = "512 X 342 X 1 BIT";
        const shown = right.slice(0, Math.ceil(corners * right.length));
        drawMicro(p, shown, p.dx(STAGE_W - 10) - microWidth(right, k), p.dy(10), k);
        drawMicro(p, "CLAUDE", p.dx(10), p.dy(STAGE_H - 10) - 5 * k, k);
      });
    }
  });
};

// ── 02 · Shape ────────────────────────────────────────────────────────────

const TILE = 20;
const COLS = STAGE_W / TILE;
const ROWS = Math.ceil(STAGE_H / TILE);

function quarterArc(cx: number, cy: number, r: number, a0: number): Vec[] {
  const out: Vec[] = [];
  for (let k = 0; k <= 8; k++) {
    const a = a0 + (k / 8) * (Math.PI / 2);
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

/** Truchet tiles pop in, rotate on the beat in waves, then collapse inward. */
function truchet(p: Painter, t: number): void {
  p.with({ paint: INK }, () => p.fill());
  const maxDist = Math.hypot(CX, CY);
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const cx = TILE / 2 + i * TILE;
      const cy = TILE / 2 + j * TILE;
      const dist = Math.hypot(cx - CX, cy - CY) / maxDist;
      const appear = easeOutBack(seg(t, (i + j) * 0.014, 0.28 + (i + j) * 0.014), 2);
      const collapse = easeInCubic(seg(t, 1.12 + (1 - dist) * 0.22, 1.36 + (1 - dist) * 0.22));
      const scale = appear * (1 - collapse);
      if (scale <= 0.01) continue;
      let turns = hash(i + j * 97, 7) < 0.5 ? 0 : 1;
      for (const beat of [0.5, 1.0]) {
        turns += easeInOutBack(seg(t, beat + dist * 0.28 - 0.1, beat + dist * 0.28 + 0.2));
      }
      const angle = turns * (Math.PI / 2);
      const cos = Math.cos(angle) * scale;
      const sin = Math.sin(angle) * scale;
      const place = (q: Vec): Vec => ({
        x: cx + (q.x - cx) * cos - (q.y - cy) * sin,
        y: cy + (q.x - cx) * sin + (q.y - cy) * cos,
      });
      const h = TILE / 2;
      p.with({ paint: PAPER }, () => {
        p.stroke(quarterArc(cx - h, cy - h, h, 0).map(place), 3.6 * scale);
        p.stroke(quarterArc(cx + h, cy + h, h, Math.PI).map(place), 3.6 * scale);
      });
    }
  }
}

/** Three ring emitters XORed together: live moiré. */
function moire(p: Painter, t: number): void {
  const { frame, clip, stage } = p;
  const spread = easeInOutCubic(seg(t, 0, 0.45)) * (1 - easeInExpo(seg(t, 0.65, 1.0)));
  const front = easeOutExpo(seg(t, 0, 0.55)) * 420 * (1 - easeInExpo(seg(t, 0.72, 1.0)));
  const spin = t * 1.6;
  const centres: Vec[] = [0, 1, 2].map((k) => {
    const a = spin + (k * Math.PI * 2) / 3;
    return { x: CX + Math.cos(a) * 58 * spread, y: CY + Math.sin(a) * 34 * spread };
  });
  // A kick on the downbeat squeezes the rings together.
  const spacing = 7.5 - 2.5 * Math.exp(-Math.max(0, t - 0.5) * 9) * (t > 0.5 ? 1 : 0);
  const phase = t * 26;
  const inv = 1 / stage.scale;
  for (let y = clip.y0; y < clip.y1; y++) {
    const sy = (y + 0.5 - stage.y) * inv;
    const row = y * frame.width;
    for (let x = clip.x0; x < clip.x1; x++) {
      const sx = (x + 0.5 - stage.x) * inv;
      let bit = 0;
      let nearest = Infinity;
      for (const c of centres) {
        const d = Math.hypot(sx - c.x, sy - c.y);
        nearest = Math.min(nearest, d);
        bit ^= Math.floor((d - phase) / spacing) & 1;
      }
      frame.pixels[row + x] = nearest < front ? bit : 1;
    }
  }
  // What survives the collapse is a single point of light.
  const dot = seg(t, 0.78, 1.0);
  if (dot > 0) p.with({ paint: PAPER }, () => p.circle(CX, CY, 2.2 * easeOutCubic(dot)));
}

export const shape: Shot = (p, t) => {
  if (t < 1.5) truchet(p, t);
  else moire(p, t - 1.5);
};

// ── 03 · Depth ────────────────────────────────────────────────────────────

const HORIZON = 118;

function depthPose(t: number): KnotPose {
  const grow = easeOutBack(seg(t, 0.0, 0.5), 1.4);
  const spinOut = easeInExpo(seg(t, 1.9, 2.5));
  return {
    morph: easeInOutCubic(seg(t, 0.45, 1.35)),
    tube: lerp(0.06, 0.26, easeOutCubic(seg(t, 0.05, 0.7))),
    yaw: t * 1.1 + spinOut * 7,
    pitch: lerp(0, 0.95, easeInOutCubic(seg(t, 0.3, 1.2))) + 0.18 * Math.sin(t * 1.9),
    roll: t * 0.8,
    center: { x: CX, y: 78 + Math.sin(t * 2.6) * 3 * seg(t, 0.4, 1) },
    size: 36 * grow + spinOut * 10,
    light: { x: Math.cos(t * 1.3) * 0.9, y: -0.9, z: -0.7 },
  };
}

function floorAndSun(p: Painter, t: number): void {
  p.with({ paint: INK }, () => p.fill());

  // Sun: rises through the horizon, white at the crown and dimming toward
  // the ground, cut by slits that widen as they sink, and scroll down.
  const rise = easeOutCubic(seg(t, 0.25, 1.1));
  const R = 56;
  const sunY = lerp(HORIZON + R, HORIZON - 22, rise);
  const savedClip = p.clip;
  const horizonClip = { ...savedClip, y1: Math.min(savedClip.y1, Math.ceil(p.dy(HORIZON))) };
  const pitch = 9;
  const scroll = (t * 6) % pitch;
  for (let band = -1; band < (2 * R) / pitch + 1; band++) {
    const y0 = sunY - R + band * pitch + scroll;
    const k = clamp01((y0 - (sunY - R)) / (2 * R));
    const slit = k < 0.35 ? 0 : (k - 0.35) * pitch * 0.9;
    p.clip = {
      ...horizonClip,
      y0: Math.max(horizonClip.y0, Math.ceil(p.dy(y0) - 0.5)),
      y1: Math.min(horizonClip.y1, Math.ceil(p.dy(y0 + pitch - slit) - 0.5)),
    };
    p.with({ paint: tone(k * k * 0.55) }, () => p.circle(CX, sunY, R));
  }
  p.clip = savedClip;

  // Floor: lines race toward the camera; the verticals converge on the sun.
  const reveal = easeOutExpo(seg(t, 0.05, 0.6));
  p.clip = {
    ...savedClip,
    x0: Math.max(savedClip.x0, Math.floor(p.dx(CX - reveal * (CX + 2)))),
    x1: Math.min(savedClip.x1, Math.ceil(p.dx(CX + reveal * (CX + 2)))),
  };
  p.with({ paint: PAPER }, () => {
    p.line({ x: 0, y: HORIZON }, { x: STAGE_W, y: HORIZON });
    // Rows at z = 1, 2, 3 … scrolling toward the camera; y = horizon + h / z.
    const travel = (t * 2.2) % 1;
    for (let k = 0; k < 9; k++) {
      const z = k + 1 - travel;
      const y = HORIZON + 64 / z;
      if (y < STAGE_H + 2) p.line({ x: 0, y }, { x: STAGE_W, y });
    }
    // Columns run to the one vanishing point, starting where the haze ends.
    for (let k = -9; k <= 9; k++) {
      p.line({ x: CX + k * 7.1, y: HORIZON + 7.1 }, { x: CX + k * 64, y: HORIZON + 64 });
    }
  });
  p.clip = savedClip;

  // Haze over the far floor.
  for (let k = 0; k < 8; k++) {
    p.with({ paint: toneOver(1 - k / 8) }, () => p.rect(0, HORIZON + 0.5 + k * 1.6, STAGE_W, 1.6));
  }
}

export const depth: Shot = (p, t) => {
  floorAndSun(p, t);
  const pose = depthPose(t);
  // Contact shadow, breathing with the bob.
  const shadowW = pose.size * 1.3 * (1 - (pose.center.y - 75) / 40);
  p.with({ paint: toneOver(0.82) }, () => p.ellipse(CX, 150, shadowW, shadowW * 0.12));
  p.with({ paint: INK }, () => p.ellipse(CX, 150, shadowW * 0.6, shadowW * 0.07));
  drawKnot(p, pose);
};

// ── 04 · Particles ───────────────────────────────────────────────────────

interface Particle {
  start: Vec;
  target: Vec;
  seeds: [number, number, number, number, number];
}

const PARTICLE_COUNT = 2600;
let particles: Particle[] | null = null;

function particleField(): Particle[] {
  if (particles) return particles;
  const pose = depthPose(2.5);
  const starts = projectKnotCurve(pose, PARTICLE_COUNT);
  const tubeRadius = pose.tube * pose.size;
  const word = layoutText("FLOW", { size: 64, tracking: 4 }, { cx: CX, top: 58 });
  const targets = sampleStrokes(word, 0.6);
  particles = starts.map((start, i) => {
    const h = (salt: number) => hash(i, salt);
    const target = targets[Math.floor(h(1) * targets.length)]!;
    const a = h(2) * Math.PI * 2;
    const r = Math.sqrt(h(3)) * 3.2;
    // Spread over the tube's cross-section, so the first frame is still the knot.
    const sa = h(9) * Math.PI * 2;
    const sr = Math.sqrt(h(10)) * tubeRadius;
    return {
      start: { x: start.x + Math.cos(sa) * sr, y: start.y + Math.sin(sa) * sr },
      target: { x: target.x + Math.cos(a) * r, y: target.y + Math.sin(a) * r },
      seeds: [h(4), h(5), h(6), h(7), h(8)],
    };
  });
  return particles;
}

function particleAt(q: Particle, t: number): Vec {
  const [s0, s1, s2, s3, s4] = q.seeds;
  const dx = q.start.x - CX;
  const dy = q.start.y - CY;
  // The knot holds for a beat, then the dust lifts off it and spirals out.
  const burst = easeInOutCubic(seg(t, 0.02 + s3 * 0.12, 0.95));
  const r = Math.hypot(dx, dy) + burst * (26 + 110 * s0);
  const a = Math.atan2(dy, dx) + easeInCubic(seg(t, 0, 0.5)) * 0.5 * (1.4 + 1.6 * s1) + Math.max(0, t - 0.5) * (1.4 + 1.6 * s1);
  const swirl: Vec = { x: CX + Math.cos(a) * r * 1.3, y: CY + Math.sin(a) * r * 0.75 };

  const across = (q.target.x - 60) / 200;
  const delay = across * 0.25 + s2 * 0.1;
  const gather = easeInOutCubic(seg(t, 0.7 + delay, 1.3 + delay));
  const shimmer = 0.5 * Math.sin(t * 11 + s3 * 40);
  const home: Vec = { x: q.target.x + shimmer, y: q.target.y + shimmer * 0.6 };
  const pos: Vec = { x: lerp(swirl.x, home.x, gather), y: lerp(swirl.y, home.y, gather) };

  const blow = seg(t, 1.8 + across * 0.3 + s4 * 0.12, 2.5);
  if (blow > 0) {
    const k = easeInCubic(blow);
    pos.x += k * (420 + 240 * s0);
    pos.y += Math.sin(blow * 5 + s1 * 9) * 22 * blow - 30 * k * (s2 - 0.3);
  }
  return pos;
}

export const flow: Shot = (p, t) => {
  p.with({ paint: INK }, () => p.fill());
  const field = particleField();
  const trail = 0.045;
  const size = Math.max(1, Math.round(p.stage.scale));
  p.with({ paint: PAPER }, () => {
    for (const q of field) {
      const head = particleAt(q, t);
      const tail = particleAt(q, Math.max(0, t - trail));
      const hx = p.dx(head.x);
      const hy = p.dy(head.y);
      p.deviceLine(p.dx(tail.x), p.dy(tail.y), hx, hy);
      if (size > 1) p.span(Math.floor(hy) + 1, Math.floor(hx), Math.floor(hx) + size);
    }
  });

  // The word's skeleton flickers on while the particles hold it.
  const hold = seg(t, 1.35, 1.5) * (1 - seg(t, 1.75, 1.85));
  if (hold > 0) {
    const word = layoutText("FLOW", { size: 64, tracking: 4 }, { cx: CX, top: 58 });
    p.with({ paint: XOR }, () => {
      for (const glyph of word) {
        for (const stroke of glyph.strokes) {
          for (let k = 1; k < stroke.length; k++) {
            if ((k + Math.floor(t * 30)) % 3 === 0) p.line(stroke[k - 1]!, stroke[k]!);
          }
        }
      }
    });
  }
};

// ── 05 · Rhythm ───────────────────────────────────────────────────────────

const BEAT = 0.5;

/** Surges forward on every beat and warps out at the end. */
function tunnelTravel(t: number): number {
  let travel = t * 3;
  for (let beat = 0; beat <= t; beat += BEAT) travel += easeOutExpo(seg(t, beat, beat + 0.3)) * 1.5;
  return travel + easeInExpo(seg(t, 1.9, 2.5)) * 30;
}

export const tunnel: Shot = (p, t) => {
  const { frame, clip, stage } = p;
  const inv = 1 / stage.scale;
  const cx = CX + Math.sin(t * 1.7) * 26;
  const cy = CY + Math.sin(t * 2.3 + 1) * 14;
  const travel = tunnelTravel(t);
  const sectors = t < 1.0 ? 16 : t < 2.0 ? 24 : 32;
  const twist = 0.045 * Math.sin(t * 1.1);
  const turn = t * 0.5 + easeInOutBack(seg(t, 1.0, 1.35)) * 0.5;
  const TAU = Math.PI * 2;
  for (let y = clip.y0; y < clip.y1; y++) {
    const dy = (y + 0.5 - stage.y) * inv - cy;
    const row = y * frame.width;
    for (let x = clip.x0; x < clip.x1; x++) {
      const dx = (x + 0.5 - stage.x) * inv - cx;
      const r = Math.hypot(dx, dy) + 0.001;
      const zdepth = 150 / r;
      const u = (Math.atan2(dy, dx) / TAU + turn) * sectors + zdepth * twist * sectors;
      const v = (zdepth + travel) * 2;
      const check = (Math.floor(u) + Math.floor(v)) & 1;
      const light = clamp01((r - 5) / 70);
      frame.pixels[row + x] = check && light > bayer(x, y) ? 0 : 1;
    }
  }
  // A speaker cone at the vanishing point, kicked by the beat.
  const kick = Math.exp(-((t % BEAT) / BEAT) * 6);
  p.with({ paint: XOR }, () => p.ring(cx, cy, 5 + kick * 7, 1.2 + kick * 1.4));
};

// ── 06 · Edit (montage) ───────────────────────────────────────────────────

/** A zoomed, panning slice of the title for a typographic close-up. */
export const titleCloseUp: Shot = (p, t) => {
  const focus = { x: lerp(60, 250, easeInOutCubic(clamp01(t / 0.25))), y: 76 };
  p.with({ stage: zoomStage(p.stage, focus, 3.2) }, () => title(p, 1.5));
};

/** The knot filling the frame, strobing. */
export const knotCloseUp: Shot = (p, t) => {
  p.with({ paint: INK }, () => p.fill());
  const pose = depthPose(1.6 + t);
  drawKnot(p, { ...pose, size: 92, center: { x: CX, y: CY }, yaw: pose.yaw + t * 4 });
};

// ── 07 · Credits ──────────────────────────────────────────────────────────

const NAME = layoutText("CLAUDE", { size: 40, tracking: 3.4 }, { cx: CX, top: 50 });
const NAME_BASELINE = 90;

export const credits: Shot = (p, t) => {
  p.with({ paint: PAPER }, () => p.fill());

  // Extrusion: the letterforms stacked back toward the lower right.
  const depthUnits = 6 * easeOutBack(seg(t, 0.45, 0.8), 1.8);
  const writes = NAME.map((_, i) => easeInOutCubic(seg(t, 0.04 + i * 0.055, 0.36 + i * 0.055)));
  const steps = Math.ceil(depthUnits * 2);
  p.with({ paint: INK }, () => {
    for (let s = steps; s >= 1; s--) {
      const o = (s / steps) * depthUnits;
      NAME.forEach((glyph, i) =>
        drawStrokes(
          p,
          mapGlyph(glyph, (q) => ({ x: q.x + o, y: q.y + o })),
          7,
          writes[i],
        ),
      );
    }
    NAME.forEach((glyph, i) => drawStrokes(p, glyph.strokes, 7, writes[i]));
  });
  // Faces punched back to white, leaving an outline over the solid depth.
  const face = seg(t, 0.35, 0.5);
  if (face > 0) {
    p.with({ paint: face < 1 ? toneUnder(face) : PAPER }, () => {
      NAME.forEach((glyph) => drawStrokes(p, glyph.strokes, 3.4));
    });
  }

  const rule = easeOutExpo(seg(t, 0.55, 0.85));
  p.with({ paint: INK }, () => p.rect(CX - 110, NAME_BASELINE + 16, 220 * rule, 1.6));

  const lines = ["MOTION DESIGN / 1-BIT SPECIALIST", "AVAILABLE FOR WORK"];
  const k = microScale(p);
  p.with({ paint: INK }, () => {
    const first = Math.floor(seg(t, 0.62, 0.9) * lines[0]!.length);
    drawMicro(p, lines[0]!.slice(0, first), p.dx(CX - 110), p.dy(NAME_BASELINE + 22), k);
    const second = Math.floor(seg(t, 0.88, 1.05) * lines[1]!.length);
    const secondY = p.dy(NAME_BASELINE + 22) + 8 * k;
    drawMicro(p, lines[1]!.slice(0, second), p.dx(CX - 110), secondY, k);
    // The cursor keeps blinking where the typing stopped.
    if (t > 0.88 && Math.floor(t * 4) % 2 === 0) {
      const x = Math.round(p.dx(CX - 110)) + microWidth(lines[1]!.slice(0, second), k) + 2 * k;
      for (let row = 0; row < 5 * k; row++) p.span(Math.round(secondY) + row, x, x + 3 * k);
    }
    const reel = seg(t, 0.7, 0.95);
    const right = "REEL 2026 / 00:15";
    const rightX = p.dx(CX + 110) - microWidth(right, k);
    // Small windows keep micro type at one pixel, so the label may not fit beside the caption.
    const fits = rightX > p.dx(CX - 110) + microWidth(lines[0]!, k) + 6 * k;
    if (reel > 0 && fits) {
      drawMicro(p, right.slice(0, Math.ceil(reel * right.length)), rightX, p.dy(NAME_BASELINE + 22), k);
    }
  });
};
