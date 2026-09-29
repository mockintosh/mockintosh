import { fromMarkdown } from "mdast-util-from-markdown";
import type { LayoutNode, InlineSegment, TableRow } from "./types.js";

// We derive MDAST types from the return type of fromMarkdown rather than
// importing @types/mdast directly, to avoid version-mismatch issues between
// the root workspace's @types/mdast and the copy bundled inside
// mdast-util-from-markdown.
type MdastRoot = ReturnType<typeof fromMarkdown>;
type MdastNode = MdastRoot["children"][number];

// Narrowed inline-content type — any node that can appear in phrasing context.
// Using a loose structural type lets us avoid the @types/mdast import entirely.
type PhrasingNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  children?: PhrasingNode[];
};

// ---------------------------------------------------------------------------
// Inline conversion — phrasing nodes → InlineSegment[]
// ---------------------------------------------------------------------------

function convertInline(nodes: PhrasingNode[]): InlineSegment[] {
  const segments: InlineSegment[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        if (node.value) segments.push({ kind: "text", text: node.value });
        break;

      case "inlineCode":
        if (node.value) segments.push({ kind: "code", text: node.value });
        break;

      case "strong": {
        const text = extractPlainText(node.children ?? []);
        if (text) segments.push({ kind: "bold", text });
        break;
      }

      case "emphasis": {
        const text = extractPlainText(node.children ?? []);
        if (text) segments.push({ kind: "italic", text });
        break;
      }

      case "link": {
        const text = extractPlainText(node.children ?? []) || (node.url ?? "");
        if (node.url) segments.push({ kind: "link", text, href: node.url });
        break;
      }

      case "image":
        // Inline image — render alt text as plain text fallback
        if (node.alt) segments.push({ kind: "text", text: node.alt });
        break;

      case "break":
        segments.push({ kind: "text", text: " " });
        break;

      case "html":
        // Strip inline HTML
        break;

      default: {
        // linkReference, imageReference, delete, footnote, etc.
        if (node.children) segments.push(...convertInline(node.children));
        else if (node.value) segments.push({ kind: "text", text: node.value });
      }
    }
  }

  return segments.filter((s) => s.text.length > 0);
}

/** Flatten phrasing content to a plain string (for headings, bold, etc.) */
function extractPlainText(nodes: PhrasingNode[]): string {
  return nodes
    .map((n) => {
      if (n.value !== undefined) return n.value;
      if (n.children) return extractPlainText(n.children);
      return "";
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Block conversion
// ---------------------------------------------------------------------------

function convertBlock(node: MdastNode, indent: number, out: LayoutNode[]): void {
  switch (node.type) {
    case "heading": {
      const h = node as {
        type: "heading";
        depth: number;
        children: PhrasingNode[];
      };
      const level: 1 | 2 | 3 = h.depth <= 1 ? 1 : h.depth === 2 ? 2 : 3;
      const text = extractPlainText(h.children);
      if (text) out.push({ type: "heading", level, text, align: "left" });
      break;
    }

    case "paragraph": {
      const p = node as { type: "paragraph"; children: PhrasingNode[] };

      // A paragraph containing only a single image becomes a block image node.
      if (p.children.length === 1 && p.children[0].type === "image") {
        const img = p.children[0];
        out.push({
          type: "image",
          src: img.url ?? "",
          alt: img.alt ?? "",
          align: "center",
        });
        break;
      }

      const segments = convertInline(p.children);
      if (segments.length > 0) {
        out.push({ type: "paragraph", segments, align: "left" });
      }
      break;
    }

    case "list": {
      convertList(node as MdastList, indent, out);
      break;
    }

    case "thematicBreak":
      out.push({ type: "hr" });
      break;

    case "blockquote": {
      const bq = node as { type: "blockquote"; children: MdastNode[] };
      for (const child of bq.children) convertBlock(child, indent, out);
      break;
    }

    case "code": {
      const code = node as { type: "code"; value: string };
      if (code.value) out.push({ type: "code", text: code.value });
      break;
    }

    case "table": {
      const table = node as { type: "table"; children: Array<{ children: Array<{ children: PhrasingNode[] }> }> };
      const rows: TableRow[] = table.children.map((row, index) => ({
        header: index === 0,
        cells: row.children.map((cell) => convertInline(cell.children)),
      }));
      if (rows.length > 0) out.push({ type: "table", rows });
      break;
    }

    case "html":
    case "yaml":
    case "definition":
    case "footnoteDefinition":
      break;

    default:
      break;
  }
}

interface MdastList {
  type: "list";
  ordered?: boolean | null;
  start?: number | null;
  children: Array<{ type: "listItem"; children: MdastNode[] }>;
}

function convertList(list: MdastList, indent: number, out: LayoutNode[]): void {
  list.children.forEach((item, index) => {
    const segments: InlineSegment[] = [];
    const nestedLists: MdastList[] = [];

    for (const child of item.children) {
      if (child.type === "paragraph") {
        const p = child as { type: "paragraph"; children: PhrasingNode[] };
        segments.push(...convertInline(p.children));
      } else if (child.type === "list") {
        nestedLists.push(child as MdastList);
      } else {
        convertBlock(child, indent, out);
      }
    }

    if (segments.length > 0) {
      const marker = list.ordered ? `${(list.start ?? 1) + index}.` : undefined;
      out.push(marker ? { type: "listItem", segments, indent, marker } : { type: "listItem", segments, indent });
    }

    for (const nested of nestedLists) {
      convertList(nested, indent + 1, out);
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parse a CommonMark markdown string into a LayoutNode[] ready for rendering. */
export function parseMarkdown(markdown: string): LayoutNode[] {
  const root = fromMarkdown(markdown);
  const nodes: LayoutNode[] = [];
  for (const child of root.children) {
    convertBlock(child, 0, nodes);
  }
  return nodes;
}

/** Extract all image source URLs from a LayoutNode list. */
export function extractImageUrls(nodes: LayoutNode[]): string[] {
  const urls: string[] = [];
  for (const node of nodes) {
    if (node.type === "image" && node.src) urls.push(node.src);
  }
  return urls;
}
