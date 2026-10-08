import { formatUrl, parseMarkdown, parseUrl, queryParams, type BitmapTip, type FormControl, type MenuEntry, type InlineSegment, type LayoutNode, type WebUrl } from "@mockintosh/sdk";
import { PageError, type DocumentPage, type SiteContext, type SiteAdapter } from "../../page";
import {
  GithubError,
  addDiscussionComment,
  addIssueComment,
  createDiscussion,
  createIssue,
  getViewer,
  setStarred,
  listViewerRepos,
  loadPage,
  type ApiLocation,
  type CommentInfo,
  type DiscussionInfo,
  type GithubPage,
  type IssueInfo,
  type CalendarWeek,
  type ProfileExtras,
  type ProfileRepo,
  type RepoContributions,
  type RepoInfo,
} from "./api";
import { commitSubject, formatAge, formatBytes, formatCount } from "./format";
import { GITHUB_MARK, GITHUB_STAR, GITHUB_STARRED } from "./icons";
import { formatGithubLocation, parseGithubLocation, type GithubLocation, type ProfileTab } from "./location";

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
      // A star has no form to come back to: say why GitHub refused it.
      if (posted.kind === "star") throw new PageError(error.message);
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
  const viewer = context.settings.githubToken ? viewerOf(context) : Promise.resolve(null);
  if (location.kind === "login" || location.kind === "logout") {
    return withHeader(loginPage(location.returnTo, await viewer, !!context.github), null, false);
  }
  const [who, page] = await Promise.all([viewer, loadBody(location, context, state)]);
  return withHeader(page, who);
}

async function loadBody(location: Exclude<GithubLocation, { kind: "login" | "logout" }>, context: SiteContext, state: FormState): Promise<DocumentPage> {
  const token = context.settings.githubToken;
  if (location.kind === "home") return homePage(token ? await topRepos(context) : null);
  if (!token && (location.kind === "discussions" || location.kind === "discussion" || location.kind === "newDiscussion")) {
    return signInFirstPage(location, "GitHub shows discussions only to people who are signed in.");
  }
  // "Search or jump to…": an owner/repo goes straight to the repository.
  const jump = location.kind === "search" ? /^\s*([\w.-]+)\/([\w.-]+)\s*$/.exec(location.query) : null;
  const target: ApiLocation = jump ? { kind: "tree", owner: jump[1], repo: jump[2], ref: "", path: "" } : location;
  try {
    return githubPage(await loadPage(context.fetch, token, target), Date.now(), { signedIn: token !== "", ...state });
  } catch (error) {
    if (error instanceof GithubError) throw new PageError(error.message);
    throw error;
  }
}

/** The dashboard's repositories; none rather than a broken home page when GitHub won't list them. */
async function topRepos(context: SiteContext): Promise<ProfileRepo[]> {
  try {
    return await listViewerRepos(context.fetch, context.settings.githubToken);
  } catch {
    return [];
  }
}

/** Logins by token, so the header asks GitHub once rather than on every page. */
const viewers = new Map<string, Promise<string>>();

/** Whose the token is, or empty when GitHub won't say (expired, revoked, offline). */
function viewerOf(context: SiteContext): Promise<string> {
  const token = context.settings.githubToken;
  let viewer = viewers.get(token);
  if (!viewer) {
    viewer = getViewer(context.fetch, token).catch(() => {
      viewers.delete(token);
      return "";
    });
    viewers.set(token, viewer);
  }
  return viewer;
}

/** Header columns: GitHub's mark, the search field, and the account corner, signed in (the login, right-aligned) and out (the Sign In button). */
const MARK_SIZE = 16;
const SEARCH_WIDTH = 110;
const ACCOUNT_WIDTH = 90;
const SIGN_IN_WIDTH = 48;

/** A page as these builders make it: its tabs (`nav`) go in the header, under the search and account, as on github.com. */
type GithubDocument = DocumentPage & { nav?: LayoutNode };

/** Where the page is, beside the mark: "owner / repo" in a repository, the login on a profile. */
function crumbs(url: string): LayoutNode[] {
  const location = parseGithubLocation(url);
  if (!location) return [];
  if ("owner" in location) {
    return [paragraph(
      link(location.owner, { kind: "profile", login: location.owner, tab: "overview" }),
      text(" / "),
      link(location.repo, { kind: "tree", owner: location.owner, repo: location.repo, ref: "", path: "" }),
    )];
  }
  if (location.kind === "profile") return [paragraph(link(location.login, { ...location, tab: "overview" }))];
  return [];
}

/**
 * The band across the top of every GitHub page, as on github.com: the home
 * link and where the page is, "Search or jump to…" and the account in the
 * corner, then the page's tabs, ruled off from the page. `viewer` is the
 * signed-in login (empty when GitHub won't say whose the token is), or
 * null when signed out. The sign-in page leaves the corner empty: it is
 * the account page.
 */
