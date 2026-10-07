/**
 * The globe as the window sees it: an orthographic view of the unit sphere,
 * centred on a point of the Earth, `radius` pixels across from centre to
 * limb. North is always up.
 *
 * Angles here are radians; the places list and the status line speak
 * degrees.
 */

export interface View {
  /** Longitude of the point under the window's centre. */
  lon: number;
  /** Latitude of the point under the window's centre, within ±π/2. */
  lat: number;
  /** Pixels from the centre of the disk to its limb. */
  radius: number;
}

export interface LonLat {
  lon: number;
  lat: number;
}

/** The camera's axes in Earth-centred coordinates (x towards 0°E on the equator, z to the north pole). */
export interface Basis {
  /** Towards the viewer: the point at the centre of the disk. */
  fx: number;
  fy: number;
  fz: number;
  /** Screen right. */
  ex: number;
  ey: number;
  /** Screen up (`ez` is always 0). */
  nx: number;
  ny: number;
  nz: number;
}

export const EARTH_RADIUS_KM = 6371;

/** Closest the camera comes: about 300 m a pixel, the coastline data's own grain. */
export const MAX_RADIUS = 20000;

const HALF_PI = Math.PI / 2;

export function basis(view: View): Basis {
  const cl = Math.cos(view.lon);
  const sl = Math.sin(view.lon);
  const cp = Math.cos(view.lat);
  const sp = Math.sin(view.lat);
  return { fx: cp * cl, fy: cp * sl, fz: sp, ex: -sl, ey: cl, nx: -sp * cl, ny: -sp * sl, nz: cp };
}

/** The whole Earth with room for its atmosphere, in a window `width × height`. */
export function fitRadius(width: number, height: number): number {
  return Math.max(8, Math.min(width, height) * 0.42);
}

/** The farthest the camera goes: the Earth a little smaller than fitted. */
export function minRadius(width: number, height: number): number {
  return fitRadius(width, height) * 0.5;
}

export function clampView(view: View, width: number, height: number): View {
  return {
    lon: wrapAngle(view.lon),
    lat: Math.max(-HALF_PI, Math.min(HALF_PI, view.lat)),
    radius: Math.max(minRadius(width, height), Math.min(MAX_RADIUS, view.radius)),
  };
}

/** `a` in (−π, π]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** The point under window pixel (x, y), or null for space. */
export function unproject(view: View, width: number, height: number, x: number, y: number): LonLat | null {
  const a = (x - width / 2) / view.radius;
  const b = (height / 2 - y) / view.radius;
  const rr = a * a + b * b;
  if (rr > 1) return null;
  const c = Math.sqrt(1 - rr);
  const k = basis(view);
  const px = a * k.ex + b * k.nx + c * k.fx;
  const py = a * k.ey + b * k.ny + c * k.fy;
  const pz = b * k.nz + c * k.fz;
  return { lon: Math.atan2(py, px), lat: Math.asin(Math.max(-1, Math.min(1, pz))) };
}

/** Where `point` is in the window, and whether it faces the viewer. */
export function project(view: View, width: number, height: number, point: LonLat): { x: number; y: number; visible: boolean } {
  const k = basis(view);
  const cp = Math.cos(point.lat);
  const px = cp * Math.cos(point.lon);
  const py = cp * Math.sin(point.lon);
  const pz = Math.sin(point.lat);
  return {
    x: width / 2 + (px * k.ex + py * k.ey) * view.radius,
    y: height / 2 - (px * k.nx + py * k.ny + pz * k.nz) * view.radius,
    visible: px * k.fx + py * k.fy + pz * k.fz >= 0,
  };
}

/**
 * The view that puts `point` under window pixel (x, y) at `radius`, so a
 * drag holds on to the ground it started on. Null when no north-up view
 * can: the pixel is off the disk, or nearer the limb than the point can be
 * turned.
 */
export function grab(point: LonLat, radius: number, width: number, height: number, x: number, y: number): View | null {
  const a = (x - width / 2) / radius;
  const b = (height / 2 - y) / radius;
  if (a * a + b * b > 1) return null;
  const cp = Math.cos(point.lat);
  if (Math.abs(a) > cp) return null;
  // a = cos φ · sin(λ − λ0): the longitude, taking the side facing us.
  const dl = Math.asin(a / cp);
  const lon = point.lon - dl;
  // b = sin φ · cos φ0 − cos φ · cos(λ − λ0) · sin φ0 = ρ · sin(α − φ0)
  const s = Math.sin(point.lat);
  const c = cp * Math.cos(dl);
  const rho = Math.hypot(s, c);
  if (rho === 0 || Math.abs(b) > rho) return null;
  const lat = Math.atan2(s, c) - Math.asin(b / rho);
  if (lat < -HALF_PI - 1e-9 || lat > HALF_PI + 1e-9) return null;
  return { lon: wrapAngle(lon), lat: Math.max(-HALF_PI, Math.min(HALF_PI, lat)), radius };
}

