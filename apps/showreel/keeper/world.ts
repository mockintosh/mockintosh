/**
 * The Keeper's world, engraved. Every pixel asks the scene two things: how
 * dark is it here (`tone`), and which way do the engraver's lines run here
 * (`phase`, a coordinate the lines are level sets of). The line is cut wider
 * where it's darker, and a second, crossing set comes in for the deep
 * shadows — the banknote look, rather than a dither.
 *
 * World units match stage units; the sea's surface is y ≈ 0, sky is
 * negative, the deep is positive. The camera is a world point at the stage
 * centre, so the whole film is one continuous move.
 */
import { clamp01, hash, lerp, seg } from "../ease";
import { STAGE_H, STAGE_W, type Frame, type PixelRect, type Stage } from "../painter";
import { fbm2, noise2 } from "./noise";

export interface Camera {
  x: number;
  y: number;
}

/** The lighthouse lamp's beam as seen from the side. */
export interface Beam {
  /** Radians; 0 points right, y is down. */
  angle: number;
  /** 0 = dark, 1 = full. */
  intensity: number;
  /** Half-angle of the cone. */
  spread: number;
}

export interface WorldState {
  /** Animation time; already held on twos by the caller. */
  t: number;
  /** Exposure number: what boils, grains and flickers. */
  exposure: number;
  camera: Camera;
  beam: Beam;
  /** Whole-frame exposure wobble, added to every tone. */
  flicker: number;
  /** Scales every tone; 0 is blank paper (for dissolves and the flare). */
  ink: number;
}

/** Hatch period in device pixels: fine enough to read as tone, coarse enough to stay a line. */
const HATCH_PX = 3.4;

const MOON = { x: 236, y: -150, r: 26 };
const LIGHTHOUSE_X = 76;
const LAMP = { x: LIGHTHOUSE_X, y: -106 };

function seaSurface(x: number, t: number): number {
  return 3.2 * Math.sin(x * 0.05 + t * 1.3) + 1.8 * Math.sin(x * 0.12 - t * 1.9) + 0.9 * Math.sin(x * 0.27 + t * 2.8);
}

function rockTop(x: number): number {
  const d = (x - LIGHTHOUSE_X) / 26;
  return -6 - 17 * Math.exp(-d * d) + 3 * noise2(x * 0.13, 4.2);
}

function towerHalfWidth(y: number): number {
  return lerp(12, 7.5, (-22 - y) / 74);
}

// Per-pixel outputs of `shade`, kept in module scope to avoid allocating.
let tone = 0;
let phase = 0;
let cross = 0;
let ink = false;
/** Set to force paper white (stars, lamp glass). */
let light = false;

interface Row {
  wy: number;
  boilX: number;
}

interface Column {
  wx: number;
  boilY: number;
  surface: number;
  rock: number;
}

