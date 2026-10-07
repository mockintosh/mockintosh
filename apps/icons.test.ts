/**
 * Every bundled app's icon: a masked 32×32 for the desktop, and a hand-drawn
 * 16×16 `smallIcon` for the application menu. `smallIcon()` can only shrink
 * the 32×32 by majority vote, which turns shading into blotches, so every app
 * declares its own (see `.cursor/skills/classic-mac-icons/SKILL.md`).
 */
import { expect, it } from "vitest";
import type { Sprite } from "@mockintosh/ui";
import { APP_MODULES } from "@/src/appModules";
import { iconSprites } from "@/src/os/sprites/icons";
import AppStore from "@/apps/AppStore";
import IconGallery from "@/apps/IconGallery";

/** Apps whose 32×32 is a full square (no transparent edge). Remove an id when its mask is fixed. */
const UNMASKED = new Set(["dither", "foundry"]);

it("every app has a masked 32×32 icon and a hand-drawn 16×16", async () => {
  const apps = [AppStore, IconGallery];
  for (const load of Object.values(APP_MODULES)) apps.push((await load()).default);

  for (const app of apps) {
    const sprite = (key: string | undefined): Sprite | undefined =>
      key === undefined ? undefined : (app.sprites?.[key] ?? iconSprites[key]);

    const icon = sprite(app.icon);
    expect(icon, `${app.id}: icon "${app.icon}" is not a sprite`).toBeDefined();
    expect([icon!.width, icon!.height], `${app.id}: icon size`).toEqual([32, 32]);
    const transparent = !!icon!.mask?.some((m) => m === 0);
    expect(transparent, `${app.id}: icon has a transparent edge`).toBe(!UNMASKED.has(app.id));

    expect(app.smallIcon, `${app.id}: declare a hand-drawn 16×16 smallIcon`).toBeDefined();
    const small = sprite(app.smallIcon);
    expect(small, `${app.id}: smallIcon "${app.smallIcon}" is not a sprite`).toBeDefined();
    expect([small!.width, small!.height], `${app.id}: smallIcon size`).toEqual([16, 16]);
  }
}, 120_000);
