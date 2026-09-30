import { formatUrl, parseMarkdown, parseUrl, type InlineSegment, type LayoutNode } from "@mockintosh/sdk";
import { PageError, type DocumentPage, type SiteAdapter } from "../../page";
import {
  GithubError,
  loadPage,
  type CommentInfo,
  type GithubPage,
  type IssueInfo,
  type ProfileRepo,
  type RepoInfo,
} from "./api";
import { commitSubject, formatAge, formatBytes, formatCount } from "./format";
import { formatGithubLocation, parseGithubLocation, type GithubLocation } from "./location";

/** github.com drawn from api.github.com: profiles, repositories, files, issues and pull requests. */
export const githubSite: SiteAdapter = {
  id: "github",
  handles: (url) => /^(www\.)?github\.com$/i.test(url.hostname),
  async load(url, context) {
    const location = parseGithubLocation(formatUrl(url));
    if (!location) throw new PageError("Safari can only show profiles, repositories, files, issues and pull requests on github.com.");
    if (location.kind === "home") return homePage();
    try {
      return githubPage(await loadPage(context.fetch, context.settings.githubToken, location), Date.now());
    } catch (error) {
      if (error instanceof GithubError) throw new PageError(error.message);
      throw error;
    }
  },
};

export function githubUrl(location: GithubLocation): string {
  return location.kind === "home" ? "https://github.com/" : `https://${formatGithubLocation(location)}`;
}

function text(value: string): InlineSegment {
  return { kind: "text", text: value };
}

function bold(value: string): InlineSegment {
  return { kind: "bold", text: value };
}

function link(value: string, location: GithubLocation): InlineSegment {
  return { kind: "link", text: value, href: githubUrl(location) };
}

function paragraph(...segments: InlineSegment[]): LayoutNode {
  return { type: "paragraph", align: "left", segments };
}

function heading(level: 1 | 2 | 3, value: string, href?: string): LayoutNode {
  return href ? { type: "heading", level, text: value, align: "left", href } : { type: "heading", level, text: value, align: "left" };
}

/** Links separated by dots; the current one is bold instead of a link. */
function tabs(items: readonly { label: string; location: GithubLocation; current: boolean }[]): LayoutNode {
  const segments: InlineSegment[] = [];
  items.forEach((item, index) => {
    if (index > 0) segments.push(text("  •  "));
    segments.push(item.current ? bold(item.label) : link(item.label, item.location));
  });
  return paragraph(...segments);
}

function homePage(): DocumentPage {
  return {
    kind: "document",
    url: githubUrl({ kind: "home" }),
    title: "GitHub",
    nodes: [
      heading(1, "GitHub"),
      paragraph(text("Look up a person, an organization or a repository, or type its github.com address in the address bar.")),
      {
        type: "form",
        form: {
          action: "https://github.com/search",
          method: "get",
          controls: [
            { kind: "text", name: "q", value: "", placeholder: "Search repositories" },
            { kind: "submit", name: "", value: "", label: "Search" },
          ],
        },
      },
      paragraph(
        text("For example "),
        link("octocat", { kind: "profile", login: "octocat", tab: "repos" }),
        text(", "),
        link("torvalds/linux", { kind: "tree", owner: "torvalds", repo: "linux", ref: "", path: "" }),
        text(", "),
        link("mockintosh/mockintosh", { kind: "tree", owner: "mockintosh", repo: "mockintosh", ref: "", path: "" }),
        text(" or "),
        link("apple", { kind: "profile", login: "apple", tab: "repos" }),
        text("."),
      ),
    ],
  };
}

export function githubPage(page: GithubPage, now: number): DocumentPage {
  if (page.view === "search") {
    const location: GithubLocation = { kind: "search", query: page.query };
    return {
      kind: "document",
      url: githubUrl(location),
      title: `Search: ${page.query}`,
      nodes: [heading(1, `Repositories matching “${page.query}”`), ...repoList(page.repos, "No repositories matched.")],
    };
  }
  if (page.view === "profile") return profilePage(page);
  return repoPage(page, now);
}

function repoList(repos: readonly ProfileRepo[], empty: string): LayoutNode[] {
  if (repos.length === 0) return [paragraph(text(empty))];
  return repos.flatMap((repo): LayoutNode[] => {
    const location: GithubLocation = { kind: "tree", owner: repo.owner, repo: repo.name, ref: "", path: "" };
    const facts = [repo.language, `${formatCount(repo.stars)} stars`].filter(Boolean).join("  •  ");
    return [
      heading(3, `${repo.owner}/${repo.name}${repo.fork ? " (fork)" : ""}`, githubUrl(location)),
      ...(repo.description ? [paragraph(text(repo.description))] : []),
      paragraph(text(facts)),
    ];
  });
}

