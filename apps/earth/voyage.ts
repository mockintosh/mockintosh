/**
 * Playing the free-return flight back: where it is, how fast the film runs,
 * where the camera looks, and what the instruments say.
 *
 * The flight (`mission.ts`) is worked out in the plane of the Moon's orbit;
 * here it is laid into the real sky at the moment it starts: that plane is
 * the Moon's orbit as it lies then, its x axis towards the Moon at the burn,
 * and the Earth turns under it with the simulated clock, so the Sun, the
 * stars and the ground below are all as they would be.
 *
 * It flies on Apollo 8's timetable: launched 21 December 1968 at 12:51:00
 * UTC, the burn for the Moon lit 2:50:38 later and lasting 5 min 18 s.
 * Apollo 8 then braked into lunar orbit; this flight keeps coasting, on the
 * free return Apollo 8 was on until it did.
 *
 * Condensed, the film runs slowly near the Earth and the Moon and fast in
 * the long coasts between: a second of it covers about as many seconds of
 * flight as the spacecraft is kilometres from the nearer surface. In real
 * time it takes the flight's own five and a half days, sped up only as asked.
 */
import { EARTH_RADIUS, MOON_RADIUS, MOON_RATE, MOON_SPHERE, PARKING_TIME, TLI, fly, moonPosition, sampleAt, type Flight } from "./mission";
import type { SkyCamera } from "./render";
import { moonAmongStars, siderealAngle, toEarth, type Vec3 } from "./sky";
import type { Instruments, SpaceScene } from "./space";

export type CameraMode = "auto" | "moon" | "earth" | "window" | "overview";

export type Pacing = "condensed" | "realtime";

/** Apollo 8's launch, ms since 1970. */
export const APOLLO_8_LAUNCH = Date.UTC(1968, 11, 21, 12, 51, 0);
/** Seconds from launch to the middle of Apollo 8's trans-lunar injection: lit at 2:50:38, burning 318 s. */
const TLI_GET = 2 * 3600 + 50 * 60 + 38 + 159;

/** Moments worth jumping to, in seconds from the burn. */
export interface MissionEvent {
  name: string;
  t: number;
}

export const CAMERA_NAMES: Record<CameraMode, string> = {
  auto: "Automatic",
  moon: "Look at the Moon",
  earth: "Look at the Earth",
  window: "Out the Window",
  overview: "Overview",
};

