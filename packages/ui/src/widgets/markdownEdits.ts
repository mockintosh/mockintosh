/**
 * The edits a Markdown editor's toolbar makes, as github.com's comment box
 * makes them: wrap the selection in markers, or mark each line it touches.
 * Pure: text and selection in, text and selection out.
 */

/** Text and the selection in it, `start` to `end`. */
export interface MarkdownText {
  value: string;
  start: number;
  end: number;
}

export type MarkdownEdit = "heading" | "bold" | "italic" | "code" | "link" | "quote" | "bullets" | "numbers";

export function applyMarkdownEdit(edit: MarkdownEdit, text: MarkdownText): MarkdownText {
  const start = Math.min(text.start, text.end);
  const end = Math.max(text.start, text.end);
  const at = { value: text.value, start, end };
  if (edit === "bold") return wrap(at, "**");
  if (edit === "italic") return wrap(at, "_");
  if (edit === "code") return at.value.slice(start, end).includes("\n") ? block(at) : wrap(at, "`");
  if (edit === "link") return link(at);
  if (edit === "heading") return prefixLines(at, () => "### ");
  if (edit === "quote") return prefixLines(at, () => "> ");
  if (edit === "bullets") return prefixLines(at, () => "- ");
  return prefixLines(at, (index) => `${index + 1}. `);
}

/** `marker` on both sides of the selection, or taken off when it's already there. */
function wrap({ value, start, end }: MarkdownText, marker: string): MarkdownText {
  const n = marker.length;
  if (value.slice(start - n, start) === marker && value.slice(end, end + n) === marker) {
    return { value: value.slice(0, start - n) + value.slice(start, end) + value.slice(end + n), start: start - n, end: end - n };
  }
  return { value: value.slice(0, start) + marker + value.slice(start, end) + marker + value.slice(end), start: start + n, end: end + n };
}

/** Lines of code fenced off, the fences on lines of their own. */
function block({ value, start, end }: MarkdownText): MarkdownText {
  const before = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
  const after = end < value.length && value[end] !== "\n" ? "\n" : "";
  const open = `${before}\`\`\`\n`;
  return { value: `${value.slice(0, start)}${open}${value.slice(start, end)}\n\`\`\`${after}${value.slice(end)}`, start: start + open.length, end: end + open.length };
}

/** `[text](url)`, with `url` selected to type over. */
function link({ value, start, end }: MarkdownText): MarkdownText {
  const label = value.slice(start, end);
  const inserted = `[${label}](url)`;
  const url = start + label.length + 3;
  return { value: value.slice(0, start) + inserted + value.slice(end), start: url, end: url + 3 };
}

/** Each line the selection touches marked by `prefix(index)`, or unmarked when every one already is. */
function prefixLines({ value, start, end }: MarkdownText, prefix: (index: number) => string): MarkdownText {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const newline = value.indexOf("\n", end > start && value[end - 1] === "\n" ? end - 1 : end);
  const to = newline === -1 ? value.length : newline;
  const lines = value.slice(from, to).split("\n");
  const marked = lines.every((line, index) => line.startsWith(prefix(index)));
  const next = lines.map((line, index) => (marked ? line.slice(prefix(index).length) : prefix(index) + line));
  const changed = next.join("\n");
  // An empty selection keeps the caret where it was in its line.
  const shift = (marked ? -1 : 1) * prefix(0).length;
  if (start === end) {
    const caret = Math.max(from, start + shift);
    return { value: value.slice(0, from) + changed + value.slice(to), start: caret, end: caret };
  }
  return { value: value.slice(0, from) + changed + value.slice(to), start: from, end: from + changed.length };
}
