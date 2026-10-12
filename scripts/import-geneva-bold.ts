/**
 * Bake Font Manager bold of Decker Geneva 9 (`body`) into a %%FNT1 face.
 *
 * Apple's System FONDs only list plain Geneva 9/12. Bold on the original Mac
 * is this 1px smear — not a separate designed strike.
 *
 * Usage: npx tsx scripts/import-geneva-bold.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { smearDeckerFontBold } from "../packages/ui/src/fonts/boldSmear";
import { decodeFont, encodeFont } from "../packages/ui/src/fonts/codec";
import { BUILTIN_FONT_BODY } from "../packages/ui/src/fonts/data";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "packages/ui/src/fonts/faces/bodyBold.ts");

const bold = smearDeckerFontBold(decodeFont(BUILTIN_FONT_BODY, "body"), "bodyBold");
const record = encodeFont(bold);
const escaped = record.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

writeFileSync(
  outPath,
  `// Generated from Decker Geneva 9 + Font Manager bold smear. Do not hand-edit.
//   npx tsx scripts/import-geneva-bold.ts
// Apple shipped no intrinsic Geneva Bold strike; this is Bold on body.
//
// Cell ${bold.maxWidth}×${bold.glyphHeight}, spacing ${bold.spacing}.
export const BUILTIN_FONT_BODY_BOLD = "${escaped}";
`,
  "utf8",
);

const count = bold.glyphWidths.reduce((n, w) => n + (w > 0 ? 1 : 0), 0);
console.log(
  `Wrote ${outPath} — ${count} glyphs, ${bold.maxWidth}×${bold.glyphHeight} cell`,
);
