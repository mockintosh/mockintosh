#!/usr/bin/env npx tsx
/**
 * List files under public/ that nothing in the repo mentions. Knip can't do
 * this: it only tracks JS/TS modules, and public/ files are fetched by URL
 * string, never imported. Does not modify the repo.
 *
 *   npm run assets:unused
 *
 * A file counts as used when its path under public/ or its file name appears
 * in any tracked text file. Mentions from inside public/ (a .fnt naming its
 * .png page) only count once the mentioning file is itself used. Names built
 * at runtime (`"/convert-sprites/" + name + ".png"`) can't be seen, so a file
 * whose bare stem appears as a quoted string is listed as "maybe" instead.
 */
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { basename, extname, join } from "path";

const ROOT = join(import.meta.dirname!, "..");
const PUBLIC = "public/";
const SKIP = new Set(["package-lock.json", "scripts/find-unused-assets.ts"]);

interface Asset {
  path: string;
  needles: string[];
  stem: string;
}

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

function readText(path: string): string | undefined {
  const bytes = readFileSync(join(ROOT, path));
  if (bytes.subarray(0, 8000).includes(0)) return undefined;
  return bytes.toString("utf8");
}

function mentions(text: string, asset: Asset): boolean {
  return asset.needles.some((needle) => text.includes(needle));
}

function quotesStem(text: string, stem: string): boolean {
  return ['"', "'", "`"].some((q) => text.includes(q + stem + q));
}

function main(): void {
  const files = trackedFiles().filter((file) => !SKIP.has(file));
  const assets: Asset[] = files
    .filter((file) => file.startsWith(PUBLIC))
    .map((file) => {
      const path = file.slice(PUBLIC.length);
      const name = basename(path);
      return { path, needles: [...new Set([path, name])], stem: basename(name, extname(name)) };
    });

  const texts = new Map<string, string>();
  for (const file of files) {
    const text = readText(file);
    if (text !== undefined) texts.set(file, text);
  }
  const outside = [...texts].filter(([file]) => !file.startsWith(PUBLIC));

  const used = new Set<string>();
  for (const asset of assets) {
    if (outside.some(([, text]) => mentions(text, asset))) used.add(asset.path);
  }
  // Follow mentions between public/ files until nothing new is reached.
  for (let grew = true; grew; ) {
    grew = false;
    for (const asset of assets) {
      if (used.has(asset.path)) continue;
      const reached = [...used].some((path) => {
        const text = texts.get(PUBLIC + path);
        return text !== undefined && mentions(text, asset);
      });
      if (reached) {
        used.add(asset.path);
        grew = true;
      }
    }
  }

  const unused: string[] = [];
  const maybe: string[] = [];
  for (const asset of assets) {
    if (used.has(asset.path)) continue;
    const where = outside.filter(([, text]) => quotesStem(text, asset.stem)).map(([file]) => file);
    if (where.length === 0) unused.push(asset.path);
    else maybe.push(`${asset.path}  ("${asset.stem}" in ${where.slice(0, 3).join(", ")}${where.length > 3 ? ", …" : ""})`);
  }

  console.log(`${assets.length} files in public/, ${used.size} mentioned by path or name.\n`);
  console.log(`Unreferenced (${unused.length}):`);
  for (const path of unused) console.log(`  ${path}`);
  console.log(`\nMaybe built at runtime — the bare name appears as a string (${maybe.length}):`);
  for (const line of maybe) console.log(`  ${line}`);
}

main();