/** Great-circle angle between two points. */
export function distance(a: LonLat, b: LonLat): number {
  const s = Math.sin((b.lat - a.lat) / 2) ** 2 + Math.cos(a.lat) * Math.cos(b.lat) * Math.sin((b.lon - a.lon) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * A flight from one view to another, as Google Earth flies: along the
 * great circle between the two centres, rising far enough on the way to see
 * where it is going. `at(t)` for t in [0, 1].
 */
export interface Flight {
  duration: number;
  at(t: number): View;
}

export function flight(from: View, to: View, fullRadius: number): Flight {
  const d = distance(from, to);
  const vec = (p: LonLat) => [Math.cos(p.lat) * Math.cos(p.lon), Math.cos(p.lat) * Math.sin(p.lon), Math.sin(p.lat)] as const;
  const [ax, ay, az] = vec(from);
  const [bx, by, bz] = vec(to);
  const logA = Math.log(from.radius);
  const logB = Math.log(to.radius);
  // High enough at the top of the arc that the trip fits in the window.
  const logTop = Math.min(logA, logB, Math.log(fullRadius * Math.max(1, 1.6 / Math.max(d, 1e-6))));
  const rise = Math.max(0, Math.min(logA, logB) - logTop);
  const duration = Math.min(4, 0.6 + d * 0.7 + Math.abs(logA - logB) * 0.12 + rise * 0.25);
  return {
    duration,
    at(t) {
      const u = Math.max(0, Math.min(1, t));
      const s = u * u * (3 - 2 * u);
      let x: number;
      let y: number;
      let z: number;
      if (d < 1e-9) [x, y, z] = [ax, ay, az];
      else {
        const sd = Math.sin(d);
        const wa = Math.sin((1 - s) * d) / sd;
        const wb = Math.sin(s * d) / sd;
        [x, y, z] = [wa * ax + wb * bx, wa * ay + wb * by, wa * az + wb * bz];
      }
      const logR = logA + (logB - logA) * s - rise * 4 * s * (1 - s);
      const lon = Math.hypot(x, y) < 1e-12 ? from.lon + (to.lon - from.lon) * s : Math.atan2(y, x);
      return { lon, lat: Math.asin(Math.max(-1, Math.min(1, z))), radius: Math.exp(logR) };
    },
  };
}

/** How far the camera would be from the ground to see this much of it, in kilometres. */
export function eyeAltitude(view: View, width: number): number {
  // As a 60° camera above the centre would see the window's width of ground.
  const across = (width / view.radius) * EARTH_RADIUS_KM;
  return across / (2 * Math.tan(Math.PI / 6));
}

/**
 * The longitudes and latitudes the window can see, for drawing only what
 * is there: longitudes relative to the view's centre may run past ±π, and
 * span all the way round when a pole is in sight.
 */
export interface Bounds {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

export function visibleBounds(view: View, width: number, height: number): Bounds {
  const bounds = { lonMin: Infinity, lonMax: -Infinity, latMin: Infinity, latMax: -Infinity };
  const add = (p: LonLat | null) => {
    if (!p) return;
    const dl = wrapAngle(p.lon - view.lon);
    bounds.lonMin = Math.min(bounds.lonMin, dl);
    bounds.lonMax = Math.max(bounds.lonMax, dl);
    bounds.latMin = Math.min(bounds.latMin, p.lat);
    bounds.latMax = Math.max(bounds.latMax, p.lat);
  };
  const step = 6;
  for (let x = 0; x <= width; x += step) {
    add(unproject(view, width, height, x, 0));
    add(unproject(view, width, height, x, height));
  }
  for (let y = 0; y <= height; y += step) {
    add(unproject(view, width, height, 0, y));
    add(unproject(view, width, height, width, y));
  }
  // The limb, where it is in the window.
  const cx = width / 2;
  const cy = height / 2;
  const around = Math.max(64, Math.ceil(view.radius / 2));
  for (let i = 0; i < around; i++) {
    const angle = (i / around) * 2 * Math.PI;
    const x = cx + Math.cos(angle) * view.radius * 0.999;
    const y = cy + Math.sin(angle) * view.radius * 0.999;
    if (x >= 0 && x <= width && y >= 0 && y <= height) add(unproject(view, width, height, x, y));
  }
  // The centre, in case the window is all ground and the edges missed it.
  add({ lon: view.lon, lat: view.lat });
  for (const pole of [HALF_PI, -HALF_PI]) {
    const at = project(view, width, height, { lon: 0, lat: pole });
    if (at.visible && at.x >= 0 && at.x <= width && at.y >= 0 && at.y <= height) {
      bounds.lonMin = -Math.PI;
      bounds.lonMax = Math.PI;
      if (pole > 0) bounds.latMax = HALF_PI;
      else bounds.latMin = -HALF_PI;
    }
  }
  // Sampling misses a little between samples; pad by a few pixels' worth.
  const pad = (step * 2) / view.radius;
  const lonPad = pad / Math.max(0.05, Math.cos(Math.max(Math.abs(bounds.latMin), Math.abs(bounds.latMax))));
  return {
    lonMin: Math.max(-Math.PI, bounds.lonMin - lonPad),
    lonMax: Math.min(Math.PI, bounds.lonMax + lonPad),
    latMin: Math.max(-HALF_PI, bounds.latMin - pad),
    latMax: Math.min(HALF_PI, bounds.latMax + pad),
  };
}
