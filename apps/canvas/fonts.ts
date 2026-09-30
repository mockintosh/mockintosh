import { defaultFontSize, getFont, listFontSizes, type FontFamilyInfo } from "@mockintosh/ui";

/** The Size menu for a TrueType family, which draws any of them exactly. */
export const SCALABLE_SIZES = [9, 10, 12, 14, 18, 24, 36, 48, 72] as const;

/** Older documents name the system faces by role; the Font menu names families. */
const ROLE_FAMILY: Readonly<Record<string, string>> = { body: "geneva", menu: "chicago", mono: "monaco" };

/** The Font menu entry a text element's font checks. */
export function fontFamilyOf(font: string): string {
  return ROLE_FAMILY[font] ?? font;
}

/** The face to draw `name` with: a family that's no longer installed falls back to Geneva. */
export function drawableFont(name: string): string {
  return getFont(name) ? name : "body";
}

/** Menu and status-bar name for a text element's font. */
export function fontLabel(name: string, families: readonly FontFamilyInfo[]): string {
  const family = fontFamilyOf(name);
  return families.find((f) => f.name === family)?.displayName ?? family;
}

/** Every family, alphabetical, as a Mac Font menu lists them. */
export function fontMenu(families: readonly FontFamilyInfo[]): FontFamilyInfo[] {
  return [...families].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** The size a text element draws at: its own, else the font's default. */
export function effectiveSize(font: string, size: number | undefined): number {
  return size ?? defaultFontSize(drawableFont(font));
}

/**
 * Sizes to offer for `font`: any standard size for a TrueType family, the
 * real bitmap sizes otherwise (a bitmap family snaps to its nearest strike).
 */
export function sizeChoices(font: string, families: readonly FontFamilyInfo[]): number[] {
  const scalable = families.find((f) => f.name === fontFamilyOf(font))?.scalable;
  return scalable ? [...SCALABLE_SIZES] : listFontSizes(drawableFont(font));
}
