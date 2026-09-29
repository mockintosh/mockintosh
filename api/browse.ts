import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import type { LayoutNode } from "@mockintosh/markdown";
import { RemoteError, decodeText, fetchRemote } from "./_web/fetch";
import { simplifyHtml } from "./_web/simplify";
import { applySiteRule, siteRuleFor } from "./_web/sites";

const MAX_PAGE_BYTES = 5_000_000;
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5";

/** POST body. Safari's `apps/safari/remote.ts` sends exactly this. */
export interface BrowseRequest {
  url: string;
  /** Read only the article, the way Reader does. */
  reader?: boolean;
  /** A form submission. `body` is `application/x-www-form-urlencoded`. */
  method?: "get" | "post";
  body?: string;
}

export interface BrowseResponse {
  /** Where the page actually is, after redirects. */
  url: string;
  title: string;
  nodes: LayoutNode[];
}

export interface BrowseErrorResponse {
  error: string;
}

function json(body: BrowseResponse | BrowseErrorResponse, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * linkedom has no `getComputedStyle`. Defuddle's HTML-string entry polyfills
 * it; a raw `Document` does not, and extraction then keeps the whole page
 * (navigation and all) after `standardizeContent` throws.
 */
export function documentFromHtml(html: string, url: string): Document {
  const { document } = parseHTML(html);
  const view = document.defaultView as (Window & { getComputedStyle?: unknown }) | null;
  if (view && typeof view.getComputedStyle !== "function") {
    view.getComputedStyle = (() => ({ display: "" })) as unknown as typeof getComputedStyle;
  }
  const doc = document as Document & { styleSheets?: StyleSheetList; URL: string };
  if (!doc.styleSheets) doc.styleSheets = [] as unknown as StyleSheetList;
  doc.URL = url;
  return document;
}

/** The page at `url` as a document, from its HTML. */
export async function readPage(html: string, url: string, reader: boolean): Promise<BrowseResponse> {
  const document = documentFromHtml(html, url);
  if (reader) {
    const article = await Defuddle(document, url, { markdown: false, useAsync: false, removeImages: false });
    const content = documentFromHtml(`<html><body>${String(article.content ?? "")}</body></html>`, url);
    const page = simplifyHtml(content, { baseUrl: url });
    return { url, title: article.title || page.title, nodes: page.nodes };
  }
  const rule = siteRuleFor(new URL(url));
  const root = rule ? applySiteRule(document, rule) : null;
  const page = simplifyHtml(document, { baseUrl: url, root });
  const title = rule?.title ? rule.title(page.title) : page.title;
  return { url, title, nodes: page.nodes };
}

function parseRequest(body: unknown): BrowseRequest | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.url !== "string" || !record.url.trim()) return null;
  return {
    url: record.url,
    reader: record.reader === true,
    method: record.method === "post" ? "post" : "get",
    body: typeof record.body === "string" ? record.body : undefined,
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let request: BrowseRequest | null;
  try {
    request = parseRequest(await req.json());
  } catch {
    request = null;
  }
  if (!request) return json({ error: "Missing url" }, 400);

  try {
    const remote = await fetchRemote(request.url, {
      method: request.method === "post" ? "POST" : "GET",
      body: request.body,
      accept: PAGE_ACCEPT,
      maxBytes: MAX_PAGE_BYTES,
    });
    const type = remote.contentType.split(";")[0]!.trim().toLowerCase();
    if (type.startsWith("image/")) {
      return json({ url: remote.url, title: remote.url, nodes: [{ type: "image", src: remote.url, alt: "", align: "center" }] });
    }
    const text = decodeText(remote.bytes, remote.contentType);
    if (type === "text/plain" || type === "application/json" || type === "text/css" || type.endsWith("javascript")) {
      return json({ url: remote.url, title: new URL(remote.url).pathname.split("/").pop() || remote.url, nodes: [{ type: "code", text }] });
    }
    if (type && type !== "text/html" && type !== "application/xhtml+xml" && !type.endsWith("+xml") && type !== "application/xml") {
      return json({ error: `Safari can't show this kind of file (${type}).` }, 415);
    }
    return json(await readPage(text, remote.url, request.reader === true));
  } catch (error) {
    if (error instanceof RemoteError) return json({ error: error.message }, error.status >= 400 && error.status < 600 ? 502 : 500);
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `Could not read the page: ${message}` }, 500);
  }
}
