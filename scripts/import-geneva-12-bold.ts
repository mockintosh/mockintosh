/**
 * Bake Font Manager bold of System 7.5.3 Geneva 12 (`geneva12`).
 *
 * Apple shipped no intrinsic Geneva Bold strike; Bold is this 1px smear.
 *
 * Usage: npx tsx scripts/import-geneva-12-bold.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { smearDeckerFontBold } from "../packages/ui/src/fonts/boldSmear";
import { decodeFont, encodeFont } from "../packages/ui/src/fonts/codec";
import { BUILTIN_FONT_GENEVA_12 } from "../packages/ui/src/fonts/faces/geneva12";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "packages/ui/src/fonts/faces/genevaTwelveBold.ts");

const bold = smearDeckerFontBold(
  decodeFont(BUILTIN_FONT_GENEVA_12, "geneva12"),
  "geneva12Bold",
);
const record = encodeFont(bold);
const escaped = record.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

writeFileSync(
  outPath,
  `// Generated from FONT 396 (Geneva 12) + Font Manager bold smear. Do not hand-edit.
//   npx tsx scripts/import-geneva-12-bold.ts
// Apple shipped no intrinsic Geneva Bold strike; this is Bold on geneva12.
//
// Cell ${bold.maxWidth}×${bold.glyphHeight}, spacing ${bold.spacing}.
export const BUILTIN_FONT_GENEVA_12_BOLD = "${escaped}";
`,
  "utf8",
);

const count = bold.glyphWidths.reduce((n, w) => n + (w > 0 ? 1 : 0), 0);
console.log(
  `Wrote ${outPath} — ${count} glyphs, ${bold.maxWidth}×${bold.glyphHeight} cell`,
);
