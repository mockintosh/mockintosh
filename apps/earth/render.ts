/**
 * One frame of Earth, white on black:
 *
 * - the sky behind: the Sun, the Moon in its phase and the bright stars
 *   where they really are at that moment, seen as a camera at the view's
 *   distance would see them, so they wheel past as the globe turns;
 * - the ground as dots on a grid of meridians and parallels, so they ride
 *   the globe as it turns and crowd together at the poles and the limb.
 *   Land and the lit side keep more of them, through an ordered dither on
 *   the grid's own indices. That is Studio Light;
 * - under the Sun, as Google Earth shows it instead: every pixel of the day
 *   side dithered from how bright the ground is there (`surface.ts`) and how
 *   high the Sun stands, the sea dark and glinting where it mirrors the Sun,
 *   haze thickening towards the limb, and the night side black but for its
 *   cities;
 * - a graticule, borders and the coast as one-pixel lines: dotted at night,
 *   and black where they cross bright ground by day;
 * - the limb as a bright ring, and outside it the atmosphere: dots on rays
 *   that thin out with height, brightest where the Sun shines through;
 * - labels for cities when close enough, and the position, eye altitude and
 *   (under the Sun) the time.
 */
import { drawMicro, microWidth, MICRO_HEIGHT } from "../showreel/microtype";
import { PAPER, Painter, type Frame } from "../showreel/painter";
import { basis, eyeAltitude, visibleBounds, wrapAngle, type Basis, type View } from "./globe";
import type { Geography, Polyline } from "./geography";
import { CITIES } from "./places";
import { moonDirection, siderealAngle, stars, sunDirection, type Vec3 } from "./sky";
import { SEA, landTone } from "./surface";

export type Lighting = "studio" | "sun";

export interface Layers {
  grid: boolean;
  borders: boolean;
  places: boolean;
  atmosphere: boolean;
  stars: boolean;
  /** The position and eye altitude along the bottom. */
  status: boolean;
  lighting: Lighting;
  /** Milliseconds since 1970 UTC, for where the Sun is. */
  time: number;
}

const BLACK = 1;
const WHITE = 0;
const DEG = Math.PI / 180;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Thresholds for an 8 × 8 ordered dither: 64 levels of grey in a pixel's neighbourhood. */
export const BAYER8 = (() => {
  const out = new Float32Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let v = 0;
      for (let bit = 0; bit < 3; bit++) {
        const bx = (x >> bit) & 1;
        const by = (y >> bit) & 1;
        v |= ((bx ^ by) << (5 - bit * 2)) | (by << (4 - bit * 2));
      }
      out[y * 8 + x] = (v + 0.5) / 64;
    }
  }
  return out;
})();

/** Studio light, in view axes (right, up, towards the viewer): from the upper left, in front. */
const STUDIO = (() => {
  const [x, y, z] = [-0.55, 0.45, 0.7];
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n] as const;
})();

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Between 0 below `edge0` and 1 above `edge1`, smoothly. */
export function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** How lit the air is where it meets space in direction θ on screen, as the Sun shines through it. */
function airLight(theta: number, lx: number, ly: number, lz: number): number {
  const across = Math.cos(theta) * lx - Math.sin(theta) * ly;
  // Sunlit air, and more of it scattered our way when the Sun is behind the Earth.
  return Math.min(1, 0.06 + smooth(-0.2, 0.25, across) * (0.75 + 0.7 * Math.max(0, -lz) ** 2));
}

/**
 * The near side of the Moon as the northern hemisphere sees it: the seas
 * (maria) as dark ovals on bright highlands, and Tycho's bright crater.
 * Disc coordinates, x right and y up, the disc's radius 1.
 */
const MARIA: readonly [number, number, number][] = [
  [-0.55, 0.12, 0.32], // Oceanus Procellarum
  [-0.25, 0.45, 0.22], // Mare Imbrium
  [0.18, 0.42, 0.14], // Mare Serenitatis
  [0.33, 0.14, 0.17], // Mare Tranquillitatis
  [0.7, 0.32, 0.1], // Mare Crisium
  [0.52, -0.12, 0.12], // Mare Fecunditatis
  [0.28, -0.25, 0.1], // Mare Nectaris
  [-0.15, -0.33, 0.15], // Mare Nubium
  [-0.45, -0.3, 0.11], // Mare Humorum
  [0.02, 0.72, 0.1], // Mare Frigoris
];