/** Sidebar width, as on github.com; the avatar fills it. */
const SIDEBAR = 200;
/** Narrower than this, the sidebar goes above the repositories. */
const TWO_COLUMNS = SIDEBAR + 16 + 220;

/** A repository as a card: name, description, and language / stars / forks. */
function repoCard(repo: ProfileRepo, owner: string): LayoutNode {
  const location: GithubLocation = { kind: "tree", owner: repo.owner, repo: repo.name, ref: "", path: "" };
  const name = repo.owner.toLowerCase() === owner.toLowerCase() ? repo.name : `${repo.owner}/${repo.name}`;
  const facts = [repo.language, `${formatCount(repo.stars)} stars`, repo.forks ? `${formatCount(repo.forks)} forks` : ""]
    .filter(Boolean)
    .join("  •  ");
  return {
    type: "box",
    nodes: [
      paragraph({ kind: "link", text: name, href: githubUrl(location) }, text(repo.fork ? "  Fork" : "  Public")),
      ...(repo.description ? [paragraph(text(repo.description))] : []),
      paragraph(text(facts)),
    ],
  };
}

/** `gustav.io` → `https://gustav.io`, as github.com links a profile's website. */
function websiteHref(blog: string): string {
  return /^https?:\/\//i.test(blog) ? blog : `https://${blog}`;
}

function profileSidebar(page: Extract<GithubPage, { view: "profile" }>): LayoutNode[] {
  const profile = page.profile;
  const isOrg = profile.kind === "Organization";
  const avatar = avatarSrc(profile.avatarUrl);
  const nodes: LayoutNode[] = [];
  if (avatar) {
    nodes.push({ type: "image", src: avatar, alt: profile.login, align: "left", width: SIDEBAR, height: SIDEBAR, borderRadius: SIDEBAR / 2 });
  }
  nodes.push(heading(1, profile.name || profile.login));
  if (profile.name) nodes.push(paragraph(text(profile.login)));
  if (profile.bio) nodes.push(paragraph(text(profile.bio)));
  nodes.push(
    isOrg
      ? paragraph(bold(formatCount(profile.followers)), text(" followers"))
      : paragraph(bold(formatCount(profile.followers)), text(" followers · "), bold(formatCount(profile.following)), text(" following")),
  );
  if (profile.company) nodes.push(paragraph(text(profile.company)));
  if (profile.location) nodes.push(paragraph(text(profile.location)));
  if (profile.blog) nodes.push(paragraph({ kind: "link", text: profile.blog, href: websiteHref(profile.blog) }));
  if (profile.twitter) nodes.push(paragraph({ kind: "link", text: `@${profile.twitter}`, href: `https://x.com/${profile.twitter}` }));
  if (page.orgs.length > 0) {
    nodes.push({ type: "hr" }, heading(3, "Organizations"));
    const segments: InlineSegment[] = [];
    page.orgs.forEach((login, index) => {
      if (index > 0) segments.push(text(", "));
      segments.push(link(login, { kind: "profile", login, tab: "repos" }));
    });
    nodes.push(paragraph(...segments));
  }
  return nodes;
}

function profileMain(page: Extract<GithubPage, { view: "profile" }>): LayoutNode[] {
  const login = page.profile.login;
  if (page.tab === "people") {
    const nodes: LayoutNode[] = [heading(2, "People")];
    if (page.people.length === 0) nodes.push(paragraph(text("No public members.")));
    for (const person of page.people) {
      nodes.push({ type: "listItem", indent: 0, segments: [link(person, { kind: "profile", login: person, tab: "repos" })] });
    }
    return nodes;
  }
  const title = page.tab === "stars" ? "Starred repositories" : "Repositories";
  const empty = page.tab === "stars" ? "No starred repositories." : "No public repositories.";
  if (page.repos.length === 0) return [heading(2, title), paragraph(text(empty))];
  return [heading(2, title), ...page.repos.map((repo) => repoCard(repo, login))];
}

