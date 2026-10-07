/**
 * The view from a spacecraft, for the free-return flight: a perspective
 * camera somewhere in space, with the Earth and the Moon as real spheres
 * at their real sizes (or blown up, for the overview), the Sun and stars
 * behind, the flight's path, and the mission's instruments over it all.
 *
 * Every pixel casts a ray. What it meets first is drawn: the Earth shaded
 * just as the globe view shades it, under the Sun; the Moon lit in its
 * phase, its near side's seas where they are; or, missing both, the sky,
 * with a thin bright skin of air round the Earth where the Sun reaches it.
 */
import { drawMicro, microWidth, MICRO_HEIGHT } from "../showreel/microtype";
import { PAPER, Painter, type Frame } from "../showreel/painter";
import type { Geography } from "./geography";
import { EARTH_RADIUS, MOON_RADIUS } from "./mission";
import { CITIES } from "./places";
import { BAYER8, drawStars, drawSun, fineDegreesFor, moonAlbedo, smooth, sunlitGround, type SkyCamera } from "./render";
import { sunDirection, type Vec3 } from "./sky";

const BLACK = 1;
const WHITE = 0;
const DEG = Math.PI / 180;

export interface Instruments {
  /** Top left, one line each: the mission and its phase. */
  phase: string[];
  /** Top right: the camera and the playback speed. */
  camera: string;
  /** Bottom left: mission elapsed time. */
  clock: string;
  /** Bottom right: distances and speed. */
  readout: string;
}

export interface SpaceScene {
  /** Simulated time, ms since 1970 UTC: where the Sun is and how far the Earth has turned. */
  time: number;
  /** The camera's position, km, in Earth axes. */
  eye: Vec3;
  camera: SkyCamera;
  /** Pixels a unit of tangent spans: the zoom. */
  focal: number;
  /** The Moon's centre, km, in Earth axes. */
  moon: Vec3;
  /** Drawn sizes over real ones, to make the bodies visible from far off. */
  scale: { earth: number; moon: number };
  /** The flight, km, in Earth axes, to draw; the first `flown` points are behind the spacecraft. Empty aboard, where it would be edge-on. */
  path: Vec3[];
  flown: number;
  /** Where the spacecraft is, to mark it; null when the camera is aboard. */
  craft: Vec3 | null;
  /** Name the bodies beside them (the overview). */
  labels: boolean;
  instruments: Instruments;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** How far along ray (o, d) it meets the sphere (c, r), or Infinity. `d` is a unit vector. */
function hitSphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o[0] - c[0];
  const oy = o[1] - c[1];
  const oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in 0…1, one cell a unit, for the Moon's mottled ground. */
function noise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const e = (t: number) => t * t * (3 - 2 * t);
  const fx = e(x - ix);
  const fy = e(y - iy);
  const fz = e(z - iz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const face = (dz: number) =>
    l(l(hash3(ix, iy, iz + dz), hash3(ix + 1, iy, iz + dz), fx), l(hash3(ix, iy + 1, iz + dz), hash3(ix + 1, iy + 1, iz + dz), fx), fy);
  return l(face(0), face(1), fz);
}

const MOON_W = 512;
const MOON_H = 256;
const moonRows: (Float32Array | undefined)[] = new Array(MOON_H);

/**
 * The Moon's ground, by selenographic latitude and longitude (0° facing the
 * Earth): the near side's seas, the far side's unbroken highlands, both
 * mottled with craters and rays as noise. Too slow for every pixel, so it is
 * baked into a map a row at a time, as rows come into view.
 */
function moonGround(lat: number, lon: number): number {
  const u = ((lon + Math.PI) / (2 * Math.PI)) * MOON_W - 0.5;
  const v = Math.max(0, Math.min(MOON_H - 1.001, ((Math.PI / 2 - lat) / Math.PI) * MOON_H - 0.5));
  const u0 = Math.floor(u);
  const v0 = Math.floor(v);
  const a = ((u0 % MOON_W) + MOON_W) % MOON_W;
  const b = (a + 1) % MOON_W;
  const top = moonRow(v0);
  const bottom = moonRow(v0 + 1);
  const fu = u - u0;
  const upper = top[a]! + (top[b]! - top[a]!) * fu;
  const lower = bottom[a]! + (bottom[b]! - bottom[a]!) * fu;
  return upper + (lower - upper) * (v - v0);
}

function moonRow(v: number): Float32Array {
  let row = moonRows[v];
  if (row) return row;
  row = new Float32Array(MOON_W);
  const lat = Math.PI / 2 - ((v + 0.5) / MOON_H) * Math.PI;
  for (let i = 0; i < MOON_W; i++) {
    const lon = ((i + 0.5) / MOON_W) * 2 * Math.PI - Math.PI;
    const [x, y, z] = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    const base = x > 0 ? moonAlbedo(y, z) : 0.88;
    row[i] = base + (noise(x * 14, y * 14, z * 14) - 0.5) * 0.25 + (noise(x * 60 + 7, y * 60, z * 60) - 0.5) * 0.15;
  }
  moonRows[v] = row;
  return row;
}

export class SpaceRenderer {
  constructor(private readonly geo: Geography) {}