function sky(wx: number, wy: number, s: WorldState): void {
  const { t, exposure } = s;
  // Luminous at the horizon, deepening overhead.
  tone = clamp01(0.14 + -wy / 290);
  phase = wy + 0.7 * Math.sin(wx * 0.03 + wy * 0.02);
  cross = (wx - wy) * 0.8;

  const dm = Math.hypot(wx - MOON.x, wy - MOON.y);
  if (dm < MOON.r) {
    const crater = fbm2(wx * 0.11, wy * 0.11) > 0.6 ? 0.34 : 0;
    const limb = Math.pow(dm / MOON.r, 4) * 0.3;
    tone = 0.04 + crater + limb;
    phase = dm;
    cross = wx + wy;
    ink = dm > MOON.r - 0.8;
    return;
  }
  // The glow: the engraver leaves the lines thin around the moon.
  tone *= 1 - 0.78 * Math.exp(-(dm - MOON.r) / 42);

  // Clouds, lit from beneath by the moon.
  if (wy > -190 && wy < -120) {
    const band = 1 - Math.abs((wy + 155) / 35);
    const c = noise2(wx * 0.017 + t * 0.05, wy * 0.05) * 0.8 + band * 0.35;
    if (c > 0.66) {
      tone = 0.1 + (c - 0.66) * 0.9 + (wy + 155) / 140;
      phase = wy * 0.9 + noise2(wx * 0.05, wy * 0.1) * 6;
      ink = c < 0.675;
      return;
    }
  }

  // Stars, one per lucky cell, twinkling from exposure to exposure.
  if (wy < -46) {
    const cx = Math.floor(wx / 15);
    const cy = Math.floor(wy / 15);
    const h = hash(cx, cy + 911);
    if (h < 0.34) {
      const sx = cx * 15 + 2 + hash(cx, cy + 3) * 11;
      const sy = cy * 15 + 2 + hash(cx, cy + 5) * 11;
      const size = (1 + hash(cx, cy + 7) * 2.2) * (0.55 + 0.45 * Math.sin(exposure * 0.9 + h * 60));
      const dx = Math.abs(wx - sx);
      const dy = Math.abs(wy - sy);
      if ((dx < 0.6 && dy < size) || (dy < 0.6 && dx < size) || dx * dx + dy * dy < size * 0.9) {
        light = true;
        return;
      }
    }
  }

  // Gulls, wings beating on twos.
  for (let k = 0; k < 3; k++) {
    const gx = ((20 + t * (11 + k * 2) + k * 70) % 380) - 30;
    const gy = -64 - k * 13 + Math.sin(t * 1.7 + k) * 3;
    const dx = wx - gx;
    if (Math.abs(dx) > 6 || Math.abs(wy - gy) > 5) continue;
    const flap = Math.sin(t * 10 + k * 2);
    const wing = gy - flap * Math.sin((Math.abs(dx) / 6) * Math.PI) * 2.2 + Math.abs(dx) * 0.25;
    if (Math.abs(wy - wing) < 0.6) {
      ink = true;
      return;
    }
  }
}

function lighthouse(wx: number, wy: number): boolean {
  const dx = wx - LIGHTHOUSE_X;
  if (Math.abs(dx) > 13 || wy < -129 || wy > -20) return false;
  // Finial.
  if (Math.hypot(dx, wy + 126) < 1.8) {
    tone = 0.85;
    phase = wy;
    ink = true;
    return true;
  }
  // Roof.
  if (wy >= -124 && wy < -112) {
    const hw = ((wy + 124) / 12) * 9.5;
    if (Math.abs(dx) > hw) return false;
    tone = 0.62 + (dx < 0 ? 0.2 : 0);
    phase = wy * 0.6 + Math.abs(dx);
    cross = dx - wy;
    ink = Math.abs(dx) > hw - 0.8 || wy > -112.8;
    return true;
  }
  // Lantern room: bright glass between the mullions.
  if (wy >= -112 && wy < -100) {
    if (Math.abs(dx) > 6.5) return false;
    const mullion = ((dx + 6.5) / 4.33) % 1 < 0.16;
    if (mullion || Math.abs(dx) > 5.8 || wy < -111.3 || wy > -100.7) {
      ink = true;
    } else {
      light = true;
    }
    return true;
  }
  // Gallery and rail.
  if (wy >= -100 && wy < -96) {
    if (Math.abs(dx) > 11) return false;
    tone = 0.9;
    phase = wy;
    ink = wy < -99.3 || wy > -96.7 || Math.abs(dx) > 10.3;
    return true;
  }
  // Tower: a lit cylinder, striped, with a door and a warm window.
  const hw = towerHalfWidth(wy);
  if (Math.abs(dx) > hw) return false;
  const u = dx / hw;
  if (Math.abs(dx) < 1.6 && wy > -62 && wy < -56) {
    light = true;
    return true;
  }
  if (Math.abs(dx) < 3.2 && wy > -31 && (wy > -28 || Math.hypot(dx, wy + 28) < 3.2)) {
    tone = 0.95;
    phase = wy;
    ink = true;
    return true;
  }
  const stripe = Math.floor((wy + 22) / 15) % 2 !== 0;
  tone = 0.1 + 0.62 * Math.pow((1 - u) / 2, 1.4) + (stripe ? 0.3 : 0);
  phase = Math.asin(Math.max(-1, Math.min(1, u))) * hw * 1.15;
  cross = wy * 1.2;
  ink = Math.abs(dx) > hw - 0.8 || Math.abs(((wy + 22) / 15) % 1) < 0.06;
  return true;
}

