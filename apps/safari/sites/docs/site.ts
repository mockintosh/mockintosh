import { parseMarkdown, type InlineSegment, type LayoutNode } from "@mockintosh/sdk";
import type { DocumentPage, SiteAdapter } from "../../page";
import { DOCS_PAGES, type DocsPage } from "./pages";

export const DOCS_ORIGIN = "https://docs.mockintosh.com";

/** Sidebar width; narrower than `TWO_COLUMNS`, the contents go above the page. */
const SIDEBAR = 112;
const TWO_COLUMNS = SIDEBAR + 16 + 240;

export function docsUrl(path: string): string {
  return `${DOCS_ORIGIN}${path}`;
}

/** `/fonts/` and `/fonts` are one page; the front page is `/`. */
function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed.toLowerCase();
}

/** Point site-relative links (`/fonts`) at docs.mockintosh.com. */
function resolveLinks(nodes: readonly LayoutNode[]): LayoutNode[] {
  const segments = (list: readonly InlineSegment[]) =>
    list.map((segment) => (segment.kind === "link" && segment.href.startsWith("/") ? { ...segment, href: docsUrl(segment.href) } : segment));
  return nodes.map((node) => {
    if (node.type === "paragraph" || node.type === "listItem") return { ...node, segments: segments(node.segments) };
    return node;
  });
}

/** Every page, the current one in bold instead of a link. */
function contents(current: DocsPage | undefined): LayoutNode[] {
  return [
    { type: "heading", level: 3, text: "Mockintosh Docs", align: "left", href: docsUrl("/") },
    ...DOCS_PAGES.map((page): LayoutNode => ({
      type: "paragraph",
      align: "left",
      segments: [page === current ? { kind: "bold", text: page.title } : { kind: "link", text: page.title, href: docsUrl(page.path) }],
    })),
  ];
}

export function docsPage(path: string): DocumentPage {
  const wanted = normalizePath(path);
  const page = DOCS_PAGES.find((candidate) => candidate.path === wanted);
  const body: LayoutNode[] = page
    ? resolveLinks(parseMarkdown(page.markdown))
    : [
        { type: "heading", level: 1, text: "Page not found", align: "left" },
        { type: "paragraph", align: "left", segments: [{ kind: "text", text: `There is no page at ${wanted} in the Mockintosh documentation. Pick one from the contents.` }] },
      ];
  const next = page ? DOCS_PAGES[DOCS_PAGES.indexOf(page) + 1] : undefined;
  if (next) {
    body.push({ type: "hr" }, { type: "paragraph", align: "left", segments: [{ kind: "text", text: "Next: " }, { kind: "link", text: next.title, href: docsUrl(next.path) }] });
  }
  return {
    kind: "document",
    url: docsUrl(page?.path ?? wanted),
    title: page ? (page.path === "/" ? "Mockintosh Docs" : `${page.title} — Mockintosh Docs`) : "Page not found — Mockintosh Docs",
    nodes: [{ type: "columns", gap: 16, minWidth: TWO_COLUMNS, columns: [{ width: SIDEBAR, nodes: contents(page) }, { nodes: body }] }],
  };
}

/** docs.mockintosh.com: the system's documentation, written into Safari rather than fetched. */
export const docsSite: SiteAdapter = {
  id: "docs",
  handles: (url) => /^docs\.mockintosh\.com$/i.test(url.hostname),
  async load(url) {
    return docsPage(url.path || "/");
  },
};