  draw(frame: Frame, scene: SpaceScene): void {
    const { width, height, pixels } = frame;
    pixels.fill(BLACK);
    const { eye, camera, focal, moon } = scene;
    const sun = sunDirection(scene.time);
    drawStars(frame, camera, focal, scene.time);
    drawSun(frame, camera, focal, sun);

    const earthR = EARTH_RADIUS * scene.scale.earth;
    const moonR = MOON_RADIUS * scene.scale.moon;
    const toEarth = Math.hypot(...eye);
    // About a pixel's worth of ground, for the land test and the air's thickness.
    const kmPerPixel = Math.max(0.05, (toEarth - earthR * 0.9) / focal);
    const fineDegrees = fineDegreesFor(earthR / kmPerPixel);
    const air = Math.max(earthR * 0.012, kmPerPixel * 2.5);
    // The Moon's near side faces the Earth; its north is about the Earth's.
    const facingEarth = norm([-moon[0], -moon[1], -moon[2]]);
    const north = norm(sub([0, 0, 1], facingEarth.map((v) => v * facingEarth[2]) as Vec3));
    const east = cross(north, facingEarth);
    const { right, up, back } = camera;
    const cx = width / 2;
    const cy = height / 2;

    for (let y = 0; y < height; y++) {
      const v = -(y + 0.5 - cy) / focal;
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5 - cx) / focal;
        const d = norm([-back[0] + u * right[0] + v * up[0], -back[1] + u * right[1] + v * up[1], -back[2] + u * right[2] + v * up[2]]);
        const te = hitSphere(eye, d, [0, 0, 0], earthR);
        const tm = hitSphere(eye, d, moon, moonR);
        const threshold = BAYER8[(y & 7) * 8 + (x & 7)]!;
        if (te < tm) {
          const n: Vec3 = [(eye[0] + te * d[0]) / earthR, (eye[1] + te * d[1]) / earthR, (eye[2] + te * d[2]) / earthR];
          const half = norm([sun[0] - d[0], sun[1] - d[1], sun[2] - d[2]]);
          // Continents just showing on the night side, as moonlight and city glow show them.
          const level = sunlitGround(this.geo, n[0], n[1], n[2], sun, half, -dot(n, d), fineDegrees, 0.07);
          pixels[row + x] = level > threshold ? WHITE : BLACK;
          continue;
        }
        if (tm < Infinity) {
          const n = norm(sub([eye[0] + tm * d[0], eye[1] + tm * d[1], eye[2] + tm * d[2]], moon));
          const albedo = moonGround(Math.asin(Math.max(-1, Math.min(1, dot(n, north)))), Math.atan2(dot(n, east), dot(n, facingEarth)));
          const lit = dot(n, sun);
          const level = lit > 0 ? albedo * Math.min(1, lit * 1.4) : 0.03;
          pixels[row + x] = level > threshold ? WHITE : BLACK;
          continue;
        }
        // The air: where the ray passes just above the Earth.
        const along = -dot(eye, d);
        if (along > 0) {
          const q: Vec3 = [eye[0] + along * d[0], eye[1] + along * d[1], eye[2] + along * d[2]];
          const above = Math.hypot(q[0], q[1], q[2]) - earthR;
          if (above > 0 && above < air) {
            // Sunlit air, brighter still looking towards the Sun; on the night side, faint airglow.
            const lit = Math.max(0.3, smooth(-0.25, 0.2, dot(norm(q), sun)) + 0.6 * Math.max(0, dot(d, sun)) ** 6);
            const level = Math.min(1, lit) * (1 - above / air) ** 1.5;
            if (level > threshold) pixels[row + x] = WHITE;
          }
        }
      }
    }

