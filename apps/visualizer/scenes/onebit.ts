/**
 * One Bit: the shots of Showreel's first reel, played live. The reel cuts
 * to a score it knows in advance; here the same type, tiles, moiré, sun and
 * knot, particles and tunnel take their timing from whatever is sounding,
 * and the edit cuts on the beat.
 */
import { easeInOutBack, easeOutBack, easeOutExpo, hash, seg } from "../../showreel/ease";
import { MICRO_HEIGHT, drawMicro, microWidth } from "../../showreel/microtype";
import { drawKnot, type KnotPose } from "../../showreel/onebit/depth";
import {
  INK,
  PAPER,
  Painter,
  STAGE_H,
  STAGE_W,
  XOR,
  bayer,
  createFrame,
  fitStage,
  invertRect,
  kaleidoscope,
  tone,
  toneOver,
  type Stage,
  type Vec,
} from "../../showreel/painter";
import { drawStrokes, layoutText, mapGlyph, sampleStrokes, type PlacedGlyph } from "../../showreel/type";
import { BANDS, type Listening } from "../listen";
import {
  approach,
  clamp01,
  createRandom,
  microScaleOf,
  noteLabel,
  noteText,
  type Frame,
  type Scene,
  type SceneDefinition,
} from "../scene";

const CX = STAGE_W / 2;
const CY = STAGE_H / 2;

/** The smallest stage that covers the frame, centred: no letterbox. */
function coverStage(frame: Frame): Stage {
  const scale = Math.max(frame.width / STAGE_W, frame.height / STAGE_H);
  return { scale, x: (frame.width - STAGE_W * scale) / 2, y: (frame.height - STAGE_H * scale) / 2 };
}

function painterFor(frame: Frame, stage: Stage): Painter {
  return new Painter(frame, stage);
}

/** Seconds since the last onset, read back from the pulse (∞ before the first). */
function sinceBeat(s: Listening): number {
  return s.pulse > 1e-4 ? -Math.log(s.pulse) / 6 : Infinity;
}

function bandMean(s: Listening, from: number, to: number): number {
  let sum = 0;
  for (let b = from; b < to; b++) sum += s.spectrum[b]!;
  return sum / Math.max(1, to - from);
}

/** A sharp sign in stage units, for the stroke face. */
function sharpStrokes(x: number, top: number, size: number): Vec[][] {
  return [
    [{ x: x + size * 0.35, y: top }, { x: x + size * 0.25, y: top + size }],
    [{ x: x + size * 0.75, y: top }, { x: x + size * 0.65, y: top + size }],
    [{ x, y: top + size * 0.38 }, { x: x + size, y: top + size * 0.3 }],
    [{ x, y: top + size * 0.72 }, { x: x + size, y: top + size * 0.64 }],
  ];
}

// ── Type ──────────────────────────────────────────────────────────────────

const WORD = "MOCKINTOSH";
const WORD_TRACKING = 3;
/** Cap height that sets the word across this share of the stage. */
const WORD_SIZE = (() => {
  const probe = layoutText(WORD, { size: 10, tracking: WORD_TRACKING }, { x: 0, top: 0 });
  const last = probe[probe.length - 1]!;
  return (10 * STAGE_W * 0.84) / (last.x + last.width);
})();
const WORD_TOP = 70;
const WORD_BASELINE = WORD_TOP + WORD_SIZE;
const WORD_STROKE = 5;

/**
 * The title card as a graphic equalizer: each letter is a band and rises
 * out of the mask line with the reel's overshoot; the registration dots
 * swell as each beat's ring passes them.
 */
