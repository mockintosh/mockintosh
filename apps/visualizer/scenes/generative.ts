/**
 * Generative: systems with a life of their own that the sound pushes
 * around — a feedback loop, a starfield, fireworks, a cellular automaton,
 * plasma, metaballs, a Chladni plate and a harmonograph.
 */
import { drawMicro, microWidth, MICRO_HEIGHT } from "../../showreel/microtype";
import { INK, PAPER, bayer } from "../../showreel/painter";
import { BANDS, WINDOW } from "../listen";
import { Phosphor } from "../phosphor";
import {
  approach,
  clamp01,
  createRandom,
  devicePainter,
  microScaleOf,
  noteLabel,
  noteText,
  unitOf,
  type Scene,
  type SceneDefinition,
} from "../scene";

/** Mean of `spectrum` over bands `[from, to)`. */
function bandMean(spectrum: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let b = from; b < to; b++) sum += spectrum[b]!;
  return sum / Math.max(1, to - from);
}

// ── Feedback ──────────────────────────────────────────────────────────────

/**
 * The previous frame, zoomed and turned a little, under this frame's
 * waveform bent into a ring: a tunnel of echoes, MilkDrop in one bit.
 */
function feedback(): Scene {
  const glow = new Phosphor();
  let direction = 1;
  let turn = 0;
  return {
    render(frame, s) {
      glow.fit(frame);
      const { width: w, height: h } = frame;
      const cx = w / 2 + Math.sin(s.travel * 0.7) * w * 0.04;
      const cy = h / 2 + Math.cos(s.travel * 0.53) * h * 0.04;
      if (s.beat && s.beats % 8 === 0) direction = -direction;
      turn = approach(turn, direction * (0.008 + 0.03 * s.mid), s.dt, 0.3);
      const zoom = 1.012 + 0.05 * s.bass + 0.03 * s.pulse;
      const cos = Math.cos(-turn) / zoom;
      const sin = Math.sin(-turn) / zoom;
      glow.warp((x, y, out) => {
        const dx = x - cx;
        const dy = y - cy;
        out.x = cx + dx * cos - dy * sin;
        out.y = cy + dx * sin + dy * cos;
      }, 0.9 - 0.04 * (1 - s.level));

      const r0 = Math.min(w, h) * (0.16 + 0.08 * s.level);
      const points = 256;
      const gain = Math.min(s.gain, 8);
      let px = 0;
      let py = 0;
      let fx = 0;
      let fy = 0;
      for (let i = 0; i <= points; i++) {
        const a = (i / points) * Math.PI * 2 + s.travel * 0.3;
        const sample = s.mono[WINDOW - 1024 + ((i % points) * 4)]!;
        const r = r0 * (1 + 0.55 * Math.max(-0.9, Math.min(0.9, sample * gain)));
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) {
          fx = x;
          fy = y;
        } else glow.line(px, py, i === points ? fx : x, i === points ? fy : y, 1.2);
        px = x;
        py = y;
      }
      if (s.beat) {
        const r = r0 * 1.6;
        for (let k = 0; k < 180; k++) glow.add(cx + Math.cos(k * 0.035) * r, cy + Math.sin(k * 0.035) * r, 0.8 * s.bass + 0.3);
      }
      glow.develop(frame);
    },
  };
}

// ── Starfield ─────────────────────────────────────────────────────────────

const STARS = 700;

