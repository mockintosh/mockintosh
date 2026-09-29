/**
 * TextEdit's `TextBox`: draw `text` word-wrapped into `box` in thePort's
 * font, one line every ascent + descent + leading, with the given
 * justification. Returns and line feeds break lines.
 */

import { DrawString, GetFontInfo, MoveTo, TextWidth, type FontInfo, type Rect } from "@mockintosh/quickdraw";
import type { TextJust } from "./state";

function wrapParagraph(paragraph: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  let i = 0;
  while (i < paragraph.length) {
    let j = i;
    while (j < paragraph.length && paragraph[j] !== " ") j++;
    while (j < paragraph.length && paragraph[j] === " ") j++;
    const word = paragraph.slice(i, j);
    const candidate = line + word;
    if (line === "" || TextWidth(candidate.trimEnd(), 0, candidate.trimEnd().length) <= width) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
    while (line.length > 1 && TextWidth(line.trimEnd(), 0, line.trimEnd().length) > width) {
      let k = line.length - 1;
      while (k > 1 && TextWidth(line, 0, k) > width) k--;
      lines.push(line.slice(0, k));
      line = line.slice(k);
    }
    i = j;
  }
  lines.push(line);
  return lines;
}

/** Break `text` as `TextBox` would for a box `width` wide. */
export function wrapText(text: string, width: number): string[] {
  return text.split(/\r\n|\r|\n/).flatMap((paragraph) => wrapParagraph(paragraph, width));
}

export function textBox(text: string, box: Rect, just: TextJust): void {
  const info: FontInfo = { ascent: 0, descent: 0, widMax: 0, leading: 0 };
  GetFontInfo(info);
  const lineHeight = info.ascent + info.descent + info.leading;
  const width = box.right - box.left;
  let v = box.top + info.ascent;
  for (const line of wrapText(text, width)) {
    if (v - info.ascent >= box.bottom) break;
    const shown = line.trimEnd();
    const w = TextWidth(shown, 0, shown.length);
    let h = box.left;
    if (just === "center") h = box.left + Math.trunc((width - w) / 2);
    if (just === "right") h = box.right - w;
    MoveTo(h, v);
    DrawString(shown);
    v += lineHeight;
  }
}