export function moonAlbedo(u: number, v: number): number {
  if ((u + 0.1) ** 2 + (v + 0.72) ** 2 < 0.06 ** 2) return 1; // Tycho
  for (const [cx, cy, r] of MARIA) if ((u - cx) ** 2 + (v - cy) ** 2 < r * r) return 0.5;
  return 0.95;
}

/**
 * How bright the ground at unit vector (x, y, z) is under the Sun, 0 to 1:
 * the Blue Marble lit as the Sun stands there, dark through twilight to
 * night, the sea glinting along `glint` (halfway between the Sun and the
 * viewer), and haze where `facing` (the cosine between the ground's normal
 * and the way to the viewer) is low, at the limb. `fineDegrees` is the
 * spacing of the parallels the land test runs on, about a pixel.
 * `nightLand` keeps land faintly showing on the night side.
 */
export function sunlitGround(
  geo: Geography,
  x: number,
  y: number,
  z: number,
  sun: Vec3,
  glint: Vec3 | null,
  facing: number,
  fineDegrees: number,
  nightLand = 0,
): number {
  const l = x * sun[0] + y * sun[1] + z * sun[2];
  // Twilight runs a few degrees past the terminator.
  const day = smooth(-0.12, 0.1, l);
  if (day <= 0 && nightLand === 0) return 0;
  const lat = Math.asin(Math.max(-1, Math.min(1, z)));
  const lon = Math.atan2(y, x);
  const land = geo.isLand(lon / DEG, Math.round(lat / DEG / fineDegrees), fineDegrees);
  // Daylight is nearly even across the lit side, falling away only towards the terminator.
  const sunlight = 0.35 + 0.65 * Math.sqrt(Math.max(0, l));
  let level = (land ? landTone(lat, lon) * sunlight * day + nightLand * (1 - day) : SEA * sunlight * day);
  if (day <= 0) return level;
  if (!land && glint) level += 0.7 * day * Math.max(0, x * glint[0] + y * glint[1] + z * glint[2]) ** 160;
  // Haze: the lit air thickens towards the limb.
  return level + 0.35 * day * (1 - Math.max(0, facing)) ** 3;
}

/** Parallels about a pixel apart for a globe `radius` pixels across: a power of two to the circle, so they stay put between zooms. */
export function fineDegreesFor(radius: number): number {
  return 360 / 2 ** Math.ceil(Math.log2(Math.max(256, 2 * Math.PI * radius)));
}

/** Pixels a radian of sky spans: a 60° camera across the window. */
export function skyFocal(width: number): number {
  return width / 2 / Math.tan(Math.PI / 6);
}