function starfield(): Scene {
  const random = createRandom(7);
  const x = new Float32Array(STARS);
  const y = new Float32Array(STARS);
  const z = new Float32Array(STARS);
  const reset = (i: number, far: boolean) => {
    x[i] = random() * 2 - 1;
    y[i] = random() * 2 - 1;
    z[i] = far ? 1 : 0.05 + random() * 0.95;
  };
  for (let i = 0; i < STARS; i++) reset(i, false);
  const glow = new Phosphor();
  let speed = 0.2;
  let roll = 0;
  return {
    render(frame, s) {
      glow.fit(frame);
      glow.decay(0.25 + 0.5 * s.level);
      const { width: w, height: h } = frame;
      const cx = w / 2;
      const cy = h / 2;
      const f = Math.max(w, h) * 0.5;
      speed = approach(speed, 0.12 + 1.3 * s.level + 2.2 * s.pulse * s.bass, s.dt, 0.15);
      roll += s.dt * (s.treble - s.bass) * 0.6;
      const cos = Math.cos(roll);
      const sin = Math.sin(roll);
      const project = (i: number, depth: number, out: [number, number]) => {
        const rx = x[i]! * cos - y[i]! * sin;
        const ry = x[i]! * sin + y[i]! * cos;
        out[0] = cx + (rx / depth) * f;
        out[1] = cy + (ry / depth) * f;
      };
      const from: [number, number] = [0, 0];
      const to: [number, number] = [0, 0];
      for (let i = 0; i < STARS; i++) {
        const before = z[i]!;
        z[i] = before - s.dt * speed;
        if (z[i]! < 0.02) {
          reset(i, true);
          continue;
        }
        project(i, before, from);
        project(i, z[i]!, to);
        if (to[0] < -2 || to[1] < -2 || to[0] > w + 2 || to[1] > h + 2) {
          reset(i, true);
          continue;
        }
        const bright = (1 - z[i]!) * (1 - z[i]!) * 1.6;
        glow.line(from[0], from[1], to[0], to[1], bright);
      }
      glow.develop(frame);
    },
  };
}

// ── Fireworks ─────────────────────────────────────────────────────────────

type BurstStyle = "peony" | "ring" | "willow" | "crossette";
const BURSTS: readonly BurstStyle[] = ["peony", "ring", "willow", "crossette"];
const MAX_SPARKS = 3500;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  drag: number;
  /** Rockets burst at their apex; crossette stars split once. */
  kind: "rocket" | "star" | "splitter";
  style: BurstStyle;
  size: number;
}

function fireworks(): Scene {
  const random = createRandom(11);
  const sparks: Spark[] = [];
  const glow = new Phosphor();
  let skyline: number[] = [];
  let skylineWidth = 0;
  let owed = 0;

  const burst = (at: Spark, u: number, power: number) => {
    const style = at.style;
    const count = Math.round((style === "ring" ? 70 : 110) * (0.6 + power));
    const speed = (45 + 90 * power) * u;
    for (let k = 0; k < count && sparks.length < MAX_SPARKS; k++) {
      const a = (k / count) * Math.PI * 2 + random() * 0.2;
      const v = style === "ring" ? speed : speed * Math.sqrt(random());
      sparks.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: style === "willow" ? 2.6 : 1.2 + random() * 0.8,
        age: 0,
        drag: style === "willow" ? 2.4 : 1.2,
        kind: style === "crossette" ? "splitter" : "star",
        style,
        size: at.size,
      });
    }
  };

  return {
    render(frame, s) {
      glow.fit(frame);
      glow.decay(0.8);
      const { width: w, height: h } = frame;
      const u = unitOf(frame);
      const launch = () => {
        // Higher notes fly higher.
        const height = s.note !== null ? clamp01((s.note - 36) / 48) : random();
        const apex = h * (0.55 - 0.35 * height);
        const vy = -Math.sqrt(2 * 60 * u * (h - apex));
        sparks.push({
          x: w * (0.15 + 0.7 * random()),
          y: h,
          vx: (random() - 0.5) * 20 * u,
          vy,
          life: 4,
          age: 0,
          drag: 0,
          kind: "rocket",
          style: BURSTS[Math.floor(random() * BURSTS.length)]!,
          size: 0.6 + s.bass,
        });
      };
      if (s.beat) launch();
      // Loud passages launch between the beats too.
      owed += s.dt * s.level * s.level * 1.5;
      if (owed > 1) {
        owed -= 1;
        launch();
      }
      const gravity = 60 * u;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const q = sparks[i]!;
        q.age += s.dt;
        const drag = Math.exp(-q.drag * s.dt);
        q.vx *= drag;
        q.vy = q.vy * drag + gravity * s.dt * (q.kind === "rocket" ? 1 : 0.5);
        const px = q.x;
        const py = q.y;
        q.x += q.vx * s.dt;
        q.y += q.vy * s.dt;
        if (q.kind === "rocket") {
          glow.line(px, py, q.x, q.y, 0.7);
          if (q.vy >= 0) {
            burst(q, u, q.size * 0.6 + s.level * 0.4);
            glow.spot(q.x, q.y, 10 * u, 1.2);
            sparks.splice(i, 1);
          }
          continue;
        }
        const fade = 1 - q.age / q.life;
        if (fade <= 0 || q.y > h) {
          sparks.splice(i, 1);
          continue;
        }
        if (q.kind === "splitter" && q.age > q.life * 0.4) {
          q.kind = "star";
          for (let k = 0; k < 4 && sparks.length < MAX_SPARKS; k++) {
            const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
            sparks.push({ ...q, vx: q.vx + Math.cos(a) * 30 * u, vy: q.vy + Math.sin(a) * 30 * u, age: 0, life: 0.8, kind: "star" });
          }
        }
        // Stars twinkle as they burn out.
        const twinkle = q.age > q.life * 0.6 && random() < 0.4 ? 0 : 1;
        glow.line(px, py, q.x, q.y, fade * 0.9 * twinkle);
      }
      glow.develop(frame);

      // A dark skyline for scale, with a few lit windows.
      if (skylineWidth !== w) {
        skylineWidth = w;
        const r = createRandom(3);
        skyline = [];
        for (let x = 0; x < w; ) {
          const bw = Math.round((10 + r() * 26) * u);
          skyline.push(x, bw, Math.round((8 + r() * 30) * u));
          x += bw;
        }
      }
      const p = devicePainter(frame);
      for (let k = 0; k < skyline.length; k += 3) {
        const [x, bw, bh] = [skyline[k]!, skyline[k + 1]!, skyline[k + 2]!];
        p.with({ paint: INK }, () => p.rect(x, h - bh, bw, bh));
        p.with({ paint: PAPER }, () => {
          const step = Math.max(3, Math.round(4 * u));
          for (let wy = h - bh + step; wy < h - step; wy += step) {
            for (let wx = x + 2; wx < x + bw - 2; wx += step) {
              const lit = ((wx * 7 + wy * 13 + k) % 11 === 0) || (s.pulse > 0.8 && (wx + wy + k) % 5 === 0);
              if (lit) p.rect(wx, wy, 1, 1);
            }
          }
        });
      }
    },
  };
}

