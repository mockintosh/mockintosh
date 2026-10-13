/**
 * Bake Font Manager bold of System 7.5.3 Geneva 9 (`body`) and Geneva 12
 * (`geneva12`) as their own faces, `bodyBold` and `geneva12Bold`.
 *
 * Apple's System FONDs only list plain Geneva 9/12. Bold on the original Mac
 * is this 1px smear — not a separate designed strike.
 *
 * Usage: npx tsx scripts/import-geneva-bold.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { smearBitmapFaceBold } from "../packages/ui/src/fonts/boldSmear";
import { decodeFont, encodeFont } from "../packages/ui/src/fonts/codec";
import type { BitmapFace } from "../packages/ui/src/fonts/font";
import { SYSTEM_FONT_GENEVA_9 } from "../packages/ui/src/fonts/faces/system/geneva_9";
import { SYSTEM_FONT_GENEVA_12 } from "../packages/ui/src/fonts/faces/system/geneva_12";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Smear a face and every page strike it carries. */
function smearFace(face: BitmapFace, name: string): BitmapFace {
  const bold = smearBitmapFaceBold(face, name);
  if (face.pages) bold.pages = new Map([...face.pages].map(([page, strike]) => [page, smearBitmapFaceBold(strike, name)]));
  return bold;
}

function bake(source: string, size: number, name: string, constName: string, file: string, from: string): void {
  const bold = smearFace(decodeFont(source, "geneva", { size }), name);
  const record = encodeFont(bold);
  const outPath = resolve(root, "packages/ui/src/fonts/faces", file);
  writeFileSync(
    outPath,
    `// Generated from System 7.5.3 ${from} + Font Manager bold smear. Do not hand-edit.
//   npx tsx scripts/import-geneva-bold.ts
// Apple shipped no intrinsic Geneva Bold strike; this is Bold on ${name.replace("Bold", "")}.
export const ${constName} = "${record}";
`,
    "utf8",
  );
  console.log(`Wrote ${outPath}`);
}

bake(SYSTEM_FONT_GENEVA_9, 9, "bodyBold", "BUILTIN_FONT_BODY_BOLD", "bodyBold.ts", "FONT 393 (Geneva 9)");
bake(SYSTEM_FONT_GENEVA_12, 12, "geneva12Bold", "BUILTIN_FONT_GENEVA_12_BOLD", "genevaTwelveBold.ts", "FONT 396 (Geneva 12)");
