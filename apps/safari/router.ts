import { parseUrl } from "@mockintosh/sdk";
import { PageError, START_URL, pageRequest, type PageRequest, type SiteContext, type WebPage } from "./page";
import { loadRemotePage } from "./remote";
import { adapterFor } from "./sites";

/**
 * What Safari shows for a request: the page, or why it couldn't be opened.
 * `landed` is the request that now stands for this page in history, when a
 * site adapter took a form post and landed on an ordinary page.
 */
export type PageResult = { kind: "page"; page: WebPage; landed?: PageRequest } | { kind: "error"; message: string };

/**
 * Where a page comes from: the start page, a site adapter for sites with an
 * API, or the server reading the page's HTML. Reader always goes to the
 * server; adapter pages are already only content. Form posts go to an
 * adapter that takes them, otherwise to the server.
 */
export async function loadPage(request: PageRequest, context: SiteContext): Promise<PageResult> {
  try {
    if (request.url === START_URL) return { kind: "page", page: { kind: "start", url: START_URL, title: "Start page" } };
    const url = parseUrl(request.url);
    if (!url) throw new PageError("That is not a web address.");
    const adapter = adapterFor(url);
    if (request.method === "post" && adapter?.submit) {
      const page = await adapter.submit(url, request.body ?? "", context);
      return { kind: "page", page, landed: pageRequest(page.url) };
    }
    const page = adapter && request.method === "get" ? await adapter.load(url, context) : await loadRemotePage(context.fetch, request);
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
