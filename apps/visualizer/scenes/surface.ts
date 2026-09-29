/**
 * Surface: height fields plotted with the Surface app's own mesh and
 * hidden-line renderer. Instead of `z = f(x, y, t)` typed by hand, the
 * heights come from the sound — a history of spectra, membrane modes, a
 * ripple tank, noise terrain.
 */
import { DEFAULT_DOMAIN, buildScene, type HeightGrid, type OrbitCamera, type ZRange } from "../../surface/mesh";
import { createNoiseField } from "../../surface/noise";
import { renderScene, type RenderMode } from "../../surface/render";
import { BANDS } from "../listen";
import { approach, createRandom, type Frame, type Scene, type SceneDefinition } from "../scene";

function heightGrid(cells: number): HeightGrid {
  return { cells, domain: DEFAULT_DOMAIN, z: new Float64Array((cells + 1) * (cells + 1)), range: null };
}

function plot(
  frame: Frame,
  grid: HeightGrid,
  range: ZRange,
  camera: OrbitCamera,
  mode: RenderMode,
  options: { inverted?: boolean; axes?: boolean } = {},
): void {
  const scene = buildScene(grid, range, camera, { width: frame.width, height: frame.height });
  renderScene(scene, frame, { mode, inverted: options.inverted ?? true, axes: options.axes ?? false });
}

/** The spectrum read as a curve at fractional band `b`. */
function spectrumAt(spectrum: Float32Array, b: number): number {
  const k = Math.max(0, Math.min(BANDS - 1, Math.floor(b)));
  const f = b - k;
  return spectrum[k]! * (1 - f) + (spectrum[Math.min(BANDS - 1, k + 1)] ?? 0) * f;
}

/**
 * Rows of the grid as a history: row 0 (the front) is the newest, older
 * rows recede. `push` shifts every row back and returns the front row to fill.
 */
class RowHistory {
  constructor(readonly grid: HeightGrid) {}
  private owed = 0;

  /** How many rows to push for `dt` at `rate` rows per second. */
  due(dt: number, rate: number): number {
    this.owed += dt * rate;
    const n = Math.floor(this.owed);
    this.owed -= n;
    return n;
  }

  push(fill: (row: Float64Array) => void): void {
    const n = this.grid.cells + 1;
    const z = this.grid.z;
    z.copyWithin(n, 0, z.length - n);
    fill(z.subarray(0, n));
  }
}

// ── Pulsar ────────────────────────────────────────────────────────────────

/**
 * Surface's "Pulsar" example in ridgeline mode, fed by the spectrum: the
 * bass in the middle of each profile, the highs out at the edges, each new
 * line pushed in at the front — Unknown Pleasures, playing.
 */
function pulsar(): Scene {
  const cells = 48;
  const history = new RowHistory(heightGrid(cells));
  const noise = createNoiseField(4);
  let rowCount = 0;
  const camera: OrbitCamera = { yaw: 0, pitch: 0.4, zoom: 1.32 };
  return {
    render(frame, s) {
      for (let k = history.due(s.dt, 22); k > 0; k--) {
        rowCount++;
        history.push((row) => {
          for (let i = 0; i <= cells; i++) {
            const x = -1 + (2 * i) / cells;
            const envelope = Math.exp(-2.6 * x * x);
            const v = spectrumAt(s.spectrum, Math.abs(x) * BANDS * 0.75);
            const grain = noise.fbm(x * 7, rowCount * 0.35, 0, 3) * 0.05;
            row[i] = envelope * (0.05 + 1.05 * v * v + grain + 0.12 * s.pulse);
          }
        });
      }
      plot(frame, history.grid, { min: 0, max: 1.25 }, camera, "ridgeline");
    },
  };
}

// ── Terrain ───────────────────────────────────────────────────────────────

/** The spectrogram as a landscape: frequency across, time into the screen, turning slowly on a turntable. */
function terrain(): Scene {
  const cells = 32;
  const history = new RowHistory(heightGrid(cells));
  let zoom = 1;
  return {
    render(frame, s) {
      for (let k = history.due(s.dt, 12); k > 0; k--) {
        history.push((row) => {
          for (let i = 0; i <= cells; i++) {
            const v = spectrumAt(s.spectrum, (i / cells) * (BANDS - 1));
            row[i] = Math.pow(v, 1.3);
          }
        });
      }
      zoom = approach(zoom, 1 + 0.06 * s.pulse, s.dt, 0.05);
      const camera: OrbitCamera = { yaw: -0.62 + Math.sin(s.time * 0.12) * 0.45, pitch: 0.5, zoom };
      plot(frame, history.grid, { min: 0, max: 1 }, camera, "hidden", { axes: true });
    },
  };
}

// ── Drumhead ──────────────────────────────────────────────────────────────

interface MembraneMode {
  m: number;
  n: number;
  /** Radians per second. */
  omega: number;
  amplitude: number;
}

/**
 * Surface's "Drumhead" with every mode at once: a square membrane fixed at
 * its rim, each vibration mode driven by a slice of the spectrum and the
 * fundamental struck on every beat.
 */
