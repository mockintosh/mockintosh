/**
 * SpriteRegistry — every named 1-bit image the OS can draw, by key.
 *
 * Built-in sprites (icons, window chrome, UI widgets) are registered at boot;
 * always-on apps contribute theirs through `SolidApp.sprites`, optional
 * bundled apps through their listing, and installed apps through their
 * module's `sprites` export. Components look sprites up
 * by name (`<image src>`, `useApp().getSprite`), so nothing else holds pixel
 * data.
 */
import type { Sprite } from "@mockintosh/ui";

export class SpriteRegistry {
  private readonly sprites = new Map<string, Sprite>();

  get(key: string): Sprite | undefined {
    return this.sprites.get(key);
  }

  has(key: string): boolean {
    return this.sprites.has(key);
  }

  register(key: string, sprite: Sprite): void {
    this.sprites.set(key, sprite);
  }

  registerAll(sprites: Record<string, Sprite>): void {
    for (const [key, sprite] of Object.entries(sprites)) this.sprites.set(key, sprite);
  }

  /** Every sprite by key: what an app process gets, since it can't ask synchronously. */
  all(): Record<string, Sprite> {
    return Object.fromEntries(this.sprites);
  }
}
