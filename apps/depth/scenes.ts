/**
 * Depth's scenes: signed-distance worlds raymarched on the GPU. Each scene is
 * WGSL that defines `sceneSdf(p) -> vec2f` (distance, material) and
 * `mainImage`; the shared library before it marches, lights and shadows any
 * `sceneSdf`. Camera orbit arrives in `u.params[0]` as (yaw, pitch, distance).
 * Scenes return linear grey: the dither turns it into ink coverage.
 */

export interface Orbit {
  yaw: number;
  pitch: number;
  distance: number;
}

export interface SceneDefinition {
  id: string;
  title: string;
  /** Where the camera starts, and how close and far it may go. */
  orbit: Orbit;
  minDistance: number;
  maxDistance: number;
  /** Radians per second the camera circles while Spin is on. */
  spin: number;
  /** Swing back and forth this far (radians) instead of circling all the way round. */
  sway?: number;
  source: string;
}

const LIBRARY = /* wgsl */ `
const PI: f32 = 3.14159265;

struct Ray { o: vec3f, d: vec3f };
struct Hit { t: f32, m: f32 };

fn rot2(a: f32) -> mat2x2f {
  let c = cos(a);
  let s = sin(a);
  return mat2x2f(c, s, -s, c);
}

fn rotX(p: vec3f, a: f32) -> vec3f { let q = rot2(a) * p.yz; return vec3f(p.x, q.x, q.y); }
fn rotY(p: vec3f, a: f32) -> vec3f { let q = rot2(a) * p.xz; return vec3f(q.x, p.y, q.y); }
fn rotZ(p: vec3f, a: f32) -> vec3f { let q = rot2(a) * p.xy; return vec3f(q.x, q.y, p.z); }

/** A ray through this pixel from a camera circling \`look\` (params[0] = yaw, pitch, distance). */
fn orbitRay(fragCoord: vec2f, look: vec3f, lens: f32) -> Ray {
  let cam = u.params[0];
  let o = look + cam.z * vec3f(cos(cam.y) * sin(cam.x), sin(cam.y), cos(cam.y) * cos(cam.x));
  let fw = normalize(look - o);
  let rt = normalize(cross(fw, vec3f(0.0, 1.0, 0.0)));
  let up = cross(rt, fw);
  let uv = vec2f(2.0 * fragCoord.x - u.resolution.x, u.resolution.y - 2.0 * fragCoord.y) / u.resolution.y;
  return Ray(o, normalize(fw * lens + rt * uv.x + up * uv.y));
}

fn march(r: Ray, tmax: f32, steps: i32) -> Hit {
  var t = 0.0;
  var m = -1.0;
  for (var i = 0; i < steps; i++) {
    let h = sceneSdf(r.o + r.d * t);
    m = h.y;
    if (abs(h.x) < 0.0003 * t + 0.0002) { return Hit(t, m); }
    t += h.x;
    if (t > tmax) { return Hit(t, -1.0); }
  }
  return Hit(t, m);
}

fn sceneNormal(p: vec3f, eps: f32) -> vec3f {
  let k = vec2f(1.0, -1.0);
  return normalize(
    k.xyy * sceneSdf(p + k.xyy * eps).x +
    k.yyx * sceneSdf(p + k.yyx * eps).x +
    k.yxy * sceneSdf(p + k.yxy * eps).x +
    k.xxx * sceneSdf(p + k.xxx * eps).x);
}

/** Penumbra toward a light: 0 in full shadow, 1 in full light; \`k\` sharpens it. */
fn softShadow(o: vec3f, d: vec3f, tmax: f32, k: f32) -> f32 {
  var res = 1.0;
  var t = 0.02;
  for (var i = 0; i < 64; i++) {
    let h = sceneSdf(o + d * t).x;
    res = min(res, k * h / t);
    t += clamp(h, 0.01, 0.3);
    if (res < 0.002 || t > tmax) { break; }
  }
  return clamp(res, 0.0, 1.0);
}

fn occlusion(p: vec3f, n: vec3f) -> f32 {
  var occ = 0.0;
  var sca = 1.0;
  for (var i = 0; i < 5; i++) {
    let h = 0.01 + 0.11 * f32(i);
    occ += (h - sceneSdf(p + n * h).x) * sca;
    sca *= 0.9;
  }
  return clamp(1.0 - 2.5 * occ, 0.0, 1.0);
}

fn sdBox(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 { return sdBox(p, b - vec3f(r)) - r; }

fn sdTorus(p: vec3f, t: vec2f) -> f32 { return length(vec2f(length(p.xz) - t.x, p.y)) - t.y; }

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn checker(p: vec2f) -> f32 {
  let q = floor(p);
  let s = q.x + q.y;
  return s - 2.0 * floor(s * 0.5);
}

/** Linear grey out: the dither turns it straight into ink coverage. */
fn grey(c: f32) -> vec4f {
  let v = clamp(c, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}

/** A key light with soft shadow, a sky fill, a bounce from behind, and ambient occlusion. */
fn lit(p: vec3f, n: vec3f, rd: vec3f, light: vec3f, albedo: f32, gloss: f32) -> f32 {
  let sha = softShadow(p + n * 0.003, light, 14.0, 10.0);
  let occ = occlusion(p, n);
  let dif = max(dot(n, light), 0.0) * sha;
  let sky = 0.5 + 0.5 * n.y;
  let bounce = max(dot(n, normalize(vec3f(-light.x, 0.0, -light.z))), 0.0);
  let h = normalize(light - rd);
  let spe = pow(max(dot(n, h), 0.0), 40.0) * sha * gloss;
  let fre = pow(1.0 - max(dot(n, -rd), 0.0), 4.0) * gloss;
  return albedo * (dif + (0.2 * sky + 0.22 * bounce) * occ) + spe + 0.25 * fre * occ;
}
`;

