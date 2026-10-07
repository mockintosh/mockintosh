import { queryParam } from "@mockintosh/sdk";

/** A place on github.com that the app can show. */
export type ProfileTab = "repos" | "stars" | "people";

export type GithubLocation =
  | { kind: "home" }
  | { kind: "search"; query: string }
  | { kind: "profile"; login: string; tab: ProfileTab }
  | { kind: "tree"; owner: string; repo: string; ref: string; path: string }
  | { kind: "blob"; owner: string; repo: string; ref: string; path: string }
  | { kind: "issues"; owner: string; repo: string }
  | { kind: "issue"; owner: string; repo: string; number: number }
  | { kind: "newIssue"; owner: string; repo: string }
  | { kind: "pulls"; owner: string; repo: string }
  | { kind: "pull"; owner: string; repo: string; number: number }
  | { kind: "discussions"; owner: string; repo: string }
  | { kind: "discussion"; owner: string; repo: string; number: number }
  /** `category` is a category's slug; empty asks for one. */
  | { kind: "newDiscussion"; owner: string; repo: string; category: string }
  /** Signing in or out, then back to `returnTo` (a github.com URL, or empty for the home page). */
  | { kind: "login"; returnTo: string }
  | { kind: "logout"; returnTo: string };

const NAME = /^[\w.-]+$/;

/** Turn an address-bar string into a location. Empty input is the start page. */
export function parseGithubLocation(raw: string): GithubLocation | null {
  let text = raw.trim();
  if (!text) return { kind: "home" };
  const search = /^(?:https?:\/\/)?(?:www\.)?github\.com\/search\/?(?:\?(.*))?$/i.exec(text);
  if (search) {
    const query = queryParam(search[1] ?? "", "q")?.trim() ?? "";
    return query ? { kind: "search", query } : { kind: "home" };
  }
  const tab = profileTab(text);
  const query = /\?([^#]*)/.exec(text)?.[1] ?? "";
  text = text.replace(/[?#].*$/, "").replace(/\/+$/, "");
  text = text.replace(/^https?:\/\//i, "").replace(/^(?:www\.)?github\.com(?:\/|$)/i, "").replace(/^\/+/, "");
  const parts = text.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) return { kind: "home" };
  if (parts.length === 1 && (parts[0] === "login" || parts[0] === "logout")) {
    return { kind: parts[0], returnTo: returnTo(queryParam(query, "return_to")) };
  }
  if (parts.length === 1) {
    return NAME.test(parts[0]) ? { kind: "profile", login: parts[0], tab } : null;
  }
  if (parts[0] === "orgs" && parts[1] && NAME.test(parts[1])) {
    const section = parts[2];
    if (parts.length > 3) return null;
    if (section && section !== "people" && section !== "repositories" && section !== "repos") return null;
    return { kind: "profile", login: parts[1], tab: section === "people" ? "people" : tab };
  }
  if (parts.length < 2) return null;
  const [owner, repo, ...rest] = parts;
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  if (rest.length === 0) return { kind: "tree", owner, repo, ref: "", path: "" };

  const [head, second, ...tail] = rest;
  if (head === "issues") {
    if (rest.length === 1) return { kind: "issues", owner, repo };
    if (second === "new") return tail.length > 0 ? null : { kind: "newIssue", owner, repo };
    const number = issueNumber(second);
    return number === null || tail.length > 0 ? null : { kind: "issue", owner, repo, number };
  }
  if (head === "discussions") {
    if (rest.length === 1) return { kind: "discussions", owner, repo };
    if (second === "new") return tail.length > 0 ? null : { kind: "newDiscussion", owner, repo, category: queryParam(query, "category") ?? "" };
    const number = issueNumber(second);
    return number === null || tail.length > 0 ? null : { kind: "discussion", owner, repo, number };
  }
  if (head === "pulls") return rest.length === 1 ? { kind: "pulls", owner, repo } : null;
  if (head === "pull") {
    const number = issueNumber(second);
    return number === null ? null : { kind: "pull", owner, repo, number };
  }
  if (head === "tree" || head === "blob") {
    if (!second) return { kind: "tree", owner, repo, ref: "", path: "" };
    const path = tail.map(decodeSegment).join("/");
    return { kind: head, owner, repo, ref: decodeSegment(second), path };
  }
  return null;
}

/** Address-bar text for a location, without a scheme. */
export function formatGithubLocation(location: GithubLocation): string {
  if (location.kind === "home") return "";
  if (location.kind === "login" || location.kind === "logout") {
    const root = `github.com/${location.kind}`;
    return location.returnTo ? `${root}?return_to=${encodeURIComponent(location.returnTo)}` : root;
  }
  if (location.kind === "search") return `github.com/search?q=${encodeURIComponent(location.query)}`;
  if (location.kind === "profile") {
    const root = `github.com/${location.login}`;
    return location.tab === "repos" ? root : `${root}?tab=${location.tab}`;
  }
  const root = `github.com/${location.owner}/${location.repo}`;
  if (location.kind === "issues") return `${root}/issues`;
  if (location.kind === "issue") return `${root}/issues/${location.number}`;
  if (location.kind === "newIssue") return `${root}/issues/new`;
  if (location.kind === "discussions") return `${root}/discussions`;
  if (location.kind === "discussion") return `${root}/discussions/${location.number}`;
  if (location.kind === "newDiscussion") {
    return location.category ? `${root}/discussions/new?category=${encodeURIComponent(location.category)}` : `${root}/discussions/new`;
  }
  if (location.kind === "pulls") return `${root}/pulls`;
  if (location.kind === "pull") return `${root}/pull/${location.number}`;
  if (!location.ref && !location.path) return root;
  const ref = encodeSegment(location.ref || "HEAD");
  const path = location.path.split("/").filter(Boolean).map(encodeSegment).join("/");
  const suffix = path ? `${ref}/${path}` : ref;
  return `${root}/${location.kind}/${suffix}`;
}

/** Only addresses on github.com come back from signing in. */
function returnTo(raw: string | null): string {
  if (!raw) return "";
  return /^https:\/\/(?:www\.)?github\.com(?:[/?#]|$)/i.test(raw) ? raw : "";
}

function profileTab(raw: string): ProfileTab {
  const tab = raw.match(/[?&]tab=([^&#]+)/i)?.[1] ?? "";
  if (tab === "stars") return "stars";
  if (tab === "people" || tab === "members") return "people";
  return "repos";
}

function issueNumber(segment: string | undefined): number | null {
  if (!segment || !/^\d+$/.test(segment)) return null;
  const number = Number(segment);
  return number > 0 ? number : null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%2F/gi, "/");
}