function profilePage(page: Extract<GithubPage, { view: "profile" }>): DocumentPage {
  const profile = page.profile;
  const location: GithubLocation = { kind: "profile", login: profile.login, tab: page.tab };
  const tab = (label: string, name: "repos" | "stars" | "people") => ({
    label,
    location: { kind: "profile", login: profile.login, tab: name } as GithubLocation,
    current: page.tab === name,
  });
  const repositories = `Repositories ${formatCount(profile.publicRepos)}`;
  const nodes: LayoutNode[] = [
    tabs(profile.kind === "Organization"
      ? [tab(repositories, "repos"), tab("People", "people")]
      : [tab(repositories, "repos"), tab("Stars", "stars")]),
    { type: "hr" },
    {
      type: "columns",
      gap: 16,
      minWidth: TWO_COLUMNS,
      columns: [{ width: SIDEBAR, nodes: profileSidebar(page) }, { nodes: profileMain(page) }],
    },
  ];
  return { kind: "document", url: githubUrl(location), title: profile.login, nodes };
}

/** Avatar size asked of GitHub, in pixels; Safari dithers what comes back. */
const AVATAR_SIZE = SIDEBAR;

/** The avatar at {@link AVATAR_SIZE} (`s=`), or "" when there is none to load. */
export function avatarSrc(avatarUrl: string): string {
  const url = parseUrl(avatarUrl);
  if (!url || url.scheme !== "https") return "";
  const query = [...url.query.split("&").filter((pair) => pair && !pair.startsWith("s=")), `s=${AVATAR_SIZE}`].join("&");
  return formatUrl({ ...url, query });
}

type RepoPage = Exclude<GithubPage, { view: "profile" } | { view: "search" }>;

function repoLocation(page: RepoPage): GithubLocation {
  const { owner, name } = page.repo;
  if (page.view === "tree") return { kind: "tree", owner, repo: name, ref: page.ref, path: page.path };
  if (page.view === "blob") return { kind: "blob", owner, repo: name, ref: page.ref, path: page.file.path };
  if (page.view === "issues") return { kind: "issues", owner, repo: name };
  if (page.view === "pulls") return { kind: "pulls", owner, repo: name };
  if (page.view === "issue") return { kind: "issue", owner, repo: name, number: page.issue.number };
  return { kind: "pull", owner, repo: name, number: page.pull.number };
}

function repoHeader(repo: RepoInfo, view: RepoPage["view"], ref: string): LayoutNode[] {
  const root: GithubLocation = { kind: "tree", owner: repo.owner, repo: repo.name, ref: "", path: "" };
  const nodes: LayoutNode[] = [
    heading(1, `${repo.owner}/${repo.name}`, githubUrl(root)),
    paragraph(text(`${repo.visibility} repository by `), link(repo.owner, { kind: "profile", login: repo.owner, tab: "repos" })),
  ];
  if (repo.description) nodes.push(paragraph(text(repo.description)));
  nodes.push(paragraph(text(`${formatCount(repo.stars)} stars  •  ${formatCount(repo.forks)} forks  •  ${formatCount(repo.watchers)} watching`)));
  const facts = [repo.language, repo.license, ...repo.topics].filter(Boolean).join("  •  ");
  if (facts) nodes.push(paragraph(text(facts)));
  if (repo.homepage) nodes.push(paragraph({ kind: "link", text: repo.homepage, href: repo.homepage }));
  const section = view === "issues" || view === "issue" ? "issues" : view === "pulls" || view === "pull" ? "pulls" : "code";
  nodes.push(
    tabs([
      { label: "Code", location: { kind: "tree", owner: repo.owner, repo: repo.name, ref, path: "" }, current: section === "code" },
      { label: "Issues", location: { kind: "issues", owner: repo.owner, repo: repo.name }, current: section === "issues" },
      { label: "Pull requests", location: { kind: "pulls", owner: repo.owner, repo: repo.name }, current: section === "pulls" },
    ]),
  );
  nodes.push({ type: "hr" });
  return nodes;
}

function pathBar(repo: RepoInfo, ref: string, path: string): LayoutNode {
  const parts = path.split("/").filter(Boolean);
  const segments: InlineSegment[] = [link(repo.name, { kind: "tree", owner: repo.owner, repo: repo.name, ref, path: "" })];
  parts.forEach((part, index) => {
    segments.push(text(" / "));
    const location: GithubLocation = { kind: "tree", owner: repo.owner, repo: repo.name, ref, path: parts.slice(0, index + 1).join("/") };
    segments.push(index === parts.length - 1 ? bold(part) : link(part, location));
  });
  return paragraph(...segments);
}

