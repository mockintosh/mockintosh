/** The game's meshes. Every model faces −z, the way yaw 0 looks. */
import { MeshBuilder, addFrustum, box, pyramid, type Mesh } from "../qd3d";

function tank(): Mesh {
  const b = new MeshBuilder();
  // Tracks, a sloped upper hull, a turret, and a long barrel.
  addFrustum(b, { y0: 0, y1: 0.45, bottom: [1.1, 1.5], top: [1.1, 1.75], shade: 0.55 });
  addFrustum(b, { y0: 0.45, y1: 0.9, bottom: [0.9, 1.3], top: [0.7, 0.85], lean: [0, 0.2], shade: 0.9 });
  addFrustum(b, { y0: 0.9, y1: 1.3, bottom: [0.5, 0.6], top: [0.38, 0.42], offset: [0, 0, 0.2], shade: 1 });
  addFrustum(b, { y0: 1.02, y1: 1.16, bottom: [0.08, 0.75], top: [0.08, 0.75], offset: [0, 0, -1.05], shade: 0.8 });
  return b.build();
}

/** A wedge-nosed round. */
function shell(): Mesh {
  const b = new MeshBuilder();
  addFrustum(b, { y0: -0.12, y1: 0.12, bottom: [0.12, 0.3], top: [0.12, 0.3], shade: 0.3 });
  return b.build();
}

export const MODELS = {
  tank: tank(),
  shell: shell(),
  cube: box(3, 3, 3, 0.95),
  pyramid: pyramid(3.4, 3.8, 3.4, 1),
  tower: box(1.6, 5.5, 1.6, 0.9),
  wall: box(5, 1.4, 1, 0.85),
  rock: pyramid(0.9, 0.3, 0.7, 0.7),
  debris: pyramid(0.7, 0.6, 0.5, 0.8),
} as const;

export type ObstacleKind = "cube" | "pyramid" | "tower" | "wall";