// ── Life ──────────────────────────────────────────────────────────────────

const PATTERNS: readonly (readonly [number, number][])[] = [
  // Glider, R-pentomino, acorn, lightweight spaceship.
  [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
  [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  [[1, 0], [3, 1], [0, 2], [1, 2], [4, 2], [5, 2], [6, 2]],
  [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
];

function life(): Scene {
  const random = createRandom(5);
  let cols = 0;
  let rows = 0;
  let cell = 0;
  let alive = new Uint8Array(0);
  let next = new Uint8Array(0);
  let ghost = new Float32Array(0);
  let owed = 0;
  const glow = new Phosphor();

  const stamp = (pattern: readonly [number, number][], at: number, row: number, flip: number) => {
    for (const [dx, dy] of pattern) {
      const x = (at + (flip & 1 ? -dx : dx) + cols) % cols;
      const y = (row + (flip & 2 ? -dy : dy) + rows) % rows;
      alive[y * cols + x] = 1;
    }
  };

  const step = () => {
    for (let y = 0; y < rows; y++) {
      const up = ((y + rows - 1) % rows) * cols;
      const here = y * cols;
      const down = ((y + 1) % rows) * cols;
      for (let x = 0; x < cols; x++) {
        const l = (x + cols - 1) % cols;
        const r = (x + 1) % cols;
        const n =
          alive[up + l]! + alive[up + x]! + alive[up + r]! +
          alive[here + l]! + alive[here + r]! +
          alive[down + l]! + alive[down + x]! + alive[down + r]!;
        const was = alive[here + x]!;
        next[here + x] = n === 3 || (was && n === 2) ? 1 : 0;
      }
    }
    [alive, next] = [next, alive];
    for (let i = 0; i < ghost.length; i++) ghost[i] = alive[i] ? 1 : ghost[i]! * 0.82;
  };

  return {
    render(frame, s) {
      const { width: w, height: h } = frame;
      const size = Math.max(2, Math.round(unitOf(frame) * 2.5));
      if (size !== cell || Math.floor(w / size) !== cols || Math.floor(h / size) !== rows) {
        cell = size;
        cols = Math.max(8, Math.floor(w / size));
        rows = Math.max(8, Math.floor(h / size));
        alive = new Uint8Array(cols * rows);
        next = new Uint8Array(cols * rows);
        ghost = new Float32Array(cols * rows);
        for (let i = 0; i < alive.length; i++) alive[i] = random() < 0.12 ? 1 : 0;
      }
      // Loud bands seed the columns under them.
      for (let b = 0; b < BANDS; b++) {
        const v = s.spectrum[b]!;
        if (v < 0.5 || random() > (v - 0.5) * s.dt * 30) continue;
        const x = Math.floor(((b + random()) / BANDS) * cols);
        const y = Math.floor(rows * (1 - v) * random() + rows * (1 - v) * 0.5) % rows;
        alive[y * cols + x] = 1;
        alive[y * cols + ((x + 1) % cols)] = 1;
        alive[((y + 1) % rows) * cols + x] = 1;
      }
      if (s.beat) {
        const pattern = PATTERNS[Math.floor(random() * PATTERNS.length)]!;
        stamp(pattern, Math.floor(random() * cols), Math.floor(random() * rows), Math.floor(random() * 4));
      }
      owed += s.dt * (4 + 26 * s.level);
      while (owed >= 1) {
        owed -= 1;
        step();
      }
      glow.fit(frame);
      glow.clear();
      const light = glow.light;
      const inset = cell >= 3 ? 1 : 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const v = alive[i] ? 1.2 : ghost[i]! * 0.45;
          if (v < 0.02) continue;
          for (let py = y * cell; py < (y + 1) * cell - inset && py < h; py++) {
            light.fill(v, py * w + x * cell, Math.min(py * w + w, py * w + (x + 1) * cell - inset));
          }
        }
      }
      glow.develop(frame);
    },
  };
}

// ── Plasma ────────────────────────────────────────────────────────────────

function plasma(): Scene {
  return {
    render(frame, s) {
      const { width: w, height: h } = frame;
      const px = frame.pixels;
      const t = s.travel * 1.6;
      const u = 1 / (unitOf(frame) * 28);
      const f1 = 1 + s.bass * 1.2;
      const f2 = 1.3 + s.mid * 1.6;
      const f3 = 0.7 + s.treble * 2;
      const cx = Math.sin(t * 0.31) * 3;
      const cy = Math.cos(t * 0.23) * 2;
      const bands = 2 + s.level * 3 + s.pulse;
      const block = 2;
      for (let by = 0; by < h; by += block) {
        const y = (by - h / 2) * u;
        for (let bx = 0; bx < w; bx += block) {
          const x = (bx - w / 2) * u;
          const v =
            Math.sin(x * f1 + t) +
            Math.sin(y * f2 + t * 1.3) +
            Math.sin((x + y) * f3 * 0.7 + t * 0.7) +
            Math.sin(Math.hypot(x - cx, y - cy) * 1.7 - t * 1.1);
          const light = 0.5 + 0.5 * Math.sin(v * bands);
          for (let dy = 0; dy < block && by + dy < h; dy++) {
            const row = (by + dy) * w;
            for (let dx = 0; dx < block && bx + dx < w; dx++) {
              px[row + bx + dx] = light > bayer(bx + dx, by + dy) ? 0 : 1;
            }
          }
        }
      }
    },
  };
}

// ── Metaballs ─────────────────────────────────────────────────────────────

const BALLS = 7;

function metaballs(): Scene {
  const size = new Float32Array(BALLS).fill(0.5);
  return {
    render(frame, s) {
      const { width: w, height: h } = frame;
      const px = frame.pixels;
      const m = Math.min(w, h);
      const xs = new Float32Array(BALLS);
      const ys = new Float32Array(BALLS);
      const r2 = new Float32Array(BALLS);
      for (let i = 0; i < BALLS; i++) {
        const from = Math.floor((i * BANDS) / BALLS);
        const to = Math.floor(((i + 1) * BANDS) / BALLS);
        size[i] = approach(size[i]!, bandMean(s.spectrum, from, to), s.dt, 0.08);
        const t = s.travel * (0.35 + i * 0.05);
        xs[i] = w / 2 + Math.sin(t * 1.3 + i * 2.1) * w * 0.32;
        ys[i] = h / 2 + Math.cos(t * 0.9 + i * 1.7) * h * 0.3;
        const r = m * (0.05 + 0.13 * size[i]! + 0.03 * s.pulse);
        r2[i] = r * r;
      }
      const block = 2;
      for (let by = 0; by < h; by += block) {
        for (let bx = 0; bx < w; bx += block) {
          let field = 0;
          for (let i = 0; i < BALLS; i++) {
            const dx = bx + 1 - xs[i]!;
            const dy = by + 1 - ys[i]!;
            field += r2[i]! / (dx * dx + dy * dy + 1);
          }
          for (let dy = 0; dy < block && by + dy < h; dy++) {
            const row = (by + dy) * w;
            for (let dx = 0; dx < block && bx + dx < w; dx++) {
              const x = bx + dx;
              const y = by + dy;
              // Solid inside, a black rim at the surface, a dithered glow outside.
              let ink: number;
              if (field >= 1.12) ink = 0;
              else if (field >= 1) ink = 1;
              else ink = (field - 0.35) * 0.55 > bayer(x, y) ? 0 : 1;
              px[row + x] = ink;
            }
          }
        }
      }
    },
  };
}

// ── Chladni plate ─────────────────────────────────────────────────────────

/** Plate modes (n, m) for the twelve pitch classes, simplest for C. */
const MODES: readonly [number, number][] = [
  [1, 2], [1, 3], [2, 3], [1, 4], [2, 5], [3, 4], [1, 5], [3, 5], [2, 7], [4, 5], [3, 7], [1, 6],
];
const GRAINS = 4000;

function chladni(): Scene {
  const random = createRandom(13);
  const gx = new Float32Array(GRAINS);
  const gy = new Float32Array(GRAINS);
  for (let i = 0; i < GRAINS; i++) {
    gx[i] = random();
    gy[i] = random();
  }
  let mode: [number, number] = [1, 2];
  let modeText = "";
  return {
    render(frame, s) {
      const { width: w, height: h } = frame;
      const p = devicePainter(frame);
      const k = microScaleOf(frame);
      p.with({ paint: INK }, () => p.fill());
      if (s.note !== null && s.clarity > 0.6) {
        const pc = ((Math.round(s.note) % 12) + 12) % 12;
        const lift = Math.max(0, Math.min(2, Math.floor((Math.round(s.note) - 48) / 12)));
        const [n, m] = MODES[pc]!;
        mode = [n + lift, m + lift];
        modeText = noteText(noteLabel(s.note));
      } else if (s.beat) {
        mode = MODES[s.beats % MODES.length]!;
        modeText = "";
      }
      const [n, m] = mode;
      const shake = s.silent ? 0.0005 : 0.004 + 0.03 * s.level + 0.03 * s.pulse;
      for (let i = 0; i < GRAINS; i++) {
        const x = gx[i]!;
        const y = gy[i]!;
        // Grains are thrown about where the plate moves and come to rest on the nodal lines.
        const amplitude = Math.abs(
          Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y) - Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y),
        );
        const hop = shake * (0.08 + amplitude);
        let nx = x + (random() - 0.5) * hop;
        let ny = y + (random() - 0.5) * hop;
        if (nx < 0) nx = -nx;
        if (ny < 0) ny = -ny;
        if (nx > 1) nx = 2 - nx;
        if (ny > 1) ny = 2 - ny;
        gx[i] = nx;
        gy[i] = ny;
      }
      const side = Math.min(w, h) * 0.86;
      const x0 = (w - side) / 2;
      const y0 = (h - side) / 2;
      p.with({ paint: PAPER }, () => {
        const frameW = Math.max(1, Math.round(unitOf(frame)));
        p.rect(x0 - 3, y0 - 3, side + 6, frameW);
        p.rect(x0 - 3, y0 + side + 3 - frameW, side + 6, frameW);
        p.rect(x0 - 3, y0 - 3, frameW, side + 6);
        p.rect(x0 + side + 3 - frameW, y0 - 3, frameW, side + 6);
        const dot = unitOf(frame) >= 2 ? 2 : 1;
        for (let i = 0; i < GRAINS; i++) p.rect(Math.floor(x0 + gx[i]! * side), Math.floor(y0 + gy[i]! * side), dot, dot);
      });
      p.with({ paint: PAPER }, () => {
        const label = `MODE ${n},${m}${modeText ? `  ${modeText}` : ""}`;
        const lx = w - microWidth(label, k) - 4 * k;
        if (lx > x0 + side + 4) drawMicro(p, label, lx, h - MICRO_HEIGHT * k - 4 * k, k);
        else drawMicro(p, label, 4 * k, 4 * k, k);
      });
    },
  };
}