function hash(a: number, b: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Degrees between graticule lines: thirty pixels apart or more. */
export function gridStep(radius: number): number {
  const pixelsPerDegree = radius * DEG;
  for (const step of [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30]) if (step * pixelsPerDegree >= 30) return step;
  return 30;
}

/**
 * Meridians in the dot grid: a power of two, so zooming halves the spacing
 * in steps rather than sliding every dot, and about three pixels apart at
 * the centre.
 */
export function dotColumns(radius: number): number {
  const wanted = (2 * Math.PI * radius) / 3;
  return Math.max(64, 2 ** Math.round(Math.log2(wanted)));
}

/**
 * A camera for the sky: its axes in Earth axes. `back` points from the
 * picture towards the viewer, so the camera looks along −back.
 */
export interface SkyCamera {
  right: Vec3;
  up: Vec3;
  back: Vec3;
}

function skyCamera(k: Basis): SkyCamera {
  return { right: [k.ex, k.ey, 0], up: [k.nx, k.ny, k.nz], back: [k.fx, k.fy, k.fz] };
}

/** Where direction `d` lands in the picture, or null behind the camera. */
export function skyPoint(frame: Frame, camera: SkyCamera, focal: number, d: Vec3): [number, number] | null {
  const { right, up, back } = camera;
  const depth = -(d[0] * back[0] + d[1] * back[1] + d[2] * back[2]);
  if (depth <= 0.05) return null;
  return [
    frame.width / 2 + (focal * (d[0] * right[0] + d[1] * right[1] + d[2] * right[2])) / depth,
    frame.height / 2 - (focal * (d[0] * up[0] + d[1] * up[1] + d[2] * up[2])) / depth,
  ];
}

/** The stars, fixed among themselves while the Earth turns under them. */
export function drawStars(frame: Frame, camera: SkyCamera, focal: number, time: number): void {
  const { width, height, pixels } = frame;
  const { directions, magnitudes } = stars();
  const angle = siderealAngle(time);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const plot = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) pixels[y * width + x] = WHITE;
  };
  for (let i = 0; i < magnitudes.length; i++) {
    const [qx, qy, z] = [directions[i * 3]!, directions[i * 3 + 1]!, directions[i * 3 + 2]!];
    const at = skyPoint(frame, camera, focal, [qx * c + qy * s, -qx * s + qy * c, z]);
    if (!at) continue;
    const sx = Math.floor(at[0]);
    const sy = Math.floor(at[1]);
    const mag = magnitudes[i]!;
    plot(sx, sy);
    if (mag < 2.2) plot(sx + 1, sy);
    if (mag < 1.2) {
      plot(sx, sy + 1);
      plot(sx + 1, sy + 1);
    }
    if (mag < 0.3) {
      plot(sx - 1, sy);
      plot(sx + 2, sy);
      plot(sx, sy - 1);
      plot(sx + 1, sy + 2);
    }
  }
}

/** The Sun, when it is in the picture: a disc, its glare and a few rays. */
export function drawSun(frame: Frame, camera: SkyCamera, focal: number, sun: Vec3): void {
  const { width, height, pixels } = frame;
  const at = skyPoint(frame, camera, focal, sun);
  if (!at) return;
  const [sx, sy] = at;
  const disc = Math.max(3, width / 90);
  const glare = disc * 14;
  const x0 = Math.max(0, Math.floor(sx - glare));
  const x1 = Math.min(width, Math.ceil(sx + glare));
  for (let y = Math.max(0, Math.floor(sy - glare)); y < Math.min(height, Math.ceil(sy + glare)); y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - sx;
      const dy = y + 0.5 - sy;
      const d = Math.hypot(dx, dy);
      // Rays along the axes and diagonals, fading out.
      const spoke = Math.min(Math.abs(dx), Math.abs(dy), Math.abs(Math.abs(dx) - Math.abs(dy)) / Math.SQRT2);
      const ray = spoke < 0.6 ? (1 - d / glare) * 0.9 : 0;
      const level = d <= disc ? 1 : Math.max(ray, Math.min(1, 1.4 * (disc / d) ** 1.4) * (1 - d / glare));
      if (level > BAYER[(y & 3) * 4 + (x & 3)]!) pixels[y * width + x] = WHITE;
    }
  }
}

export class EarthRenderer {
  /** How bright each pixel of the globe was drawn, so lines can stand out against it. */
  private tone = new Float32Array(0);

  constructor(private readonly geo: Geography) {}

  draw(frame: Frame, view: View, layers: Layers): void {
    const { width, height } = frame;
    frame.pixels.fill(BLACK);
    if (this.tone.length !== width * height) this.tone = new Float32Array(width * height);
    else this.tone.fill(0);
    const k = basis(view);
    const sun = layers.lighting === "sun" ? sunDirection(layers.time) : null;
    const sky = skyCamera(k);
    const focal = skyFocal(width);
    if (layers.stars) {
      drawStars(frame, sky, focal, layers.time);
      this.moon(frame, k, moonDirection(layers.time), sun ?? sunDirection(layers.time));
    }
    if (sun) drawSun(frame, sky, focal, sun);
    this.globe(frame, view, k, sun, layers.atmosphere);
    const lines = new Lines(frame, view, k, sun, sun ? this.tone : null);
    if (layers.grid) this.graticule(lines, view, width, height);
    if (layers.borders) for (const line of this.geo.borders) lines.polyline(line, 2, true);
    // By day the shore shows by itself, land against sea; Borders draws it as Google Earth's does.
    for (const ring of this.geo.land) lines.polyline(ring, 1, layers.borders);
    if (sun) this.lights(frame, view, k, sun);
    if (layers.places) this.places(frame, view, k);
    if (layers.status) this.status(frame, view, sun ? layers.time : null);
  }