// ---------------------------------------------------------------------------
// Macintosh — a compact Mac on a desk, smiling
// ---------------------------------------------------------------------------

const MACINTOSH = /* wgsl */ `
const MAC = vec3f(0.0, 1.72, 0.0);
const SCREEN = vec3f(0.0, 0.55, 1.18);

fn macCase(q: vec3f) -> f32 {
  // A little narrower and shallower toward the top, as the real case is.
  let taper = 1.0 - 0.035 * (q.y + 1.7);
  var d = sdRoundBox(vec3f(q.x / taper, q.y, q.z), vec3f(1.2, 1.7, 1.3), 0.16) * taper;
  d = max(d, -sdRoundBox(q - vec3f(0.0, 0.55, 1.36), vec3f(0.9, 0.72, 0.16), 0.12));
  d = max(d, -sdBox(q - vec3f(0.42, -0.78, 1.3), vec3f(0.36, 0.028, 0.12)));
  d = max(d, -(abs(q.y + 1.32) - 0.012));
  return d;
}

fn macScreen(q: vec3f) -> f32 {
  let s = q - SCREEN;
  return max(sdRoundBox(s, vec3f(0.76, 0.58, 0.3), 0.1), length(s - vec3f(0.0, 0.0, -4.0)) - 4.05);
}

fn keyboard(p: vec3f) -> vec2f {
  let k = rotX(p - vec3f(0.0, 0.1, 2.85), -0.07);
  let body = sdRoundBox(k, vec3f(1.3, 0.07, 0.48), 0.05);
  let cell = 0.17;
  let id = clamp(round(k.xz / cell), vec2f(-7.0, -2.0), vec2f(7.0, 2.0));
  let r = k.xz - id * cell;
  let keys = sdRoundBox(vec3f(r.x, k.y - 0.08, r.y), vec3f(0.066, 0.04, 0.066), 0.025);
  if (keys < body) { return vec2f(keys, 5.0); }
  return vec2f(body, 4.0);
}

fn mouse(p: vec3f) -> f32 {
  let m = rotY(p - vec3f(2.05, 0.12, 2.75), 0.2);
  var d = sdRoundBox(m, vec3f(0.27, 0.12, 0.42), 0.1);
  d = max(d, -(abs(m.z + 0.12) - 0.008));
  return d;
}

fn sceneSdf(p: vec3f) -> vec2f {
  let q = p - MAC;
  var res = vec2f(p.y, 3.0);
  let body = macCase(q);
  if (body < res.x) { res = vec2f(body, 1.0); }
  let glass = macScreen(q);
  if (glass < res.x) { res = vec2f(glass, 2.0); }
  let kb = keyboard(p);
  if (kb.x < res.x) { res = kb; }
  let mo = mouse(p);
  if (mo < res.x) { res = vec2f(mo, 1.0); }
  return res;
}

fn segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

/** The Happy Mac, drawn on the tube. \`uv\` is -1…1 across the glass. */
fn happyMac(uv: vec2f) -> f32 {
  let blink = select(1.0, 0.1, fract(u.time * 0.23) > 0.97);
  var d = 1e5;
  d = min(d, segment(uv, vec2f(-0.28, 0.32 - 0.2 * blink), vec2f(-0.28, 0.32 + 0.1 * blink)));
  d = min(d, segment(uv, vec2f(0.28, 0.32 - 0.2 * blink), vec2f(0.28, 0.32 + 0.1 * blink)));
  d = min(d, segment(uv, vec2f(0.04, 0.3), vec2f(0.04, -0.05)));
  d = min(d, segment(uv, vec2f(0.04, -0.05), vec2f(-0.08, -0.05)));
  let c = uv - vec2f(0.0, 0.05);
  let a = atan2(c.y, c.x);
  if (a < -0.6 && a > -2.55) { d = min(d, abs(length(c) - 0.5)); }
  return select(0.95, 0.05, d < 0.055);
}

fn mainImage(fragCoord: vec2f) -> vec4f {
  let r = orbitRay(fragCoord, vec3f(0.3, 1.4, 1.0), 1.9);
  let horizon = 1.0 - 0.3 * max(r.d.y, 0.0);
  let h = march(r, 40.0, 180);
  if (h.m < 0.0) { return grey(horizon); }
  let p = r.o + r.d * h.t;
  let n = sceneNormal(p, 0.001);
  let light = normalize(vec3f(-0.7, 1.0, 0.8));
  var c = 0.0;
  if (h.m == 2.0) {
    let s = (p - MAC - SCREEN).xy / vec2f(0.76, 0.58);
    let glow = happyMac(s) * (1.0 - 0.25 * dot(s, s));
    let glare = pow(max(dot(reflect(r.d, n), light), 0.0), 60.0);
    c = 0.1 + 0.85 * glow + glare;
  } else if (h.m == 3.0) {
    let tile = mix(0.72, 0.95, checker(p.xz * 0.7));
    c = lit(p, n, r.d, light, tile, 0.0);
  } else if (h.m == 5.0) {
    c = lit(p, n, r.d, light, 0.7, 0.1);
  } else {
    c = lit(p, n, r.d, light, 0.92, 0.2);
  }
  let fog = 1.0 - exp(-0.0012 * h.t * h.t);
  return grey(mix(c, horizon, fog));
}
`;

