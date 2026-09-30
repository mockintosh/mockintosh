import { BUILTIN_FONT_BODY, BUILTIN_FONT_MENU, BUILTIN_FONT_MONO } from "./data";
import { BUILTIN_FONT_BODY_BOLD } from "./faces/bodyBold";
import { BUILTIN_FONT_GENEVA_12 } from "./faces/geneva12";
import { BUILTIN_FONT_GENEVA_12_BOLD } from "./faces/genevaTwelveBold";
import { BUILTIN_FONT_LISA } from "./faces/lisa";
import { BUILTIN_FONT_PIXEL } from "./faces/pixel";
import * as R from "./faces/redaction";
import { BUILTIN_FONT_JISKAN_16, BUILTIN_FONT_JISKAN_16_INFO } from "./faces/jiskan";
import { CITY_GENERATED } from "./faces/city/generated";

export interface FontFamilyInfo {
  name: string;
  defaultSize: number;
  /** Bitmap strike sizes (the ones a size menu shows outlined). */
  sizes: readonly number[];
  /** Ships with the system (not installed from the Fonts folder or at run time). */
  builtIn?: boolean;
  /** Has an outline: any size draws without bitmap scaling. */
  scalable?: boolean;
  /** Name for menus (`name` is the registry key): the font's own family name for outlines. */
  displayName: string;
}

export interface FontStrikeSpec {
  family: string;
  size: number;
  /** Styled face this strike draws (1 bold, 2 italic); plain when absent. */
  style?: 1 | 2;
  /** `%%FNT1` block, or a loader for a large strike fetched on first use. */
  data: string | (() => Promise<string>);
  info?: { ascent: number; descent: number; leading: number };
  /**
   * Ordinal → [advance, originX] for glyphs whose ink overhangs their
   * advance (`%%FNT1` stores one width per glyph, used as the cell).
   */
  overhangs?: Readonly<Record<number, readonly [number, number]>>;
}

/** Role names keep existing `<text font="body">` call sites. */
export const ROLE_ALIASES: Readonly<Record<string, { family: string; size: number }>> = {
  body: { family: "geneva", size: 9 },
  menu: { family: "chicago", size: 12 },
  mono: { family: "monaco", size: 9 },
  geneva12: { family: "geneva", size: 12 },
};

/** Baked FM smears — resolvable by the old name, not listed as families. */
export const BAKED_STYLE_ALIASES: Readonly<Record<string, { family: string; size: number; data: string }>> = {
  bodyBold: { family: "geneva", size: 9, data: BUILTIN_FONT_BODY_BOLD },
  geneva12Bold: { family: "geneva", size: 12, data: BUILTIN_FONT_GENEVA_12_BOLD },
};

export const FAMILY_DEFAULTS: Readonly<Record<string, number>> = {
  chicago: 12,
  geneva: 9,
  monaco: 9,
  newYork: 12,
  venice: 14,
  london: 18,
  athens: 18,
  sanFrancisco: 18,
  toronto: 12,
  cairo: 18,
  losAngeles: 12,
  lisa: 12,
  pixel: 24,
  redaction: 20,
  jiskan: 16,
};

/** Menu names for built-in families whose key isn't just the name lowercased. */
const BUILTIN_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  newYork: "New York",
  sanFrancisco: "San Francisco",
  losAngeles: "Los Angeles",
  pixel: "Geist Pixel",
};

