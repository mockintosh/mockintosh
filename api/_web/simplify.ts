/**
 * HTML → `LayoutNode[]`, the way a 1996 browser read a page: by what the
 * tags mean. Styles and scripts are dropped, links keep working, forms keep
 * their controls, data tables stay tables and layout tables flatten back
 * into the blocks they were arranging.
 */

import type { Align, FormControl, InlineSegment, LayoutNode, TableRow, WebForm } from "@mockintosh/markdown";

export interface SimplifiedPage {
  title: string;
  nodes: LayoutNode[];
}

export interface SimplifyOptions {
  /** Resolves relative links, images and form actions. */
  baseUrl: string;
  /** The subtree to read. Defaults to `document.body`. */
  root?: Element | null;
  /** Stop once this many blocks exist; the rest of the page is dropped. */
  maxNodes?: number;
}

const DEFAULT_MAX_NODES = 1500;

const SKIPPED = new Set([
  "script", "style", "noscript", "template", "svg", "iframe", "object", "embed", "canvas",
  "video", "audio", "head", "datalist", "dialog", "map", "source", "track", "math",
]);

const BLOCKS = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "center", "dd", "details", "dir",
  "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "header", "hgroup",
  "html", "legend", "main", "nav", "p", "section", "summary", "tbody", "td", "tfoot", "th",
  "thead", "tr",
]);

/** Elements whose presence in a cell marks the table as page layout, not data. */
const LAYOUT_CELL_CONTENT = "table, div, p, ul, ol, form, h1, h2, h3, h4, h5, h6, pre, blockquote, img";

const TEXT_INPUTS = new Set(["", "text", "search", "email", "url", "tel", "number"]);

type Style = "text" | "bold" | "italic" | "code";

interface ListFrame {
  ordered: boolean;
  next: number;
}

interface ItemFrame {
  indent: number;
  /** Marker for the item's first block; later blocks in the item get none. */
  marker: string | null;
}

interface FormFrame {
  form: WebForm;
  emitted: boolean;
}

function tagOf(element: Element): string {
  return element.tagName.toLowerCase();
}

function isHidden(element: Element): boolean {
  if (element.hasAttribute("hidden")) return true;
  if (element.getAttribute("aria-hidden") === "true") return true;
  const style = (element.getAttribute("style") ?? "").replace(/\s+/g, "").toLowerCase();
  return style.includes("display:none") || style.includes("visibility:hidden");
}

class PageBuilder {
  readonly nodes: LayoutNode[] = [];
  private segments: InlineSegment[] = [];
  private readonly lists: ListFrame[] = [];
  private readonly items: ItemFrame[] = [];
  private readonly links: string[] = [];
  private readonly aligns: Align[] = [];
  private bold = 0;
  private italic = 0;
  private code = 0;
  private form: FormFrame | null = null;

  constructor(private readonly baseUrl: string, private readonly maxNodes: number) {}

  get full(): boolean {
    return this.nodes.length >= this.maxNodes;
  }

  resolve(href: string): string | null {
    const trimmed = href.trim();
    if (!trimmed || /^(javascript|data|vbscript):/i.test(trimmed)) return null;
    try {
      return new URL(trimmed, this.baseUrl).toString();
    } catch {
      return null;
    }
  }

  private push(node: LayoutNode): void {
    if (!this.full) this.nodes.push(node);
  }

  private align(): Align {
    return this.aligns[this.aligns.length - 1] ?? "left";
  }

  private style(): Style {
    if (this.code > 0) return "code";
    if (this.bold > 0) return "bold";
    if (this.italic > 0) return "italic";
    return "text";
  }

  addText(raw: string): void {
    const text = raw.replace(/[ \t\r\n\f]+/g, " ");
    if (!text) return;
    const href = this.links[this.links.length - 1];
    if (href) this.segments.push({ kind: "link", text, href });
    else this.segments.push({ kind: this.style(), text });
  }

  lineBreak(): void {
    if (this.segments.length > 0) this.segments.push({ kind: "text", text: "\n" });
  }