function drumhead(): Scene {
  const cells = 30;
  const grid = heightGrid(cells);
  const modes: MembraneMode[] = [];
  for (let m = 1; m <= 3; m++) {
    for (let n = 1; n <= 3; n++) modes.push({ m, n, omega: 5 * Math.hypot(m, n), amplitude: 0 });
  }
  modes.sort((a, b) => a.omega - b.omega);
  let strike = 0;
  return {
    render(frame, s) {
      if (s.beat) strike = Math.min(1.4, strike + 0.6 + s.bass);
      strike *= Math.exp(-s.dt * 2.5);
      modes.forEach((mode, k) => {
        const from = Math.floor((k * BANDS * 0.8) / modes.length);
        const v = spectrumAt(s.spectrum, from);
        mode.amplitude = approach(mode.amplitude, v * (k === 0 ? 0.6 : 0.4), s.dt, 0.1);
      });
      const n = cells + 1;
      for (let j = 0; j < n; j++) {
        const v = j / cells;
        for (let i = 0; i < n; i++) {
          const u = i / cells;
          let z = 0;
          modes.forEach((mode, k) => {
            const a = mode.amplitude + (k < 2 ? strike * (k === 0 ? 0.8 : 0.3) : 0);
            z += a * Math.sin(mode.m * Math.PI * u) * Math.sin(mode.n * Math.PI * v) * Math.cos(mode.omega * s.time + k);
          });
          grid.z[j * n + i] = z;
        }
      }
      const camera: OrbitCamera = { yaw: -0.6 + s.time * 0.08, pitch: 0.55, zoom: 1.05 };
      plot(frame, grid, { min: -1.3, max: 1.3 }, camera, "hidden");
    },
  };
}

// ── Pond ──────────────────────────────────────────────────────────────────

/** A ripple tank: every beat drops a stone, the treble rains on the water. */
function pond(): Scene {
  const cells = 40;
  const n = cells + 1;
  const grid = heightGrid(cells);
  let current = new Float64Array(n * n);
  let previous = new Float64Array(n * n);
  const random = createRandom(31);
  let owed = 0;

  const drop = (amount: number, radius: number) => {
    const ci = 3 + Math.floor(random() * (n - 6));
    const cj = 3 + Math.floor(random() * (n - 6));
    const reach = Math.ceil(radius * 2);
    for (let j = Math.max(1, cj - reach); j <= Math.min(n - 2, cj + reach); j++) {
      for (let i = Math.max(1, ci - reach); i <= Math.min(n - 2, ci + reach); i++) {
        const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (radius * radius);
        current[j * n + i]! -= amount * Math.exp(-d2);
      }
    }
  };

  const step = () => {
    const next = previous;
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        next[k] = ((current[k - 1]! + current[k + 1]! + current[k - n]! + current[k + n]!) / 2 - next[k]!) * 0.985;
      }
    }
    previous = current;
    current = next;
  };

  return {
    render(frame, s) {
      if (s.beat) drop(0.7 + 0.8 * s.bass, 1.6 + s.bass);
      if (random() < s.treble * s.treble * s.dt * 14) drop(0.25, 1);
      owed += s.dt * 40;
      while (owed >= 1) {
        owed -= 1;
        step();
      }
      for (let k = 0; k < n * n; k++) grid.z[k] = Math.max(-1, Math.min(1, current[k]!));
      const camera: OrbitCamera = { yaw: -0.7 + s.time * 0.05, pitch: 0.62, zoom: 1.08 };
      plot(frame, grid, { min: -1, max: 1 }, camera, "hidden");
    },
  };
}

// ── Flyover ───────────────────────────────────────────────────────────────

/** Surface's "Alien Terrain", flown over: faster and taller the louder it gets, ridged by the bass. */
function flyover(): Scene {
  const cells = 40;
  const n = cells + 1;
  const grid = heightGrid(cells);
  const noise = createNoiseField(9);
  let distance = 0;
  let height = 0.6;
  let ridges = 0;
  return {
    render(frame, s) {
      distance += s.dt * (0.2 + 1.1 * s.level + 0.9 * s.pulse);
      height = approach(height, 0.45 + 0.9 * s.level, s.dt, 0.25);
      ridges = approach(ridges, s.bass, s.dt, 0.15);
      for (let j = 0; j < n; j++) {
        const y = -1 + (2 * j) / cells + distance;
        for (let i = 0; i < n; i++) {
          const x = -1 + (2 * i) / cells;
          const base = noise.fbm(x * 1.2, y * 1.2, 0, 4);
          const crest = noise.ridged(x * 0.8, y * 0.8, 3, 3);
          grid.z[j * n + i] = base * height + crest * ridges * 0.6;
        }
      }
      const camera: OrbitCamera = { yaw: 0, pitch: 0.34, zoom: 1.35 };
      plot(frame, grid, { min: -0.9, max: 1.3 }, camera, "ridgeline");
    },
  };
}

export const SURFACE_SCENES: readonly SceneDefinition[] = [
  { id: "pulsar", title: "Pulsar", create: pulsar },
  { id: "terrain", title: "Terrain", create: terrain },
  { id: "drumhead", title: "Drumhead", create: drumhead },
  { id: "pond", title: "Pond", create: pond },
  { id: "flyover", title: "Flyover", create: flyover },
];