  /**
   * The Moon, when it is in the sky behind the Earth: lit on the side that
   * faces the Sun, its seas darker than its highlands, and the dark side
   * just showing by earthshine. Drawn a good deal larger than life, as the
   * real one would be a dot or two across.
   */
  private moon(frame: Frame, k: Basis, moon: Vec3, sun: Vec3): void {
    const { width, height, pixels } = frame;
    const depth = -(moon[0] * k.fx + moon[1] * k.fy + moon[2] * k.fz);
    if (depth <= 0.05) return;
    const focal = skyFocal(width);
    const mx = width / 2 + (focal * (moon[0] * k.ex + moon[1] * k.ey)) / depth;
    const my = height / 2 - (focal * (moon[0] * k.nx + moon[1] * k.ny + moon[2] * k.nz)) / depth;
    const radius = Math.max(5, width / 36);
    if (mx + radius < 0 || mx - radius > width || my + radius < 0 || my - radius > height) return;
    // The face we see, in Earth axes: towards us, and right and up across the disc.
    const [tx, ty, tz] = [-moon[0], -moon[1], -moon[2]];
    const along = k.ex * tx + k.ey * ty;
    let [rx, ry, rz] = [k.ex - along * tx, k.ey - along * ty, -along * tz];
    const rn = Math.hypot(rx, ry, rz) || 1;
    [rx, ry, rz] = [rx / rn, ry / rn, rz / rn];
    const [ux, uy, uz] = [ty * rz - tz * ry, tz * rx - tx * rz, tx * ry - ty * rx];
    const lightRight = sun[0] * rx + sun[1] * ry + sun[2] * rz;
    const lightUp = sun[0] * ux + sun[1] * uy + sun[2] * uz;
    const lightToward = sun[0] * tx + sun[1] * ty + sun[2] * tz;
    for (let y = Math.max(0, Math.floor(my - radius)); y < Math.min(height, Math.ceil(my + radius)); y++) {
      for (let x = Math.max(0, Math.floor(mx - radius)); x < Math.min(width, Math.ceil(mx + radius)); x++) {
        const u = (x + 0.5 - mx) / radius;
        const v = (my - (y + 0.5)) / radius;
        const rr = u * u + v * v;
        if (rr > 1) continue;
        const w = Math.sqrt(1 - rr);
        const lit = Math.max(0, u * lightRight + v * lightUp + w * lightToward);
        const level = Math.max(0.05, moonAlbedo(u, v) * Math.min(1, lit * 1.4));
        pixels[y * width + x] = level > BAYER8[(y & 7) * 8 + (x & 7)]! ? WHITE : BLACK;
      }
    }
  }