  /** End the paragraph in progress, if it has any text. */
  flush(): void {
    const segments = cleanSegments(this.segments);
    this.segments = [];
    if (segments.length === 0) return;
    const item = this.items[this.items.length - 1];
    if (item) {
      const marker = item.marker ?? "";
      item.marker = null;
      this.push({ type: "listItem", segments, indent: item.indent, marker });
    } else {
      this.push({ type: "paragraph", segments, align: this.align() });
    }
  }

  block(node: LayoutNode): void {
    this.flush();
    this.push(node);
  }

  walk(node: Node): void {
    if (this.full) return;
    if (node.nodeType === 3) {
      this.addText(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = tagOf(element);
    if (SKIPPED.has(tag) || isHidden(element)) return;

    switch (tag) {
      case "br":
        this.lineBreak();
        return;
      case "hr":
        this.block({ type: "hr" });
        return;
      case "img":
        this.image(element);
        return;
      case "a":
        this.anchor(element);
        return;
      case "b":
      case "strong":
        this.bold++;
        this.children(element);
        this.bold--;
        return;
      case "i":
      case "em":
      case "cite":
      case "var":
      case "dfn":
        this.italic++;
        this.children(element);
        this.italic--;
        return;
      case "code":
      case "kbd":
      case "samp":
      case "tt":
        this.code++;
        this.children(element);
        this.code--;
        return;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        this.heading(element, tag === "h1" ? 1 : tag === "h2" ? 2 : 3);
        return;
      case "pre":
        this.block({ type: "code", text: (element.textContent ?? "").replace(/\n+$/, "") });
        return;
      case "ul":
      case "ol":
      case "menu":
      case "dir":
        this.list(element, tag === "ol");
        return;
      case "li":
        this.listItem(element);
        return;
      case "dt":
        this.flush();
        this.bold++;
        this.children(element);
        this.bold--;
        this.flush();
        return;
      case "table":
        this.table(element);
        return;
      case "form":
        this.formElement(element);
        return;
      case "input":
      case "textarea":
      case "select":
      case "button":
        this.control(element, tag);
        return;
      case "center":
        this.flush();
        this.aligns.push("center");
        this.children(element);
        this.flush();
        this.aligns.pop();
        return;
    }

    if (BLOCKS.has(tag)) {
      const align = element.getAttribute("align")?.toLowerCase();
      const aligned = align === "center" || align === "right";
      this.flush();
      if (aligned) this.aligns.push(align as Align);
      this.children(element);
      this.flush();
      if (aligned) this.aligns.pop();
      return;
    }
    this.children(element);
  }

  children(element: Element): void {
    for (const child of Array.from(element.childNodes)) {
      if (this.full) return;
      this.walk(child);
    }
  }

  private anchor(element: Element): void {
    const href = this.resolve(element.getAttribute("href") ?? "");
    if (!href) {
      this.children(element);
      return;
    }
    this.links.push(href);
    this.children(element);
    this.links.pop();
  }

  private image(element: Element): void {
    const src = this.resolve(element.getAttribute("src") ?? element.getAttribute("data-src") ?? "");
    if (!src) return;
    const width = Number(element.getAttribute("width"));
    const height = Number(element.getAttribute("height"));
    if ((width > 0 && width <= 2) || (height > 0 && height <= 2)) return;
    const alt = (element.getAttribute("alt") ?? "").trim();
    const href = this.links[this.links.length - 1];
    if (href && alt) {
      this.segments.push({ kind: "link", text: alt, href });
      return;
    }
    this.block(href ? { type: "image", src, alt, align: this.align(), href } : { type: "image", src, alt, align: this.align() });
  }

  private heading(element: Element, level: 1 | 2 | 3): void {
    this.flush();
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const links = Array.from(element.querySelectorAll("a[href]"));
    const only = links.length === 1 ? this.resolve(links[0]!.getAttribute("href") ?? "") : null;
    const href = only ?? this.links[this.links.length - 1];
    this.push(href ? { type: "heading", level, text, align: this.align(), href } : { type: "heading", level, text, align: this.align() });
  }

  private list(element: Element, ordered: boolean): void {
    this.flush();
    const start = Number(element.getAttribute("start"));
    this.lists.push({ ordered, next: Number.isFinite(start) && start > 0 ? start : 1 });
    this.children(element);
    this.flush();
    this.lists.pop();
  }

  private listItem(element: Element): void {
    this.flush();
    const list = this.lists[this.lists.length - 1];
    const marker = list?.ordered ? `${list.next++}.` : "•";
    this.items.push({ indent: Math.max(0, this.lists.length - 1), marker });
    this.children(element);
    this.flush();
    this.items.pop();
  }

  private table(element: Element): void {
    const rows = tableRows(element);
    if (isDataTable(element, rows)) {
      const data: TableRow[] = rows.map((row) => ({
        header: row.every((cell) => tagOf(cell) === "th") || row[0]!.parentElement?.parentElement?.tagName.toLowerCase() === "thead",
        cells: row.map((cell) => this.inlineOf(cell)),
      }));
      this.block({ type: "table", rows: data });
      return;
    }
    this.flush();
    for (const row of rows) {
      for (const cell of row) {
        this.children(cell);
        this.flush();
      }
    }
  }

  /** A cell's content as one inline run, links and styles kept. */
  private inlineOf(cell: Element): InlineSegment[] {
    const saved = this.segments;
    this.segments = [];
    const inline = new InlineReader(this);
    inline.children(cell);
    const segments = cleanSegments(this.segments);
    this.segments = saved;
    return segments;
  }

  pushSegment(segment: InlineSegment): void {
    this.segments.push(segment);
  }

  private formElement(element: Element): void {
    const outer = this.form;
    const method = (element.getAttribute("method") ?? "get").toLowerCase() === "post" ? "post" : "get";
    const action = this.resolve(element.getAttribute("action") ?? "") ?? "";
    this.form = { form: { action, method, controls: [] }, emitted: false };
    this.flush();
    this.children(element);
    this.flush();
    this.form = outer;
  }

  private control(element: Element, tag: string): void {
    const frame = this.form;
    if (!frame) return;
    const control = controlOf(element, tag);
    if (!control) return;
    frame.form.controls.push(control);
    if (control.kind !== "hidden" && !frame.emitted) {
      frame.emitted = true;
      this.block({ type: "form", form: frame.form });
    }
  }
}

/** Reads a subtree as inline content only: block tags become spaces. */
class InlineReader {
  constructor(private readonly page: PageBuilder) {}

  children(element: Element): void {
    for (const child of Array.from(element.childNodes)) this.walk(child, "text", null);
  }

  private walk(node: Node, style: Style, href: string | null): void {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").replace(/[ \t\r\n\f]+/g, " ");
      if (text) this.page.pushSegment(href ? { kind: "link", text, href } : { kind: style, text });
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = tagOf(element);
    if (SKIPPED.has(tag) || isHidden(element)) return;
    if (tag === "br") {
      this.page.pushSegment({ kind: "text", text: "\n" });
      return;
    }
    if (tag === "img") {
      const alt = (element.getAttribute("alt") ?? "").trim();
      if (alt) this.page.pushSegment(href ? { kind: "link", text: alt, href } : { kind: "text", text: alt });
      return;
    }
    let nextStyle = style;
    let nextHref = href;
    if (tag === "b" || tag === "strong") nextStyle = "bold";
    else if (tag === "i" || tag === "em") nextStyle = "italic";
    else if (tag === "code" || tag === "kbd" || tag === "tt") nextStyle = "code";
    else if (tag === "a") nextHref = this.page.resolve(element.getAttribute("href") ?? "") ?? href;
    if (BLOCKS.has(tag)) this.page.pushSegment({ kind: "text", text: " " });
    for (const child of Array.from(element.childNodes)) this.walk(child, nextStyle, nextHref);
  }
}

function controlOf(element: Element, tag: string): FormControl | null {
  const name = element.getAttribute("name") ?? "";
  if (element.hasAttribute("disabled")) return null;
  if (tag === "textarea") {
    const rows = Number(element.getAttribute("rows")) || 4;
    return { kind: "textarea", name, value: element.textContent ?? "", rows: Math.min(12, Math.max(2, rows)) };
  }
  if (tag === "select") {
    const options = Array.from(element.querySelectorAll("option"));
    const chosen = options.find((option) => option.hasAttribute("selected")) ?? options[0];
    if (!chosen || !name) return null;
    return { kind: "hidden", name, value: chosen.getAttribute("value") ?? (chosen.textContent ?? "").trim() };
  }
  if (tag === "button") {
    const type = (element.getAttribute("type") ?? "submit").toLowerCase();
    if (type !== "submit") return null;
    const label = (element.textContent ?? "").replace(/\s+/g, " ").trim() || "Submit";
    return { kind: "submit", name, value: element.getAttribute("value") ?? "", label };
  }
  const type = (element.getAttribute("type") ?? "").toLowerCase();
  const value = element.getAttribute("value") ?? "";
  if (TEXT_INPUTS.has(type)) {
    return { kind: "text", name, value, placeholder: element.getAttribute("placeholder") ?? "" };
  }
  if (type === "hidden") return name ? { kind: "hidden", name, value } : null;
  if (type === "submit" || type === "image") {
    return { kind: "submit", name, value, label: value || element.getAttribute("alt") || "Submit" };
  }
  if ((type === "checkbox" || type === "radio") && element.hasAttribute("checked") && name) {
    return { kind: "hidden", name, value: value || "on" };
  }
  return null;
}

/** Rows of `table` itself, not of tables nested in its cells. */
function tableRows(table: Element): Element[][] {
  const rows: Element[][] = [];
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      const tag = tagOf(child);
      if (tag === "tr") {
        const cells = Array.from(child.children).filter((cell) => {
          const cellTag = tagOf(cell);
          return (cellTag === "td" || cellTag === "th") && !isHidden(cell);
        });
        if (cells.length > 0) rows.push(cells);
      } else if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
        visit(child);
      }
    }
  };
  visit(table);
  return rows;
}

