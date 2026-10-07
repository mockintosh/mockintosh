/**
 * A free-return flight to the Moon and back, as Apollo 8 and 13 flew it: a
 * spacecraft in a low parking orbit fires once, coasts out, swings round
 * behind the Moon, and falls back to the Earth with no further burn.
 *
 * The flight is worked out in the plane of the Moon's orbit, centred on the
 * Earth, with the Moon on a circle at its mean distance (kilometres and
 * seconds throughout). The spacecraft feels both bodies, and the Earth's own
 * fall towards the Moon (the "indirect" term), stepped with RK4 at a pace
 * set by how close it is to either. `TLI` is where on the parking orbit the
 * burn happens and how fast it leaves, found by `solveFreeReturn` so the
 * flight passes 150 km behind the Moon 68 hours later and comes home to a
 * perigee 45 km up, inside the entry corridor: 5.7 days in all.
 */

export const MU_EARTH = 398600.4418;
export const MU_MOON = 4902.8;
export const EARTH_RADIUS = 6371;
export const MOON_RADIUS = 1737.4;
/** The Moon's mean distance. */
export const MOON_DISTANCE = 384400;
/** The Moon's mean motion round the Earth, radians a second. */
export const MOON_RATE = Math.sqrt((MU_EARTH + MU_MOON) / MOON_DISTANCE ** 3);

export const PARKING_ALTITUDE = 185;
/** Where the atmosphere begins to matter on the way home: the flight ends here. */
export const ENTRY_ALTITUDE = 122;
/** Seconds in the parking orbit before the burn, so the flight opens close to the Earth. */
export const PARKING_TIME = 1500;
/** Beyond this distance from the Moon the Earth's pull wins: the Moon's sphere of influence. */
export const MOON_SPHERE = 66100;

export interface Injection {
  /** Angle round the parking orbit at the burn, from the Moon's direction then. */
  angle: number;
  /** Speed just after the burn. */
  speed: number;
}

/** Solved by `solveFreeReturn` (see mission.test.ts). */
export const TLI: Injection = { angle: -2.317989231633545, speed: 10.962533730769062 };

export type Vec3 = [number, number, number];

export function moonPosition(t: number): Vec3 {
  return [MOON_DISTANCE * Math.cos(MOON_RATE * t), MOON_DISTANCE * Math.sin(MOON_RATE * t), 0];
}

function acceleration(t: number, x: number, y: number, z: number): Vec3 {
  const [mx, my, mz] = moonPosition(t);
  const r3 = Math.hypot(x, y, z) ** 3;
  const [dx, dy, dz] = [x - mx, y - my, z - mz];
  const d3 = Math.hypot(dx, dy, dz) ** 3;
  const m3 = MOON_DISTANCE ** 3;
  return [
    (-MU_EARTH * x) / r3 - (MU_MOON * dx) / d3 - (MU_MOON * mx) / m3,
    (-MU_EARTH * y) / r3 - (MU_MOON * dy) / d3 - (MU_MOON * my) / m3,
    (-MU_EARTH * z) / r3 - (MU_MOON * dz) / d3 - (MU_MOON * mz) / m3,
  ];
}

/** One sample of the flight: time from the burn, position and velocity. */
export interface Sample {
  t: number;
  p: Vec3;
  v: Vec3;
}

export interface Flight {
  samples: Sample[];
  /** Closest to the Moon: time and height above its surface. */
  perilune: { t: number; altitude: number };
  /** Closest to the Earth on the way home (or where the flight met the air). */
  perigee: { t: number; altitude: number };
  /** Whether it went round the far side of the Moon. */
  farSide: boolean;
  /** When it reached the entry altitude, or the last sample's time if it never did. */
  end: number;
}

function step(t: number, s: [number, number, number, number, number, number], dt: number): [number, number, number, number, number, number] {
  const f = (tt: number, q: number[]) => {
    const a = acceleration(tt, q[0]!, q[1]!, q[2]!);
    return [q[3]!, q[4]!, q[5]!, a[0], a[1], a[2]];
  };
  const k1 = f(t, s);
  const k2 = f(t + dt / 2, s.map((v, i) => v + (dt / 2) * k1[i]!));
  const k3 = f(t + dt / 2, s.map((v, i) => v + (dt / 2) * k2[i]!));
  const k4 = f(t + dt, s.map((v, i) => v + dt * k3[i]!));
  return s.map((v, i) => v + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!)) as [number, number, number, number, number, number];
}

/**
 * Fly `injection` from the parking orbit `PARKING_TIME` before the burn until
 * the entry altitude on the way home, or `limit` seconds. `untilPerilune`
 * stops once it has passed the Moon, for the solver.
 */
