/**
 * The lines of a laid-out text block, as the shared editing keys need them:
 * ← → to a line's ends, ↑ ↓ to the line above or below at the same x.
 */

import type { DeckerFont } from "./font";
import type { TextAlign } from "../nodes";
import type { TextLines } from "../textEditing";
import { caretPoint, indexAtPoint, lineOfIndex, lineTop, type TextBlock } from "./textLayout";

export function blockLines(block: TextBlock, font: DeckerFont, align: TextAlign, width: number): TextLines {
  return {
    lineAt(index) {
      const line = block.lines[lineOfIndex(block, index)]!;
      return { start: line.start, end: line.start + line.text.length };
    },
    vertical(index, rows) {
      const row = lineOfIndex(block, index) + rows;
      if (row < 0) return 0;
      if (row >= block.lines.length) {
        const last = block.lines[block.lines.length - 1]!;
        return last.start + last.text.length;
      }
      const at = caretPoint(block, font, index, align, width);
      return indexAtPoint(block, font, at.x, lineTop(block, row), align, width);
    },
  };
}