function paperBoat(wx: number, wy: number, s: WorldState): boolean {
  const bx = 128 + s.t * 4;
  if (Math.abs(wx - bx) > 16) return false;
  const by = seaSurface(bx, s.t) - 0.6;
  const slope = (seaSurface(bx + 1, s.t) - seaSurface(bx - 1, s.t)) / 2;
  const c = Math.cos(Math.atan(slope));
  const sn = Math.sin(Math.atan(slope));
  const dx = wx - bx;
  const dy = wy - by;
  const u = (dx * c + dy * sn) / 1.5;
  const v = (-dx * sn + dy * c) / 1.5;
  if (v > -2.5 && v < 1.6) {
    const hw = 9.5 - (v + 2.5) * 1.1;
    if (Math.abs(u) > hw) return false;
    tone = 0.08;
    phase = v;
    ink = Math.abs(u) > hw - 0.7 || v > 0.9 || v < -1.9;
    return true;
  }
  if (v <= -2.5 && v > -12) {
    const hw = (v + 12) * 0.5;
    if (Math.abs(u) > hw) return false;
    tone = u < 0 ? 0.3 : 0.06;
    phase = u * 1.3 + v * 0.3;
    ink = Math.abs(u) > hw - 0.7 || Math.abs(u) < 0.35;
    return true;
  }
  return false;
}

function whale(wx: number, wy: number, s: WorldState): boolean {
  const { t } = s;
  const cx = lerp(430, -130, seg(t, 7.2, 12.2));
  const cy = 96 + Math.sin(t * 0.9) * 5;
  const lx = wx - cx;
  const ly = wy - cy;
  if (lx < -62 || lx > 80 || Math.abs(ly) > 42) return false;
  const bend = 3.5 * Math.sin(lx * 0.045 - t * 2.2) * clamp01((lx + 20) / 80);
  const v = ly - bend;

  // Flukes.
  if (lx > 58) {
    const q = lx - 58;
    if (Math.abs(v) < q * 0.95 + 1.2 && (q < 4 || Math.abs(v) > q * 0.55 - 1)) {
      tone = 0.78;
      phase = v + q * 0.5;
      cross = lx;
      ink = Math.abs(v) > q * 0.95 + 0.4 || q > 17.5;
      return q < 18;
    }
    return false;
  }
  const n = (lx + 58) / 118;
  const th = n < 0.25 ? 21 * Math.sqrt(Math.max(0, 1 - ((0.25 - n) / 0.25) ** 2)) : 21 * (1 - Math.pow((n - 0.25) / 0.75, 1.2) * 0.86);

  // Pectoral fin, trailing down and back.
  const fin = v - th * 0.55;
  if (lx > -34 && lx < -8 && fin > 0 && fin < (lx + 34) * 0.55 && fin < 14) {
    tone = 0.7;
    phase = fin * 0.5 + lx;
    cross = wy;
    ink = fin > (lx + 34) * 0.55 - 0.8 || fin > 13.2;
    return true;
  }
  if (Math.abs(v) > th) return false;

  const side = v / th;
  // Eye, with a glint.
  const eye = Math.hypot(lx + 42, v + 2);
  if (eye < 1.9) {
    if (eye < 0.6) light = true;
    else ink = true;
    return true;
  }
  if (side < 0.25) {
    tone = 0.94 - side * 0.1;
    phase = v * 0.95;
    cross = lx * 0.9 + v * 0.3;
    if (fbm2(wx * 0.18, wy * 0.18) > 0.7) tone = 0.25;
  } else {
    tone = 0.1 + (side - 0.25) * 0.3;
    phase = v * 1.7;
    cross = lx;
  }
  ink = Math.abs(v) > th - 0.8 || Math.abs(side - 0.25) < 0.04 || (lx < -30 && Math.abs(v - 4 - (lx + 30) * -0.12) < 0.5);
  return true;
}

function fish(wx: number, wy: number, s: WorldState): boolean {
  const { t } = s;
  const sx = lerp(260, 40, seg(t, 6.6, 12)) + 26 * Math.sin(t * 0.8);
  const sy = 46 + 9 * Math.sin(t * 1.3);
  if (Math.abs(wx - sx) > 48 || Math.abs(wy - sy) > 24) return false;
  for (let k = 0; k < 16; k++) {
    const fx = sx + ((k % 4) - 1.5) * 16 + 7 * Math.sin(k * 1.7 + t * 1.1);
    const fy = sy + (Math.floor(k / 4) - 1.5) * 9 + 3 * Math.cos(k * 2.3 + t * 1.4);
    const dx = wx - fx;
    const dy = wy - fy;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 3) continue;
    const body = (dx / 4.2) ** 2 + (dy / 1.7) ** 2;
    const tail = dx > 3 && dx < 7 && Math.abs(dy) < (dx - 3) * 0.55;
    if (body < 1 || tail) {
      tone = 0.1;
      phase = dy;
      ink = (body > 0.62 && body < 1) || (tail && Math.abs(dy) > (dx - 3) * 0.55 - 0.6) || Math.hypot(dx + 2.6, dy + 0.3) < 0.55;
      return true;
    }
  }
  return false;
}