  /** Cities lit on the night side. */
  private lights(frame: Frame, view: View, k: Basis, sun: Vec3): void {
    const { width, height, pixels } = frame;
    const plot = (x: number, y: number) => {
      if (x >= 0 && y >= 0 && x < width && y < height) pixels[y * width + x] = WHITE;
    };
    for (const city of CITIES) {
      const lat = city.lat * DEG;
      const lon = city.lon * DEG;
      const c = Math.cos(lat);
      const [px, py, pz] = [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
      if (px * sun[0] + py * sun[1] + pz * sun[2] > -0.06) continue;
      if (px * k.fx + py * k.fy + pz * k.fz < 0.05) continue;
      const x = Math.floor(width / 2 + (px * k.ex + py * k.ey) * view.radius);
      const y = Math.floor(height / 2 - (px * k.nx + py * k.ny + pz * k.nz) * view.radius);
      plot(x, y);
      if (city.rank <= 2) plot(x + 1, y);
      if (city.rank === 1) {
        plot(x, y - 1);
        plot(x + 1, y + 1);
        plot(x - 1, y);
        plot(x, y + 1);
      }
    }
  }

  /** Dots, limb and atmosphere: every pixel once. */
  private globe(frame: Frame, view: View, k: Basis, sun: Vec3 | null, atmosphere: boolean): void {
    const { width, height, pixels } = frame;
    const R = view.radius;
    const cx = width / 2;
    const cy = height / 2;
    const columns = dotColumns(R);
    const step = (2 * Math.PI) / columns;
    const stepDegrees = 360 / columns;
    const maxThin = Math.log2(columns);
    // Under the Sun the land test runs per pixel: parallels about a pixel apart.
    const fineDegrees = fineDegreesFor(R);
    const tone = this.tone;
    // The light's direction in view axes, for the atmosphere's bright side.
    const [lx, ly, lz] = sun ? [sun[0] * k.ex + sun[1] * k.ey, sun[0] * k.nx + sun[1] * k.ny + sun[2] * k.nz, sun[0] * k.fx + sun[1] * k.fy + sun[2] * k.fz] : STUDIO;
    // Halfway between the Sun and the viewer: the sea glints where it faces this way.
    let glint: Vec3 | null = null;
    if (sun) {
      const [hx, hy, hz] = [sun[0] + k.fx, sun[1] + k.fy, sun[2] + k.fz];
      const h = Math.hypot(hx, hy, hz);
      if (h > 0.2) glint = [hx / h, hy / h, hz / h];
    }
    const haloHeight = Math.max(6, R * 0.32);
    const rays = 4 * Math.max(16, Math.round((2 * Math.PI * R) / (4 * 2)));
    const rayStep = (2 * Math.PI) / rays;
    const outer = (R + haloHeight) ** 2;
    const inner = (R - 0.5) ** 2;
    const limb = (R + 1.5) ** 2;

    for (let y = 0; y < height; y++) {
      const b = (cy - (y + 0.5)) / R;
      const dy = y + 0.5 - cy;
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 >= inner && d2 < limb) {
          // The limb: all lit under studio light, fading to a few dots on the night side under the Sun.
          const level = sun ? airLight(Math.atan2(dy, dx), lx, ly, lz) * 1.3 + 0.12 : 1;
          pixels[row + x] = level > BAYER[(y & 3) * 4 + (x & 3)]! ? WHITE : BLACK;
          continue;
        }
        if (d2 >= limb) {
          if (!atmosphere || d2 >= outer) continue;
          // Space: the atmosphere, dots two pixels apart on rays from the limb.
          const r = Math.sqrt(d2);
          const theta = Math.atan2(dy, dx);
          const ray = Math.round(theta / rayStep);
          const ring = Math.round((r - R - 2) / 2);
          const gr = R + 2 + ring * 2;
          const gx = cx + gr * Math.cos(ray * rayStep);
          const gy = cy + gr * Math.sin(ray * rayStep);
          if (Math.floor(gx) !== x || Math.floor(gy) !== y) continue;
          const height01 = (gr - R) / haloHeight;
          const lit = sun
            ? airLight(ray * rayStep, lx, ly, lz)
            : 0.55 + 0.45 * Math.max(0, (Math.cos(ray * rayStep) * lx - Math.sin(ray * rayStep) * ly) * 0.8 + lz * 0.2);
          const density = (1 - height01) ** 1.8 * lit;
          const order = BAYER[(ring & 3) * 4 + (((ray % rays) + rays) & 3)]!;
          if (order * 0.7 + hash(ray, ring) * 0.3 < density) pixels[row + x] = WHITE;
          continue;
        }
        // The disk hides the sky behind it.
        pixels[row + x] = BLACK;
        const a = dx / R;
        const c = Math.sqrt(Math.max(0, 1 - a * a - b * b));
        const px = a * k.ex + b * k.nx + c * k.fx;
        const py = a * k.ey + b * k.ny + c * k.fy;
        const pz = b * k.nz + c * k.fz;
        if (sun) {
          const level = sunlitGround(this.geo, px, py, pz, sun, glint, c, fineDegrees);
          if (level <= 0) continue;
          tone[row + x] = level;
          if (level > BAYER8[(y & 7) * 8 + (x & 7)]!) pixels[row + x] = WHITE;
          continue;
        }
        // Studio light: find the nearest grid point and dot it if it lands in this pixel.
        const lat = Math.asin(Math.max(-1, Math.min(1, pz)));
        const lon = Math.atan2(py, px);
        const j = Math.round(lat / step);
        const glat = j * step;
        // Towards the poles the meridians close up: keep every 2^thin-th, so
        // dots stay at least half their spacing apart instead of piling into a patch.
        const apart = R * step * Math.cos(glat);
        const wanted = Math.max(1.5, R * step * 0.5);
        const thin = apart >= wanted ? 0 : Math.min(maxThin, Math.ceil(Math.log2(wanted / Math.max(apart, 1e-12))));
        let i = Math.round(lon / step / 2 ** thin) * 2 ** thin;
        const glon = i * step;
        const gc = Math.cos(glat);
        const gxw = gc * Math.cos(glon);
        const gyw = gc * Math.sin(glon);
        const gzw = Math.sin(glat);
        const ga = gxw * k.ex + gyw * k.ey;
        const gb = gxw * k.nx + gyw * k.ny + gzw * k.nz;
        if (Math.floor(cx + ga * R) !== x || Math.floor(cy - gb * R) !== y) continue;
        if (gxw * k.fx + gyw * k.fy + gzw * k.fz < 0) continue;
        i = (((i % columns) + columns) % columns) >> thin;
        const land = this.geo.isLand(wrapAngle(glon) / DEG, j, stepDegrees);
        const l = Math.max(0, a * lx + b * ly + c * lz);
        const value = land ? 0.3 + 0.4 * l : 0.02 + 0.12 * l;
        if (value > BAYER[(j & 3) * 4 + (i & 3)]!) pixels[row + x] = WHITE;
      }
    }
  }

  private graticule(lines: Lines, view: View, width: number, height: number): void {
    const g = gridStep(view.radius);
    const bounds = visibleBounds(view, width, height);
    // A sample every few pixels along each line.
    const sample = Math.min(2, Math.max(1e-4, 4 / view.radius / DEG));
    const lonMin = view.lon / DEG + bounds.lonMin / DEG;
    const lonMax = view.lon / DEG + bounds.lonMax / DEG;
    const latMin = bounds.latMin / DEG;
    const latMax = bounds.latMax / DEG;
    const full = bounds.lonMax - bounds.lonMin >= 2 * Math.PI - 1e-9;
    const westmost = full ? Math.round(-180 / g) : Math.ceil(lonMin / g);
    const eastmost = full ? Math.round(180 / g) - 1 : Math.floor(lonMax / g);
    // Meridians stop short of the poles before they crowd together: the
    // minor ones first, every 90° not at all.
    const pixelsPerDegree = view.radius * DEG;
    for (let m = westmost; m <= eastmost; m++) {
      const lon = m * g;
      let every = 1;
      while (every < 64 && m % (every * 2) === 0) every *= 2;
      const quarter = Math.abs(lon / 90 - Math.round(lon / 90)) < 1e-9;
      const limit = quarter ? 90 : Math.acos(Math.min(1, 8 / (g * every * pixelsPerDegree))) / DEG;
      const south = Math.max(latMin, -limit);
      const north = Math.min(latMax, limit);
      if (south >= north) continue;
      lines.begin();
      const n = Math.max(1, Math.ceil((north - south) / sample));
      for (let s = 0; s <= n; s++) lines.to(lon, south + ((north - south) * s) / n, lines.gridDash);
    }
    for (let m = Math.ceil(latMin / g); m <= Math.floor(latMax / g); m++) {
      const lat = m * g;
      if (Math.abs(lat) >= 90) continue;
      lines.begin();
      const across = full ? 360 : lonMax - lonMin;
      const from = full ? -180 : lonMin;
      const n = Math.max(1, Math.ceil((across * Math.cos(lat * DEG)) / sample));
      for (let s = 0; s <= n; s++) lines.to(from + (across * s) / n, lat, lines.gridDash);
    }
  }

  private places(frame: Frame, view: View, k: Basis): void {
    const pixelsPerDegree = view.radius * DEG;
    const shown = pixelsPerDegree >= 20 ? 3 : pixelsPerDegree >= 7 ? 2 : pixelsPerDegree >= 3 ? 1 : 0;
    if (shown === 0) return;
    const painter = new Painter(frame, { scale: 1, x: 0, y: 0 });
    const taken: [number, number, number, number][] = [];
    const cx = frame.width / 2;
    const cy = frame.height / 2;
    for (let rank = 1; rank <= shown; rank++) {
      for (const city of CITIES) {
        if (city.rank !== rank) continue;
        const lat = city.lat * DEG;
        const lon = city.lon * DEG;
        const c = Math.cos(lat);
        const [px, py, pz] = [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
        // Not too near the limb, where the label would hang off into space.
        if (px * k.fx + py * k.fy + pz * k.fz < 0.15) continue;
        const x = Math.round(cx + (px * k.ex + py * k.ey) * view.radius);
        const y = Math.round(cy - (px * k.nx + py * k.ny + pz * k.nz) * view.radius);
        const name = city.name.toUpperCase();
        const box: [number, number, number, number] = [x - 2, y - 4, x + 5 + microWidth(name), y + 3];
        if (box[2] < 0 || box[0] >= frame.width || box[3] < 0 || box[1] >= frame.height) continue;
        if (taken.some((t) => box[0] < t[2] + 2 && t[0] < box[2] + 2 && box[1] < t[3] + 1 && t[1] < box[3] + 1)) continue;
        taken.push(box);
        painter.paint = () => BLACK;
        painter.rect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
        painter.paint = PAPER;
        painter.rect(x - 1, y - 1, 3, 3);
        drawMicro(painter, name, x + 4, y - 2);
      }
    }
  }

  private status(frame: Frame, view: View, time: number | null): void {
    const painter = new Painter(frame, { scale: 1, x: 0, y: 0 });
    const lat = view.lat / DEG;
    const lon = wrapAngle(view.lon) / DEG;
    const where = `${Math.abs(lat).toFixed(2)}${lat < 0 ? "S" : "N"}  ${Math.abs(lon).toFixed(2)}${lon < 0 ? "W" : "E"}`;
    const km = eyeAltitude(view, frame.width);
    const alt = `EYE ALT ${km >= 100 ? Math.round(km).toLocaleString("en-US") : km.toFixed(1)} KM`;
    const y = frame.height - MICRO_HEIGHT - 4;
    // Clear of the window's grow box.
    const right = frame.width - 19 - microWidth(alt);
    const shown: [string, number][] = [[where, 5], [alt, right]];
    if (time !== null) {
      const date = new Date(time);
      const pad = (n: number) => String(n).padStart(2, "0");
      const when = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
      const x = Math.round((frame.width - microWidth(when)) / 2);
      // Only where it fits between the other two.
      if (x > 5 + microWidth(where) + 8 && x + microWidth(when) < right - 8) shown.push([when, x]);
    }
    for (const [text, x] of shown) {
      painter.paint = () => BLACK;
      painter.rect(x - 2, y - 2, microWidth(text) + 4, MICRO_HEIGHT + 4);
      painter.paint = PAPER;
      drawMicro(painter, text, x, y);
    }
  }
}