/** How a menu shows a family key: `newYork` → "New York", `futura` → "Futura". */
export function familyDisplayName(key: string): string {
  return BUILTIN_DISPLAY_NAMES[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

export const CITY_FAMILY_ORDER = [
  "chicago",
  "geneva",
  "newYork",
  "monaco",
  "venice",
  "london",
  "athens",
  "sanFrancisco",
  "toronto",
  "cairo",
  "losAngeles",
] as const;

type RedactionSize = 10 | 14 | 20 | 29 | 50 | 100;
const REDACTION_SIZES: readonly RedactionSize[] = [10, 14, 20, 29, 50, 100];

/** Redaction's bitmaps by size: Regular 10–29 are bundled, the rest load on first use. */
const REDACTION_DATA: Readonly<Record<RedactionSize, FontStrikeSpec["data"]>> = {
  10: R.BUILTIN_FONT_REDACTION_10,
  14: R.BUILTIN_FONT_REDACTION_14,
  20: R.BUILTIN_FONT_REDACTION_20,
  29: R.BUILTIN_FONT_REDACTION_29,
  50: () => import("./faces/redaction50").then((m) => m.BUILTIN_FONT_REDACTION_50),
  100: () => import("./faces/redaction100").then((m) => m.BUILTIN_FONT_REDACTION_100),
};
const REDACTION_BOLD_DATA: Readonly<Record<RedactionSize, FontStrikeSpec["data"]>> = {
  10: () => import("./faces/redactionBold").then((m) => m.BUILTIN_FONT_REDACTION_BOLD_10),
  14: () => import("./faces/redactionBold").then((m) => m.BUILTIN_FONT_REDACTION_BOLD_14),
  20: () => import("./faces/redactionBold").then((m) => m.BUILTIN_FONT_REDACTION_BOLD_20),
  29: () => import("./faces/redactionBold").then((m) => m.BUILTIN_FONT_REDACTION_BOLD_29),
  50: () => import("./faces/redactionBold50").then((m) => m.BUILTIN_FONT_REDACTION_BOLD_50),
  100: () => import("./faces/redactionBold100").then((m) => m.BUILTIN_FONT_REDACTION_BOLD_100),
};
const REDACTION_ITALIC_DATA: Readonly<Record<RedactionSize, FontStrikeSpec["data"]>> = {
  10: () => import("./faces/redactionItalic").then((m) => m.BUILTIN_FONT_REDACTION_ITALIC_10),
  14: () => import("./faces/redactionItalic").then((m) => m.BUILTIN_FONT_REDACTION_ITALIC_14),
  20: () => import("./faces/redactionItalic").then((m) => m.BUILTIN_FONT_REDACTION_ITALIC_20),
  29: () => import("./faces/redactionItalic").then((m) => m.BUILTIN_FONT_REDACTION_ITALIC_29),
  50: () => import("./faces/redactionItalic50").then((m) => m.BUILTIN_FONT_REDACTION_ITALIC_50),
  100: () => import("./faces/redactionItalic100").then((m) => m.BUILTIN_FONT_REDACTION_ITALIC_100),
};

/** Redaction's pixel cuts (100, 70, 50, 35, 20, 10), each at the size where its grid is one pixel. */
const REDACTION_STRIKES: readonly FontStrikeSpec[] = REDACTION_SIZES.flatMap((size): FontStrikeSpec[] => [
  {
    family: "redaction",
    size,
    data: REDACTION_DATA[size],
    info: R[`BUILTIN_FONT_REDACTION_${size}_INFO`],
    overhangs: R[`BUILTIN_FONT_REDACTION_${size}_OVERHANGS`],
  },
  {
    family: "redaction",
    size,
    style: 1,
    data: REDACTION_BOLD_DATA[size],
    info: R[`BUILTIN_FONT_REDACTION_BOLD_${size}_INFO`],
    overhangs: R[`BUILTIN_FONT_REDACTION_BOLD_${size}_OVERHANGS`],
  },
  {
    family: "redaction",
    size,
    style: 2,
    data: REDACTION_ITALIC_DATA[size],
    info: R[`BUILTIN_FONT_REDACTION_ITALIC_${size}_INFO`],
    overhangs: R[`BUILTIN_FONT_REDACTION_ITALIC_${size}_OVERHANGS`],
  },
]);

const VENDORED_STRIKES: readonly FontStrikeSpec[] = [
  { family: "chicago", size: 12, data: BUILTIN_FONT_MENU, info: { ascent: 12, descent: 3, leading: 0 } },
  { family: "geneva", size: 9, data: BUILTIN_FONT_BODY, info: { ascent: 10, descent: 2, leading: 0 } },
  { family: "geneva", size: 12, data: BUILTIN_FONT_GENEVA_12, info: { ascent: 12, descent: 3, leading: 1 } },
  { family: "monaco", size: 9, data: BUILTIN_FONT_MONO, info: { ascent: 9, descent: 2, leading: 0 } },
  { family: "lisa", size: 12, data: BUILTIN_FONT_LISA, info: { ascent: 10, descent: 2, leading: 0 } },
  { family: "pixel", size: 24, data: BUILTIN_FONT_PIXEL },
  ...REDACTION_STRIKES,
  { family: "jiskan", size: 16, data: BUILTIN_FONT_JISKAN_16, info: BUILTIN_FONT_JISKAN_16_INFO },
];

export const BUILTIN_STRIKES: readonly FontStrikeSpec[] = [...VENDORED_STRIKES, ...CITY_GENERATED];

export const LISTED_FONT_NAMES: readonly string[] = [
  "body",
  "menu",
  "mono",
  ...CITY_FAMILY_ORDER,
  "lisa",
  "pixel",
  "redaction",
  "jiskan",
];