function repoPage(page: RepoPage, now: number): DocumentPage {
  const repo = page.repo;
  const ref = page.view === "tree" || page.view === "blob" ? page.ref : repo.defaultBranch;
  const nodes = repoHeader(repo, page.view, ref);
  const location = repoLocation(page);
  let title = `${repo.owner}/${repo.name}`;

  if (page.view === "tree") {
    nodes.push(paragraph(text("Branch "), bold(page.ref)));
    if (page.commit) {
      const commit = page.commit;
      nodes.push(paragraph({ kind: "code", text: commit.sha }, text(`  ${commitSubject(commit.message)}  •  ${commit.author}  •  ${formatAge(commit.date, now)}`)));
    }
    if (page.path) nodes.push(pathBar(repo, page.ref, page.path));
    for (const entry of page.entries) {
      const target: GithubLocation = entry.type === "dir"
        ? { kind: "tree", owner: repo.owner, repo: repo.name, ref: page.ref, path: entry.path }
        : { kind: "blob", owner: repo.owner, repo: repo.name, ref: page.ref, path: entry.path };
      nodes.push({ type: "listItem", indent: 0, segments: [link(entry.type === "dir" ? `${entry.name}/` : entry.name, target)] });
    }
    if (page.readme) {
      nodes.push({ type: "hr" }, heading(2, "README"));
      nodes.push(...resolveRelative(parseMarkdown(page.readme), repo, page.ref, page.path));
    }
  } else if (page.view === "blob") {
    const file = page.file;
    title = `${file.name} • ${title}`;
    nodes.push(pathBar(repo, page.ref, file.path), paragraph(text(formatBytes(file.size))));
    if (file.note) nodes.push(paragraph({ kind: "italic", text: file.note }));
    if (file.text !== null) {
      const dir = file.path.split("/").slice(0, -1).join("/");
      nodes.push(...(/\.(md|markdown)$/i.test(file.name)
        ? resolveRelative(parseMarkdown(file.text), repo, page.ref, dir)
        : [{ type: "code", text: file.text } as LayoutNode]));
    }
  } else if (page.view === "issues" || page.view === "pulls") {
    const items = page.view === "pulls" ? page.pulls : page.issues;
    if (items.length === 0) nodes.push(paragraph(text(page.view === "pulls" ? "No open pull requests." : "No open issues.")));
    for (const item of items) {
      const target: GithubLocation = page.view === "pulls"
        ? { kind: "pull", owner: repo.owner, repo: repo.name, number: item.number }
        : { kind: "issue", owner: repo.owner, repo: repo.name, number: item.number };
      nodes.push(heading(3, item.title, githubUrl(target)), paragraph(text(issueLine(item, now))));
    }
  } else {
    const item = page.view === "pull" ? page.pull : page.issue;
    title = `${item.title} • #${item.number}`;
    nodes.push(heading(2, item.title), paragraph(text(issueLine(item, now))));
    nodes.push(...(item.body ? resolveRelative(parseMarkdown(item.body), repo, repo.defaultBranch, "") : [paragraph({ kind: "italic", text: "No description." })]));
    for (const comment of page.comments) nodes.push(...commentNodes(comment, repo, now));
  }
  return { kind: "document", url: githubUrl(location), title, nodes };
}

function issueLine(item: IssueInfo, now: number): string {
  return `#${item.number} ${item.state}, opened ${formatAge(item.createdAt, now)} by ${item.user}  •  ${item.comments} comments`;
}

function commentNodes(comment: CommentInfo, repo: RepoInfo, now: number): LayoutNode[] {
  return [
    { type: "hr" },
    paragraph(bold(comment.user), text(`  •  ${formatAge(comment.createdAt, now)}`)),
    ...resolveRelative(parseMarkdown(comment.body), repo, repo.defaultBranch, ""),
  ];
}

/**
 * Markdown in a repository links relative to its own directory. Point those
 * links at the file on github.com and images at their raw bytes, so they work
 * from whatever page shows the markdown.
 */
export function resolveRelative(nodes: readonly LayoutNode[], repo: RepoInfo, ref: string, dir: string): LayoutNode[] {
  const branch = ref || repo.defaultBranch;
  const base = `https://github.com/${repo.owner}/${repo.name}/blob/${branch}/${dir ? `${dir}/` : ""}`;
  const rawBase = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${dir ? `${dir}/` : ""}`;
  const absolute = (href: string, against: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return href;
    const url = parseUrl(href, against);
    return url ? formatUrl(url) : href;
  };
  const segments = (list: readonly InlineSegment[]) =>
    list.map((segment) => (segment.kind === "link" ? { ...segment, href: absolute(segment.href, base) } : segment));
  return nodes.map((node) => {
    if (node.type === "paragraph" || node.type === "listItem") return { ...node, segments: segments(node.segments) };
    if (node.type === "image") return { ...node, src: absolute(node.src, rawBase) };
    if (node.type === "table") return { ...node, rows: node.rows.map((row) => ({ ...row, cells: row.cells.map(segments) })) };
    return node;
  });
}
