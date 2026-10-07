/**
 * The sky around the Earth: where the Sun is and which way the stars lie,
 * in the Earth's own axes (x towards 0°E on the equator, z to the north
 * pole) at a moment. The stars hold still against the Sun's year; the
 * Earth turns under both once a sidereal day.
 *
 * The Sun is the Astronomical Almanac's low-precision formula, good to about
 * a hundredth of a degree for centuries either side of 2000: plenty for a
 * terminator drawn in one bit. The Moon is rougher, to about a degree.
 */
import { decode, unzigzag } from "./packing";
import { STARS } from "./stars.generated";

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

/** Days since noon UTC on 1 January 2000 (J2000.0). */
function daysSinceJ2000(time: number): number {
  return time / 86_400_000 + 2440587.5 - 2451545;
}

/** How far the Earth has turned against the stars: Greenwich mean sidereal time, radians. */
export function siderealAngle(time: number): number {
  const n = daysSinceJ2000(time);
  return ((280.46061837 + 360.98564736629 * n) % 360) * DEG;
}

/** A direction fixed among the stars (equatorial, J2000), turned into the Earth's axes at `time`. */
export function toEarth([x, y, z]: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c + y * s, -x * s + y * c, z];
}

/** The Sun among the stars at `time`. */
function sunAmongStars(time: number): Vec3 {
  const n = daysSinceJ2000(time);
  const meanLongitude = (280.46 + 0.9856474 * n) * DEG;
  const anomaly = (357.528 + 0.9856003 * n) * DEG;
  const longitude = meanLongitude + (1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;
  return [Math.cos(longitude), Math.cos(obliquity) * Math.sin(longitude), Math.sin(obliquity) * Math.sin(longitude)];
}

/** Where the Sun is overhead at `time`, as a unit vector in Earth axes. */
export function sunDirection(time: number): Vec3 {
  return toEarth(sunAmongStars(time), siderealAngle(time));
}

/**
 * The Moon among the stars at `time`: its mean orbit with the largest
 * correction of each angle, good to about a degree. Plenty for where it
 * hangs in the sky and which way its phase faces.
 */
export function moonAmongStars(time: number): Vec3 {
  const n = daysSinceJ2000(time);
  const meanLongitude = (218.316 + 13.176396 * n) * DEG;
  const anomaly = (134.963 + 13.064993 * n) * DEG;
  const fromNode = (93.272 + 13.22935 * n) * DEG;
  const longitude = meanLongitude + 6.289 * DEG * Math.sin(anomaly);
  const latitude = 5.128 * DEG * Math.sin(fromNode);
  const obliquity = (23.439 - 0.0000004 * n) * DEG;
  const [x, y, z] = [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
  const c = Math.cos(obliquity);
  const s = Math.sin(obliquity);
  return [x, c * y - s * z, s * y + c * z];
}

/** Where the Moon is overhead at `time`, as a unit vector in Earth axes. */
export function moonDirection(time: number): Vec3 {
  return toEarth(moonAmongStars(time), siderealAngle(time));
}

export interface StarField {
  /** `[x, y, z, …]` unit vectors among the stars. */
  directions: Float64Array;
  /** Visual magnitude: smaller is brighter. */
  magnitudes: Float32Array;
}

let field: StarField | null = null;

/** The catalogue, unpacked the first time it is asked for. */
export function stars(): StarField {
  if (field) return field;
  const values = decode(STARS);
  const count = values.length / 3;
  const directions = new Float64Array(count * 3);
  const magnitudes = new Float32Array(count);
  let ra = 0;
  for (let i = 0; i < count; i++) {
    ra += unzigzag(values[i * 3]!);
    const dec = ((values[i * 3 + 1]! - 9000) / 100) * DEG;
    const r = (ra / 100) * DEG;
    directions[i * 3] = Math.cos(dec) * Math.cos(r);
    directions[i * 3 + 1] = Math.cos(dec) * Math.sin(r);
    directions[i * 3 + 2] = Math.sin(dec);
    magnitudes[i] = (values[i * 3 + 2]! - 20) / 10;
  }
  field = { directions, magnitudes };
  return field;
}

