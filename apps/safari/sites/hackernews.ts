import { parseUrl, queryParam, type FetchFunction, type InlineSegment, type LayoutNode, type WebUrl } from "@mockintosh/sdk";
import { PageError, type DocumentPage, type SiteAdapter } from "../page";

const SITE = "https://news.ycombinator.com";
const API = "https://hn.algolia.com/api/v1";
/** Comments past this depth are drawn at it, so deep threads stay readable. */
const MAX_DEPTH = 6;
const MAX_COMMENTS = 400;

type Listing = "top" | "new" | "ask" | "show";

/** A page on news.ycombinator.com that the adapter draws. */
export type HackerNewsLocation =
  | { kind: "listing"; listing: Listing }
  | { kind: "item"; id: number }
  | { kind: "user"; id: string };

const LISTINGS: Record<Listing, { path: string; label: string; query: string }> = {
  top: { path: "/news", label: "top", query: "search?tags=front_page&hitsPerPage=30" },
  new: { path: "/newest", label: "new", query: "search_by_date?tags=story&hitsPerPage=30" },
  ask: { path: "/ask", label: "ask", query: "search_by_date?tags=ask_hn&hitsPerPage=30" },
  show: { path: "/show", label: "show", query: "search_by_date?tags=show_hn&hitsPerPage=30" },
};

export function parseHackerNewsUrl(url: WebUrl): HackerNewsLocation | null {
  if (!/^news\.ycombinator\.com$/i.test(url.hostname)) return null;
  const path = url.path.replace(/\/+$/, "") || "/news";
  if (path === "/item") {
    const id = Number(queryParam(url.query, "id"));
    return Number.isInteger(id) && id > 0 ? { kind: "item", id } : null;
  }
  if (path === "/user") {
    const id = queryParam(url.query, "id");
    return id ? { kind: "user", id } : null;
  }
  if (path === "/front") return { kind: "listing", listing: "top" };
  for (const [listing, entry] of Object.entries(LISTINGS) as [Listing, (typeof LISTINGS)[Listing]][]) {
    if (entry.path === path) return { kind: "listing", listing };
  }
  return null;
}

function itemUrl(id: number | string): string {
  return `${SITE}/item?id=${id}`;
}

function userUrl(id: string): string {
  return `${SITE}/user?id=${encodeURIComponent(id)}`;
}

export const hackerNewsSite: SiteAdapter = {
  id: "hackernews",
  handles: (url) => parseHackerNewsUrl(url) !== null,
  async load(url, context) {
    const location = parseHackerNewsUrl(url);
    if (!location) throw new PageError("Safari can't show that Hacker News page.");
    const now = Date.now();
    if (location.kind === "listing") return listingPage(location.listing, await api(context.fetch, LISTINGS[location.listing].query), now);
    if (location.kind === "item") return itemPage(await api(context.fetch, `items/${location.id}`), now);
    return userPage(location.id, await api(context.fetch, `users/${encodeURIComponent(location.id)}`));
  },
};

