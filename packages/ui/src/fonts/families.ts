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

export const FAMILY_DEFAULTS: Readonly<Record<string, number>> = {
  chicane: 12,
  genova: 9,
  monoco: 9,
  newark: 12,
  vence: 14,
  londinium: 18,
  athene: 18,
  sanfrisco: 18,
  taranto: 12,
  kairos: 18,
  losalamos: 12,
};

/**
 * Apple's names for the built-in families (trademarks, so the families go by
 * other names) → registry key. Documents saved under the old keys still open.
 */
export const FORMER_FAMILY_NAMES: Readonly<Record<string, string>> = {
  chicago: "chicane",
  geneva: "genova",
  monaco: "monoco",
  newYork: "newark",
  venice: "vence",
  london: "londinium",
  athens: "athene",
  sanFrancisco: "sanfrisco",
  toronto: "taranto",
  cairo: "kairos",
  losAngeles: "losalamos",
};

/** Role names keep existing `<text font="body">` call sites. */
export const ROLE_ALIASES: Readonly<Record<string, { family: string; size: number }>> = {
  body: { family: "genova", size: 9 },
  menu: { family: "chicane", size: 12 },
  mono: { family: "monoco", size: 9 },
  genova12: { family: "genova", size: 12 },
  // The Apple names these families shipped under before they were renamed.
  ...Object.fromEntries(
    Object.entries(FORMER_FAMILY_NAMES).map(([old, family]) => [old, { family, size: FAMILY_DEFAULTS[family]! }]),
  ),
};

/** Baked FM smears — resolvable by the old name, not listed as families. */
export const BAKED_STYLE_ALIASES: Readonly<Record<string, { family: string; size: number; data: string }>> = {
  bodyBold: { family: "genova", size: 9, data: BUILTIN_FONT_BODY_BOLD },
  genova12Bold: { family: "genova", size: 12, data: BUILTIN_FONT_GENEVA_12_BOLD },
};

/** Menu names for built-in families whose key isn't just the name lowercased. */
const BUILTIN_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  losalamos: "Los Alamos",
};

/** How a menu shows a family key: `losalamos` → "Los Alamos", `futura` → "Futura". */
export function familyDisplayName(key: string): string {
  return BUILTIN_DISPLAY_NAMES[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

export const CITY_FAMILY_ORDER = [
  "chicane",
  "genova",
  "newark",
  "monoco",
  "vence",
  "londinium",
  "athene",
  "sanfrisco",
  "taranto",
  "kairos",
  "losalamos",
] as const;

/** Chicago, Geneva, Monaco and New York from System 7.5.3; the other city fonts from System 6.0.8. */
export const BUILTIN_STRIKES: readonly FontStrikeSpec[] = [...SYSTEM_STRIKES, ...CITY_GENERATED];

export const LISTED_FONT_NAMES: readonly string[] = [
  "body",
  "menu",
  "mono",
  ...CITY_FAMILY_ORDER,
];
