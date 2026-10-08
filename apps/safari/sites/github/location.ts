import { queryParam } from "@mockintosh/sdk";

/** A place on github.com that the app can show. */
/** A profile's tabs: Overview is its front page; Repositories is `?tab=repositories`. */
export type ProfileTab = "overview" | "repos" | "stars" | "people";

export type GithubLocation =
  | { kind: "home" }
  | { kind: "search"; query: string }
  | { kind: "profile"; login: string; tab: ProfileTab }
  | { kind: "tree"; owner: string; repo: string; ref: string; path: string }
  | { kind: "blob"; owner: string; repo: string; ref: string; path: string }
  /** `state: "closed"` lists the closed ones; omitted, the open ones. */
  | { kind: "issues"; owner: string; repo: string; state?: "closed" }
  | { kind: "issue"; owner: string; repo: string; number: number }
  | { kind: "newIssue"; owner: string; repo: string }
  | { kind: "pulls"; owner: string; repo: string; state?: "closed" }
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
    return { kind: "profile", login: parts[1], tab: section === "people" ? "people" : section ? "repos" : tab };
  }
  if (parts.length < 2) return null;
  const [owner, repo, ...rest] = parts;
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  if (rest.length === 0) return { kind: "tree", owner, repo, ref: "", path: "" };

  const [head, second, ...tail] = rest;
  if (head === "issues") {
    if (rest.length === 1) return closedList({ kind: "issues", owner, repo }, query);
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
  if (head === "pulls") return rest.length === 1 ? closedList({ kind: "pulls", owner, repo }, query) : null;
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
    if (location.tab === "overview") return root;
    return `${root}?tab=${location.tab === "repos" ? "repositories" : location.tab}`;
  }
  const root = `github.com/${location.owner}/${location.repo}`;
  // github.com's own filter for the closed ones: `is:issue is:closed`.
  if (location.kind === "issues") return location.state === "closed" ? `${root}/issues?q=is%3Aissue+is%3Aclosed` : `${root}/issues`;
  if (location.kind === "issue") return `${root}/issues/${location.number}`;
  if (location.kind === "newIssue") return `${root}/issues/new`;
  if (location.kind === "discussions") return `${root}/discussions`;
  if (location.kind === "discussion") return `${root}/discussions/${location.number}`;
  if (location.kind === "newDiscussion") {
    return location.category ? `${root}/discussions/new?category=${encodeURIComponent(location.category)}` : `${root}/discussions/new`;
  }
  if (location.kind === "pulls") return location.state === "closed" ? `${root}/pulls?q=is%3Apr+is%3Aclosed` : `${root}/pulls`;
  if (location.kind === "pull") return `${root}/pull/${location.number}`;
  if (!location.ref && !location.path) return root;
  const ref = encodeSegment(location.ref || "HEAD");
  const path = location.path.split("/").filter(Boolean).map(encodeSegment).join("/");
  const suffix = path ? `${ref}/${path}` : ref;
  return `${root}/${location.kind}/${suffix}`;
}

/** A list of issues or pull requests, closed when its query asks for them: `?q=… is:closed` (or `state:closed`), or `?state=closed`. */
function closedList<T extends { kind: "issues" | "pulls" }>(list: T, query: string): T {
  const filter = queryParam(query, "q") ?? "";
  const closed = queryParam(query, "state") === "closed" || /(?:^|\s)(?:is|state):closed(?:\s|$)/.test(filter);
  return closed ? { ...list, state: "closed" } : list;
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
  if (tab === "repositories" || tab === "repos") return "repos";
  return "overview";
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