// ---------------------------------------------------------------------------
// Mandelbulb — the power-8 bulb, breathing between powers
// ---------------------------------------------------------------------------

const MANDELBULB = /* wgsl */ `
fn bulbPower() -> f32 { return 8.0 + 2.0 * sin(u.time * 0.21); }

fn sceneSdf(p: vec3f) -> vec2f {
  let bound = length(p) - 1.25;
  if (bound > 0.2) { return vec2f(bound, 0.0); }
  let power = bulbPower();
  var z = p;
  var dr = 1.0;
  var r = length(z);
  var trap = 1e5;
  for (var i = 0; i < 8; i++) {
    if (r > 2.0) { break; }
    let theta = acos(clamp(z.y / r, -1.0, 1.0)) * power + u.time * 0.1;
    let phi = atan2(z.z, z.x) * power;
    dr = pow(r, power - 1.0) * power * dr + 1.0;
    let zr = pow(r, power);
    z = zr * vec3f(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi)) + p;
    r = length(z);
    trap = min(trap, r);
  }
  return vec2f(0.5 * log(max(r, 1e-6)) * r / dr, trap);
}

fn mainImage(fragCoord: vec2f) -> vec4f {
  let r = orbitRay(fragCoord, vec3f(0.0), 1.7);
  let uv = (fragCoord - 0.5 * u.resolution) / u.resolution.y;
  let back = 0.12 * exp(-3.0 * dot(uv, uv));
  let h = march(r, 8.0, 220);
  if (h.m < 0.0) { return grey(back); }
  let p = r.o + r.d * h.t;
  let n = sceneNormal(p, 0.0005);
  // Lit from over the camera's shoulder, so the side we see is the side that shines.
  let side = normalize(cross(r.o, vec3f(0.0, 1.0, 0.0)));
  let light = normalize(normalize(r.o) * 0.6 + vec3f(0.0, 1.0, 0.0) - side * 0.9);
  let sha = softShadow(p + n * 0.002, light, 4.0, 16.0);
  let dif = max(dot(n, light), 0.0) * sha;
  // The orbit trap stands in for occlusion: points that stayed near the origin are deep in a crevice.
  let occ = 0.2 + 0.8 * clamp(h.m * 1.5 - 0.3, 0.0, 1.0);
  let rim = pow(clamp(1.0 + dot(n, r.d), 0.0, 1.0), 3.0);
  let spe = pow(max(dot(reflect(r.d, n), light), 0.0), 24.0) * sha;
  let c = occ * (0.9 * dif + 0.1 + 0.35 * rim) + 0.3 * spe;
  return grey(c);
}
`;