function typeCard(): Scene {
  const glyphs = layoutText(WORD, { size: WORD_SIZE, tracking: WORD_TRACKING }, { cx: CX, top: WORD_TOP });
  const lift = new Float32Array(glyphs.length).fill(48);
  const velocity = new Float32Array(glyphs.length);
  let credit = "";
  let typedAt = 0;
  return {
    render(frame, s) {
      const p = painterFor(frame, fitStage(frame.width, frame.height));
      p.with({ paint: PAPER }, () => p.fill());
      const since = sinceBeat(s);
      const ring = since * 380;
      const grid = 12;
      p.with({ paint: INK }, () => {
        for (let gx = grid / 2; gx < STAGE_W; gx += grid) {
          for (let gy = grid / 2; gy < STAGE_H; gy += grid) {
            const d = Math.hypot(gx - CX, gy - CY);
            const swell = Math.exp(-(((d - ring) / 14) ** 2)) * Math.exp(-since * 2);
            p.circle(gx, gy, 0.45 + 1.4 * swell);
          }
        }
      });

      const savedClip = p.clip;
      p.clip = { ...savedClip, y1: Math.min(savedClip.y1, Math.ceil(p.dy(WORD_BASELINE + WORD_STROKE / 2 + 0.5))) };
      const dt = Math.min(0.05, s.dt);
      glyphs.forEach((glyph, i) => {
        const from = Math.floor((i * BANDS * 0.85) / glyphs.length);
        const to = Math.floor(((i + 1) * BANDS * 0.85) / glyphs.length);
        const target = (1 - clamp01(bandMean(s, from, to) * 1.25)) * 48;
        velocity[i] = velocity[i]! + ((target - lift[i]!) * 260 - velocity[i]! * 15) * dt;
        lift[i] = lift[i]! + velocity[i]! * dt;
        const skew = Math.max(-0.4, Math.min(0.4, -velocity[i]! * 0.003));
        const strokes = mapGlyph(glyph, (q) => ({ x: q.x + (WORD_BASELINE - q.y) * skew, y: q.y + Math.max(-6, lift[i]!) }));
        p.with({ paint: INK }, () => drawStrokes(p, strokes, WORD_STROKE));
      });
      p.clip = savedClip;

      const ruleW = 212 * (0.15 + 0.85 * s.level);
      p.with({ paint: INK }, () => p.rect(CX - ruleW / 2, WORD_BASELINE + 9, ruleW, 1.6));

      const next = s.note !== null
        ? `NOW PLAYING  ${noteText(noteLabel(s.note))}  ${s.pitch!.toFixed(1)} HZ`
        : s.silent ? "WAITING FOR SOUND" : "LISTENING";
      if (next !== credit) {
        credit = next;
        typedAt = s.time;
      }
      const typed = Math.floor(seg(s.time, typedAt, typedAt + 0.35) * credit.length);
      const k = microScaleOf(frame);
      p.with({ paint: INK }, () => {
        const text = credit.slice(0, typed) + (typed < credit.length || Math.floor(s.time * 3) % 2 === 0 ? "_" : " ");
        drawMicro(p, text, p.dx(CX) - microWidth(credit + "_", k) / 2, p.dy(WORD_BASELINE + 16), k);
        drawMicro(p, "BANDS 01-10", p.dx(10), p.dy(10), k);
        const right = "512 X 342 X 1 BIT";
        drawMicro(p, right, p.dx(STAGE_W - 10) - microWidth(right, k), p.dy(10), k);
        drawMicro(p, "ONE BIT", p.dx(10), p.dy(STAGE_H - 10) - MICRO_HEIGHT * k, k);
        const beats = `BEAT ${String(s.beats % 10000).padStart(4, "0")}`;
        drawMicro(p, beats, p.dx(STAGE_W - 10) - microWidth(beats, k), p.dy(STAGE_H - 10) - MICRO_HEIGHT * k, k);
      });
      // Every eighth beat lands on a single inverted frame, as the reel's cuts do.
      if (s.beats > 0 && s.beats % 8 === 0 && since < 1 / 30) invertRect(frame, { x0: 0, y0: 0, x1: frame.width, y1: frame.height });
    },
  };
}

// ── Truchet ───────────────────────────────────────────────────────────────

const TILE = 20;

