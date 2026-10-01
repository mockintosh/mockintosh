import type { WebUrl } from "@mockintosh/sdk";
import type { SiteAdapter } from "../page";
import { docsSite } from "./docs/site";
import { githubSite } from "./github/page";
import { hackerNewsSite } from "./hackernews";
import { mockintoshSite } from "./mockintosh";

/** Sites Safari draws itself, from their APIs or its own pixels. Everything else is read from its HTML on the server. */
export const SITE_ADAPTERS: readonly SiteAdapter[] = [githubSite, hackerNewsSite, mockintoshSite, docsSite];

export function adapterFor(url: WebUrl): SiteAdapter | undefined {
  return SITE_ADAPTERS.find((adapter) => adapter.handles(url));
}
