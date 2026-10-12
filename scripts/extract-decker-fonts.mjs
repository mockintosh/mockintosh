/**
 * Reads `reference/Decker/js/lil.js` FONTS block and writes
 * `scripts/decker-fonts.ts` with embedded %%FNT strings: Decker's drawings,
 * which `import-system-fonts.py` reads for the letters Apple's strikes lack.
 *
 * Usage: node scripts/extract-decker-fonts.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const lilPath = path.join(root, "reference/Decker/js/lil.js");

function readQuotedString(source, startIndex) {
  let i = startIndex;
  if (source[i] !== '"') {
    throw new Error(`Expected string literal at ${startIndex}`);
  }
  i += 1;
  let value = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      value += source[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (ch === '"') {
      return [value, i + 1];
    }
    value += ch;
    i += 1;
  }
  throw new Error("Unterminated string literal");
}

function extractFontData(source, name) {
  const anchor = `${name}:`;
  const start = source.indexOf(anchor);
  if (start < 0) {
    throw new Error(`Could not find built-in Decker font "${name}"`);
  }

  let i = start + anchor.length;
  while (i < source.length && /\s/.test(source[i])) i += 1;

  let combined = "";
  while (i < source.length) {
    const [segment, nextIndex] = readQuotedString(source, i);
    combined += segment;
    i = nextIndex;
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (source[i] !== "+") break;
    i += 1;
    while (i < source.length && /\s/.test(source[i])) i += 1;
  }

  return combined;
}

function tsEscapeDoubleQuoted(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

const lilSource = fs.readFileSync(lilPath, "utf8");
const body = extractFontData(lilSource, "body");
const menu = extractFontData(lilSource, "menu");
const mono = extractFontData(lilSource, "mono");

const out = `// Vendored from Decker \`lil.js\` FONTS block. Regenerate:
//   node scripts/extract-decker-fonts.mjs
export const BUILTIN_FONT_BODY = "${tsEscapeDoubleQuoted(body)}";
export const BUILTIN_FONT_MENU = "${tsEscapeDoubleQuoted(menu)}";
export const BUILTIN_FONT_MONO = "${tsEscapeDoubleQuoted(mono)}";
`;

const outPath = path.join(root, "scripts/decker-fonts.ts");
fs.writeFileSync(outPath, out, "utf8");
console.log(`Wrote ${outPath} (${out.length} bytes)`);
