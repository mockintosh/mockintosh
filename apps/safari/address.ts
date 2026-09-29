import { encodeQuery, formatUrl, parseUrl, type FormField, type WebForm } from "@mockintosh/sdk";
import { START_URL, pageRequest, type PageRequest } from "./page";

const SEARCH_URL = "https://lite.duckduckgo.com/lite/";

/**
 * What the address bar means: a URL, a bare host (`example.com`), or words
 * to search for. Empty goes to the start page.
 */
export function addressToUrl(raw: string): string {
  const text = raw.trim();
  if (!text || text === START_URL) return START_URL;
  if (/^https?:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(text)) return `https://${text}`;
  return `${SEARCH_URL}?q=${encodeURIComponent(text)}`;
}

/**
 * Address-bar text for a URL. The start page reads as empty, and `https`
 * pages drop the scheme (the lock shows it) when typing the short form
 * back in would go to the same page.
 */
export function urlToAddress(url: string): string {
  if (url === START_URL) return "";
  const short = url.replace(/^https:\/\//i, "").replace(/^([^/?#]+)\/$/, "$1");
  if (short === url) return url;
  const back = addressToUrl(short);
  return back === url || `${back}/` === url ? short : url;
}

export function isSecure(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/**
 * Where a clicked link goes, or null when Safari stays put: same-page
 * anchors, `mailto:`, `javascript:` and other schemes it cannot open.
 */
export function resolveLink(href: string, currentUrl: string): string | null {
  const target = parseUrl(href, currentUrl === START_URL ? undefined : currentUrl);
  if (!target || (target.scheme !== "http" && target.scheme !== "https")) return null;
  const page = formatUrl({ ...target, fragment: "" });
  if (target.fragment && page === withoutFragment(currentUrl)) return null;
  return page;
}

function withoutFragment(url: string): string {
  const parsed = parseUrl(url);
  return parsed ? formatUrl({ ...parsed, fragment: "" }) : url;
}

/** The request a submitted form makes, like a browser: GET puts fields in the query. */
export function formRequest(form: WebForm, fields: readonly FormField[], currentUrl: string): PageRequest | null {
  const action = resolveLink(form.action || currentUrl, currentUrl) ?? (form.action ? null : currentUrl);
  if (!action || action === START_URL) return null;
  const query = encodeQuery(fields);
  if (form.method === "post") return pageRequest(action, { method: "post", body: query });
  const url = parseUrl(action);
  return url ? pageRequest(formatUrl({ ...url, query })) : null;
}