function withHeader(page: GithubDocument, viewer: string | null, account = true): DocumentPage {
  const corner: LayoutNode[] = !account
    ? []
    : viewer === null
      ? [buttonForm({ kind: "login", returnTo: page.url }, "Sign In")]
      : [accountMenu(viewer, page.url)];
  const search: LayoutNode = {
    type: "form",
    form: { action: "https://github.com/search", method: "get", controls: [{ kind: "text", name: "q", value: "", placeholder: "Search or jump to…" }] },
  };
  const mark: LayoutNode = { type: "image", src: GITHUB_MARK, alt: "GitHub", align: "left", width: MARK_SIZE, height: MARK_SIZE, href: githubUrl({ kind: "home" }) };
  const header: LayoutNode = {
    type: "columns",
    gap: 8,
    minWidth: 0,
    center: true,
    columns: [
      { width: MARK_SIZE, nodes: [mark] },
      { nodes: crumbs(page.url) },
      { width: SEARCH_WIDTH, nodes: [search] },
      { width: account && viewer === null ? SIGN_IN_WIDTH : ACCOUNT_WIDTH, nodes: corner },
    ],
  };
  const { nav, ...rest } = page;
  // Tabs draw their own rule, under the current tab's line.
  const top = nav ? [header, TABS_SPACE, nav] : [header, HR];
  return { ...rest, nodes: [...top, HEADER_SPACE, ...spaceSections(page.nodes)] };
}

/** 4px more between the header and the tabs: an empty spacer adds one more of the page's 4px gaps. */
const TABS_SPACE: LayoutNode = { type: "spacer", height: 0 };

/** Room under the header's rule, on every page. */
const HEADER_SPACE: LayoutNode = { type: "spacer", height: 4 };

/** Space over a section's heading, on top of the page's usual gap, so sections stand apart. */
const SECTION_SPACE: LayoutNode = { type: "spacer", height: 8 };

/** Does `node` open a section: a page or section heading, or a heading with a button beside it? */
function opensSection(node: LayoutNode): boolean {
  if (node.type === "heading") return node.level <= 2;
  if (node.type === "columns" && node.center) {
    const first = node.columns[0]?.nodes[0];
    return first?.type === "heading" && first.level <= 2;
  }
  return false;
}

/** Space over every section but a column's first, through the page's columns: one rule for all of GitHub's pages. */
function spaceSections(nodes: readonly LayoutNode[]): LayoutNode[] {
  return nodes.flatMap((node, index): LayoutNode[] => {
    const spaced = node.type === "columns" && !node.center
      ? { ...node, columns: node.columns.map((column) => ({ ...column, nodes: spaceSections(column.nodes) })) }
      : node;
    return index > 0 && opensSection(node) ? [SECTION_SPACE, spaced] : [spaced];
  });
}

/**
 * The signed-in corner, as github.com's avatar menu: their profile,
 * repositories and stars, and Sign out, which comes back to `here`.
 * `viewer` is empty when GitHub wouldn't say whose the token is.
 */
function accountMenu(viewer: string, here: string): LayoutNode {
  const signOut = buttonForm({ kind: "logout", returnTo: here }, "Sign out");
  const items: MenuEntry[] = viewer
    ? [
      { label: "Your profile", href: githubUrl({ kind: "profile", login: viewer, tab: "overview" }) },
      { label: "Your repositories", href: githubUrl({ kind: "profile", login: viewer, tab: "repos" }) },
      { label: "Your stars", href: githubUrl({ kind: "profile", login: viewer, tab: "stars" }) },
    ]
    : [{ label: "Account", href: githubUrl({ kind: "login", returnTo: here }) }];
  if (signOut.type === "form") items.push({ label: "Sign out", form: signOut.form });
  return { type: "menu", label: viewer || "Account", items, align: "right" };
}

/** Where a form posts, and the page that shows the form again if GitHub refuses it. */
type Posted =
  | { kind: "star"; owner: string; repo: string; starred: boolean; form: ApiLocation }
  | { kind: "issue"; owner: string; repo: string; form: ApiLocation }
  | { kind: "issueComment"; owner: string; repo: string; number: number; form: ApiLocation }
  | { kind: "discussion"; owner: string; repo: string; form: ApiLocation }
  | { kind: "discussionComment"; owner: string; repo: string; number: number; form: ApiLocation };

