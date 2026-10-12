/**
 * Where a character lives in a strike.
 *
 * A strike holds 256 glyphs, like an `'NFNT'`. Page 0 is Mac OS Roman, the
 * encoding System 6 and 7 drew Roman text in: ASCII, then Apple's upper 128
 * (™ at 0xAA, • at 0xA5, the Apple logo at 0xF0). Chicago's menu symbols
 * sit in the control range where Apple put them (⌘ 0x11, ✓ 0x12), and
 * `MISSING_SLOT` holds the font's missing-character glyph, which QuickDraw
 * keeps at `lastChar + 1`.
 *
 * Every other character lives on a page strike of the same face: page
 * `(codePoint >> 8) + 1`, slot `codePoint & 0xff`.
 */

/** Mac OS Roman 0x80–0xFF, as the System 7 fonts draw it (0xDB is ¤, not €). */
const MAC_ROMAN_HIGH =
  "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü" +
  "†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø" +
  "¿¡¬√ƒ≈∆«»…\u00A0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄¤‹›ﬁﬂ" +
  "‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

/** Glyph slot QuickDraw draws for a character the strike lacks. */
export const MISSING_SLOT = 0;

/** Menu symbols in the control range (Chicago's own ⌘ ✓ ◆; ⇧ ⌥ are Mockintosh's). */
const CONTROL_SYMBOLS: readonly (readonly [number, number])[] = [
  [0x11, 0x2318],
  [0x12, 0x2713],
  [0x13, 0x25c6],
  [0x15, 0x21e7],
  [0x16, 0x2325],
];

const SLOT_CODE_POINTS = new Int32Array(256).fill(-1);
const CODE_POINT_SLOTS = new Map<number, number>();

function assign(slot: number, codePoint: number): void {
  SLOT_CODE_POINTS[slot] = codePoint;
  CODE_POINT_SLOTS.set(codePoint, slot);
}

assign(10, 10);
for (let code = 32; code <= 126; code++) assign(code, code);
for (let i = 0; i < MAC_ROMAN_HIGH.length; i++) assign(0x80 + i, MAC_ROMAN_HIGH.charCodeAt(i));
for (const [slot, codePoint] of CONTROL_SYMBOLS) assign(slot, codePoint);

/** Page-0 slot for a code point, or -1 when it lives on a page strike. */
export function slotForCodePoint(codePoint: number): number {
  return CODE_POINT_SLOTS.get(codePoint) ?? -1;
}

/** The code point a page-0 slot draws, or undefined for an empty slot. */
export function codePointForSlot(slot: number): number | undefined {
  const codePoint = SLOT_CODE_POINTS[slot] ?? -1;
  return codePoint < 0 ? undefined : codePoint;
}

/** The character a page-0 slot draws (see {@link codePointForSlot}). */
export function charForSlot(slot: number): string | undefined {
  const codePoint = codePointForSlot(slot);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

/** Page strike holding a code point that has no page-0 slot. */
export function pageOfCodePoint(codePoint: number): number {
  return (codePoint >> 8) + 1;
}

/** The code point at `slot` of page strike `page` (page > 0). */
export function codePointOnPage(page: number, slot: number): number {
  return ((page - 1) << 8) | slot;
}

/** Page and slot that draw `codePoint`. */
export function placeCodePoint(codePoint: number): { page: number; slot: number } {
  const slot = slotForCodePoint(codePoint);
  if (slot >= 0) return { page: 0, slot };
  return { page: pageOfCodePoint(codePoint), slot: codePoint & 0xff };
}

/** Mac OS Roman's printable characters plus the menu symbols: the charset an importer walks by default. */
export function macRomanCharset(): string {
  let chars = "";
  for (let slot = 0; slot < 256; slot++) {
    const codePoint = SLOT_CODE_POINTS[slot]!;
    if (codePoint > 10) chars += String.fromCodePoint(codePoint);
  }
  return chars;
}
