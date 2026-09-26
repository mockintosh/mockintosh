/**
 * A tube swept along a curve that morphs from a ring into a trefoil knot,
 * rasterized with a z-buffer and Gouraud shading, then ordered-dithered into
 * one bit. The same projection hands the particle scene its starting points,
 * so the knot can shatter into the next shot.
 */
import { bayer, type Painter, type Vec } from "./painter";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface KnotPose {
  /** 0 = a plain ring, 1 = a trefoil knot. */
  morph: number;
  /** Tube radius in world units. */
  tube: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** Where the knot's centre lands, in stage units. */
  center: Vec;
  /** Stage units per world unit at the knot's centre. */
  size: number;
  /** Direction *towards* the light, in camera space. */
  light: Vec3;
}

const CAMERA_DISTANCE = 4.2;
const SEGMENTS = 168;
const SIDES = 12;

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** The ring traced twice (morph 0) opening into the (2, 3) torus knot (morph 1). */
function knotPoint(u: number, morph: number): Vec3 {
  const r = 2 + morph * Math.cos(3 * u);
  return { x: (r * Math.cos(2 * u)) / 3, y: (r * Math.sin(2 * u)) / 3, z: (-morph * Math.sin(3 * u)) / 3 };
}

/** Rotation by yaw (about y), pitch (about x), roll (about z), in that order. */
function rotator(pose: KnotPose): (v: Vec3) => Vec3 {
  const cy = Math.cos(pose.yaw);
  const sy = Math.sin(pose.yaw);
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  const cr = Math.cos(pose.roll);
  const sr = Math.sin(pose.roll);
  return (v) => {
    const x1 = v.x * cr - v.y * sr;
    const y1 = v.x * sr + v.y * cr;
    const x2 = x1 * cy + v.z * sy;
    const z2 = -x1 * sy + v.z * cy;
    return { x: x2, y: y1 * cp - z2 * sp, z: y1 * sp + z2 * cp };
  };
}

interface ProjectedVertex {
  /** Device pixels. */
  x: number;
  y: number;
  /** Camera depth, larger is further. */
  z: number;
  light: number;
}

function project(painter: Painter, pose: KnotPose, v: Vec3): { x: number; y: number; z: number } {
  const z = v.z + CAMERA_DISTANCE;
  const k = (pose.size * CAMERA_DISTANCE) / z;
  return { x: painter.dx(pose.center.x + v.x * k), y: painter.dy(pose.center.y + v.y * k), z };
}

/** Points on the knot's centre line as they appear on stage in this pose. */
export function projectKnotCurve(pose: KnotPose, count: number): Vec[] {
  const rotate = rotator(pose);
  const out: Vec[] = [];
  for (let k = 0; k < count; k++) {
    const v = rotate(knotPoint((k / count) * Math.PI * 2, pose.morph));
    const s = (pose.size * CAMERA_DISTANCE) / (v.z + CAMERA_DISTANCE);
    out.push({ x: pose.center.x + v.x * s, y: pose.center.y + v.y * s });
  }
  return out;
}

let depthBuffer = new Float32Array(0);

/** Draw the knot over whatever is on the frame; shading is dithered white-on-black. */
export function drawKnot(painter: Painter, pose: KnotPose): void {
  if (pose.size <= 0) return;
  const { frame, clip } = painter;
  if (depthBuffer.length < frame.width * frame.height) depthBuffer = new Float32Array(frame.width * frame.height);
  depthBuffer.fill(Infinity);

  const rotate = rotator(pose);
  const light = normalize(pose.light);
  // Blinn half-vector; the viewer looks down +z, so towards it is -z.
  const half = normalize({ x: light.x, y: light.y, z: light.z - 1 });
  const verts: ProjectedVertex[] = new Array(SEGMENTS * SIDES);
  const eps = 1e-3;
  for (let i = 0; i < SEGMENTS; i++) {
    const u = (i / SEGMENTS) * Math.PI * 2;
    const c = knotPoint(u, pose.morph);
    const a = knotPoint(u - eps, pose.morph);
    const b = knotPoint(u + eps, pose.morph);
    const tangent = normalize({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    const binormal = normalize(cross(tangent, { x: 0, y: 0, z: 1 }));
    const normal = cross(binormal, tangent);
    for (let j = 0; j < SIDES; j++) {
      const v = (j / SIDES) * Math.PI * 2;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      const n = rotate({
        x: normal.x * cv + binormal.x * sv,
        y: normal.y * cv + binormal.y * sv,
        z: normal.z * cv + binormal.z * sv,
      });
      const centre = rotate(c);
      const pos = {
        x: centre.x + n.x * pose.tube,
        y: centre.y + n.y * pose.tube,
        z: centre.z + n.z * pose.tube,
      };
      const diffuse = Math.max(0, n.x * light.x + n.y * light.y + n.z * light.z);
      const spec = Math.pow(Math.max(0, n.x * half.x + n.y * half.y + n.z * half.z), 24);
      const rim = Math.pow(1 - Math.abs(n.z), 3);
      const p = project(painter, pose, pos);
      verts[i * SIDES + j] = { ...p, light: 0.04 + 0.78 * diffuse + 0.9 * spec + 0.35 * rim };
    }
  }

  const px = frame.pixels;
  const W = frame.width;
  const tri = (a: ProjectedVertex, b: ProjectedVertex, c: ProjectedVertex) => {
    // Both windings are drawn: the ring traces itself twice at morph 0, so
    // facing can't be read off the winding. The depth test sorts it out.
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-6) return;
    const x0 = Math.max(clip.x0, Math.floor(Math.min(a.x, b.x, c.x)));
    const x1 = Math.min(clip.x1 - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const y0 = Math.max(clip.y0, Math.floor(Math.min(a.y, b.y, c.y)));
    const y1 = Math.min(clip.y1 - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    const inv = 1 / area;
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const cx = x + 0.5;
        const w0 = ((b.x - cx) * (c.y - cy) - (b.y - cy) * (c.x - cx)) * inv;
        const w1 = ((c.x - cx) * (a.y - cy) - (c.y - cy) * (a.x - cx)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a.z + w1 * b.z + w2 * c.z;
        const i = y * W + x;
        if (z >= depthBuffer[i]!) continue;
        depthBuffer[i] = z;
        const lit = w0 * a.light + w1 * b.light + w2 * c.light;
        px[i] = lit > bayer(x, y) ? 0 : 1;
      }
    }
  };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const i2 = (i + 1) % SEGMENTS;
    for (let j = 0; j < SIDES; j++) {
      const j2 = (j + 1) % SIDES;
      const a = verts[i * SIDES + j]!;
      const b = verts[i2 * SIDES + j]!;
      const c = verts[i2 * SIDES + j2]!;
      const d = verts[i * SIDES + j2]!;
      tri(a, b, c);
      tri(a, c, d);
    }
  }

  // A black contour where the knot meets empty space, so it reads against
  // anything bright behind it.
  const x0 = Math.max(clip.x0 + 1, Math.floor(minX) - 1);
  const x1 = Math.min(clip.x1 - 1, Math.ceil(maxX) + 2);
  const y0 = Math.max(clip.y0 + 1, Math.floor(minY) - 1);
  const y1 = Math.min(clip.y1 - 1, Math.ceil(maxY) + 2);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      if (depthBuffer[i] !== Infinity) continue;
      if (
        depthBuffer[i - 1] !== Infinity ||
        depthBuffer[i + 1] !== Infinity ||
        depthBuffer[i - W] !== Infinity ||
        depthBuffer[i + W] !== Infinity
      ) {
        px[i] = 1;
      }
    }
  }
}