function bubbles(wx: number, wy: number, s: WorldState): boolean {
  for (let k = 0; k < 7; k++) {
    const bx = 42 + k * 41 + Math.sin(wy * 0.09 + k) * 2.2;
    if (Math.abs(wx - bx) > 4) continue;
    const rise = s.t * 16 + k * 11;
    const i = Math.round((190 - wy + rise) / 23);
    const by = 190 - i * 23 + rise;
    const r = 1 + hash(i, k) * 1.7;
    const d = Math.hypot(wx - bx, wy - by);
    if (d < r + 0.3) {
      if (d > r - 0.6) ink = true;
      else light = d < r * 0.45 && wx < bx;
      tone = 0.05;
      phase = d;
      return true;
    }
  }
  return false;
}

function kelp(wx: number, wy: number, s: WorldState): boolean {
  for (let k = 0; k < 4; k++) {
    const base = 30 + k * 83;
    const top = 112 + k * 9;
    if (wy < top) continue;
    const sway = Math.sin(wy * 0.06 + s.t * 1.3 + k) * 7 * ((200 - wy) / 90);
    const x = base + sway;
    const w = 1.9 + Math.sin(wy * 0.5 + k) * 0.5;
    if (Math.abs(wx - x) < w) {
      tone = 0.86;
      phase = wy * 0.4 + (wx - x) * 2;
      ink = Math.abs(wx - x) > w - 0.6;
      return true;
    }
  }
  return false;
}

function sea(wx: number, wy: number, surface: number, s: WorldState): void {
  const { t } = s;
  const d = wy - surface;
  // Dark where it meets the sky, moonlit in mid-water, black on the bottom.
  tone = lerp(0.66, 0.4, seg(d, 16, 70)) + seg(d, 120, 185) * 0.4;
  phase = wy - surface * 1.6 * Math.exp(-d / 32) + 0.8 * Math.sin(wx * 0.3 + d * 0.2 - t * 2) * Math.exp(-d / 18);
  cross = wx * 0.9 - wy * 0.5;
  ink = d < 0.9;
  // The moon's path on the water.
  const glitter = 1 - d / 75;
  if (glitter > 0 && Math.abs(wx - MOON.x) < 24 * glitter + 3) {
    if (noise2(wx * 0.22, wy * 0.9 + t * 2.5) > 0.5) tone *= 0.12;
  }
  // Light through the water.
  if (d > 5) {
    const ray = ((wx * 0.9 + wy * 0.42 - t * 4) / 30) % 1;
    if ((ray + 1) % 1 < 0.3) tone *= 1 - 0.6 * Math.exp(-d / 160);
  }
  // Sea floor.
  const floor = 182 + 7 * noise2(wx * 0.03, 1.5);
  if (wy > floor) {
    tone = 0.93;
    phase = wy * 0.5 + noise2(wx * 0.2, wy * 0.2) * 4;
    ink = wy < floor + 0.8;
  }
}

function rock(wx: number, wy: number, top: number): boolean {
  const dx = wx - LIGHTHOUSE_X;
  if (wy < top || Math.abs(dx) > 40 + Math.max(0, wy) * 0.1) return false;
  const lit = dx > 0 ? 0.15 : 0;
  tone = 0.76 - lit + (wy > 0 ? 0.12 : 0);
  phase = (wx + wy) * 0.8 + noise2(wx * 0.15, wy * 0.15) * 5;
  cross = (wx - wy) * 0.8;
  ink = wy < top + 0.9 || noise2(wx * 0.3, wy * 0.3) > 0.8;
  return true;
}

/** Where a lit point sits across the beam: 0 on its axis, 1 at its edge. */
let beamAcross = 0;

