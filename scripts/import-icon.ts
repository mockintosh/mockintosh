#!/usr/bin/env npx tsx
/**
 * Import one classic Mac icon as defineSprite into src/os/sprites/icons.ts.
 * A System 7.5.3 family brings its 16×16 too, keyed `<key>-16x16`; a ryOS
 * PNG is fetched and thresholded. No PNG is written into the repo.
 *
 *   npm run icons:import -- "system-7.5.3/system/-3993" --key icon/trash
 *   npm run icons:import -- "system-7/system/system-trash-system.png" --key icon/trash
 */
import { readFile } from "fs/promises";
import { encodeSprite, type Sprite } from "@mockintosh/ui";
import { flagString, parseArgs } from "./icons/args";
import { pngBufferToSprite } from "./icons/convert";
import { fetchIconPng } from "./icons/fetchIcon";
import {
  appendIconToModule,
  constNameForKey,
  parseIconEntries,
  slugKey,
  uniqueConst,
  uniqueKey,
} from "./icons/iconsModule";
import { loadCatalog } from "./icons/catalog";
import { ICONS_MODULE_PATH } from "./icons/paths";
import { isSystem753File, system753Family } from "./icons/system753";
import type { IconRecord } from "./icons/types";

function usage(): never {
  console.error(`Usage: npm run icons:import -- <file from icons:find> [--key icon/name] [--from <png-path>]

Writes a defineSprite() into src/os/sprites/icons.ts. Does not add files under public/.`);
  process.exit(2);
}

async function main(): Promise<void> {
  const { rest, flags } = parseArgs(process.argv.slice(2));
  if (rest.length === 0 || flags.help) usage();
  const file = rest.join(" ");

  const existing = parseIconEntries(await readFile(ICONS_MODULE_PATH, "utf8"));
  const takenKeys = new Set(existing.map((e) => e.key));
  const takenConsts = new Set(existing.map((e) => e.constName));

  if (isSystem753File(file)) {
    const found = system753Family(file);
    if (!found) throw new Error(`Unknown System 7.5.3 family ${JSON.stringify(file)}. Run icons:find first.`);
    const { family, large, small } = found;
    const key = uniqueKey(flagString(flags, "key") ?? `icon/${slugKey(family.name, file)}`, takenKeys);
    const from = `System 7.5.3: ${family.source} ${family.name || ""} ${family.id}`.replace(/\s+/g, " ");
    const write = async (spriteKey: string, sprite: Sprite, kind: string) => {
      const constName = uniqueConst(constNameForKey(spriteKey), takenConsts);
      takenConsts.add(constName);
      await appendIconToModule({
        key: spriteKey,
        constName,
        sprite: { width: sprite.width, height: sprite.height, b64: encodeSprite(sprite) },
        sourceFile: file,
        mode: "threshold",
        provenance: `${from} · ${kind}`,
      });
      console.log(`  ${spriteKey}  ${sprite.width}×${sprite.height}  (${constName})`);
    };
    console.log(`Imported ${file} into ${ICONS_MODULE_PATH}`);
    if (large) await write(key, large, family.icn ? "ICN#" : "ICON");
    if (small) await write(large ? `${key}-16x16` : key, small, family.ics ? "ics#" : "SICN");
    if (large && small) console.log(`App icon: icon: "${key}", smallIcon: "${key}-16x16"`);
    else if (large) console.log(`No 16×16 in this family: draw one (.cursor/skills/classic-mac-icons/DRAWING.md).`);
    return;
  }

  const catalog = loadCatalog();
  const record: IconRecord | undefined = catalog.find((icon) => icon.file === file);
  if (!record && !flagString(flags, "from")) {
    throw new Error(
      `Unknown catalog file ${JSON.stringify(file)}. Run icons:find first and pass the exact path.`
    );
  }

  const png = flagString(flags, "from")
    ? await readFile(flagString(flags, "from")!)
    : await fetchIconPng(file);
  const sprite = await pngBufferToSprite(png, "threshold");

  const preferredKey =
    flagString(flags, "key") ?? `icon/${slugKey(record?.name ?? "", file)}`;
  const key = uniqueKey(preferredKey, takenKeys);
  if (key !== preferredKey) {
    console.error(`Key ${preferredKey} is taken; using ${key}`);
  }
  const constName = uniqueConst(constNameForKey(key), takenConsts);

  await appendIconToModule({
    key,
    constName,
    sprite,
    sourceFile: file,
    mode: "threshold",
  });

  console.log(`Imported ${file}`);
  console.log(`  key:   ${key}`);
  console.log(`  const: ${constName}`);
  console.log(`  size:  ${sprite.width}×${sprite.height}`);
  console.log(`  file:  ${ICONS_MODULE_PATH}`);
  console.log(`Use as <image src="${key}"> or os.sprites.get("${key}").`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