export function fly(injection: Injection, limit = 10 * 86400, untilPerilune = false): Flight {
  const r0 = EARTH_RADIUS + PARKING_ALTITUDE;
  const circular = Math.sqrt(MU_EARTH / r0);
  // Counter-clockwise, as the Moon goes: back along the parking orbit to where the flight opens.
  const back = injection.angle - (circular / r0) * PARKING_TIME;
  let s: [number, number, number, number, number, number] = [
    r0 * Math.cos(back),
    r0 * Math.sin(back),
    0,
    -circular * Math.sin(back),
    circular * Math.cos(back),
    0,
  ];
  let t = -PARKING_TIME;
  let burned = false;
  const samples: Sample[] = [{ t, p: [s[0], s[1], s[2]], v: [s[3], s[4], s[5]] }];
  const perilune = { t: 0, altitude: Infinity };
  const perigee = { t: 0, altitude: Infinity };
  let farSide = false;
  let end = limit;
  let leftEarth = false;
  while (t < limit) {
    const r = Math.hypot(s[0], s[1], s[2]);
    const [mx, my] = moonPosition(t);
    const dm = Math.hypot(s[0] - mx, s[1] - my, s[2]);
    // A step a small part of the time it would take to fall in from here, near whichever body is closer.
    const pace = Math.min(r ** 1.5 / Math.sqrt(MU_EARTH), dm ** 1.5 / Math.sqrt(MU_MOON));
    let dt = Math.max(2, Math.min(600, pace * 0.04));
    if (!burned && t + dt >= 0) dt = -t;
    if (dt <= 0) dt = 2;
    s = step(t, s, dt);
    t += dt;
    if (!burned && t >= -1e-9) {
      // The burn: the same direction, the new speed.
      const speed = Math.hypot(s[3], s[4], s[5]);
      s = [s[0], s[1], s[2], (s[3] / speed) * injection.speed, (s[4] / speed) * injection.speed, (s[5] / speed) * injection.speed];
      burned = true;
    }
    samples.push({ t, p: [s[0], s[1], s[2]], v: [s[3], s[4], s[5]] });
    const [nx, ny] = moonPosition(t);
    const moonAlt = Math.hypot(s[0] - nx, s[1] - ny, s[2]) - MOON_RADIUS;
    if (moonAlt < perilune.altitude) {
      perilune.altitude = moonAlt;
      perilune.t = t;
      // Behind the Moon: further from the Earth than the Moon, on its line.
      farSide = (s[0] - nx) * nx + (s[1] - ny) * ny > 0;
    }
    if (moonAlt < 0) {
      end = t;
      break;
    }
    if (untilPerilune && perilune.altitude < 40000 && moonAlt > perilune.altitude + 20000) {
      end = t;
      break;
    }
    const alt = Math.hypot(s[0], s[1], s[2]) - EARTH_RADIUS;
    if (alt > 50000) leftEarth = true;
    if (leftEarth && t > perilune.t && alt < perigee.altitude) {
      perigee.altitude = alt;
      perigee.t = t;
    }
    if (leftEarth && alt < ENTRY_ALTITUDE) {
      end = t;
      break;
    }
    if (leftEarth && t > perilune.t && perigee.altitude < alt - 20000) {
      end = t;
      break;
    }
  }
  const flight = { samples, perilune, perigee, farSide, end };
  const last = samples[samples.length - 1]!;
  if (samples.length > 1 && Math.hypot(...last.p) - EARTH_RADIUS < ENTRY_ALTITUDE) {
    // The last step went below the entry altitude: end the flight exactly at it.
    let lo = samples[samples.length - 2]!.t;
    let hi = last.t;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (Math.hypot(...sampleAt(flight, mid).p) - EARTH_RADIUS > ENTRY_ALTITUDE) lo = mid;
      else hi = mid;
    }
    samples[samples.length - 1] = sampleAt(flight, hi);
    flight.end = hi;
  }
  return flight;
}

/** Where the flight is at `t`: between samples, by the cubic that matches both ends' velocities. */
export function sampleAt(flight: Flight, t: number): Sample {
  const { samples } = flight;
  if (t <= samples[0]!.t) return samples[0]!;
  const last = samples[samples.length - 1]!;
  if (t >= last.t) return last;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo]!;
  const b = samples[hi]!;
  const h = b.t - a.t;
  const u = (t - a.t) / h;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
  const h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2;
  const h11 = u ** 3 - u ** 2;
  const p: Vec3 = [0, 0, 0];
  const v: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    p[i] = h00 * a.p[i]! + h10 * h * a.v[i]! + h01 * b.p[i]! + h11 * h * b.v[i]!;
    v[i] = a.v[i]! + (b.v[i]! - a.v[i]!) * u;
  }
  return { t, p, v };
}

/**
 * Find the burn: the angle and speed whose flight passes `perilune` km
 * behind the Moon and returns to a perigee `perigee` km up. For each speed
 * the angle that gives the perilune is bisected (between flights that hit
 * the Moon and flights that pass wide of it), and the speed is bisected
 * between returns that come in too steep and too shallow. Both are
 * monotonic near Apollo's flights, where Newton's method is not.
 */
export function solveFreeReturn(speeds: [number, number], angles: [number, number], perilune = 150, perigee = 45): Injection {
  const angleFor = (speed: number): number => {
    let [lo, hi] = angles;
    const miss = (angle: number) => {
      const f = fly({ angle, speed }, 6 * 86400, true);
      return (f.farSide ? f.perilune.altitude : -1) - perilune;
    };
    const below = miss(lo) < 0;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (miss(mid) < 0 === below) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  let [slow, fast] = speeds;
  const low = fly({ angle: angleFor(slow), speed: slow }).perigee.altitude < perigee;
  for (let i = 0; i < 30; i++) {
    const mid = (slow + fast) / 2;
    if (fly({ angle: angleFor(mid), speed: mid }).perigee.altitude < perigee === low) slow = mid;
    else fast = mid;
  }
  const speed = (slow + fast) / 2;
  return { angle: angleFor(speed), speed };
}