function quarterArc(cx: number, cy: number, r: number, a0: number): Vec[] {
  const out: Vec[] = [];
  for (let k = 0; k <= 8; k++) {
    const a = a0 + (k / 8) * (Math.PI / 2);
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

/** Truchet tiles that turn in a wave from the centre on every beat, sized by the band beneath them. */
function truchet(): Scene {
  const recent: number[] = [];
  let settled = 0;
  let scales = new Float32Array(0);
  return {
    render(frame, s) {
      const stage = coverStage(frame);
      const p = painterFor(frame, stage);
      p.with({ paint: INK }, () => p.fill());
      if (s.beat) recent.push(s.time);
      while (recent.length > 0 && s.time - recent[0]! > 1.2) {
        recent.shift();
        settled++;
      }
      const left = -stage.x / stage.scale;
      const top = -stage.y / stage.scale;
      const cols = Math.ceil((frame.width / stage.scale) / TILE) + 1;
      const rows = Math.ceil((frame.height / stage.scale) / TILE) + 1;
      if (scales.length !== cols) scales = new Float32Array(cols).fill(0.6);
      const maxDist = Math.hypot(cols * TILE, rows * TILE) / 2;
      const width = 2.4 + 2.6 * s.level;
      for (let i = 0; i < cols; i++) {
        const band = Math.min(BANDS - 1, Math.floor((i / cols) * BANDS * 0.9));
        scales[i] = approach(scales[i]!, 0.45 + 0.6 * s.spectrum[band]!, s.dt, 0.05);
      }
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const cx = Math.floor(left / TILE) * TILE + TILE / 2 + i * TILE;
          const cy = Math.floor(top / TILE) * TILE + TILE / 2 + j * TILE;
          const dist = Math.hypot(cx - CX, cy - CY) / maxDist;
          const scale = Math.min(1.05, scales[i]!);
          let turns = (hash(i + j * 97, 7) < 0.5 ? 0 : 1) + settled;
          for (const beat of recent) turns += easeInOutBack(seg(s.time, beat + dist * 0.35 - 0.05, beat + dist * 0.35 + 0.25));
          const angle = turns * (Math.PI / 2) * (hash(i * 31 + j, 3) < 0.5 ? 1 : -1);
          const cos = Math.cos(angle) * scale;
          const sin = Math.sin(angle) * scale;
          const place = (q: Vec): Vec => ({
            x: cx + (q.x - cx) * cos - (q.y - cy) * sin,
            y: cy + (q.x - cx) * sin + (q.y - cy) * cos,
          });
          const h = TILE / 2;
          p.with({ paint: PAPER }, () => {
            p.stroke(quarterArc(cx - h, cy - h, h, 0).map(place), width * scale);
            p.stroke(quarterArc(cx + h, cy + h, h, Math.PI).map(place), width * scale);
          });
        }
      }
    },
  };
}

// ── Moire ─────────────────────────────────────────────────────────────────

/** Three ring emitters XORed together; the kick squeezes the rings, the mids spread the sources. */
function moire(): Scene {
  let spread = 0.5;
  return {
    render(frame, s) {
      const stage = coverStage(frame);
      const inv = 1 / stage.scale;
      spread = approach(spread, 0.3 + 0.9 * s.mid, s.dt, 0.2);
      const spin = s.travel * 0.9;
      const centres = [0, 1, 2].map((k) => {
        const a = spin + (k * Math.PI * 2) / 3;
        return { x: CX + Math.cos(a) * 58 * spread, y: CY + Math.sin(a) * 34 * spread };
      });
      const spacing = 7.5 - 3.2 * s.pulse * (0.4 + s.bass);
      const phase = s.travel * 22;
      const px = frame.pixels;
      const { width: w, height: h } = frame;
      const [a, b, c] = centres as [Vec, Vec, Vec];
      for (let y = 0; y < h; y++) {
        const sy = (y + 0.5 - stage.y) * inv;
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const sx = (x + 0.5 - stage.x) * inv;
          const bit =
            (Math.floor((Math.hypot(sx - a.x, sy - a.y) - phase) / spacing) ^
              Math.floor((Math.hypot(sx - b.x, sy - b.y) - phase) / spacing) ^
              Math.floor((Math.hypot(sx - c.x, sy - c.y) - phase) / spacing)) & 1;
          px[row + x] = bit;
        }
      }
      // A point of light at the heart, swelling on the beat.
      const p = painterFor(frame, stage);
      p.with({ paint: XOR }, () => p.circle(CX, CY, 1.5 + 5 * s.pulse));
    },
  };
}