async function api(fetch: FetchFunction, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}/${path}`);
  if (response.status === 404) throw new PageError("No such item on Hacker News.");
  if (!response.ok) throw new PageError(`Hacker News returned ${response.status}.`);
  return record(await response.json());
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function text(value: string): InlineSegment {
  return { kind: "text", text: value };
}

function link(value: string, href: string): InlineSegment {
  return { kind: "link", text: value, href };
}

function age(seconds: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now / 1000 - seconds) / 60));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function domainOf(url: string): string {
  return parseUrl(url)?.hostname.replace(/^www\./, "") ?? "";
}

function header(current: Listing | null): LayoutNode[] {
  const segments: InlineSegment[] = [];
  (Object.keys(LISTINGS) as Listing[]).forEach((listing, index) => {
    if (index > 0) segments.push(text(" | "));
    const entry = LISTINGS[listing];
    segments.push(listing === current ? { kind: "bold", text: entry.label } : link(entry.label, `${SITE}${entry.path}`));
  });
  return [{ type: "heading", level: 1, text: "Hacker News", align: "left", href: `${SITE}/news` }, { type: "paragraph", align: "left", segments }, { type: "hr" }];
}

function listingPage(listing: Listing, data: Record<string, unknown>, now: number): DocumentPage {
  const hits = Array.isArray(data.hits) ? data.hits.map(record) : [];
  const nodes = header(listing);
  hits.forEach((hit, index) => {
    const id = str(hit.objectID);
    const url = str(hit.url);
    const title = str(hit.title) || "(untitled)";
    const domain = url ? domainOf(url) : "";
    const comments = num(hit.num_comments);
    nodes.push({
      type: "listItem",
      indent: 0,
      marker: `${index + 1}.`,
      segments: [
        link(title, url || itemUrl(id)),
        ...(domain ? [text(` (${domain})`)] : []),
        text(`\n${num(hit.points)} points by `),
        link(str(hit.author), userUrl(str(hit.author))),
        text(` ${age(num(hit.created_at_i), now)} | `),
        link(comments === 0 ? "discuss" : `${comments} comment${comments === 1 ? "" : "s"}`, itemUrl(id)),
      ],
    });
  });
  if (hits.length === 0) nodes.push({ type: "paragraph", align: "left", segments: [text("Nothing here right now.")] });
  return { kind: "document", url: `${SITE}${LISTINGS[listing].path}`, title: "Hacker News", nodes };
}

function itemPage(item: Record<string, unknown>, now: number): DocumentPage {
  const id = num(item.id);
  const title = str(item.title);
  const url = str(item.url);
  const nodes = header(null);
  const created = num(item.created_at_i);
  const children = Array.isArray(item.children) ? item.children.map(record) : [];
  if (title) nodes.push({ type: "heading", level: 2, text: title, align: "left", ...(url ? { href: url } : {}) });
  nodes.push({
    type: "paragraph",
    align: "left",
    segments: [
      ...(item.type === "story" || item.type === "poll" ? [text(`${num(item.points)} points by `)] : [text("by ")]),
      link(str(item.author), userUrl(str(item.author))),
      text(` ${age(created, now)}`),
      ...(url ? [text(" | "), link(domainOf(url), url)] : []),
    ],
  });
  for (const block of hnText(str(item.text))) nodes.push(block);

  let count = 0;
  const walk = (comment: Record<string, unknown>, depth: number) => {
    if (count >= MAX_COMMENTS) return;
    const body = hnText(str(comment.text));
    const replies = Array.isArray(comment.children) ? comment.children.map(record) : [];
    if (body.length > 0) {
      count++;
      const indent = Math.min(depth, MAX_DEPTH);
      const author = str(comment.author);
      nodes.push({
        type: "listItem",
        indent,
        marker: "•",
        segments: [link(author, userUrl(author)), text(` ${age(num(comment.created_at_i), now)} | `), link("link", itemUrl(num(comment.id)))],
      });
      for (const block of body) {
        if (block.type === "paragraph") nodes.push({ type: "listItem", indent, marker: " ", segments: block.segments });
        else nodes.push(block);
      }
    }
    for (const reply of replies) walk(reply, depth + 1);
  };
  if (children.length > 0) nodes.push({ type: "hr" });
  for (const child of children) walk(child, 0);
  return { kind: "document", url: itemUrl(id), title: title || `Comment by ${str(item.author)}`, nodes };
}

function userPage(id: string, user: Record<string, unknown>): DocumentPage {
  const nodes = header(null);
  nodes.push(
    { type: "heading", level: 2, text: str(user.username) || id, align: "left" },
    { type: "paragraph", align: "left", segments: [text(`karma: ${num(user.karma)}`)] },
    ...hnText(str(user.about)),
  );
  return { kind: "document", url: userUrl(id), title: `Profile: ${id}`, nodes };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/**
 * Hacker News post and comment text: paragraphs split by `<p>`, `<a href>`,
 * `<i>` and `<pre><code>`, nothing else.
 */
export function hnText(html: string): LayoutNode[] {
  const out: LayoutNode[] = [];
  if (!html.trim()) return out;
  for (const part of html.split(/(<pre><code>[\s\S]*?<\/code><\/pre>)/i)) {
    const pre = /^<pre><code>([\s\S]*?)<\/code><\/pre>$/i.exec(part);
    if (pre) {
      out.push({ type: "code", text: decodeEntities(pre[1]!.replace(/<[^>]+>/g, "")).replace(/\n+$/, "") });
      continue;
    }
    for (const paragraph of part.split(/<p>/i)) {
      const segments: InlineSegment[] = [];
      let italic = false;
      let href: string | null = null;
      for (const token of paragraph.split(/(<[^>]+>)/)) {
        if (!token) continue;
        if (token.startsWith("<")) {
          const tag = token.toLowerCase();
          if (tag.startsWith("<i")) italic = true;
          else if (tag.startsWith("</i")) italic = false;
          else if (tag.startsWith("<a")) href = decodeEntities(/href="([^"]*)"/i.exec(token)?.[1] ?? "") || null;
          else if (tag.startsWith("</a")) href = null;
          continue;
        }
        const value = decodeEntities(token);
        if (href) segments.push({ kind: "link", text: value, href });
        else segments.push({ kind: italic ? "italic" : "text", text: value });
      }
      if (segments.some((segment) => segment.text.trim())) out.push({ type: "paragraph", align: "left", segments });
    }
  }
  return out;
}