// ── Harmonograph ──────────────────────────────────────────────────────────

/** Just-intonation ratios by interval in semitones. */
const RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8] as const;

interface Pendulums {
  fx: number;
  fy: number;
  px: number;
  py: number;
  fx2: number;
  fy2: number;
}

/**
 * Two pendulums per axis, tuned to the interval between the last two notes:
 * a fifth draws a 3:2 figure, an octave a figure-eight, and each new note
 * lifts the pen and starts a fresh figure while the old one fades.
 */
function harmonograph(): Scene {
  const random = createRandom(17);
  const glow = new Phosphor();
  let heard: number | null = null;
  let t = 0;
  let tuning: Pendulums = { fx: 2, fy: 3, px: 0, py: Math.PI / 2, fx2: 2.01, fy2: 3.005 };
  let caption = "3:2";
  const retune = (ratio: number, label: string) => {
    tuning = {
      fx: 2,
      fy: 2 * ratio,
      px: random() * Math.PI,
      py: random() * Math.PI,
      fx2: 2 * (1 + (random() - 0.5) * 0.01),
      fy2: 2 * ratio * (1 + (random() - 0.5) * 0.01),
    };
    caption = label;
    t = 0;
  };
  return {
    render(frame, s) {
      glow.fit(frame);
      glow.decay(t < 1.5 ? 0.93 : 0.995);
      const { width: w, height: h } = frame;
      const note = s.note !== null && s.clarity > 0.6 ? Math.round(s.note) : null;
      if (note !== null && note !== heard) {
        // The interval from the last note heard (from C for the very first).
        const interval = ((note - (heard ?? 60)) % 12 + 12) % 12;
        const ratio = RATIOS[interval]!;
        heard = note;
        retune(interval === 0 ? 2 : ratio, `${noteText(noteLabel(note))}  ${interval === 0 ? "2:1" : fraction(ratio)}`);
      } else if (note === null && s.beat && s.pulse > 0.9 && random() < 0.3) {
        const interval = Math.floor(random() * 12);
        retune(RATIOS[interval]!, fraction(RATIOS[interval]!));
      }
      const scale = Math.min(w, h) * 0.42;
      const cx = w / 2;
      const cy = h / 2;
      const speed = 2.5 + 5 * s.level;
      const steps = 60;
      const dt = (s.dt * speed) / steps;
      const at = (time: number): [number, number] => {
        const decay = Math.exp(-0.012 * time);
        const x = (Math.sin(tuning.fx * time + tuning.px) + Math.sin(tuning.fx2 * time)) * 0.5 * decay;
        const y = (Math.sin(tuning.fy * time + tuning.py) + Math.sin(tuning.fy2 * time + 1)) * 0.5 * decay;
        return [cx + x * scale * (w > h ? 1.3 : 1), cy + y * scale];
      };
      let [ax, ay] = at(t);
      for (let k = 0; k < steps; k++) {
        t += dt;
        const [bx, by] = at(t);
        glow.line(ax, ay, bx, by, 0.35);
        ax = bx;
        ay = by;
      }
      glow.spot(ax, ay, 1.5 * unitOf(frame), 1);
      glow.develop(frame);
      const k = microScaleOf(frame);
      const p = devicePainter(frame);
      p.with({ paint: PAPER }, () => drawMicro(p, caption, 4 * k, h - MICRO_HEIGHT * k - 4 * k, k));
    },
  };
}

function fraction(ratio: number): string {
  for (let d = 1; d <= 45; d++) {
    const n = Math.round(ratio * d);
    if (Math.abs(n / d - ratio) < 1e-6) return `${n}:${d}`;
  }
  return ratio.toFixed(3);
}

export const GENERATIVE_SCENES: readonly SceneDefinition[] = [
  { id: "feedback", title: "Feedback", create: feedback },
  { id: "starfield", title: "Starfield", create: starfield },
  { id: "fireworks", title: "Fireworks", create: fireworks },
  { id: "life", title: "Life", create: life },
  { id: "plasma", title: "Plasma", create: plasma },
  { id: "metaballs", title: "Lava Lamp", create: metaballs },
  { id: "chladni", title: "Chladni Plate", create: chladni },
  { id: "harmonograph", title: "Harmonograph", create: harmonograph },
];