/**
 * One-pixel lines on the globe, cut where they go round the back: points in
 * Earth axes are turned into view axes, and an edge that crosses the limb
 * stops on it.
 */
class Lines {
  private readonly cx: number;
  private readonly cy: number;
  private prev: [number, number, number] | null = null;

  constructor(
    private readonly frame: Frame,
    private readonly view: View,
    private readonly k: Basis,
    /** Under the Sun, lines on the night side are drawn half as bright. */
    private readonly sun: Vec3 | null,
    /** How bright the globe under each pixel is: lines go black over bright ground. */
    private readonly tone: Float32Array | null,
  ) {
    this.cx = frame.width / 2;
    this.cy = frame.height / 2;
  }

  /** The graticule is a fine dotted line under the Sun, so the ground shows through it. */
  get gridDash(): number {
    return this.sun ? 2 : 1;
  }

  begin(): void {
    this.prev = null;
  }

  /** Continue the line to (lon, lat) degrees. `dash` 1 draws every pixel, 2 every other, 4 every fourth. */
  to(lon: number, lat: number, dash: number): void {
    const c = Math.cos(lat * DEG);
    this.toUnit(c * Math.cos(lon * DEG), c * Math.sin(lon * DEG), Math.sin(lat * DEG), dash, true, true);
  }

