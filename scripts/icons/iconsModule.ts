import { readFile, writeFile } from "fs/promises";
import { ICONS_MODULE_PATH } from "./paths";
import type { ConvertedSprite, ConvertMode } from "./types";

const EXPORT_RE = /export const iconSprites: Record<string, Sprite> = \{/;
const ENTRY_RE = /^\s+"([^"]+)": ([A-Z0-9_]+),?\s*$/;

export interface IconModuleEntry {
  key: string;
  constName: string;
}

export function parseIconEntries(source: string): IconModuleEntry[] {
  const start = source.search(EXPORT_RE);
  if (start < 0) throw new Error("icons.ts is missing `export const iconSprites`");
  const body = source.slice(start);
  const entries: IconModuleEntry[] = [];
  for (const line of body.split("\n")) {
    const match = ENTRY_RE.exec(line);
    if (match) entries.push({ key: match[1], constName: match[2] });
  }
  return entries;
}

export function slugKey(name: string, file: string): string {
  const raw = name || file.replace(/\.png$/i, "").split("--").pop() || file;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "icon";
}

export function constNameForKey(key: string): string {
  const leaf = key.replace(/^icon\//, "");
  const ident = leaf.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `ICON_${ident || "ICON"}`;
}

export function uniqueKey(preferred: string, taken: Set<string>): string {
  if (!taken.has(preferred)) return preferred;
  let n = 2;
  while (taken.has(`${preferred}-${n}`)) n++;
  return `${preferred}-${n}`;
}

export function uniqueConst(preferred: string, taken: Set<string>): string {
  if (!taken.has(preferred)) return preferred;
  let n = 2;
  while (taken.has(`${preferred}_${n}`)) n++;
  return `${preferred}_${n}`;
}

export function escapeForTS(b64: string): string {
  return `"${b64}"`;
}

export interface AppendIconOptions {
  key: string;
  constName: string;
  sprite: Pick<ConvertedSprite, "width" | "height" | "b64">;
  sourceFile: string;
  mode: ConvertMode;
  /** The doc comment's source line; defaults to the ryOS path and conversion mode. */
  provenance?: string;
}

export function appendIconSource(source: string, options: AppendIconOptions): string {
  if (!EXPORT_RE.test(source)) {
    throw new Error("icons.ts is missing `export const iconSprites`");
  }
  const entries = parseIconEntries(source);
  if (entries.some((e) => e.key === options.key)) {
    throw new Error(`Sprite key already exists: ${options.key}`);
  }
  if (entries.some((e) => e.constName === options.constName)) {
    throw new Error(`Const name already exists: ${options.constName}`);
  }
  const decl = [
    `/** ${options.provenance ?? `ryos: ${options.sourceFile} · ${options.mode}`} */`,
    `const ${options.constName} = defineSprite(`,
    `  ${options.sprite.width},`,
    `  ${options.sprite.height},`,
    `  ${escapeForTS(options.sprite.b64)}`,
    `);`,
    "",
  ].join("\n");
  const withDecl = source.replace(EXPORT_RE, `${decl}export const iconSprites: Record<string, Sprite> = {`);
  const closing = withDecl.lastIndexOf("};");
  if (closing < 0) throw new Error("icons.ts is missing the iconSprites closing brace");
  const entry = `  "${options.key}": ${options.constName},\n`;
  return withDecl.slice(0, closing) + entry + withDecl.slice(closing);
}

export async function appendIconToModule(
  options: AppendIconOptions,
  path = ICONS_MODULE_PATH
): Promise<void> {
  const source = await readFile(path, "utf8");
  await writeFile(path, appendIconSource(source, options), "utf8");
}