// ---------------------------------------------------------------------------
// Menger sponge — a level-4 sponge hanging over a floor
// ---------------------------------------------------------------------------

const MENGER = /* wgsl */ `
fn sponge(p: vec3f) -> f32 {
  var d = sdBox(p, vec3f(1.0));
  var s = 1.0;
  for (var i = 0; i < 4; i++) {
    let a = (p * s - 2.0 * floor(p * s * 0.5)) - 1.0;
    s *= 3.0;
    let r = abs(1.0 - 3.0 * abs(a));
    let da = max(r.x, r.y);
    let db = max(r.y, r.z);
    let dc = max(r.z, r.x);
    d = max(d, (min(da, min(db, dc)) - 1.0) / s);
  }
  return d;
}

fn sceneSdf(p: vec3f) -> vec2f {
  let q = rotY(rotX(p - vec3f(0.0, 1.6, 0.0), 0.6155), 0.785398 + u.time * 0.15);
  let s = sponge(q);
  let ground = p.y;
  if (s < ground) { return vec2f(s, 1.0); }
  return vec2f(ground, 2.0);
}

fn mainImage(fragCoord: vec2f) -> vec4f {
  let r = orbitRay(fragCoord, vec3f(0.0, 1.2, 0.0), 1.8);
  let sky = 0.85 - 0.4 * max(r.d.y, 0.0);
  let h = march(r, 30.0, 200);
  if (h.m < 0.0) { return grey(sky); }
  let p = r.o + r.d * h.t;
  let n = sceneNormal(p, 0.0007);
  let light = normalize(vec3f(0.5, 0.9, 0.35));
  var c = 0.0;
  if (h.m == 1.0) {
    c = lit(p, n, r.d, light, 0.85, 0.05);
  } else {
    c = lit(p, n, r.d, light, 0.7, 0.0);
  }
  let fog = 1.0 - exp(-0.004 * h.t * h.t);
  return grey(mix(c, sky, fog));
}
`;

// ---------------------------------------------------------------------------
// Blobs — metaballs on a mirror floor
// ---------------------------------------------------------------------------