  /** A coastline or border; `byDay` false leaves out what lies in sunlight. */
  polyline(line: Polyline, dash: number, byDay = true): void {
    const { unit, drawn, closed } = line;
    const n = unit.length / 3;
    this.begin();
    for (let i = 0; i <= (closed ? n : n - 1); i++) {
      const p = (i % n) * 3;
      this.toUnit(unit[p]!, unit[p + 1]!, unit[p + 2]!, dash, i === 0 || drawn[i - 1] === 1, byDay);
    }
  }

  private toUnit(x: number, y: number, z: number, dash: number, draw: boolean, byDay: boolean): void {
    const { k } = this;
    const a = x * k.ex + y * k.ey;
    const b = x * k.nx + y * k.ny + z * k.nz;
    const c = x * k.fx + y * k.fy + z * k.fz;
    const prev = this.prev;
    this.prev = [a, b, c];
    if (!prev || !draw) return;
    const [pa, pb, pc] = prev;
    if (pc < 0 && c < 0) return;
    let [a0, b0, a1, b1] = [pa, pb, a, b];
    if (pc < 0 || c < 0) {
      // Stop at the limb: where c = 0 along the chord, pushed out onto the circle.
      const t = pc / (pc - c);
      let ma = pa + (a - pa) * t;
      let mb = pb + (b - pb) * t;
      const m = Math.hypot(ma, mb) || 1;
      ma /= m;
      mb /= m;
      if (pc < 0) [a0, b0] = [ma, mb];
      else [a1, b1] = [ma, mb];
    }
    const R = this.view.radius;
    const lit = this.sun ? x * this.sun[0] + y * this.sun[1] + z * this.sun[2] : 0;
    if (!byDay && lit > 0.05) return;
    const night = this.sun !== null && lit < -0.08;
    segment(this.frame, this.cx + a0 * R, this.cy - b0 * R, this.cx + a1 * R, this.cy - b1 * R, night ? dash * 2 : dash, this.tone);
  }
}