function isDataTable(table: Element, rows: Element[][]): boolean {
  if (table.getAttribute("role") === "presentation") return false;
  if (rows.length < 2 || rows.length > 200) return false;
  const columns = Math.max(...rows.map((row) => row.length));
  if (columns < 2 || columns > 8) return false;
  return rows.every((row) => row.every((cell) => cell.querySelector(LAYOUT_CELL_CONTENT) === null));
}

/**
 * Collapse whitespace the way a browser does: one space between words,
 * none at the start or end of a paragraph or around a line break. Adjacent
 * segments of the same kind merge.
 */
export function cleanSegments(segments: readonly InlineSegment[]): InlineSegment[] {
  const out: InlineSegment[] = [];
  let afterSpace = true;
  for (const segment of segments) {
    let text = "";
    for (const ch of segment.text) {
      if (ch === "\n") {
        text = text.replace(/ $/, "");
        if (out.length > 0 || text) text += "\n";
        afterSpace = true;
      } else if (ch === " ") {
        if (!afterSpace) text += " ";
        afterSpace = true;
      } else {
        text += ch;
        afterSpace = false;
      }
    }
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.kind === segment.kind && (last.kind !== "link" || last.href === (segment as { href?: string }).href)) {
      last.text += text;
    } else {
      out.push({ ...segment, text } as InlineSegment);
    }
  }
  const last = out[out.length - 1];
  if (last) {
    last.text = last.text.replace(/[ \n]+$/, "");
    if (!last.text) out.pop();
  }
  const first = out[0];
  if (first) {
    first.text = first.text.replace(/^\n+/, "");
    if (!first.text) out.shift();
  }
  return out.every((segment) => !segment.text.trim()) ? [] : out;
}

export function simplifyHtml(document: Document, options: SimplifyOptions): SimplifiedPage {
  const builder = new PageBuilder(options.baseUrl, options.maxNodes ?? DEFAULT_MAX_NODES);
  const root = options.root ?? document.body ?? document.documentElement;
  if (root) builder.walk(root);
  builder.flush();
  const title = (document.title || "").replace(/\s+/g, " ").trim();
  return { title, nodes: builder.nodes };
}
