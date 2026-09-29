import type { SceneDefinition, SceneGroup } from "./scene";
import { GENERATIVE_SCENES } from "./scenes/generative";
import { INSTRUMENT_SCENES } from "./scenes/instruments";
import { ONE_BIT_SCENES } from "./scenes/onebit";
import { SURFACE_SCENES } from "./scenes/surface";

/** Menu order: ← and → walk every scene in turn, ↑ and ↓ jump between groups. */
export const SCENE_GROUPS: readonly SceneGroup[] = [
  { id: "instruments", title: "Instruments", scenes: INSTRUMENT_SCENES },
  { id: "generative", title: "Generative", scenes: GENERATIVE_SCENES },
  { id: "one-bit", title: "One Bit", scenes: ONE_BIT_SCENES },
  { id: "surface", title: "Surface", scenes: SURFACE_SCENES },
];

export const SCENES: readonly SceneDefinition[] = SCENE_GROUPS.flatMap((group) => group.scenes);

export function groupOf(scene: SceneDefinition): SceneGroup {
  return SCENE_GROUPS.find((group) => group.scenes.includes(scene))!;
}

/** The scene `offset` steps from `scene` in menu order, wrapping. */
export function stepScene(scene: SceneDefinition, offset: number): SceneDefinition {
  const at = SCENES.indexOf(scene);
  return SCENES[(((at + offset) % SCENES.length) + SCENES.length) % SCENES.length]!;
}

/** The first scene of the group `offset` groups from `scene`'s, wrapping. */
export function stepGroup(scene: SceneDefinition, offset: number): SceneDefinition {
  const at = SCENE_GROUPS.indexOf(groupOf(scene));
  const n = SCENE_GROUPS.length;
  return SCENE_GROUPS[(((at + offset) % n) + n) % n]!.scenes[0]!;
}
