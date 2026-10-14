/**
 * The Emoji family: black-and-white emoji every face falls back to.
 *
 * Its strikes are baked from Noto Emoji (`scripts/build-emoji-font.ts`),
 * one per cell height, each a chunk of its own: a strike loads the first
 * time text needs an emoji at that size, with the sequence table. Until
 * then those emoji draw as missing boxes, and loading fires
 * `onFontsChanged`, so text lays out again. A face draws an emoji from the
 * largest strike that fits its cell, bottom-aligned, as a text face's own
 * glyphs are.
 *
 * Sequences (👨‍👩‍👧, 🇸🇪, 1️⃣) are looked up whole in `EMOJI_SEQUENCES`,
 * without variation selectors; each names the code point that draws it.
 */

import { EMOJI_STRIKES, loadEmojiSequences } from "./faces/emoji/generated";
import type { BitmapFace } from "./font";
import { getFont, registerHiddenStrikes } from "./registry";

export const EMOJI_FAMILY = "emoji";

const SIZES = Object.keys(EMOJI_STRIKES)
  .map(Number)
  .sort((a, b) => a - b);

let sequences: Map<string, number> | undefined;
let sequencesLoading: Promise<void> | undefined;
const loaded = new Set<number>();
const loading = new Map<number, Promise<void>>();

function loadSequences(): Promise<void> {
  sequencesLoading ??= loadEmojiSequences().then((packed) => {
    const table = new Map<string, number>();
    for (const line of packed.split("\n")) {
      const tab = line.indexOf("\t");
      table.set(line.slice(0, tab), parseInt(line.slice(tab + 1), 16));
    }
    sequences = table;
  });
  return sequencesLoading;
}

/**
 * Load the Emoji strikes for `sizes` (every size when omitted) and the
 * sequence table, each once. Resolves when they draw; text measured
 * before then is laid out again via `onFontsChanged`.
 */
export function loadEmoji(sizes: readonly number[] = SIZES): Promise<void> {
  return Promise.all(
    sizes.map((size) => {
      let pending = loading.get(size);
      if (!pending) {
        // The sequences come with the first strike, so sequences draw whole from the start.
        pending = Promise.all([EMOJI_STRIKES[size]!(), loadSequences()]).then(([data]) => {
          loaded.add(size);
          registerHiddenStrikes(EMOJI_FAMILY, [{ size, data }]);
        });
        loading.set(size, pending);
      }
      return pending;
    }),
  ).then(() => {});
}

/** The code point that draws an emoji sequence (variation selectors removed), if the family has it. */
export function emojiSequence(key: string): number | undefined {
  return sequences?.get(key);
}

/** The strike a face whose cell is `cellHeight` rows draws emoji from: the largest that fits. */
function sizeForCell(cellHeight: number): number {
  let size = SIZES[0]!;
  for (const s of SIZES) if (s <= cellHeight) size = s;
  return size;
}

/** The Emoji strike for a face whose cell is `cellHeight` rows; undefined, and loading, until it arrives. */
export function emojiFace(cellHeight: number): BitmapFace | undefined {
  const size = sizeForCell(cellHeight);
  if (!loaded.has(size)) {
    if (!loading.has(size)) {
      loadEmoji([size]).catch((error: unknown) => console.warn(`Emoji: couldn't load the ${size}px strike`, error));
    }
    return undefined;
  }
  return getFont(EMOJI_FAMILY, size) ?? undefined;
}