const BLOBS = /* wgsl */ `
fn blobs(p: vec3f) -> f32 {
  var d = 1e5;
  for (var i = 0; i < 7; i++) {
    let k = f32(i);
    let t = u.time * (0.4 + 0.07 * k) + k * 1.7;
    let c = vec3f(1.3 * sin(t * 1.1 + k), 1.25 + 0.7 * sin(t * 1.3 + 2.0 * k), 1.3 * cos(t * 0.9 + 0.5 * k));
    d = smin(d, length(p - c) - (0.38 + 0.06 * k), 0.55);
  }
  return d;
}

fn sceneSdf(p: vec3f) -> vec2f {
  let b = blobs(p);
  if (b < p.y) { return vec2f(b, 1.0); }
  return vec2f(p.y, 2.0);
}

fn skyGrey(d: vec3f) -> f32 {
  // A soft studio: bright overhead panel, dark walls.
  let panel = smoothstep(0.75, 0.95, d.y) * 0.9;
  return 0.12 + 0.25 * max(d.y, 0.0) + panel;
}

fn blobShade(p: vec3f, n: vec3f, rd: vec3f, light: vec3f) -> f32 {
  let base = lit(p, n, rd, light, 0.55, 0.9);
  let refl = skyGrey(reflect(rd, n));
  let fre = 0.1 + 0.9 * pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  return base + 0.5 * fre * refl;
}

fn mainImage(fragCoord: vec2f) -> vec4f {
  let r = orbitRay(fragCoord, vec3f(0.0, 1.0, 0.0), 1.8);
  let h = march(r, 30.0, 160);
  if (h.m < 0.0) { return grey(skyGrey(r.d)); }
  let p = r.o + r.d * h.t;
  let n = sceneNormal(p, 0.001);
  let light = normalize(vec3f(-0.4, 1.0, 0.3));
  if (h.m == 1.0) { return grey(blobShade(p, n, r.d, light)); }
  // The floor mirrors the blobs, fading with distance from them.
  let floorLit = lit(p, n, r.d, light, 0.35 + 0.1 * checker(p.xz), 0.0);
  let mr = Ray(p + n * 0.003, reflect(r.d, n));
  let mh = march(mr, 12.0, 90);
  var refl = skyGrey(mr.d);
  if (mh.m == 1.0) {
    let mp = mr.o + mr.d * mh.t;
    refl = blobShade(mp, sceneNormal(mp, 0.001), mr.d, light);
  }
  let c = mix(floorLit, refl, 0.45);
  let fog = 1.0 - exp(-0.006 * h.t * h.t);
  return grey(mix(c, 0.12, fog));
}
`;

// ---------------------------------------------------------------------------
// Gyroscope — nested rings turning about three axes
// ---------------------------------------------------------------------------

const GYROSCOPE = /* wgsl */ `
const CENTRE = vec3f(0.0, 1.9, 0.0);

fn sceneSdf(p: vec3f) -> vec2f {
  let t = u.time;
  var q = p - CENTRE;
  var d = length(q) - 0.42;
  var m = 1.0;
  q = rotX(q, t * 0.7);
  let r1 = sdTorus(rotZ(q, PI * 0.5), vec2f(1.55, 0.07));
  q = rotY(q, t * 1.1);
  let r2 = sdTorus(rotX(q, PI * 0.5), vec2f(1.25, 0.07));
  q = rotZ(q, t * 1.6);
  let r3 = sdTorus(q, vec2f(0.95, 0.07));
  let axle = max(length(q.xz) - 0.03, abs(q.y) - 0.95);
  let rings = min(min(r1, r2), min(r3, axle));
  if (rings < d) { d = rings; m = 2.0; }
  // A pedestal under it all.
  let stand = min(
    sdRoundBox(p - vec3f(0.0, 0.08, 0.0), vec3f(0.9, 0.08, 0.9), 0.05),
    max(length(p.xz) - 0.06, abs(p.y - 0.25) - 0.25));
  if (stand < d) { d = stand; m = 3.0; }
  if (p.y < d) { d = p.y; m = 4.0; }
  return vec2f(d, m);
}

fn mainImage(fragCoord: vec2f) -> vec4f {
  let r = orbitRay(fragCoord, vec3f(0.0, 1.5, 0.0), 1.8);
  let sky = 0.08 + 0.12 * max(r.d.y, 0.0);
  let h = march(r, 30.0, 160);
  if (h.m < 0.0) { return grey(sky); }
  let p = r.o + r.d * h.t;
  let n = sceneNormal(p, 0.001);
  let light = normalize(vec3f(0.3, 1.0, 0.5));
  var c = 0.0;
  if (h.m == 1.0) {
    c = lit(p, n, r.d, light, 0.9, 1.0);
  } else if (h.m == 2.0) {
    c = lit(p, n, r.d, light, 0.7, 1.0);
  } else if (h.m == 3.0) {
    c = lit(p, n, r.d, light, 0.3, 0.6);
  } else {
    // A spotlight pool on the floor.
    let pool = exp(-0.25 * dot(p.xz, p.xz));
    c = lit(p, n, r.d, light, 0.6, 0.0) * pool;
  }
  return grey(c);
}
`;

