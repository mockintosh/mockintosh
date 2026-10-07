import { formatUrl, parseMarkdown, parseUrl, queryParams, type FormControl, type InlineSegment, type LayoutNode, type WebUrl } from "@mockintosh/sdk";
import { PageError, type DocumentPage, type SiteContext, type SiteAdapter } from "../../page";
import {
  GithubError,
  addDiscussionComment,
  addIssueComment,
  createDiscussion,
  createIssue,
  getViewer,
  loadPage,
  type ApiLocation,
  type CommentInfo,
  type DiscussionInfo,
  type GithubPage,
  type IssueInfo,
  type ProfileRepo,
  type RepoInfo,
} from "./api";
import { commitSubject, formatAge, formatBytes, formatCount } from "./format";
import { formatGithubLocation, parseGithubLocation, type GithubLocation } from "./location";

/**
 * github.com drawn from api.github.com: profiles, repositories, files,
 * issues, pull requests and discussions. Signed in, its forms open issues
 * and discussions and comment on them.
 */
export const githubSite: SiteAdapter = {
  id: "github",
  handles: (url) => /^(www\.)?github\.com$/i.test(url.hostname),
  load: (url, context) => loadLocation(locationOf(url), context, {}),
  async submit(url, body, context) {
    const location = locationOf(url);
    const fields = Object.fromEntries(queryParams(body).map((field) => [field.name, field.value]));
    if (location.kind === "login" || location.kind === "logout") {
      const returnTo = fields.return_to || location.returnTo;
      if (location.kind === "logout") {
        await context.github?.signOut();
        return loadLocation(returnLocation(returnTo), withToken(context, ""), {});
      }
      if (!context.github) throw new PageError(NO_PHONE_SIGN_IN);
      const token = await context.github.signIn();
      if (token === null) return loadLocation({ kind: "login", returnTo }, context, {});
      return loadLocation(returnLocation(returnTo), withToken(context, token), {});
    }
    const posted = postedLocation(location, fields);
    if (!posted) throw new PageError("Safari can't send that form to GitHub.");
    try {
      return loadLocation(await post(posted, fields, context), context, {});
    } catch (error) {
      if (!(error instanceof GithubError)) throw error;
      // Back to the form, with what was written and why GitHub refused it.
      return loadLocation(posted.form, context, { draft: fields, error: error.message });
    }
  },
};

const NO_PHONE_SIGN_IN = "This Macintosh can't sign in from a phone. Bookmarks › GitHub Token… takes a personal access token instead.";

/** A form on a GitHub page: what was written, and why GitHub refused it. */
interface FormState {
  draft?: Record<string, string>;
  error?: string;
}

/** How forms are drawn: signed in or not, and anything to put back in them. */
export interface PageForms extends FormState {
  signedIn: boolean;
}

function locationOf(url: WebUrl): GithubLocation {
  const location = parseGithubLocation(formatUrl(url));
  if (!location) throw new PageError("Safari can only show profiles, repositories, files, issues, pull requests and discussions on github.com.");
  return location;
}

function withToken(context: SiteContext, githubToken: string): SiteContext {
  return { ...context, settings: { ...context.settings, githubToken } };
}