/** A line from (x0, y0) to (x1, y1), clipped to the frame: white, or black where `tone` says the ground is bright. */
function segment(frame: Frame, x0: number, y0: number, x1: number, y1: number, dash: number, tone: Float32Array | null): void {
  const { width, height, pixels } = frame;
  // Liang–Barsky against the frame, so far-off ends cost nothing.
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, x0) || !clip(dx, width - 1e-6 - x0) || !clip(-dy, y0) || !clip(dy, height - 1e-6 - y0)) return;
  let xa = Math.floor(x0 + dx * t0);
  let ya = Math.floor(y0 + dy * t0);
  const xb = Math.floor(x0 + dx * t1);
  const yb = Math.floor(y0 + dy * t1);
  const sx = xb > xa ? 1 : -1;
  const sy = yb > ya ? 1 : -1;
  const ax = Math.abs(xb - xa);
  const ay = Math.abs(yb - ya);
  let err = ax - ay;
  for (;;) {
    // Dashed on diagonals of the window, so pieces of one line agree.
    if (((xa + ya) & (dash - 1)) === 0) {
      if (xa >= 0 && ya >= 0 && xa < width && ya < height) {
        const at = ya * width + xa;
        pixels[at] = tone && tone[at]! > 0.45 ? BLACK : WHITE;
      }
    }
    if (xa === xb && ya === yb) break;
    const e2 = err * 2;
    if (e2 > -ay) {
      err -= ay;
      xa += sx;
    }
    if (e2 < ax) {
      err += ax;
      ya += sy;
    }
  }
}