/** Seconds of the burn shown as TRANS-LUNAR INJECTION, around its middle (Apollo 8's lasted 318). */
const BURN = 318;
/** Seconds the camera takes to settle on a new target, in real time. */
const SETTLE = 0.5;
/** Seconds of flight a second of film covers while the Earth sets and rises over the Moon. */
const EARTHRISE_RATE = 25;
/** Half the picture's height when framing the earthrise: a long lens, 7° to the top edge. */
const EARTHRISE_HALF_HEIGHT = (7 * Math.PI) / 180;
/** How much larger than life the overview draws the Earth and the Moon, so they show at all. */
const OVERVIEW_EARTH = 5;
const OVERVIEW_MOON = 9;
/** How far above the plane of the flight the overview looks down from, km. */
const OVERVIEW_HEIGHT = 900000;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/** Turn `v` about the unit axis `k` by `angle` (Rodrigues). */
function turn(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Ground elapsed time, as Apollo's clocks counted it from launch, and the date and time in UTC. */
const clock = (sinceLaunch: number, time: number): string => {
  const s = Math.max(0, Math.floor(sinceLaunch));
  const date = new Date(time);
  return (
    `GET ${String(Math.floor(s / 3600)).padStart(3, "0")}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}  ` +
    `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
};

const km = (n: number) => Math.round(n).toLocaleString("en-US");

export class Voyage {
  readonly flight: Flight = fly(TLI);
  /** Simulated time at the burn, ms since 1970. */
  readonly epoch: number;
  /** Seconds from the burn. */
  t = -PARKING_TIME;
  /** The film's speed over its pace, a power of two. */
  speed = 1;
  pacing: Pacing = "condensed";
  paused = false;
  mode: CameraMode = "auto";
  /** Looking about with the mouse: turns away from where the mode looks. */
  yaw = 0;
  pitch = 0;
  /** Magnification over the 60° lens, by the scroll wheel. */
  zoom = 1;
  private readonly axes: [Vec3, Vec3, Vec3];
  private look: Vec3 | null = null;
  /** The automatic camera's own telephoto, eased like its aim. */
  private lens = 1;

  /** The moments the Jump To menu offers, in order. */
  readonly events: MissionEvent[];
  /** When the launch was, ms since 1970: what the mission clock counts from. */
  private readonly launch: number;

  /** A flight whose burn for the Moon is at `burn` (ms since 1970), launched as long before it as Apollo 8's was. */
  constructor(burn = APOLLO_8_LAUNCH + TLI_GET * 1000) {
    this.epoch = burn;
    this.launch = burn - TLI_GET * 1000;
    const x = norm(moonAmongStars(this.epoch));
    const z = norm(cross(x, moonAmongStars(this.epoch + 3_600_000)));
    this.axes = [x, cross(z, x), z];
    this.events = this.findEvents();
  }

  /** The slowest and fastest the film can be asked to run, over its pace. */
  get speeds(): [number, number] {
    return this.pacing === "realtime" ? [1, 4096] : [1 / 8, 64];
  }

  /** Real time or condensed, keeping within the new pacing's speeds. */
  setPacing(pacing: Pacing): void {
    this.pacing = pacing;
    const [slowest, fastest] = this.speeds;
    this.speed = Math.max(slowest, Math.min(fastest, this.speed));
  }

  /** Go straight to `t` (seconds from the burn), the camera with it. */
  jump(t: number): void {
    this.t = Math.max(-PARKING_TIME, Math.min(this.flight.end, t));
    this.look = null;
    this.lens = this.telephoto();
    if (this.finished) this.paused = true;
  }

  private findEvents(): MissionEvent[] {
    const { perilune, end } = this.flight;
    const at = (t: number) => {
      const saved = this.t;
      this.t = t;
      const result = { lost: this.lossOfSignal(), inside: this.altitudes().moon + MOON_RADIUS < MOON_SPHERE };
      this.t = saved;
      return result;
    };
    let los = perilune.t;
    while (at(los - 10).lost) los -= 10;
    let aos = perilune.t;
    while (at(aos).lost) aos += 10;
    let arrive = perilune.t;
    while (at(arrive - 600).inside) arrive -= 600;
    let leave = perilune.t;
    while (at(leave + 600).inside) leave += 600;
    return [
      { name: "Earth Parking Orbit", t: -PARKING_TIME },
      { name: "Trans-Lunar Injection", t: -BURN / 2 - 30 },
      { name: "Into the Moon's Sphere", t: arrive },
      { name: "Loss of Signal", t: los - 240 },
      { name: "Perilune", t: perilune.t - 120 },
      { name: "Earthrise", t: aos - 60 },
      { name: "Out of the Moon's Sphere", t: leave },
      { name: "Entry Interface", t: end - 1800 },
    ];
  }

  get finished(): boolean {
    return this.t >= this.flight.end;
  }

  /** Simulated time now, ms since 1970. */
  time(): number {
    return this.epoch + this.t * 1000;
  }

  /** A vector in the flight's plane, in Earth axes now. */
  private place(v: Vec3): Vec3 {
    const [x, y, z] = this.axes;
    return toEarth(add(add(mul(x, v[0]), mul(y, v[1])), mul(z, v[2])), siderealAngle(this.time()));
  }

  /** Kilometres above the Earth's and the Moon's surfaces now. */
  altitudes(): { earth: number; moon: number } {
    const { p } = sampleAt(this.flight, this.t);
    const m = moonPosition(this.t);
    return { earth: Math.hypot(...p) - EARTH_RADIUS, moon: Math.hypot(...sub(p, m)) - MOON_RADIUS };
  }

  /**
   * Seconds of flight a second of film covers now: the speed, in real
   * time. Condensed, watching the Earth set and rise over the Moon, the
   * automatic camera slows right down, so the few minutes it takes play over
   * several seconds.
   */
  rate(): number {
    if (this.pacing === "realtime") return this.speed;
    const { earth, moon } = this.altitudes();
    let rate = Math.max(60, Math.min(25000, Math.min(earth, moon) * 0.8));
    const elevation = this.earthElevation();
    if (this.mode === "auto" && elevation !== null && elevation > -0.03 && elevation < EARTHRISE_HALF_HEIGHT * 1.6) rate = Math.min(rate, EARTHRISE_RATE);
    return rate * this.speed;
  }

  /** How high the Earth's centre stands above the lunar horizon, radians (negative while hidden), or null away from the Moon. */
  private earthElevation(): number | null {
    const { p } = sampleAt(this.flight, this.t);
    const toMoon = sub(moonPosition(this.t), p);
    const distance = Math.hypot(...toMoon);
    if (distance - MOON_RADIUS > 20000) return null;
    const apart = Math.acos(Math.max(-1, Math.min(1, dot(norm(toMoon), norm(mul(p, -1))))));
    return apart - Math.asin(Math.min(1, MOON_RADIUS / distance));
  }

  /** Run the film on by `seconds` of real time. */
  advance(seconds: number): void {
    if (!this.paused && !this.finished) this.t = Math.min(this.flight.end, this.t + this.rate() * seconds);
    if (this.finished) this.paused = true;
    // The camera eases towards its target in real time, paused or not.
    const target = this.target();
    const ease = 1 - Math.exp(-seconds / SETTLE);
    this.look = this.look ? norm(add(this.look, mul(sub(target, this.look), ease))) : target;
    this.lens += (this.telephoto() - this.lens) * ease;
  }

  /**
   * Behind the Moon and just after, the automatic camera frames the Earth
   * rising as Apollo 8 photographed it: aimed a little above the lunar
   * horizon nearest the Earth, so the horizon runs across the lower part of
   * the picture and the Earth comes up out of it. Null once the Earth has
   * climbed clear, or away from the Moon.
   */
  private earthrise(): Vec3 | null {
    if (this.mode !== "auto" || this.watching() !== "earth") return null;
    const elevation = this.earthElevation();
    if (elevation === null || elevation > EARTHRISE_HALF_HEIGHT * 1.6) return null;
    const { p } = sampleAt(this.flight, this.t);
    const toMoon = sub(moonPosition(this.t), p);
    const distance = Math.hypot(...toMoon);
    const c = norm(toMoon);
    const e = norm(mul(p, -1));
    const limb = Math.asin(Math.min(1, MOON_RADIUS / distance));
    const towards = norm(sub(e, mul(c, dot(c, e))));
    const aim = limb + EARTHRISE_HALF_HEIGHT * 0.4;
    return norm(add(mul(c, Math.cos(aim)), mul(towards, Math.sin(aim))));
  }

  /** What the automatic camera is watching now. */
  private watching(): CameraMode {
    if (this.mode !== "auto") return this.mode;
    // Out of the parking orbit along the horizon, out to the Moon looking ahead, and from
    // just before the far side back at the Earth, to see it rise.
    if (this.t < BURN + 600) return "window";
    return this.t < this.flight.perilune.t - 1.5 * 3600 ? "moon" : "earth";
  }

  /**
   * The automatic camera zooms, as Apollo's crews used long lenses, until
   * what it watches fills a fair part of the picture: about a quarter of
   * its height across.
   */
  private telephoto(): number {
    if (this.mode !== "auto") return 1;
    if (this.earthrise()) return Math.tan(Math.PI / 9) / Math.tan(EARTHRISE_HALF_HEIGHT);
    const watching = this.watching();
    if (watching !== "moon" && watching !== "earth") return 1;
    const { p } = sampleAt(this.flight, this.t);
    const centre = watching === "moon" ? moonPosition(this.t) : ([0, 0, 0] as Vec3);
    const radius = watching === "moon" ? MOON_RADIUS : EARTH_RADIUS;
    const seen = Math.asin(Math.min(1, radius / Math.hypot(...sub(p, centre))));
    // At the 60° lens the picture is about 40° tall; a quarter of that is 5° of radius.
    return Math.max(1, Math.min(10, (5 * Math.PI) / 180 / seen));
  }

  /** Back to the parking orbit, the camera as it was. */
  restart(): void {
    this.t = -PARKING_TIME;
    this.paused = false;
  }

  /** Whether the Moon stands between the spacecraft and the Earth: no radio. */
  lossOfSignal(): boolean {
    const { p } = sampleAt(this.flight, this.t);
    const m = moonPosition(this.t);
    const d = norm(mul(p, -1));
    const along = dot(sub(m, p), d);
    if (along <= 0 || along > Math.hypot(...p)) return false;
    const closest = add(p, mul(d, along));
    return Math.hypot(...sub(closest, m)) < MOON_RADIUS;
  }

  /** Where the spacecraft lands, as latitude and longitude (radians) on the turning Earth. */
  landing(): { lat: number; lon: number } {
    const p = norm(this.place(sampleAt(this.flight, this.flight.end).p));
    return { lat: Math.asin(p[2]), lon: Math.atan2(p[1], p[0]) };
  }

  /** Where the camera means to look, in the flight's plane, before the mouse turns it. */
  private target(): Vec3 {
    const { p, v } = sampleAt(this.flight, this.t);
    const m = moonPosition(this.t);
    const mode = this.watching();
    const rise = this.earthrise();
    if (rise) return rise;
    if (mode === "moon") return norm(sub(m, p));
    if (mode === "earth") return norm(mul(p, -1));
    // Low over the Earth, the window tips down to take in the horizon.
    if (mode === "window" && this.mode === "auto") return norm(add(norm(v), mul(norm(p), -0.45)));
    if (mode === "window") return norm(v);
    return [0, 0, -1];
  }

  scene(width: number, height: number): SpaceScene {
    const lens = (width / 2 / Math.tan(Math.PI / 6)) * this.zoom * this.lens;
    const sample = sampleAt(this.flight, this.t);
    const flown = this.flight.samples.findIndex((s) => s.t > this.t);
    // The overview draws the flight as it looks turning with the Moon, which holds still: the
    // figure of eight Apollo's diagrams show. Each point is turned on by how far the Moon has
    // gone round since it was flown, then lifted clear of the bodies as they are drawn larger.
    const overview = this.mode === "overview";
    const kmPerPixel = 330000 / (width / 2) / this.zoom;
    const path = overview
      ? this.flight.samples.map((s) => {
          const a = MOON_RATE * (this.t - s.t);
          return this.place(this.clear([s.p[0] * Math.cos(a) - s.p[1] * Math.sin(a), s.p[0] * Math.sin(a) + s.p[1] * Math.cos(a), s.p[2]], kmPerPixel));
        })
      : [];
    const moon = this.place(moonPosition(this.t));
    const craft = this.place(overview ? this.clear(sample.p, kmPerPixel) : sample.p);
    const normal = this.place([0, 0, 1]);

    let eye: Vec3;
    let camera: SkyCamera;
    let focal = lens;
    let scale = { earth: 1, moon: 1 };
    if (this.mode === "overview") {
      // From above the plane of the flight: the Earth on the left, the Moon on the right where
      // the flight meets it. Dragging across spins the picture; dragging up and down tilts it.
      const centre = mul(moonPosition(this.t), 0.47);
      let back = normal;
      let right = this.place(norm(moonPosition(this.t)));
      let up = cross(back, right);
      right = turn(right, back, this.yaw);
      up = turn(up, back, this.yaw);
      back = turn(back, right, -this.pitch);
      up = cross(back, right);
      eye = add(this.place(centre), mul(back, OVERVIEW_HEIGHT));
      camera = { right, up, back };
      focal = ((width / 2) * OVERVIEW_HEIGHT) / 330000 * this.zoom;
      scale = { earth: OVERVIEW_EARTH, moon: OVERVIEW_MOON };
    } else {
      eye = craft;
      let look = this.place(this.look ?? this.target());
      // Up is the flight's north, except low over the Earth or the Moon, where it is straight up
      // from the ground, so the horizon runs level across the picture.
      const { earth, moon: overMoon } = this.altitudes();
      const low = overMoon < 20000 ? sub(sample.p, moonPosition(this.t)) : earth < 20000 ? sample.p : null;
      let hint = low ? this.place(norm(low)) : normal;
      if (Math.abs(dot(look, hint)) > 0.99) hint = low ? normal : this.place([1, 0, 0]);
      let right = norm(cross(look, hint));
      let up = cross(right, look);
      look = norm(turn(look, up, -this.yaw));
      right = norm(cross(look, up));
      look = norm(turn(look, right, this.pitch));
      up = cross(right, look);
      camera = { right, up, back: mul(look, -1) };
    }
    return {
      time: this.time(),
      eye,
      camera,
      focal,
      moon,
      scale,
      path,
      flown: flown < 0 ? path.length : flown,
      craft: this.mode === "overview" ? craft : null,
      labels: this.mode === "overview",
      instruments: this.instruments(sample.v),
    };
  }

  /**
   * A point of the flight, moved for the overview, where the bodies are drawn
   * many times their size: near each, pushed out by as much as the body grew
   * plus a few pixels, fading to no push at all well clear of it. So the
   * flight passes the drawn Moon just as it passes the real one, close but
   * outside, rather than through the middle of the bigger disc.
   */
  private clear(p: Vec3, kmPerPixel: number): Vec3 {
    let out = p;
    for (const [centre, radius, scale] of [
      [[0, 0, 0] as Vec3, EARTH_RADIUS, OVERVIEW_EARTH],
      [moonPosition(this.t), MOON_RADIUS, OVERVIEW_MOON],
    ] as const) {
      const offset = sub(out, centre);
      const r = Math.hypot(...offset);
      if (r === 0) continue;
      const grow = (scale - 1) * radius + kmPerPixel * 3;
      // Fades over three times the push, so nothing is squeezed to less than half its spacing.
      const reach = grow * 3;
      const x = Math.max(0, Math.min(1, (r - radius) / reach));
      const push = grow * (1 - x * x * (3 - 2 * x));
      out = add(centre, mul(offset, (r + push) / r));
    }
    return out;
  }

  private instruments(velocity: Vec3): Instruments {
    const { earth, moon } = this.altitudes();
    const phase = ["APOLLO 8  FREE RETURN"];
    if (this.finished) phase.push("ENTRY INTERFACE  SPLASHDOWN");
    else if (this.t < -BURN / 2) phase.push("EARTH PARKING ORBIT");
    else if (this.t < BURN / 2) phase.push("TRANS-LUNAR INJECTION");
    else if (moon + MOON_RADIUS < MOON_SPHERE) {
      phase.push(Math.abs(this.t - this.flight.perilune.t) < 900 ? `PERILUNE ${km(this.flight.perilune.altitude)} KM` : "LUNAR FLYBY");
      if (this.lossOfSignal()) phase.push("LOSS OF SIGNAL");
    } else if (this.t < this.flight.perilune.t) phase.push("TRANS-LUNAR COAST");
    else phase.push(earth < 20000 ? "ENTRY APPROACH" : "TRANS-EARTH COAST");
    const pace = this.pacing === "realtime" ? (this.speed === 1 ? "REAL TIME" : `REAL TIME X${this.speed}`) : `X${this.speed}`;
    const status = this.finished ? "ESC TO RETURN" : this.paused ? "PAUSED" : pace;
    return {
      phase,
      camera: `${CAMERA_NAMES[this.mode].toUpperCase()}${this.mode === "overview" ? " - NOT TO SCALE" : ""}  ${status}`,
      clock: clock((this.time() - this.launch) / 1000, this.time()),
      readout: `EARTH ${km(earth)} KM  MOON ${km(moon)} KM  ${Math.hypot(...velocity).toFixed(2)} KM/S`,
    };
  }
}