/** Forms post where github.com's own do: a list makes a new item, an item takes a comment. */
function postedLocation(location: GithubLocation, fields: Record<string, string>): Posted | null {
  if (!("owner" in location)) return null;
  const { owner, repo } = location;
  // The Star button posts to the repository's front page, saying which way.
  if (location.kind === "tree" && (fields.star === "star" || fields.star === "unstar")) {
    return { kind: "star", owner, repo, starred: fields.star === "star", form: { kind: "tree", owner, repo, ref: "", path: "" } };
  }
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
  if (posted.kind === "star") {
    await setStarred(fetch, token, owner, repo, posted.starred);
    return posted.form;
  }
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

function italic(value: string): InlineSegment {
  return { kind: "italic", text: value };
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

/** Facts on one line, the way github.com runs them together. Empty ones drop out. */
function facts(...items: Array<InlineSegment | string | false | undefined>): LayoutNode {
  const segments: InlineSegment[] = [];
  for (const item of items) {
    if (!item) continue;
    if (segments.length > 0) segments.push(text("  •  "));
    segments.push(typeof item === "string" ? text(item) : item);
  }
  return paragraph(...segments);
}

const HR: LayoutNode = { type: "hr" };

/** Corner radius of every card on these pages: slightly rounded, as github.com's boxes are. */
const CARD_RADIUS = 3;

/**
 * A bordered list, as github.com draws issues, files and results: one row
 * per entry, ruled between unless the rows are single lines.
 */
function list(rows: readonly LayoutNode[][], empty: string, ruled = true): LayoutNode {
  if (rows.length === 0) return { type: "box", radius: CARD_RADIUS, nodes: [paragraph(text(empty))] };
  return { type: "box", radius: CARD_RADIUS, nodes: rows.flatMap((row, index) => (index > 0 && ruled ? [HR, ...row] : row)) };
}

/** A bordered card with a header line, as github.com draws each comment. */
function card(header: InlineSegment[], body: readonly LayoutNode[]): LayoutNode {
  return { type: "box", radius: CARD_RADIUS, nodes: [paragraph(...header), HR, ...body] };
}

/** A heading on the left and a button on the right, as above github.com's lists. */
function toolbar(title: string, button: LayoutNode | null): LayoutNode {
  if (!button) return heading(2, title);
  return { type: "columns", gap: 8, minWidth: 0, center: true, columns: [{ nodes: [heading(2, title)] }, { width: 120, nodes: [button] }] };
}

/** A button that goes to `location`, as github.com's "New issue" does. */
function linkButton(label: string, location: GithubLocation): LayoutNode {
  return { type: "form", form: { action: githubUrl(location), method: "get", align: "right", controls: [{ kind: "submit", name: "", value: "", label }] } };
}

const EXAMPLES: ReadonlyArray<readonly [string, GithubLocation]> = [
  ["octocat", { kind: "profile", login: "octocat", tab: "overview" }],
  ["torvalds/linux", { kind: "tree", owner: "torvalds", repo: "linux", ref: "", path: "" }],
  ["mockintosh/mockintosh", { kind: "tree", owner: "mockintosh", repo: "mockintosh", ref: "", path: "" }],
  ["apple", { kind: "profile", login: "apple", tab: "overview" }],
];

/** Signed out, a way in; signed in, `repos` holds the dashboard's top repositories. */
function homePage(repos: readonly ProfileRepo[] | null): DocumentPage {
  const nodes: LayoutNode[] = [];
  if (repos && repos.length > 0) {
    nodes.push(heading(2, "Top repositories"), repoList(repos, ""));
  } else {
    const examples: InlineSegment[] = [text("For example ")];
    EXAMPLES.forEach(([label, location], index) => {
      if (index > 0) examples.push(text(index === EXAMPLES.length - 1 ? " or " : ", "));
      examples.push(link(label, location));
    });
    examples.push(text("."));
    nodes.push(
      paragraph(text("Search GitHub above, or type owner/repo there to go straight to a repository.")),
      paragraph(...examples),
    );
  }
  return { kind: "document", url: githubUrl({ kind: "home" }), title: "GitHub", nodes };
}

/**
 * `/login`: a button that puts up the phone sign-in sheet, or, signed in,
 * who as and a button to sign out. `viewer` is null when signed out, and
 * empty when GitHub wouldn't say whose the token is.
 */
function loginPage(returnTo: string, viewer: string | null, canSignIn: boolean): DocumentPage {
  const url = githubUrl({ kind: "login", returnTo });
  if (viewer !== null) {
    const who = viewer
      ? paragraph(text("Safari is signed in to GitHub as "), link(viewer, { kind: "profile", login: viewer, tab: "overview" }), text("."))
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
    paragraph(text("Signed in, Safari can open issues and discussions and comment on them as you.")),
  ];
  if (canSignIn) {
    nodes.push(
      paragraph(text("Safari shows a code to scan with your phone, or signs you in with this computer's browser.")),
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

/** A form that is only a button, posting to `location`; `icon` names a sprite before the label. */
function buttonForm(location: Extract<GithubLocation, { kind: "login" | "logout" }>, label: string, icon?: string): LayoutNode {
  return {
    type: "form",
    form: {
      action: `https://github.com/${location.kind}`,
      method: "post",
      align: "right",
      controls: [
        { kind: "hidden", name: "return_to", value: location.returnTo },
        { kind: "submit", name: "", value: "", label, icon },
      ],
    },
  };
}

/** Sign in, then come back to `location`. */
function signInForm(location: GithubLocation, label: string): LayoutNode {
  const form = buttonForm({ kind: "login", returnTo: githubUrl(location) }, label);
  return form.type === "form" ? { ...form, form: { ...form.form, align: "left" } } : form;
}

/** A form that posts to `location`, with what was written put back and why GitHub refused it above. */
function postForm(location: GithubLocation, forms: PageForms, controls: FormControl[]): LayoutNode[] {
  const draft = forms.draft ?? {};
  const filled = controls.map((control) => (control.kind === "submit" || draft[control.name] === undefined ? control : { ...control, value: draft[control.name] }));
  const form: LayoutNode = { type: "form", form: { action: githubUrl(location), method: "post", controls: filled } };
  return forms.error ? [paragraph(bold(forms.error)), form] : [form];
}

/** The box at the foot of a conversation: write a comment, or sign in to. */
function commentForm(location: GithubLocation, forms: PageForms): LayoutNode {
  if (!forms.signedIn) {
    return { type: "box", radius: CARD_RADIUS, nodes: [paragraph(text("Sign in to join this conversation on GitHub.")), signInForm(location, "Sign In")] };
  }
  return {
    type: "box",
    radius: CARD_RADIUS,
    nodes: [
      paragraph(bold("Add a comment")),
      ...postForm(location, forms, [
        { kind: "textarea", name: "body", value: "", rows: 5 },
        { kind: "submit", name: "", value: "", label: "Comment" },
      ]),
    ],
  };
}

export function githubPage(page: GithubPage, now: number, forms: PageForms = { signedIn: false }): GithubDocument {
  if (page.view === "search") {
    const location: GithubLocation = { kind: "search", query: page.query };
    const results = page.total === 1 ? "1 repository result" : `${formatCount(page.total)} repository results`;
    return {
      kind: "document",
      url: githubUrl(location),
      title: `Search: ${page.query}`,
      nodes: [heading(2, results), repoList(page.repos, `No repositories matched “${page.query}”.`)],
    };
  }
  if (page.view === "profile") return profilePage(page, now, forms);
  return repoPage(page, now, forms);
}

/** Repositories by full name, as search results and the dashboard list them. */
function repoList(repos: readonly ProfileRepo[], empty: string): LayoutNode {
  return list(
    repos.map((repo): LayoutNode[] => {
      const location: GithubLocation = { kind: "tree", owner: repo.owner, repo: repo.name, ref: "", path: "" };
      return [
        heading(3, `${repo.owner} / ${repo.name}`, githubUrl(location)),
        ...(repo.description ? [paragraph(text(repo.description))] : []),
        facts(repo.fork && "Fork", repo.language, plural(repo.stars, "star", "stars")),
      ];
    }),
    empty,
  );
}

/** Sidebar width; the avatar fills it. Narrower than github.com's, so the main column holds the contribution graph. */
const SIDEBAR = 150;
/** Narrower than this, the sidebar goes above the repositories. */
const TWO_COLUMNS = SIDEBAR + 16 + 220;

/** A repository as a card: name, description, and language / stars / forks. */
function repoCard(repo: ProfileRepo, owner: string): LayoutNode {
  const location: GithubLocation = { kind: "tree", owner: repo.owner, repo: repo.name, ref: "", path: "" };
  const name = repo.owner.toLowerCase() === owner.toLowerCase() ? repo.name : `${repo.owner}/${repo.name}`;
  return {
    type: "box",
    radius: CARD_RADIUS,
    nodes: [
      paragraph({ kind: "link", text: name, href: githubUrl(location) }, text(repo.fork ? "  Fork" : "  Public")),
      ...(repo.description ? [paragraph(text(repo.description))] : []),
      facts(repo.language, plural(repo.stars, "star", "stars"), repo.forks > 0 && plural(repo.forks, "fork", "forks")),
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
  if (page.extras?.status) nodes.push(paragraph(italic(page.extras.status)));
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
    nodes.push(HR, heading(3, "Organizations"));
    const segments: InlineSegment[] = [];
    page.orgs.forEach((login, index) => {
      if (index > 0) segments.push(text(", "));
      segments.push(link(login, { kind: "profile", login, tab: "overview" }));
    });
    nodes.push(paragraph(...segments));
  }
  return nodes;
}

function profileMain(page: Extract<GithubPage, { view: "profile" }>, now: number, forms: PageForms): LayoutNode[] {
  const login = page.profile.login;
  if (page.tab === "people") {
    const people = page.people.map((person) => [paragraph(link(person, { kind: "profile", login: person, tab: "overview" }))]);
    return [heading(2, "People"), list(people, "No public members.", false)];
  }
  if (page.tab === "overview") return overviewMain(page, now, forms);
  const title = page.tab === "stars" ? "Starred repositories" : "Repositories";
  const empty = page.tab === "stars" ? "No starred repositories." : "No public repositories.";
  if (page.repos.length === 0) return [heading(2, title), paragraph(text(empty))];
  return [heading(2, title), ...page.repos.map((repo) => repoCard(repo, login))];
}

/** Pinned (or popular) repositories, then, signed in, the contribution graph and this month's activity. */
function overviewMain(page: Extract<GithubPage, { view: "profile" }>, now: number, forms: PageForms): LayoutNode[] {
  const { profile, extras } = page;
  const pinned = extras?.pinned ?? [];
  const repos = pinned.length > 0 ? pinned : page.repos;
  const nodes: LayoutNode[] = [heading(2, pinned.length > 0 ? "Pinned" : "Popular repositories")];
  nodes.push(...(repos.length > 0 ? repos.map((repo) => repoCard(repo, profile.login)) : [paragraph(text("No public repositories."))]));
  if (profile.kind === "Organization") return nodes;
  if (!extras) {
    if (!forms.signedIn) {
      const here: GithubLocation = { kind: "profile", login: profile.login, tab: "overview" };
      nodes.push(paragraph(text("Sign in to see pinned repositories and contributions.")), signInForm(here, "Sign In"));
    }
    return nodes;
  }
  if (extras.calendar && extras.calendar.weeks.length > 0) {
    nodes.push(...contributionCalendar(extras.calendar.total, extras.calendar.weeks));
  }
  if (extras.activity) nodes.push(...activityNodes(extras.activity, now));
  return nodes;
}

/** Pixels per day square, and between squares. */
const DAY = 8;
const DAY_GAP = 2;
const WEEK = DAY + DAY_GAP;

/** Is (x, y) on the edge of a day's square? */
function onEdge(x: number, y: number): boolean {
  return x === 0 || y === 0 || x === DAY - 1 || y === DAY - 1;
}

/**
 * A day's square at each level, none to most. A day without contributions
 * is a dotted outline; a day with some is outlined solid and filled with
 * the Mac's grays, deeper for more, as github.com deepens its green.
 */
const DAY_INK: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => onEdge(x, y) && (x + y) % 2 === 0,
  (x, y) => onEdge(x, y) || (x % 4 === 1 && y % 4 === 1) || (x % 4 === 3 && y % 4 === 3),
  (x, y) => onEdge(x, y) || (x + y) % 2 === 0,
  (x, y) => onEdge(x, y) || !(x % 2 === 1 && y % 2 === 0),
  () => true,
];

/** "3 contributions on October 5, 2026", as github.com names a day of its calendar. */
function dayTip(week: CalendarWeek, weekday: number): string {
  const [year, month, day] = week.firstDay.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + weekday));
  const count = week.counts[weekday] ?? 0;
  const what = count === 0 ? "No contributions" : plural(count, "contribution", "contributions");
  return `${what} on ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** Weeks as github.com draws them: a column per week, Sunday at the top. Each day names itself when hovered. */
export function contributionGraph(weeks: readonly CalendarWeek[]): LayoutNode {
  const width = Math.max(1, weeks.length * WEEK - DAY_GAP);
  const height = 7 * WEEK - DAY_GAP;
  const data = new Uint8Array(width * height);
  const tips: BitmapTip[] = [];
  weeks.forEach((week, column) => {
    week.levels.forEach((level, row) => {
      const ink = DAY_INK[level];
      if (!ink) return;
      tips.push({ x: column * WEEK, y: row * WEEK, width: DAY, height: DAY, label: dayTip(week, row) });
      for (let y = 0; y < DAY; y++) {
        for (let x = 0; x < DAY; x++) {
          if (ink(x, y)) data[(row * WEEK + y) * width + column * WEEK + x] = 1;
        }
      }
    });
  });
  return { type: "bitmap", width, height, data, alt: "Contribution graph", tips };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A month needs this many weeks over it for its name to fit. */
const LABELLED_WEEKS = 3;

/** The months over the weeks, each name over the weeks that start in it, as github.com labels its calendar. */
function monthRow(weeks: readonly CalendarWeek[]): LayoutNode {
  const runs: { month: number; weeks: number }[] = [];
  for (const week of weeks) {
    const month = Number(week.firstDay.slice(5, 7)) - 1;
    const last = runs[runs.length - 1];
    if (last && last.month === month) last.weeks++;
    else runs.push({ month, weeks: 1 });
  }
  return {
    type: "columns",
    gap: 0,
    minWidth: 0,
    columns: runs.map((run) => ({
      width: run.weeks * WEEK,
      nodes: run.weeks >= LABELLED_WEEKS ? [paragraph(text(MONTH_NAMES[run.month] ?? ""))] : [],
    })),
  };
}

/**
 * The contribution calendar: the whole year in a pane that scrolls
 * sideways, opened on the latest weeks, with the months over them.
 */
export function contributionCalendar(total: number, weeks: readonly CalendarWeek[]): LayoutNode[] {
  const graph = contributionGraph(weeks);
  const width = weeks.length * WEEK - DAY_GAP;
  return [
    heading(2, `${plural(total, "contribution", "contributions")} in the last year`),
    { type: "box", radius: CARD_RADIUS, nodes: [{ type: "scroller", width, start: "end", nodes: [monthRow(weeks), graph] }] },
  ];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** "Contribution activity" for this month: commits, pull requests and issues, each by repository. */
function activityNodes(activity: NonNullable<ProfileExtras["activity"]>, now: number): LayoutNode[] {
  const date = new Date(now);
  const nodes: LayoutNode[] = [heading(2, "Contribution activity"), paragraph(bold(`${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`))];
  const group = (verb: string, one: string, many: string, items: readonly RepoContributions[]) => {
    if (items.length === 0) return;
    const total = items.reduce((sum, item) => sum + item.count, 0);
    const rows = items.map((item): LayoutNode[] => [
      paragraph(link(`${item.owner}/${item.name}`, { kind: "tree", owner: item.owner, repo: item.name, ref: "", path: "" }), text(`  ${plural(item.count, one, many)}`)),
    ]);
    nodes.push(heading(3, `${verb} ${plural(total, one, many)} in ${plural(items.length, "repository", "repositories")}`), list(rows, "", false));
  };
  group("Created", "commit", "commits", activity.commits);
  group("Opened", "pull request", "pull requests", activity.pulls);
  group("Opened", "issue", "issues", activity.issues);
  if (nodes.length === 2) nodes.push(paragraph(text("No activity yet this month.")));
  return nodes;
}

/** A tab bar, as github.com's: the current tab bold over a line, the others links, spaced apart over a rule. */
function tabs(items: readonly { label: string; location: GithubLocation; current: boolean }[]): LayoutNode {
  return { type: "tabs", items: items.map((item) => ({ label: item.label, href: githubUrl(item.location), current: item.current })) };
}

/** A profile as github.com lays it out: its tabs across the top, then the person beside what they've made. */
function profilePage(page: Extract<GithubPage, { view: "profile" }>, now: number, forms: PageForms): GithubDocument {
  const profile = page.profile;
  const location: GithubLocation = { kind: "profile", login: profile.login, tab: page.tab };
  const tab = (label: string, name: ProfileTab) => ({
    label,
    location: { kind: "profile", login: profile.login, tab: name } as GithubLocation,
    current: page.tab === name,
  });
  const repositories = `Repositories ${formatCount(profile.publicRepos)}`;
  const nav = tabs(profile.kind === "Organization"
    ? [tab("Overview", "overview"), tab(repositories, "repos"), tab("People", "people")]
    : [tab("Overview", "overview"), tab(repositories, "repos"), tab("Stars", "stars")]);
  const nodes: LayoutNode[] = [
    {
      type: "columns",
      gap: 16,
      minWidth: TWO_COLUMNS,
      columns: [{ width: SIDEBAR, nodes: profileSidebar(page) }, { nodes: profileMain(page, now, forms) }],
    },
  ];
  return { kind: "document", url: githubUrl(location), title: profile.login, nodes, nav };
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

/** A repository's tabs: Code, Issues, Pull requests, and Discussions where it has them. */
function repoNav(repo: RepoInfo, view: RepoPage["view"], ref: string): LayoutNode {
  const section = sectionOf(view);
  const sections = [
    { label: "Code", location: { kind: "tree", owner: repo.owner, repo: repo.name, ref, path: "" } as GithubLocation, current: section === "code" },
    { label: "Issues", location: { kind: "issues", owner: repo.owner, repo: repo.name } as GithubLocation, current: section === "issues" },
    { label: "Pull requests", location: { kind: "pulls", owner: repo.owner, repo: repo.name } as GithubLocation, current: section === "pulls" },
  ];
  if (repo.hasDiscussions || section === "discussions") {
    sections.push({ label: "Discussions", location: { kind: "discussions", owner: repo.owner, repo: repo.name }, current: section === "discussions" });
  }
  return tabs(sections);
}

/** Room for the Star button at the right of a repository's title: a star and "Starred 1.2k". */
const STAR_WIDTH = 115;

/**
 * GitHub's Star button and the count beside it: an outline star to star
 * with, a filled one once starred. Signed in, it stars or unstars
 * (`starred` says which it is now); signed out, it signs in and comes back.
 */
function starButton(repo: RepoInfo, starred: boolean | null, here: GithubLocation): LayoutNode {
  const count = formatCount(repo.stars);
  if (starred === null) return buttonForm({ kind: "login", returnTo: githubUrl(here) }, `Star ${count}`, GITHUB_STAR);
  return {
    type: "form",
    form: {
      action: githubUrl({ kind: "tree", owner: repo.owner, repo: repo.name, ref: "", path: "" }),
      method: "post",
      align: "right",
      controls: [
        { kind: "hidden", name: "star", value: starred ? "unstar" : "star" },
        starred
          ? { kind: "submit", name: "", value: "", label: `Starred ${count}`, icon: GITHUB_STARRED, tooltip: `Unstar ${repo.owner}/${repo.name}` }
          : { kind: "submit", name: "", value: "", label: `Star ${count}`, icon: GITHUB_STAR },
      ],
    },
  };
}

/** Width of the Code page's About column. */
const ABOUT_WIDTH = 120;
/** Narrower than this, About goes under the files. */
const CODE_COLUMNS = ABOUT_WIDTH + 16 + 240;

/** The Code page's About column, as on github.com: what it is, its site, its tags, and its counts. */
function aboutNodes(repo: RepoInfo): LayoutNode[] {
  const nodes: LayoutNode[] = [heading(3, "About")];
  if (repo.description) nodes.push(paragraph(text(repo.description)));
  if (repo.homepage) nodes.push(paragraph({ kind: "link", text: repo.homepage.replace(/^https?:\/\//, ""), href: repo.homepage }));
  const tags = [repo.language, repo.license, ...repo.topics].filter(Boolean);
  if (tags.length > 0) nodes.push(facts(...tags));
  nodes.push(
    paragraph(text(`${repo.visibility} repository`)),
    paragraph(bold(formatCount(repo.stars)), text(repo.stars === 1 ? " star" : " stars")),
    paragraph(bold(formatCount(repo.watchers)), text(" watching")),
    paragraph(bold(formatCount(repo.forks)), text(repo.forks === 1 ? " fork" : " forks")),
  );
  return nodes;
}

/** The branch, then the path from the repository's root, each part a link up. */
function pathBar(repo: RepoInfo, ref: string, path: string): LayoutNode {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return paragraph(text("Branch "), bold(ref));
  const segments: InlineSegment[] = [bold(ref), text("  •  "), link(repo.name, { kind: "tree", owner: repo.owner, repo: repo.name, ref, path: "" })];
  parts.forEach((part, index) => {
    segments.push(text(" / "));
    const location: GithubLocation = { kind: "tree", owner: repo.owner, repo: repo.name, ref, path: parts.slice(0, index + 1).join("/") };
    segments.push(index === parts.length - 1 ? bold(part) : link(part, location));
  });
  return paragraph(...segments);
}

function repoPage(page: RepoPage, now: number, forms: PageForms): GithubDocument {
  const repo = page.repo;
  const ref = page.view === "tree" || page.view === "blob" ? page.ref : repo.defaultBranch;
  const location = repoLocation(page);
  const name = `${repo.owner}/${repo.name}`;
  const { title, body } = repoBody(page, location, now, forms);
  return { kind: "document", url: githubUrl(location), title: title ? `${title} • ${name}` : name, nodes: body, nav: repoNav(repo, page.view, ref) };
}

/** What a repository page shows under its header, and its window title before the repository's name. */
function repoBody(page: RepoPage, location: GithubLocation, now: number, forms: PageForms): { title: string; body: LayoutNode[] } {
  const repo = page.repo;
  const { owner, name } = repo;
  if (page.view === "tree") {
    const rows: LayoutNode[][] = page.entries.map((entry) => {
      const target: GithubLocation = entry.type === "dir"
        ? { kind: "tree", owner, repo: name, ref: page.ref, path: entry.path }
        : { kind: "blob", owner, repo: name, ref: page.ref, path: entry.path };
      return [paragraph(link(entry.type === "dir" ? `${entry.name}/` : entry.name, target))];
    });
    const files = list(rows, "This folder is empty.", false);
    const commit = page.commit;
    const box: LayoutNode = commit && files.type === "box"
      ? { ...files, nodes: [facts(bold(commit.author), commitSubject(commit.message), commit.sha, formatAge(commit.date, now)), HR, ...files.nodes] }
      : files;
    const main: LayoutNode[] = [pathBar(repo, page.ref, page.path), box];
    if (page.readme) {
      main.push(card([bold("README")], resolveRelative(parseMarkdown(page.readme), repo, page.ref, page.path)));
    }
    if (page.path) return { title: page.path, body: main };
    // The repository's front page: its name and Star button, then the files beside About.
    return {
      title: "",
      body: [
        {
          type: "columns",
          gap: 8,
          minWidth: 0,
          center: true,
          columns: [{ nodes: [heading(1, repo.name)] }, { width: STAR_WIDTH, nodes: [starButton(repo, page.starred, location)] }],
        },
        { type: "columns", gap: 16, minWidth: CODE_COLUMNS, columns: [{ nodes: main }, { width: ABOUT_WIDTH, nodes: aboutNodes(repo) }] },
      ],
    };
  }
  if (page.view === "blob") {
    const file = page.file;
    const lines = file.text === null ? "" : `${formatCount(file.text.split("\n").length)} lines`;
    const body: LayoutNode[] = [pathBar(repo, page.ref, file.path), facts(lines, formatBytes(file.size))];
    if (file.note) body.push(paragraph(italic(file.note)));
    if (file.text !== null) {
      const dir = file.path.split("/").slice(0, -1).join("/");
      body.push(/\.(md|markdown)$/i.test(file.name)
        ? { type: "box", radius: CARD_RADIUS, nodes: resolveRelative(parseMarkdown(file.text), repo, page.ref, dir) }
        : { type: "code", text: file.text });
    }
    return { title: file.name, body };
  }
  if (page.view === "issues" || page.view === "pulls") {
    const pulls = page.view === "pulls";
    const items = pulls ? page.pulls : page.issues;
    const rows = items.map((item): LayoutNode[] => {
      const target: GithubLocation = pulls ? { kind: "pull", owner, repo: name, number: item.number } : { kind: "issue", owner, repo: name, number: item.number };
      return [heading(3, item.title, githubUrl(target)), facts(`#${item.number} opened ${formatAge(item.createdAt, now)} by ${item.user}`, commentCount(item.comments))];
    });
    return {
      title: pulls ? "Pull requests" : "Issues",
      body: [
        toolbar(pulls ? "Open pull requests" : "Open issues", pulls ? null : linkButton("New issue", { kind: "newIssue", owner, repo: name })),
        list(rows, pulls ? "There aren't any open pull requests." : "There aren't any open issues."),
      ],
    };
  }
  if (page.view === "discussions") {
    const rows = page.discussions.map((item): LayoutNode[] => [
      heading(3, item.title, githubUrl({ kind: "discussion", owner, repo: name, number: item.number })),
      facts(item.category, `${item.user} started ${formatAge(item.createdAt, now)}`, commentCount(item.comments), item.answered && "✓ Answered"),
    ]);
    return {
      title: "Discussions",
      body: [
        toolbar("Discussions", linkButton("New discussion", { kind: "newDiscussion", owner, repo: name, category: "" })),
        list(rows, "There aren't any discussions yet."),
      ],
    };
  }
  if (page.view === "newIssue") {
    const body: LayoutNode[] = [heading(2, "Create new issue")];
    if (!forms.signedIn) {
      body.push(paragraph(text("Sign in to open an issue.")), signInForm(location, "Sign In"));
    } else {
      body.push(
        paragraph(text("Add a title, then describe the issue. Markdown works.")),
        ...postForm({ kind: "issues", owner, repo: name }, forms, [
          { kind: "text", name: "title", value: "", placeholder: "Title" },
          { kind: "textarea", name: "body", value: "", rows: 10 },
          { kind: "submit", name: "", value: "", label: "Create" },
        ]),
      );
    }
    return { title: "New issue", body };
  }
  if (page.view === "newDiscussion") return { title: "New discussion", body: newDiscussionNodes(page, forms) };
  if (page.view === "discussion") {
    const item = page.discussion;
    return {
      title: item.title,
      body: [
        heading(1, `${item.title} #${item.number}`),
        facts(item.category, `${item.user} started this discussion ${formatAge(item.createdAt, now)}`, commentCount(item.comments), item.answered && "✓ Answered"),
        ...conversation(item, page.comments, repo, now),
        commentForm(location, forms),
      ],
    };
  }
  const item = page.view === "pull" ? page.pull : page.issue;
  const kind = page.view === "pull" ? "pull request" : "issue";
  return {
    title: item.title,
    body: [
      heading(1, `${item.title} #${item.number}`),
      facts(bold(stateLabel(item.state)), `${item.user} opened this ${kind} ${formatAge(item.createdAt, now)}`, commentCount(item.comments)),
      ...conversation(item, page.comments, repo, now),
      commentForm(location, forms),
    ],
  };
}

function stateLabel(state: string): string {
  return state === "merged" ? "Merged" : state === "closed" ? "Closed" : "Open";
}

function commentCount(count: number): string {
  return count === 1 ? "1 comment" : `${formatCount(count)} comments`;
}

/** The opening post and its comments as cards, saying when only the first of them are shown. */
function conversation(item: IssueInfo, comments: readonly CommentInfo[], repo: RepoInfo, now: number): LayoutNode[] {
  const opening: CommentInfo = { user: item.user, body: item.body, createdAt: item.createdAt };
  const nodes = [commentCard(opening, repo, now, "No description provided."), ...comments.map((comment) => commentCard(comment, repo, now, ""))];
  if (item.comments > comments.length) {
    nodes.push(paragraph(italic(`Showing the first ${comments.length} of ${commentCount(item.comments)}.`)));
  }
  return nodes;
}

/** A comment as github.com draws it: "user commented 3d ago" over the text, a discussion's replies in cards inside. */
function commentCard(comment: CommentInfo, repo: RepoInfo, now: number, empty: string): LayoutNode {
  const header = [bold(comment.user), text(` commented ${formatAge(comment.createdAt, now)}`), ...(comment.answer ? [text("  •  "), bold("✓ Answer")] : [])];
  const replies = (comment.replies ?? []).map((reply) => commentCard(reply, repo, now, ""));
  return card(header, [...markdownOr(comment.body, repo, empty), ...replies]);
}

function markdownOr(body: string, repo: RepoInfo, empty: string): LayoutNode[] {
  if (body) return resolveRelative(parseMarkdown(body), repo, repo.defaultBranch, "");
  return empty ? [paragraph(italic(empty))] : [];
}

/** Choose a category, as github.com asks first; then the title and what to say. */
function newDiscussionNodes(page: Extract<GithubPage, { view: "newDiscussion" }>, forms: PageForms): LayoutNode[] {
  const { repo, category } = page;
  if (!category) {
    const rows = page.categories.map((item): LayoutNode[] => {
      const target: GithubLocation = { kind: "newDiscussion", owner: repo.owner, repo: repo.name, category: item.slug };
      return [heading(3, item.name, githubUrl(target)), ...(item.description ? [paragraph(text(item.description))] : [])];
    });
    return [heading(2, "Start a new discussion"), paragraph(text("Select a category:")), list(rows, "This repository has no discussion categories.")];
  }
  const here: GithubLocation = { kind: "newDiscussion", owner: repo.owner, repo: repo.name, category: category.slug };
  const nodes: LayoutNode[] = [heading(2, `Start a new discussion in ${category.name}`)];
  if (category.description) nodes.push(paragraph(text(category.description)));
  if (!forms.signedIn) return [...nodes, paragraph(text("Sign in to start a discussion.")), signInForm(here, "Sign In")];
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
