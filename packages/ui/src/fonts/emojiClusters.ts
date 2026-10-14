/**
 * Where characters begin and end, for drawing and for the caret.
 *
 * Most characters are one code point. An emoji may be several that draw as
 * one: a base and its variation selector (❤️), a skin tone (👍🏽), a keycap
 * (1️⃣), a flag's two regional indicators (🇸🇪) or its tags (🏴󠁧󠁢󠁳󠁣󠁴󠁿), and
 * any of those joined by ZERO WIDTH JOINER (👨‍👩‍👧). This follows the emoji
 * sequence grammar of UTS #51, loosely: a joiner followed by anything joins it.
 */

/** First private-use code point the Emoji family stores sequences at (`sequences.ts`). */
export const SEQUENCE_BASE = 0xf0000;

export const ZWJ = 0x200d;
export const VS15 = 0xfe0e;
export const VS16 = 0xfe0f;
const KEYCAP = 0x20e3;

/** Characters that draw nothing and take no room: joiners, variation selectors, bidi marks, tags. */
export function isDefaultIgnorable(cp: number): boolean {
  return (
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff ||
    (cp >= 0xe0000 && cp <= 0xe0fff)
  );
}

export function isRegionalIndicator(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

export function isSkinTone(cp: number): boolean {
  return cp >= 0x1f3fb && cp <= 0x1f3ff;
}

/** Code points that only modify the one before: they extend a cluster. */
function extends_(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || isSkinTone(cp) || cp === KEYCAP || (cp >= 0xe0020 && cp <= 0xe007f);
}

/** UTF-16 length of the code point at `i`. */
function width(cp: number): number {
  return cp > 0xffff ? 2 : 1;
}

/**
 * Text with nothing that joins: no joiners, selectors, tones, keycaps, flags
 * or tags, and no surrogates. Each UTF-16 unit is then its own character.
 */
const SIMPLE = /^[^​-‏‪-‮⁠-⁯⃣\ud800-\udfff︀-️﻿]*$/;

export function isSimpleText(text: string): boolean {
  return SIMPLE.test(text);
}

/** Index just past the character (cluster) that starts at `i`. */
export function clusterEnd(text: string, i: number): number {
  if (i >= text.length) return text.length;
  const first = text.codePointAt(i)!;
  let at = i + width(first);
  if (isRegionalIndicator(first)) {
    const next = text.codePointAt(at);
    return next !== undefined && isRegionalIndicator(next) ? at + 2 : at;
  }
  for (;;) {
    const cp = text.codePointAt(at);
    if (cp === undefined) return at;
    if (extends_(cp)) {
      at += width(cp);
      continue;
    }
    if (cp === ZWJ) {
      const next = text.codePointAt(at + 1);
      if (next === undefined || next === 0x0a) return at + 1;
      at += 1 + width(next);
      continue;
    }
    return at;
  }
}

/** Index where the character (cluster) that ends at `i` starts. */
export function clusterStartBefore(text: string, i: number): number {
  if (i <= 0) return 0;
  if (isSimpleText(text)) return i - 1;
  // Clusters only run forward, and never across a newline: walk from the line's start.
  let at = i >= 2 ? text.lastIndexOf("\n", i - 2) + 1 : 0;
  let start = at;
  while (at < i) {
    start = at;
    at = clusterEnd(text, at);
  }
  return start;
}

/** Index just past the character (cluster) at `i`, never past the end. */
export function clusterEndAfter(text: string, i: number): number {
  if (i >= text.length) return text.length;
  if (isSimpleText(text)) return i + 1;
  // Snap to a boundary first: `i` may sit inside a cluster.
  const start = clusterStartBefore(text, i + 1);
  return clusterEnd(text, start);
}

/** Each character (cluster) of `text`, as `[start, end)`. */
export function* clusters(text: string): Generator<[number, number]> {
  for (let i = 0; i < text.length; ) {
    const end = clusterEnd(text, i);
    yield [i, end];
    i = end;
  }
}

/**
 * Whether a key event's `key` is a character to type: one character, or one
 * emoji (a keyboard or a remapping can send 😀, two UTF-16 units). Named
 * keys (`Enter`, `ArrowLeft`, `Dead`) are ASCII words.
 */
export function isTypedKey(key: string): boolean {
  if (key.length === 1) return true;
  return /[^\x00-\x7f]/.test(key) && clusterEnd(key, 0) === key.length;
}