/** How much the beam lights a point: 0 outside the cone. Sets `beamAcross`. */
function beamLight(wx: number, wy: number, beam: Beam): number {
  if (beam.intensity <= 0) return 0;
  const dx = wx - LAMP.x;
  const dy = wy - LAMP.y;
  const along = dx * Math.cos(beam.angle) + dy * Math.sin(beam.angle);
  if (along <= 0) return 0;
  const across = Math.abs(-dx * Math.sin(beam.angle) + dy * Math.cos(beam.angle));
  const edge = along * Math.tan(beam.spread) + 2;
  if (across > edge) return 0;
  beamAcross = across / edge;
  const core = beamAcross < 0.6 ? 1 : (1 - beamAcross) / 0.4;
  return beam.intensity * core * Math.exp(-along / 1600);
}

/** Paint the engraved world into `rect` of `frame`. */
export function paintWorld(frame: Frame, stage: Stage, rect: PixelRect, s: WorldState): void {
  const inv = 1 / stage.scale;
  const period = HATCH_PX * inv;
  const crossPeriod = period * 1.15;
  const e = s.exposure;

  const rows: Row[] = [];
  for (let y = rect.y0; y < rect.y1; y++) {
    const sy = (y + 0.5 - stage.y) * inv;
    const wy = sy - STAGE_H / 2 + s.camera.y;
    rows.push({ wy, boilX: 0.4 * Math.sin(wy * 0.23 + e * 1.7) + 0.28 * Math.sin(wy * 0.071 + e * 2.9) });
  }
  const cols: Column[] = [];
  for (let x = rect.x0; x < rect.x1; x++) {
    const sx = (x + 0.5 - stage.x) * inv;
    const wx = sx - STAGE_W / 2 + s.camera.x;
    cols.push({
      wx,
      boilY: 0.4 * Math.sin(wx * 0.19 + e * 2.3) + 0.28 * Math.sin(wx * 0.083 + e * 1.3),
      surface: seaSurface(wx, s.t),
      rock: rockTop(wx),
    });
  }

  const px = frame.pixels;
  for (let j = 0; j < rows.length; j++) {
    const y = rect.y0 + j;
    const row = rows[j]!;
    const sy = (y + 0.5 - stage.y) * inv;
    const vy = (sy - STAGE_H / 2) / 118;
    for (let i = 0; i < cols.length; i++) {
      const x = rect.x0 + i;
      const col = cols[i]!;
      const wx = col.wx + row.boilX;
      const wy = row.wy + col.boilY;
      ink = false;
      light = false;
      cross = (wx + wy) * 0.8;

      const underwater = wy > col.surface;
      if (underwater) {
        if (!(whale(wx, wy, s) || fish(wx, wy, s) || bubbles(wx, wy, s) || kelp(wx, wy, s) || rock(wx, wy, col.rock))) {
          sea(wx, wy, col.surface, s);
        }
      } else if (!(lighthouse(wx, wy) || paperBoat(wx, wy, s) || rock(wx, wy, col.rock))) {
        sky(wx, wy, s);
      }

      let bit = 0;
      if (ink) bit = 1;
      else if (!light) {
        const lit = beamLight(wx, wy, s.beam);
        // The engraver rules the beam's edges and leaves its core as bare paper.
        const ruled = lit > 0 && beamAcross > 0.93 && s.beam.intensity > 0.3 && s.beam.spread < 0.5;
        const sx = (x + 0.5 - stage.x) * inv;
        const vx = (sx - STAGE_W / 2) / 175;
        const vignette = Math.max(0, vx * vx + vy * vy - 0.55) * 0.9;
        const shade = (Math.min(1, tone * (1 - lit) + vignette * (1 - lit)) + s.flicker * (1 - lit)) * s.ink;
        if (ruled) bit = 1;
        else if (shade > 0) {
          const f = phase / period;
          const width = Math.min(0.92, shade * 1.12);
          if (Math.abs(f - Math.floor(f) - 0.5) < width * 0.5) bit = 1;
          else if (shade > 0.5) {
            const g = cross / crossPeriod;
            if (Math.abs(g - Math.floor(g) - 0.5) < (shade - 0.5) * 0.75) bit = 1;
          }
        }
      }
      if (ink && s.ink < 1 && hash(x >> 1, (y >> 1) + e * 131) > s.ink) bit = 0;
      px[y * frame.width + x] = bit;
    }
  }
}