// ---------------------------------------------------------------------------
// Pillars — a field of columns under a travelling ripple
// ---------------------------------------------------------------------------

const PILLARS = /* wgsl */ `
const CELL: f32 = 0.5;

fn pillarHeight(id: vec2f) -> f32 {
  let d = length(id);
  return 1.0 + 0.85 * sin(d * 0.45 - u.time * 2.2) + 0.2 * sin(id.x * 0.7 + u.time) * cos(id.y * 0.6 - u.time * 0.8);
}

fn sceneSdf(p: vec3f) -> vec2f {
  let base = round(p.xz / CELL);
  var d = p.y;
  var m = 2.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let id = base + vec2f(f32(i), f32(j));
      if (length(id) > 22.0) { continue; }
      let ht = pillarHeight(id);
      let c = vec3f(id.x * CELL, ht * 0.5, id.y * CELL);
      let b = sdRoundBox(p - c, vec3f(0.19, ht * 0.5, 0.19), 0.03);
      if (b < d) { d = b; m = 1.0; }
    }
  }
  return vec2f(d, m);
}

fn mainImage(fragCoord: vec2f) -> vec4f {
  let r = orbitRay(fragCoord, vec3f(0.0, 0.4, 0.0), 1.6);
  let sky = 0.9 - 0.5 * max(r.d.y, 0.0);
  let h = march(r, 40.0, 200);
  if (h.m < 0.0) { return grey(sky); }
  let p = r.o + r.d * h.t;
  let n = sceneNormal(p, 0.001);
  let light = normalize(vec3f(-0.5, 0.75, -0.45));
  var c = 0.0;
  if (h.m == 1.0) {
    let top = smoothstep(0.7, 0.9, n.y);
    c = lit(p, n, r.d, light, mix(0.6, 0.95, top), 0.2);
  } else {
    c = lit(p, n, r.d, light, 0.3, 0.0);
  }
  let fog = 1.0 - exp(-0.0025 * h.t * h.t);
  return grey(mix(c, sky, fog));
}
`;

function scene(definition: Omit<SceneDefinition, "source"> & { body: string }): SceneDefinition {
  const { body, ...rest } = definition;
  return { ...rest, source: LIBRARY + body };
}

export const SCENES: readonly SceneDefinition[] = [
  scene({ id: "macintosh", title: "Macintosh", orbit: { yaw: 0.35, pitch: 0.3, distance: 7.5 }, minDistance: 4, maxDistance: 18, spin: 0.3, sway: 0.9, body: MACINTOSH }),
  scene({ id: "mandelbulb", title: "Mandelbulb", orbit: { yaw: 0.4, pitch: 0.35, distance: 2.6 }, minDistance: 1.4, maxDistance: 5, spin: 0.12, body: MANDELBULB }),
  scene({ id: "menger", title: "Menger Sponge", orbit: { yaw: 0.6, pitch: 0.3, distance: 4.6 }, minDistance: 2.2, maxDistance: 10, spin: 0.1, body: MENGER }),
  scene({ id: "blobs", title: "Blobs", orbit: { yaw: 0.0, pitch: 0.28, distance: 5.5 }, minDistance: 3, maxDistance: 12, spin: 0.15, body: BLOBS }),
  scene({ id: "gyroscope", title: "Gyroscope", orbit: { yaw: 0.3, pitch: 0.22, distance: 5.6 }, minDistance: 3, maxDistance: 12, spin: 0.1, body: GYROSCOPE }),
  scene({ id: "pillars", title: "Pillars", orbit: { yaw: 0.78, pitch: 0.75, distance: 10 }, minDistance: 4, maxDistance: 18, spin: 0.08, body: PILLARS }),
];

export function stepScene(current: SceneDefinition, by: number): SceneDefinition {
  const index = SCENES.indexOf(current);
  return SCENES[(index + by + SCENES.length) % SCENES.length]!;
}