/** Where to go after signing in or out: a page on github.com, or the home page. */
function returnLocation(returnTo: string): GithubLocation {
  const location = /^https:\/\/(?:www\.)?github\.com(?:[/?#]|$)/i.test(returnTo) ? parseGithubLocation(returnTo) : null;
  return location && location.kind !== "login" && location.kind !== "logout" ? location : { kind: "home" };
}

async function loadLocation(location: GithubLocation, context: SiteContext, state: FormState): Promise<DocumentPage> {
  const token = context.settings.githubToken;
  if (location.kind === "home") return homePage(token ? await viewerOrEmpty(context) : "");
  if (location.kind === "login") return loginPage(location.returnTo, token ? await viewerOrEmpty(context) : null, token !== "", !!context.github);
  if (location.kind === "logout") return loginPage(location.returnTo, token ? await viewerOrEmpty(context) : null, token !== "", !!context.github);
  if (!token && (location.kind === "discussions" || location.kind === "discussion" || location.kind === "newDiscussion")) {
    return signInFirstPage(location, "GitHub shows discussions only to people who are signed in.");
  }
  try {
    return githubPage(await loadPage(context.fetch, token, location), Date.now(), { signedIn: token !== "", ...state });
  } catch (error) {
    if (error instanceof GithubError) throw new PageError(error.message);
    throw error;
  }
}

async function viewerOrEmpty(context: SiteContext): Promise<string> {
  try {
    return await getViewer(context.fetch, context.settings.githubToken);
  } catch {
    return "";
  }
}

/** Where a form posts, and the page that shows the form again if GitHub refuses it. */
type Posted =
  | { kind: "issue"; owner: string; repo: string; form: ApiLocation }
  | { kind: "issueComment"; owner: string; repo: string; number: number; form: ApiLocation }
  | { kind: "discussion"; owner: string; repo: string; form: ApiLocation }
  | { kind: "discussionComment"; owner: string; repo: string; number: number; form: ApiLocation };

/** Forms post where github.com's own do: a list makes a new item, an item takes a comment. */
function postedLocation(location: GithubLocation, fields: Record<string, string>): Posted | null {
  if (!("owner" in location)) return null;
  const { owner, repo } = location;
  if (location.kind === "issues") return { kind: "issue", owner, repo, form: { kind: "newIssue", owner, repo } };
  if (location.kind === "issue" || location.kind === "pull") return { kind: "issueComment", owner, repo, number: location.number, form: location };
  if (location.kind === "discussions") {
    return { kind: "discussion", owner, repo, form: { kind: "newDiscussion", owner, repo, category: fields.category ?? "" } };
  }
  if (location.kind === "discussion") return { kind: "discussionComment", owner, repo, number: location.number, form: location };
  return null;
}

/** Sends the form to GitHub; resolves with the page that shows what it made. */
async function post(posted: Posted, fields: Record<string, string>, context: SiteContext): Promise<GithubLocation> {
  const { fetch } = context;
  const token = context.settings.githubToken;
  if (!token) throw new GithubError("Sign in to GitHub first.", 401);
  const { owner, repo } = posted;
  const title = (fields.title ?? "").trim();
  const body = fields.body ?? "";
  if (posted.kind === "issue") {
    if (!title) throw new GithubError("An issue needs a title.", 422);
    return { kind: "issue", owner, repo, number: await createIssue(fetch, token, owner, repo, title, body) };
  }
  if (posted.kind === "discussion") {
    if (!title) throw new GithubError("A discussion needs a title.", 422);
    if (!body.trim()) throw new GithubError("A discussion needs something written in it.", 422);
    return { kind: "discussion", owner, repo, number: await createDiscussion(fetch, token, owner, repo, fields.category ?? "", title, body) };
  }
  if (!body.trim()) throw new GithubError("Write a comment first.", 422);
  if (posted.kind === "issueComment") {
    await addIssueComment(fetch, token, owner, repo, posted.number, body);
    return posted.form;
  }
  await addDiscussionComment(fetch, token, owner, repo, posted.number, body);
  return posted.form;
}

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

/** `viewer` is the signed-in login, or empty. */
function homePage(viewer: string): DocumentPage {
  const account = viewer
    ? paragraph(text("Signed in as "), link(viewer, { kind: "profile", login: viewer, tab: "repos" }), text(". "), link("Account", { kind: "login", returnTo: "" }))
    : paragraph(link("Sign in", { kind: "login", returnTo: "" }), text(" to open issues and discussions and to comment."));
  return {
    kind: "document",
    url: githubUrl({ kind: "home" }),
    title: "GitHub",
    nodes: [
      heading(1, "GitHub"),
      account,
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

/**
 * `/login`: a button that puts up the phone sign-in sheet, or, signed in,
 * who as and a button to sign out. `viewer` is null when signed out, and
 * empty when GitHub wouldn't say whose the token is.
 */
function loginPage(returnTo: string, viewer: string | null, signedIn: boolean, canSignIn: boolean): DocumentPage {
  const url = githubUrl({ kind: "login", returnTo });
  if (signedIn) {
    const who = viewer
      ? paragraph(text("Safari is signed in to GitHub as "), link(viewer, { kind: "profile", login: viewer, tab: "repos" }), text("."))
      : paragraph(text("Safari has a GitHub token, but GitHub won't say whose it is. It may have expired or been revoked."));
    return {
      kind: "document",
      url,
      title: "GitHub Account",
      nodes: [heading(1, "GitHub Account"), who, buttonForm({ kind: "logout", returnTo }, "Sign Out")],
    };
  }
  const nodes: LayoutNode[] = [
    heading(1, "Sign in to GitHub"),
    paragraph(text("Signed in, Safari can open issues and discussions and comment on them as you, on public repositories.")),
  ];
  if (canSignIn) {
    nodes.push(
      paragraph(text("Safari shows a code. Scan it with your phone and sign in to GitHub there; nothing is typed on this Macintosh.")),
      buttonForm({ kind: "login", returnTo }, "Sign In"),
    );
  } else {
    nodes.push(paragraph(text(NO_PHONE_SIGN_IN)));
  }
  return { kind: "document", url, title: "Sign in to GitHub", nodes };
}

/** A page that needs an account, asking to sign in first. */
function signInFirstPage(location: GithubLocation, why: string): DocumentPage {
  return {
    kind: "document",
    url: githubUrl(location),
    title: "Sign in to GitHub",
    nodes: [heading(1, "Sign in to GitHub"), paragraph(text(why)), signInForm(location, "Sign In")],
  };
}

/** A form that is only a button, posting to `location`. */
function buttonForm(location: Extract<GithubLocation, { kind: "login" | "logout" }>, label: string): LayoutNode {
  return {
    type: "form",
    form: {
      action: `https://github.com/${location.kind}`,
      method: "post",
      controls: [
        { kind: "hidden", name: "return_to", value: location.returnTo },
        { kind: "submit", name: "", value: "", label },
      ],
    },
  };
}

/** Sign in, then come back to `location`. */
function signInForm(location: GithubLocation, label: string): LayoutNode {
  return buttonForm({ kind: "login", returnTo: githubUrl(location) }, label);
}

/** A form that posts to `location`, with what was written put back and why GitHub refused it above. */
function postForm(location: GithubLocation, forms: PageForms, controls: FormControl[]): LayoutNode[] {
  const draft = forms.draft ?? {};
  const filled = controls.map((control) => (control.kind === "submit" || draft[control.name] === undefined ? control : { ...control, value: draft[control.name] }));
  const form: LayoutNode = { type: "form", form: { action: githubUrl(location), method: "post", controls: filled } };
  return forms.error ? [paragraph(bold(forms.error)), form] : [form];
}

function commentForm(location: GithubLocation, forms: PageForms): LayoutNode[] {
  if (!forms.signedIn) return [{ type: "hr" }, signInForm(location, "Sign In to Comment")];
  return [
    { type: "hr" },
    heading(3, "Add a comment"),
    ...postForm(location, forms, [
      { kind: "textarea", name: "body", value: "", rows: 5 },
      { kind: "submit", name: "", value: "", label: "Comment" },
    ]),
  ];
}

export function githubPage(page: GithubPage, now: number, forms: PageForms = { signedIn: false }): DocumentPage {
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
  return repoPage(page, now, forms);
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
  if (page.view === "pull") return { kind: "pull", owner, repo: name, number: page.pull.number };
  if (page.view === "newIssue") return { kind: "newIssue", owner, repo: name };
  if (page.view === "discussions") return { kind: "discussions", owner, repo: name };
  if (page.view === "discussion") return { kind: "discussion", owner, repo: name, number: page.discussion.number };
  return { kind: "newDiscussion", owner, repo: name, category: page.category?.slug ?? "" };
}

type RepoSection = "code" | "issues" | "pulls" | "discussions";

function sectionOf(view: RepoPage["view"]): RepoSection {
  if (view === "issues" || view === "issue" || view === "newIssue") return "issues";
  if (view === "pulls" || view === "pull") return "pulls";
  if (view === "discussions" || view === "discussion" || view === "newDiscussion") return "discussions";
  return "code";
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
  const section = sectionOf(view);
  const sections = [
    { label: "Code", location: { kind: "tree", owner: repo.owner, repo: repo.name, ref, path: "" } as GithubLocation, current: section === "code" },
    { label: "Issues", location: { kind: "issues", owner: repo.owner, repo: repo.name } as GithubLocation, current: section === "issues" },
    { label: "Pull requests", location: { kind: "pulls", owner: repo.owner, repo: repo.name } as GithubLocation, current: section === "pulls" },
  ];
  if (repo.hasDiscussions || section === "discussions") {
    sections.push({ label: "Discussions", location: { kind: "discussions", owner: repo.owner, repo: repo.name }, current: section === "discussions" });
  }
  nodes.push(tabs(sections));
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

function repoPage(page: RepoPage, now: number, forms: PageForms): DocumentPage {
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
    if (page.view === "issues") nodes.push(paragraph(link("New issue", { kind: "newIssue", owner: repo.owner, repo: repo.name })));
    if (items.length === 0) nodes.push(paragraph(text(page.view === "pulls" ? "No open pull requests." : "No open issues.")));
    for (const item of items) {
      const target: GithubLocation = page.view === "pulls"
        ? { kind: "pull", owner: repo.owner, repo: repo.name, number: item.number }
        : { kind: "issue", owner: repo.owner, repo: repo.name, number: item.number };
      nodes.push(heading(3, item.title, githubUrl(target)), paragraph(text(issueLine(item, now))));
    }
  } else if (page.view === "newIssue") {
    title = `New issue • ${title}`;
    nodes.push(heading(2, "New issue"));
    if (!forms.signedIn) nodes.push(signInForm(location, "Sign In to Open an Issue"));
    else {
      nodes.push(...postForm({ kind: "issues", owner: repo.owner, repo: repo.name }, forms, [
        { kind: "text", name: "title", value: "", placeholder: "Title" },
        { kind: "textarea", name: "body", value: "", rows: 10 },
        { kind: "submit", name: "", value: "", label: "Submit new issue" },
      ]));
    }
  } else if (page.view === "discussions") {
    title = `Discussions • ${title}`;
    nodes.push(paragraph(link("New discussion", { kind: "newDiscussion", owner: repo.owner, repo: repo.name, category: "" })));
    if (page.discussions.length === 0) nodes.push(paragraph(text("No discussions yet.")));
    for (const item of page.discussions) {
      const target: GithubLocation = { kind: "discussion", owner: repo.owner, repo: repo.name, number: item.number };
      nodes.push(heading(3, item.title, githubUrl(target)), paragraph(text(discussionLine(item, now))));
    }
  } else if (page.view === "newDiscussion") {
    title = `New discussion • ${title}`;
    nodes.push(...newDiscussionNodes(page, forms));
  } else if (page.view === "discussion") {
    const item = page.discussion;
    title = `${item.title} • Discussion #${item.number}`;
    nodes.push(heading(2, item.title), paragraph(text(discussionLine(item, now))));
    nodes.push(...markdownOr(item.body, repo, "No description."));
    for (const comment of page.comments) nodes.push(...commentNodes(comment, repo, now));
    nodes.push(...commentForm(location, forms));
  } else {
    const item = page.view === "pull" ? page.pull : page.issue;
    title = `${item.title} • #${item.number}`;
    nodes.push(heading(2, item.title), paragraph(text(issueLine(item, now))));
    nodes.push(...markdownOr(item.body, repo, "No description."));
    for (const comment of page.comments) nodes.push(...commentNodes(comment, repo, now));
    nodes.push(...commentForm(location, forms));
  }
  return { kind: "document", url: githubUrl(location), title, nodes };
}

function issueLine(item: IssueInfo, now: number): string {
  return `#${item.number} ${item.state}, opened ${formatAge(item.createdAt, now)} by ${item.user}  •  ${item.comments} comments`;
}

function discussionLine(item: DiscussionInfo, now: number): string {
  const facts = [item.category, `#${item.number} opened ${formatAge(item.createdAt, now)} by ${item.user}`, `${item.comments} comments`];
  if (item.answered) facts.push("Answered");
  return facts.filter(Boolean).join("  •  ");
}

function markdownOr(body: string, repo: RepoInfo, empty: string): LayoutNode[] {
  return body ? resolveRelative(parseMarkdown(body), repo, repo.defaultBranch, "") : [paragraph({ kind: "italic", text: empty })];
}

/** Indent of a reply under its discussion comment. */
const REPLY_INDENT = 16;

function commentNodes(comment: CommentInfo, repo: RepoInfo, now: number): LayoutNode[] {
  const byline = (item: CommentInfo) => paragraph(bold(item.user), text(`  •  ${formatAge(item.createdAt, now)}${item.answer ? "  •  Answer" : ""}`));
  const replies = (comment.replies ?? []).map((reply): LayoutNode => ({
    type: "columns",
    gap: 0,
    minWidth: 0,
    columns: [{ width: REPLY_INDENT, nodes: [] }, { nodes: [byline(reply), ...markdownOr(reply.body, repo, "")] }],
  }));
  return [{ type: "hr" }, byline(comment), ...markdownOr(comment.body, repo, ""), ...replies];
}

/** Choose a category, as github.com asks first; then the title and what to say. */
function newDiscussionNodes(page: Extract<GithubPage, { view: "newDiscussion" }>, forms: PageForms): LayoutNode[] {
  const { repo, category } = page;
  if (!category) {
    const nodes: LayoutNode[] = [heading(2, "Start a new discussion"), paragraph(text("Select a category:"))];
    for (const item of page.categories) {
      const target: GithubLocation = { kind: "newDiscussion", owner: repo.owner, repo: repo.name, category: item.slug };
      nodes.push(heading(3, item.name, githubUrl(target)));
      if (item.description) nodes.push(paragraph(text(item.description)));
    }
    if (page.categories.length === 0) nodes.push(paragraph(text("This repository has no discussion categories.")));
    return nodes;
  }
  const here: GithubLocation = { kind: "newDiscussion", owner: repo.owner, repo: repo.name, category: category.slug };
  const nodes: LayoutNode[] = [heading(2, `New discussion in ${category.name}`)];
  if (category.description) nodes.push(paragraph(text(category.description)));
  if (!forms.signedIn) return [...nodes, signInForm(here, "Sign In to Start a Discussion")];
  return [
    ...nodes,
    ...postForm({ kind: "discussions", owner: repo.owner, repo: repo.name }, forms, [
      { kind: "hidden", name: "category", value: category.slug },
      { kind: "text", name: "title", value: "", placeholder: "Title" },
      { kind: "textarea", name: "body", value: "", rows: 10 },
      { kind: "submit", name: "", value: "", label: "Start discussion" },
    ]),
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
