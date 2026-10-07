import type { Sprite } from "@mockintosh/ui";
import type { CatalogFile, IconFamily, IconGroup } from "./types";
import { familyFromRecord } from "./decode";
import raw from "./system753.json";

/** Dialogs.h `stopIcon` / `noteIcon` / `cautionIcon` — System `ICON` 0 / 1 / 2. */
const ALERT_ICON_ID = { stop: 0, note: 1, caution: 2 } as const;

const file = raw as CatalogFile;

let cached: IconFamily[] | undefined;

/** Every family dumped from the System 7.5.3 image, including update bags. */
export function loadIconCatalog(): IconFamily[] {
  if (!cached) cached = file.families.map(familyFromRecord);
  return cached;
}

/**
 * What the Finder would show after the 7.5.x updates: System IDs overlaid
 * by later update bags, plus Finder, control panels, and bundled apps.
 */
export function shippedIconCatalog(): IconFamily[] {
  const system = new Map<number, IconFamily>();
  const rest: IconFamily[] = [];
  for (const family of loadIconCatalog()) {
    if (family.group === "system") system.set(family.id, family);
    else if (family.group === "update") {
      const prev = system.get(family.id);
      system.set(family.id, {
        ...family,
        source: "System",
        group: "system",
        name: family.name || prev?.name || "",
      });
    } else rest.push(family);
  }
  return [...system.values(), ...rest];
}

export function familyLabel(family: IconFamily): string {
  if (family.name) return family.name;
  return `${family.source} ${family.id}`;
}

/** 32×32 1-bit sprite for a Stop / Note / Caution alert. */
export function alertIcon(variant: keyof typeof ALERT_ICON_ID): Sprite | undefined {
  const id = ALERT_ICON_ID[variant];
  return shippedIconCatalog().find((f) => f.group === "system" && f.id === id)?.icon;
}

export const ICON_GROUP_LABEL: Record<IconGroup, string> = {
  system: "System",
  finder: "Finder",
  update: "Updates",
  cdev: "Control Panels",
  app: "Applications",
  stack: "HyperCard",
};