// ── Sunset ────────────────────────────────────────────────────────────────

const HORIZON = 118;
const SUN_R = 56;

/**
 * The reel's depth shot: a sun sliced by the spectrum over a floor that
 * races by with the loudness, and the knot — a ring when it's quiet, a
 * trefoil when it's loud — swelling on every beat.
 */
function sunset(): Scene {
  let morph = 0;
  let size = 36;
  return {
    render(frame, s) {
      const stage = coverStage(frame);
      const p = painterFor(frame, stage);
      p.with({ paint: INK }, () => p.fill());
      const left = -stage.x / stage.scale - 2;
      const right = (frame.width - stage.x) / stage.scale + 2;
      const bottom = (frame.height - stage.y) / stage.scale + 2;

      const R = SUN_R * (1 + 0.06 * s.bass + 0.04 * s.pulse);
      const sunY = HORIZON - 22;
      const savedClip = p.clip;
      const horizonClip = { ...savedClip, y1: Math.min(savedClip.y1, Math.ceil(p.dy(HORIZON))) };
      const pitch = 9;
      const scroll = (s.travel * 6) % pitch;
      const slits = Math.ceil((2 * R) / pitch) + 1;
      for (let band = -1; band < slits; band++) {
        const y0 = sunY - R + band * pitch + scroll;
        const k = clamp01((y0 - (sunY - R)) / (2 * R));
        // Lower slits are the low bands.
        const b = Math.max(0, Math.min(BANDS - 1, Math.round((1 - k) * BANDS * 0.7)));
        const open = k < 0.3 ? 0 : (k - 0.3) * pitch * (0.35 + 1.1 * s.spectrum[b]!);
        p.clip = {
          ...horizonClip,
          y0: Math.max(horizonClip.y0, Math.ceil(p.dy(y0) - 0.5)),
          y1: Math.min(horizonClip.y1, Math.ceil(p.dy(y0 + pitch - Math.min(pitch - 0.5, open)) - 0.5)),
        };
        p.with({ paint: tone(k * k * 0.55) }, () => p.circle(CX, sunY, R));
      }
      p.clip = savedClip;

      p.with({ paint: PAPER }, () => {
        p.line({ x: left, y: HORIZON }, { x: right, y: HORIZON });
        const travel = (s.travel * 1.8) % 1;
        for (let k = 0; k < 12; k++) {
          const z = k + 1 - travel;
          const y = HORIZON + 64 / z;
          if (y < bottom) p.line({ x: left, y }, { x: right, y });
        }
        for (let k = -16; k <= 16; k++) {
          p.line({ x: CX + k * 7.1, y: HORIZON + 7.1 }, { x: CX + k * 64, y: HORIZON + 64 });
        }
      });
      for (let k = 0; k < 8; k++) {
        p.with({ paint: toneOver(1 - k / 8) }, () => p.rect(left, HORIZON + 0.5 + k * 1.6, right - left, 1.6));
      }

      morph = approach(morph, clamp01(s.level * 1.3), s.dt, 0.4);
      size = approach(size, 34 * (1 + 0.28 * s.pulse + 0.1 * s.bass), s.dt, 0.06);
      const t = s.travel;
      const pose: KnotPose = {
        morph,
        tube: 0.1 + 0.16 * s.bass + 0.04 * s.pulse,
        yaw: t * 1.1,
        pitch: 0.7 + 0.18 * Math.sin(t * 0.9),
        roll: t * 0.6,
        center: { x: CX, y: 76 + Math.sin(s.time * 2.6) * 3 },
        size,
        light: { x: Math.cos(s.time * 1.3) * 0.9, y: -0.9, z: -0.7 },
      };
      const shadowW = pose.size * 1.3;
      p.with({ paint: toneOver(0.82) }, () => p.ellipse(CX, 150, shadowW, shadowW * 0.12));
      p.with({ paint: INK }, () => p.ellipse(CX, 150, shadowW * 0.6, shadowW * 0.07));
      drawKnot(p, pose);
    },
  };
}

