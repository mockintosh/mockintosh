import { BUILTIN_FONT_BODY_BOLD } from "./faces/bodyBold";
import { BUILTIN_FONT_GENEVA_12_BOLD } from "./faces/genevaTwelveBold";
import { CITY_GENERATED } from "./faces/city/generated";
import { SYSTEM_STRIKES } from "./faces/system/generated";

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
  /** Font record (`%%MFN1`, or a Decker `%%FNT1`). */
  data: string;
  info?: { ascent: number; descent: number; leading: number };
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
};

/** Menu names for built-in families whose key isn't just the name lowercased. */
const BUILTIN_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  newYork: "New York",
  sanFrancisco: "San Francisco",
  losAngeles: "Los Angeles",
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

/** Chicago, Geneva, Monaco and New York from System 7.5.3; the other city fonts from System 6.0.8. */
export const BUILTIN_STRIKES: readonly FontStrikeSpec[] = [...SYSTEM_STRIKES, ...CITY_GENERATED];

export const LISTED_FONT_NAMES: readonly string[] = [
  "body",
  "menu",
  "mono",
  ...CITY_FAMILY_ORDER,
];