    this.lights(frame, scene, sun, earthR);
    this.path(frame, scene, earthR, moonR);
    if (scene.labels) this.labels(frame, scene, earthR, moonR);
    this.instruments(frame, scene.instruments);
  }

  /** Where a point in space lands in the picture, and how far in front of the camera it is. */
  private project(frame: Frame, scene: SpaceScene, p: Vec3): [number, number, number] {
    const { right, up, back } = scene.camera;
    const rel = sub(p, scene.eye);
    const depth = -dot(rel, back);
    return [frame.width / 2 + (scene.focal * dot(rel, right)) / depth, frame.height / 2 - (scene.focal * dot(rel, up)) / depth, depth];
  }

  /** Whether the segment from the eye to `p` passes through either body first. */
  private hidden(scene: SpaceScene, p: Vec3, earthR: number, moonR: number): boolean {
    const rel = sub(p, scene.eye);
    const distance = Math.hypot(...rel);
    const d: Vec3 = [rel[0] / distance, rel[1] / distance, rel[2] / distance];
    return hitSphere(scene.eye, d, [0, 0, 0], earthR) < distance - 1 || hitSphere(scene.eye, d, scene.moon, moonR) < distance - 1;
  }

  /** Cities lit on the night side, where the camera can see them. */
  private lights(frame: Frame, scene: SpaceScene, sun: Vec3, earthR: number): void {
    for (const city of CITIES) {
      const c = Math.cos(city.lat * DEG);
      const n: Vec3 = [c * Math.cos(city.lon * DEG), c * Math.sin(city.lon * DEG), Math.sin(city.lat * DEG)];
      if (dot(n, sun) > -0.06) continue;
      const p: Vec3 = [n[0] * earthR, n[1] * earthR, n[2] * earthR];
      if (dot(n, sub(scene.eye, p)) <= 0) continue;
      const [x, y, depth] = this.project(frame, scene, p);
      if (depth <= 0) continue;
      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) continue;
      frame.pixels[py * frame.width + px] = WHITE;
      if (city.rank === 1 && px + 1 < frame.width) frame.pixels[py * frame.width + px + 1] = WHITE;
    }
  }

  /** The flight: solid where it has been, dotted ahead, hidden behind the bodies; and the spacecraft. */
  private path(frame: Frame, scene: SpaceScene, earthR: number, moonR: number): void {
    const { width, height, pixels } = frame;
    const near = 1;
    let prev: [number, number, number] | null = null;
    for (let i = 0; i < scene.path.length; i++) {
      const p = scene.path[i]!;
      const at = this.project(frame, scene, p);
      if (prev && prev[2] > near && at[2] > near && !this.hidden(scene, p, earthR, moonR)) {
        const steps = Math.ceil(Math.max(Math.abs(at[0] - prev[0]), Math.abs(at[1] - prev[1])));
        if (steps < 4000) {
          for (let s = 0; s <= steps; s++) {
            const x = Math.floor(prev[0] + ((at[0] - prev[0]) * s) / Math.max(1, steps));
            const y = Math.floor(prev[1] + ((at[1] - prev[1]) * s) / Math.max(1, steps));
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            if (i <= scene.flown || ((x + y) & 1) === 0) pixels[y * width + x] = WHITE;
          }
        }
      }
      prev = at;
    }
    if (!scene.craft) return;
    const [x, y, depth] = this.project(frame, scene, scene.craft);
    if (depth <= near) return;
    const painter = new Painter(frame, { scale: 1, x: 0, y: 0 });
    painter.paint = () => BLACK;
    painter.rect(Math.round(x) - 3, Math.round(y) - 3, 7, 7);
    painter.paint = PAPER;
    for (let k = -3; k <= 3; k++) {
      painter.pixel(Math.round(x) + k, Math.round(y));
      painter.pixel(Math.round(x), Math.round(y) + k);
    }
  }

  private labels(frame: Frame, scene: SpaceScene, earthR: number, moonR: number): void {
    const painter = new Painter(frame, { scale: 1, x: 0, y: 0 });
    for (const [name, centre, radius] of [["EARTH", [0, 0, 0] as Vec3, earthR], ["MOON", scene.moon, moonR]] as const) {
      const [x, y, depth] = this.project(frame, scene, centre);
      if (depth <= 0) continue;
      const r = (radius * scene.focal) / depth;
      painter.paint = PAPER;
      drawMicro(painter, name, Math.round(x - microWidth(name) / 2), Math.round(y + r + 4));
    }
  }

  private instruments(frame: Frame, instruments: Instruments): void {
    const painter = new Painter(frame, { scale: 1, x: 0, y: 0 });
    const line = (text: string, x: number, y: number) => {
      painter.paint = () => BLACK;
      painter.rect(x - 2, y - 2, microWidth(text) + 4, MICRO_HEIGHT + 4);
      painter.paint = PAPER;
      drawMicro(painter, text, x, y);
    };
    instruments.phase.forEach((text, i) => line(text, 5, 5 + i * (MICRO_HEIGHT + 4)));
    line(instruments.camera, frame.width - 5 - microWidth(instruments.camera), 5);
    const bottom = frame.height - MICRO_HEIGHT - 4;
    line(instruments.clock, 5, bottom);
    // Clear of the window's grow box.
    line(instruments.readout, frame.width - 19 - microWidth(instruments.readout), bottom);
  }
}