// ── Flow ──────────────────────────────────────────────────────────────────

const PARTICLES = 2200;

/**
 * The reel's dust: it swirls about the centre, bursts outward on the beat,
 * and when a note is held long enough, gathers into the note's name.
 */
function flow(): Scene {
  const random = createRandom(23);
  const x = new Float32Array(PARTICLES);
  const y = new Float32Array(PARTICLES);
  const vx = new Float32Array(PARTICLES);
  const vy = new Float32Array(PARTICLES);
  const orbit = new Float32Array(PARTICLES);
  const angle = new Float32Array(PARTICLES);
  const rate = new Float32Array(PARTICLES);
  const px = new Float32Array(PARTICLES);
  const py = new Float32Array(PARTICLES);
  for (let i = 0; i < PARTICLES; i++) {
    orbit[i] = 12 + 70 * Math.sqrt(random());
    angle[i] = random() * Math.PI * 2;
    rate[i] = 0.8 + 1.6 * random();
    x[i] = CX + Math.cos(angle[i]!) * orbit[i]! * 1.3;
    y[i] = CY + Math.sin(angle[i]!) * orbit[i]! * 0.75;
  }
  let word = "";
  let glyphs: PlacedGlyph[] = [];
  let targets: Vec[] = [];
  let heldSince = Infinity;
  let heldNote: number | null = null;

  const spell = (text: string) => {
    word = text;
    const letters = text.replace("#", "");
    glyphs = layoutText(letters, { size: 60, tracking: 5 }, { cx: CX - (text.includes("#") ? 12 : 0), top: 60 });
    const points = sampleStrokes(glyphs, 0.7);
    if (text.includes("#")) {
      const letter = glyphs[0]!;
      for (const stroke of sharpStrokes(letter.x + letter.width + 4, 58, 20)) {
        for (let k = 0; k <= 30; k++) {
          const a = stroke[0]!;
          const b = stroke[1]!;
          points.push({ x: a.x + (b.x - a.x) * (k / 30), y: a.y + (b.y - a.y) * (k / 30) });
        }
      }
    }
    targets = points;
  };

  return {
    render(frame, s) {
      const stage = coverStage(frame);
      const p = painterFor(frame, stage);
      p.with({ paint: INK }, () => p.fill());
      const rounded = s.note !== null && s.clarity > 0.65 ? Math.round(s.note) : null;
      if (rounded !== heldNote) {
        heldNote = rounded;
        heldSince = s.time;
      }
      const gathering = heldNote !== null && s.time - heldSince > 0.25;
      if (gathering) {
        const text = noteText(noteLabel(heldNote!));
        if (text !== word) spell(text);
      }
      const dt = Math.min(0.05, s.dt);
      const pull = gathering ? 16 : 7;
      const damping = gathering ? 7 : 3.5;
      const swell = 1 + 0.5 * s.bass;
      for (let i = 0; i < PARTICLES; i++) {
        px[i] = x[i]!;
        py[i] = y[i]!;
        angle[i] = angle[i]! + dt * rate[i]! * (0.4 + 1.4 * s.level);
        let tx: number;
        let ty: number;
        if (gathering && targets.length > 0) {
          const target = targets[i % targets.length]!;
          const shimmer = 0.6 * Math.sin(s.time * 11 + i);
          tx = target.x + shimmer;
          ty = target.y + shimmer * 0.6;
        } else {
          tx = CX + Math.cos(angle[i]!) * orbit[i]! * 1.3 * swell;
          ty = CY + Math.sin(angle[i]!) * orbit[i]! * 0.75 * swell;
        }
        vx[i] = vx[i]! + ((tx - x[i]!) * pull - vx[i]! * damping) * dt;
        vy[i] = vy[i]! + ((ty - y[i]!) * pull - vy[i]! * damping) * dt;
        if (s.beat) {
          const dx = x[i]! - CX;
          const dy = y[i]! - CY;
          const d = Math.hypot(dx, dy) + 1;
          const kick = (60 + 220 * hash(i, 4)) * (0.3 + s.bass);
          vx[i] = vx[i]! + (dx / d) * kick;
          vy[i] = vy[i]! + (dy / d) * kick;
        }
        x[i] = x[i]! + vx[i]! * dt;
        y[i] = y[i]! + vy[i]! * dt;
      }
      const dot = Math.max(1, Math.round(stage.scale));
      p.with({ paint: PAPER }, () => {
        for (let i = 0; i < PARTICLES; i++) {
          const hx = p.dx(x[i]!);
          const hy = p.dy(y[i]!);
          p.deviceLine(p.dx(px[i]!), p.dy(py[i]!), hx, hy);
          if (dot > 1) p.span(Math.floor(hy) + 1, Math.floor(hx), Math.floor(hx) + dot);
        }
      });
      // While the word holds, its skeleton flickers on through the dust.
      if (gathering && s.time - heldSince > 0.8) {
        p.with({ paint: XOR }, () => {
          for (const glyph of glyphs) {
            for (const stroke of glyph.strokes) {
              for (let k = 1; k < stroke.length; k++) {
                if ((k + Math.floor(s.time * 30)) % 3 === 0) p.line(stroke[k - 1]!, stroke[k]!);
              }
            }
          }
        });
      }
    },
  };
}

