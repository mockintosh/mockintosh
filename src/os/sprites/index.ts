/**
 * The OS's built-in sprites. Generated data files (`scripts/convert-sprites.ts`)
 * plus the registry they load into.
 */
import type { SpriteRegistry } from "./registry";
import { iconSprites } from "./icons";
import { uiSprites } from "./ui";
import { chromeSprites } from "./chrome";
import { standardFileSprites } from "./standardFile";

export { SpriteRegistry } from "./registry";

export function registerBuiltinSprites(registry: SpriteRegistry): void {
  registry.registerAll(iconSprites);
  registry.registerAll(uiSprites);
  registry.registerAll(chromeSprites);
  registry.registerAll(standardFileSprites);
}
