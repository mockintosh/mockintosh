#!/usr/bin/env npx tsx
/**
 * Render icons as contact sheets (desktop, selected, application menu, and
 * gridded ×8 copies) and print what looks wrong. Does not modify the repo.
 *
 *   npm run icons:preview -- apps/tank/icons.ts
 *   npm run icons:preview -- --app tank
 *   npm run icons:preview -- --apps
 *
 * A sprite keyed `<key>-16x16` is the hand-drawn small icon of `<key>`.
 */
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import type { Sprite } from "@mockintosh/ui";
import { defineSprite } from "@mockintosh/ui";
import { flagBool, flagString, parseArgs } from "./icons/args";
import { previewRoot, REPO_ROOT } from "./icons/paths";
import { iconIssues, writeIconSheets, type SheetIcon } from "./icons/sheet";
import { iconSprites } from "../src/os/sprites/icons";

const SMALL_SUFFIX = "-16x16";

function usage(): never {
  console.error(`Usage: npm run icons:preview -- <module.ts...> [--out sheet.png]
       npm run icons:preview -- --app <id>
       npm run icons:preview -- --apps

Modules: every exported Sprite or Record<string, Sprite>; "<key>${SMALL_SUFFIX}" pairs with "<key>".
--app / --apps read apps/declarations.generated.json (refresh it with npm run apps:declarations).`);
  process.exit(2);
}

function isSprite(value: unknown): value is Sprite {
  const v = value as Sprite;
  return !!v && typeof v === "object" && typeof v.width === "number" && v.data instanceof Uint8Array;
}

/** A module's sprites by key: record entries first, so an exported const shows under its registry key once. */
async function moduleSprites(path: string): Promise<Map<string, Sprite>> {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as Record<string, unknown>;
  const out = new Map<string, Sprite>();
  const seen = new Set<Sprite>();
  const add = (key: string, sprite: Sprite) => {
    if (seen.has(sprite)) return;
    seen.add(sprite);
    out.set(key, sprite);
  };
  for (const value of Object.values(mod)) {
    if (value && typeof value === "object" && !isSprite(value)) {
      for (const [key, sprite] of Object.entries(value)) if (isSprite(sprite)) add(key, sprite);
    }
  }
  for (const [name, value] of Object.entries(mod)) if (isSprite(value)) add(name, value);
  return out;
}

function isIconSize(sprite: Sprite, size: number): boolean {
  return sprite.width === size && sprite.height === size;
}

/**
 * Pair each 32×32 with its `-16x16` partner; a lone 16×16 gets a row of its
 * own. Other sizes are UI glyphs, not icons, and are left out.
 */
function pairSprites(sprites: Map<string, Sprite>): { icons: SheetIcon[]; skipped: string[] } {
  const icons: SheetIcon[] = [];
  const skipped: string[] = [];
  for (const [key, sprite] of sprites) {
    if (key.endsWith(SMALL_SUFFIX) && sprites.has(key.slice(0, -SMALL_SUFFIX.length))) continue;
    if (isIconSize(sprite, 32)) icons.push({ label: key, large: sprite, small: sprites.get(key + SMALL_SUFFIX) });
    else if (isIconSize(sprite, 16)) icons.push({ label: key, small: sprite });
    else skipped.push(key);
  }
  return { icons, skipped };
}

interface Declaration {
  id: string;
  title: string;
  icon: string;
  smallIcon?: string;
  sprites?: Record<string, { width: number; height: number; data: string }>;
}

function appIcon(decl: Declaration): SheetIcon {
  const lookup = (key: string | undefined): Sprite | undefined => {
    if (!key) return undefined;
    const encoded = decl.sprites?.[key];
    return encoded ? defineSprite(encoded.width, encoded.height, encoded.data) : iconSprites[key];
  };
  return { label: `${decl.title} (${decl.id}): ${decl.icon}`, large: lookup(decl.icon), small: lookup(decl.smallIcon) };
}

function declarations(): Declaration[] {
  const file = join(REPO_ROOT, "apps", "declarations.generated.json");
  return Object.values(JSON.parse(readFileSync(file, "utf8")) as Record<string, Declaration>);
}

async function main(): Promise<void> {
  const { rest, flags } = parseArgs(process.argv.slice(2));
  if (flags.help) usage();

  let icons: SheetIcon[] = [];
  let name: string;
  if (flagBool(flags, "apps")) {
    icons = declarations().map(appIcon);
    name = "apps";
  } else if (flagString(flags, "app")) {
    const id = flagString(flags, "app")!;
    const decl = declarations().find((d) => d.id === id);
    if (!decl) throw new Error(`No app ${JSON.stringify(id)} in apps/declarations.generated.json`);
    icons = [appIcon(decl)];
    name = id;
  } else {
    if (rest.length === 0) usage();
    for (const path of rest) {
      const paired = pairSprites(await moduleSprites(path));
      icons.push(...paired.icons);
      if (paired.skipped.length) console.log(`${path}: not icon-sized, left out: ${paired.skipped.join(", ")}`);
    }
    name = rest.map((p) => p.replace(/\.[jt]sx?$/, "").split("/").slice(-2).join("-")).join("+");
  }
  if (icons.length === 0) throw new Error("No sprites found.");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = flagString(flags, "out") ?? join(previewRoot(), `preview-${name}-${stamp}.png`);
  const pages = await writeIconSheets(icons, out);

  for (const page of pages) console.log(`sheet: ${page}`);
  const issues = icons.flatMap(iconIssues);
  if (issues.length) {
    console.log("");
    for (const issue of issues) console.log(`! ${issue.label}: ${issue.message}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