// ── Tunnel ────────────────────────────────────────────────────────────────

/** The checker tunnel, surging on the beat, with a speaker cone at the vanishing point. */
function tunnel(): Scene {
  let turn = 0;
  let twist = 0;
  return {
    render(frame, s) {
      const stage = coverStage(frame);
      const inv = 1 / stage.scale;
      const { width: w, height: h } = frame;
      const px = frame.pixels;
      const t = s.time;
      const cx = CX + Math.sin(t * 1.7) * 26 * (0.3 + s.level);
      const cy = CY + Math.sin(t * 2.3 + 1) * 14 * (0.3 + s.level);
      const travel = s.travel * 3;
      const sectors = s.level < 0.45 ? 16 : s.level < 0.8 ? 24 : 32;
      twist = approach(twist, 0.02 + 0.08 * s.mid, s.dt, 0.4);
      // A half-sector snap on every beat, eased like the reel's turn.
      turn += s.dt * 0.3;
      const snap = easeOutBack(clamp01(sinceBeat(s) / 0.3), 1.4);
      const angleOffset = turn + ((s.beats - 1 + snap) * 0.5) / sectors;
      const TAU = Math.PI * 2;
      for (let y = 0; y < h; y++) {
        const dy = (y + 0.5 - stage.y) * inv - cy;
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const dx = (x + 0.5 - stage.x) * inv - cx;
          const r = Math.hypot(dx, dy) + 0.001;
          const z = 150 / r;
          const u = (Math.atan2(dy, dx) / TAU + angleOffset) * sectors + z * twist * sectors;
          const v = (z + travel) * 2;
          const check = (Math.floor(u) + Math.floor(v)) & 1;
          const light = clamp01((r - 5) / 70);
          px[row + x] = check && light > bayer(x, y) ? 0 : 1;
        }
      }
      const p = painterFor(frame, stage);
      const kick = s.pulse * (0.5 + s.bass);
      p.with({ paint: XOR }, () => p.ring(cx, cy, 5 + kick * 9, 1.2 + kick * 1.6));
    },
  };
}

