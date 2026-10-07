/**
 * The System 7.5.3 icon families the Icon Gallery app shows, as search
 * records. Unlike the ryOS catalog these are local and come as families, so a
 * hit carries its original `ICN#` and, for many, the hand-drawn `ics#` that
 * Apple drew to go with it.
 */
import type { Sprite } from "@mockintosh/ui";
import { familyLabel, shippedIconCatalog } from "../../src/os/iconCatalog/catalog";
import { familyMembers } from "../../src/os/iconCatalog/decode";
import type { IconFamily } from "../../src/os/iconCatalog/types";
import type { IconRecord } from "./types";

export const SYSTEM753_COLLECTION = "system-7.5.3";

export interface FamilySprites {
  family: IconFamily;
  /** `ICN#`, else the unmasked `ICON`. */
  large?: Sprite;
  /** `ics#`, else the first `SICN` frame. */
  small?: Sprite;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function familyFile(family: IconFamily): string {
  return `${SYSTEM753_COLLECTION}/${slug(family.source)}/${family.id}`;
}

export function familySprites(family: IconFamily): FamilySprites {
  return { family, large: family.icn ?? family.icon, small: family.ics ?? family.sicn?.[0] };
}

let byFile: Map<string, FamilySprites> | undefined;

function families(): Map<string, FamilySprites> {
  if (!byFile) {
    byFile = new Map();
    for (const family of shippedIconCatalog()) {
      const sprites = familySprites(family);
      if (sprites.large || sprites.small) byFile.set(familyFile(family), sprites);
    }
  }
  return byFile;
}

export function isSystem753File(file: string): boolean {
  return file.startsWith(`${SYSTEM753_COLLECTION}/`);
}

export function system753Family(file: string): FamilySprites | undefined {
  return families().get(file);
}

/** Every shipped family with a 1-bit member, as a search record. */
export function system753Records(): IconRecord[] {
  return [...families().entries()].map(([file, { family, large, small }]) => {
    const kinds = familyMembers(family)
      .filter((m) => m.depth === "1-bit")
      .map((m) => m.kind);
    const sizes = [large && "32x32", small && "16x16"].filter(Boolean) as string[];
    return {
      file,
      name: familyLabel(family),
      collection: SYSTEM753_COLLECTION,
      category: family.group,
      themes: [...new Set(kinds)],
      vibes: large && small ? ["pair"] : [],
      description: `${family.source} ${[...new Set(kinds)].join(" ")} ${family.id} (${sizes.join(" + ")})`,
    };
  });
}
