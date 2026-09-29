import { parseUrl } from "@mockintosh/sdk";
import { PageError, START_URL, type PageRequest, type SiteContext, type WebPage } from "./page";
import { loadRemotePage } from "./remote";
import { adapterFor } from "./sites";
import { startPage } from "./start";

/** What Safari shows for a request: the page, or why it couldn't be opened. */
export type PageResult = { kind: "page"; page: WebPage } | { kind: "error"; message: string };

/**
 * Where a page comes from: the start page, a site adapter for sites with an
 * API, or the server reading the page's HTML. Reader and form posts always
 * go to the server; adapter pages are already only content.
 */
export async function loadPage(request: PageRequest, context: SiteContext): Promise<PageResult> {
  try {
    if (request.url === START_URL) return { kind: "page", page: startPage() };
    const url = parseUrl(request.url);
    if (!url) throw new PageError("That is not a web address.");
    const adapter = request.method === "get" ? adapterFor(url) : undefined;
    const page = adapter ? await adapter.load(url, context) : await loadRemotePage(context.fetch, request);
    return { kind: "page", page };
  } catch (error) {
    return { kind: "error", message: error instanceof PageError ? error.message : "Safari can't open the page." };
  }
}

/** True when View › Reader changes what this request shows. */
export function readerApplies(request: PageRequest): boolean {
  if (request.url === START_URL || request.method !== "get") return false;
  const url = parseUrl(request.url);
  return url !== null && !adapterFor(url);
}