// ── Edit ──────────────────────────────────────────────────────────────────

type Treatment = "none" | "invert" | "kaleidoscope" | "strobe" | "split";
const TREATMENTS: readonly Treatment[] = ["none", "invert", "kaleidoscope", "strobe", "split", "none"];
const MIN_CUT = 0.22;
const MAX_CUT = 1.6;

/** A montage of the other shots, cutting on the beat, each cut with one of the reel's treatments. */
function edit(): Scene {
  const random = createRandom(29);
  const shots = [truchet(), moire(), sunset(), flow(), tunnel(), typeCard()];
  let layer: Frame = createFrame(0, 0);
  let split: Frame = createFrame(0, 0);
  let cut = 0;
  let cutAt = -Infinity;
  let shot = 0;
  let partner = 1;
  let treatment: Treatment = "none";
  return {
    render(frame, s) {
      if (layer.width !== frame.width || layer.height !== frame.height) {
        layer = createFrame(frame.width, frame.height);
        split = createFrame(frame.width, frame.height);
      }
      const held = s.time - cutAt;
      if ((s.beat && held > MIN_CUT) || held > MAX_CUT) {
        cut++;
        cutAt = s.time;
        shot = (shot + 1 + Math.floor(random() * (shots.length - 1))) % shots.length;
        partner = (shot + 1 + Math.floor(random() * (shots.length - 1))) % shots.length;
        treatment = TREATMENTS[Math.floor(random() * TREATMENTS.length)]!;
      }
      const local = s.time - cutAt;
      shots[shot]!.render(layer, s);

      // Every cut lands with a jolt that settles in a few frames.
      const jolt = Math.exp(-local * 22) * 5 * Math.max(1, frame.width / STAGE_W);
      const ox = Math.round(Math.cos(cut * 2.4) * jolt);
      const oy = Math.round(Math.sin(cut * 2.4) * jolt);
      const { width: w, height: h } = frame;
      for (let y = 0; y < h; y++) {
        const sy = Math.max(0, Math.min(h - 1, y - oy));
        for (let x = 0; x < w; x++) {
          const sx = Math.max(0, Math.min(w - 1, x - ox));
          frame.pixels[y * w + x] = layer.pixels[sy * w + sx]!;
        }
      }
      const rect = { x0: 0, y0: 0, x1: w, y1: h };
      if (treatment === "invert") invertRect(frame, rect);
      else if (treatment === "kaleidoscope") kaleidoscope(frame, rect);
      else if (treatment === "strobe" && Math.floor(local * 30) % 4 < 2) invertRect(frame, rect);
      else if (treatment === "split") {
        shots[partner]!.render(split, s);
        const sweep = 0.75 - 0.5 * easeOutExpo(clamp01(local / 0.3));
        for (let y = 0; y < h; y++) {
          const from = Math.max(0, Math.ceil(w * sweep + y * 0.45));
          if (from >= w) continue;
          frame.pixels.set(split.pixels.subarray(y * w + from, y * w + w), y * w + from);
          if (from > 0) frame.pixels[y * w + from - 1] = 0;
        }
      }
      const k = microScaleOf(frame);
      const p = new Painter(frame, { scale: 1, x: 0, y: 0 });
      const label = `CUT ${String(cut % 100).padStart(2, "0")}`;
      p.with({ paint: XOR }, () => drawMicro(p, label, w - microWidth(label, k) - 6 * k, 5 * k, k));
    },
  };
}

export const ONE_BIT_SCENES: readonly SceneDefinition[] = [
  { id: "type", title: "Type", create: typeCard },
  { id: "truchet", title: "Truchet", create: truchet },
  { id: "moire", title: "Moire", create: moire },
  { id: "sunset", title: "Sunset", create: sunset },
  { id: "flow", title: "Flow", create: flow },
  { id: "tunnel", title: "Tunnel", create: tunnel },
  { id: "edit", title: "Edit", create: edit },
];
