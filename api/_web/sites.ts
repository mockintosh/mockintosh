/**
 * Per-site cleanup for pages read through the HTML simplifier: where the
 * content is, and which chrome to cut. Sites with a usable API get a Safari
 * site adapter instead; these are sites whose HTML is the best source.
 */

export interface SiteRule {
  hosts: RegExp;
  /** First selector that matches is the part of the page to read. */
  content?: readonly string[];
  /** Removed before reading. */
  remove?: readonly string[];
  /** Page title with the site's suffix trimmed. */
  title?: (title: string) => string;
}

export const SITE_RULES: readonly SiteRule[] = [
  {
    hosts: /(^|\.)wikipedia\.org$/,
    content: ["#mw-content-text .mw-parser-output", "#mw-content-text", "#content"],
    remove: [
      ".mw-editsection",
      ".mw-jump-link",
      ".navbox",
      ".vertical-navbox",
      ".sidebar",
      ".infobox",
      ".metadata",
      ".ambox",
      ".noprint",
      ".shortdescription",
      "#toc",
      ".toc",
      "sup.reference",
      ".mw-references-wrap",
      ".reflist",
      "style",
      "link",
    ],
    title: (title) => title.replace(/ - Wikipedia$/, ""),
  },
];

export function siteRuleFor(url: URL): SiteRule | undefined {
  const host = url.hostname.toLowerCase();
  return SITE_RULES.find((rule) => rule.hosts.test(host));
}

/** Apply `rule` to `document`: cut the chrome, return the element to read. */
export function applySiteRule(document: Document, rule: SiteRule): Element | null {
  for (const selector of rule.remove ?? []) {
    for (const element of Array.from(document.querySelectorAll(selector))) element.remove();
  }
  for (const selector of rule.content ?? []) {
    const found = document.querySelector(selector);
    if (found) return found;
  }
  return null;
}
