/**
 * Font suitcases: one family in one file, the way a System 7 suitcase held
 * a FOND with its `'NFNT'` strikes and `'sfnt'` outlines.
 *
 * On disk a suitcase is JSON (`.suit`): hand-tuned bitmap strikes as
 * `%%FNT1` records, outlines as base64 TrueType / OpenType bytes, both
 * tagged with their style (1 bold, 2 italic), plus the family's scaler
 * switches. Installing registers everything with the Font Manager.
 */

import { decodeBase64, encodeBase64 } from "../base64";
import type { FamilyScalerSettings } from "./outlineStrike";
import { familyKey, registerFont, registerOutlineFace, registerStyledStrike } from "./registry";
import { OutlineFace } from "./truetype/scaler";

const SUITCASE_FORMAT = "mockintosh-suitcase";

/** Style bits in a suitcase: the Font Manager's plain / bold / italic faces. */
export const SUITCASE_BOLD = 1;
export const SUITCASE_ITALIC = 2;

export interface SuitcaseStrike {
  size: number;
  /** 0 plain, 1 bold, 2 italic, 3 bold italic. */
  style: number;
  /** `%%FNT1` record. */
  data: string;
}

export interface SuitcaseOutline {
  style: number;
  /** TrueType / OpenType bytes. */
  bytes: Uint8Array;
}

export interface FontSuitcase {
  /** Name shown in font menus. */
  family: string;
  strikes: SuitcaseStrike[];
  outlines: SuitcaseOutline[];
  settings?: Partial<Pick<FamilyScalerSettings, "kerning" | "hint" | "dropout" | "preserveGlyph" | "preferOutline">>;
}

interface SuitcaseJson {
  format: typeof SUITCASE_FORMAT;
  version: 1;
  family: string;
  strikes: SuitcaseStrike[];
  outlines: { style: number; data: string }[];
  settings?: FontSuitcase["settings"];
}

export function encodeSuitcase(suitcase: FontSuitcase): string {
  const json: SuitcaseJson = {
    format: SUITCASE_FORMAT,
    version: 1,
    family: suitcase.family,
    strikes: [...suitcase.strikes].sort((a, b) => a.style - b.style || a.size - b.size),
    outlines: suitcase.outlines.map((o) => ({ style: o.style, data: encodeBase64(o.bytes) })),
    ...(suitcase.settings ? { settings: suitcase.settings } : {}),
  };
  return JSON.stringify(json, null, 1) + "\n";
}

export function decodeSuitcase(text: string): FontSuitcase {
  let json: Partial<SuitcaseJson>;
  try {
    json = JSON.parse(text) as Partial<SuitcaseJson>;
  } catch {
    throw new Error("This suitcase is damaged.");
  }
  if (json.format !== SUITCASE_FORMAT || typeof json.family !== "string") {
    throw new Error("This isn't a font suitcase.");
  }
  const strikes = (json.strikes ?? []).filter(
    (s) => typeof s?.data === "string" && s.data.startsWith("%%FNT") && Number.isFinite(s.size),
  );
  const outlines = (json.outlines ?? [])
    .filter((o) => typeof o?.data === "string")
    .map((o) => ({ style: (o.style | 0) & 3, bytes: decodeBase64(o.data) }));
  return { family: json.family, strikes, outlines, settings: json.settings };
}

/** Registry key a suitcase installs under. */
export function suitcaseKey(suitcase: FontSuitcase): string {
  return familyKey(suitcase.family);
}

/**
 * Register a suitcase's faces with the Font Manager; returns its family key.
 * An outline that can't be read throws before anything is registered.
 */
export function installSuitcase(suitcase: FontSuitcase): string {
  const family = suitcaseKey(suitcase);
  const faces = suitcase.outlines.map((o) => ({ style: o.style, face: new OutlineFace(o.bytes) }));
  for (const { style, face } of faces) {
    registerOutlineFace(face, {
      family,
      bold: (style & SUITCASE_BOLD) !== 0,
      italic: (style & SUITCASE_ITALIC) !== 0,
      settings: suitcase.settings,
    });
  }
  for (const strike of suitcase.strikes) {
    if (strike.style) registerStyledStrike(family, strike.size, strike.data, strike.style & 3);
    else registerFont(family, strike.data, strike.size);
  }
  return family;
}

/** Style bits a loose font file claims for itself (`OS/2` / `head`). */
export function outlineStyleOf(face: OutlineFace): number {
  return (face.font.bold ? SUITCASE_BOLD : 0) | (face.font.italic ? SUITCASE_ITALIC : 0);
}
