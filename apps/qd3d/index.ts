/**
 * qd3d: a small 1-bit polygon engine in the manner of PlayDators. Meshes
 * are flat-shaded with the `SHADE_PATTERNS` ramp, sorted painter-style and
 * outlined in black. See docs/1bit-3d-research.md.
 */
export { MeshBuilder, addFrustum, box, createMesh, pyramid, type FrustumSpec, type Mesh, type Vec3 } from "./mesh";
export {
  CREASES,
  LIGHTING,
  Renderer,
  SILHOUETTE,
  SOLID,
  WIRE,
  drawLine,
  fillPolygon,
  fillRows,
  focalLength,
  horizonY,
  instance,
  project,
  type Camera,
  type Instance,
  type RenderOptions,
  type Target,
} from "./render";
