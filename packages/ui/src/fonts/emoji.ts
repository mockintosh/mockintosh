/**
 * The Emoji family: black-and-white emoji every face falls back to.
 *
 * Its strikes are baked from Noto Emoji (`scripts/build-emoji-font.ts`),
 * one per cell height, and load in their own chunk the first time text
 * needs one: until then emoji draw as missing boxes, and loading
 * them fires `onFontsChanged`, so text lays out again. A face draws an
 * emoji from the largest strike that fits its cell, bottom-aligned, as
 * a text face's own glyphs are.
 *
 * Sequences (👨‍👩‍👧, 🇸🇪, 1️⃣) are looked up whole in `EMOJI_SEQUENCES`,
 * without variation selectors; each names the code point that draws it.
 */

import type { BitmapFace } from "./font";
import { getFont, registerHiddenStrikes } from "./registry";

export const EMOJI_FAMILY = "emoji";

let sizes: readonly number[] = [];
let sequences: Map<string, number> | undefined;
let loading: Promise<void> | undefined;

/**
 * Load the Emoji family's strikes and sequences (once). Resolves when emoji
 * draw; text measured before then is laid out again via `onFontsChanged`.
 */
export function loadEmoji(): Promise<void> {
  loading ??= import("./faces/emoji/generated").then(({ EMOJI_STRIKES, EMOJI_SEQUENCES }) => {
    const table = new Map<string, number>();
    for (const line of EMOJI_SEQUENCES.split("\n")) {
      const tab = line.indexOf("\t");
      table.set(line.slice(0, tab), parseInt(line.slice(tab + 1), 16));
    }
    sequences = table;
    sizes = EMOJI_STRIKES.map((strike) => strike.size).sort((a, b) => a - b);
    registerHiddenStrikes(EMOJI_FAMILY, EMOJI_STRIKES);
  });
  return loading;
}

/** The code point that draws an emoji sequence (variation selectors removed), if the family has it. */
export function emojiSequence(key: string): number | undefined {
  return sequences?.get(key);
}

const faceForCell = new Map<number, BitmapFace | null>();

/** The Emoji strike for a face whose cell is `cellHeight` rows: the largest that fits. */
export function emojiFace(cellHeight: number): BitmapFace | undefined {
  if (!sizes.length) {
    if (!loading) loadEmoji().catch((error: unknown) => console.warn("Emoji: couldn't load the strikes", error));
    return undefined;
  }
  let face = faceForCell.get(cellHeight);
  if (face === undefined) {
    let size = sizes[0]!;
    for (const s of sizes) if (s <= cellHeight) size = s;
    face = getFont(EMOJI_FAMILY, size);
    faceForCell.set(cellHeight, face);
  }
  return face ?? undefined;
}
