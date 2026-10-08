import { decodeBase64 } from "@mockintosh/ui";
import type { FetchFunction } from "@mockintosh/sdk";
import type { GithubLocation, ProfileTab } from "./location";

export class GithubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface RepoInfo {
  owner: string;
  name: string;
  description: string;
  visibility: "Public" | "Private";
  defaultBranch: string;
  stars: number;
  forks: number;
  watchers: number;
  language: string;
  license: string;
  homepage: string;
  topics: string[];
  hasDiscussions: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface IssueInfo {
  number: number;
  title: string;
  user: string;
  comments: number;
  state: string;
  body: string;
  createdAt: string;
  /** When it was closed, or merged; empty while open. */
  closedAt: string;
}

/** How many open and closed issues, or pull requests, a repository has; null where GitHub wouldn't say. */
export interface StateCounts {
  open: number | null;
  closed: number | null;
}

export interface CommentInfo {
  user: string;
  body: string;
  createdAt: string;
  /** A discussion comment's thread. */
  replies?: CommentInfo[];
  /** Marked as the discussion's answer. */
  answer?: boolean;
}

export interface DiscussionInfo extends IssueInfo {
  category: string;
  answered: boolean;
}

export interface DiscussionCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export interface FileBody {
  name: string;
  path: string;
  size: number;
  text: string | null;
  note: string;
}

export interface ProfileInfo {
  login: string;
  name: string;
  kind: "User" | "Organization";
  bio: string;
  company: string;
  location: string;
  blog: string;
  twitter: string;
  followers: number;
  following: number;
  publicRepos: number;
  /** `avatars.githubusercontent.com` URL; empty when the API gave none. */
  avatarUrl: string;
}

export interface ProfileRepo {
  owner: string;
  name: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  fork: boolean;
}

/** Contributions to one repository in a month. */
export interface RepoContributions {
  owner: string;
  name: string;
  count: number;
}

/** A week of the contribution calendar, Sunday first. */
export interface CalendarWeek {
  /** The week's first day, `YYYY-MM-DD`. */
  firstDay: string;
  /** Each day's level, 0 (none) to 4, or -1 before the calendar starts or after today. */
  levels: number[];
  /** Each day's contributions, 0 where there is no day. */
  counts: number[];
}

/**
 * What a profile shows only to someone signed in: GitHub's GraphQL API
 * alone has it, and that API always needs a token.
 */
export interface ProfileExtras {
  pinned: ProfileRepo[];
  /** The status message a person set; empty when none (and for organizations). */
  status: string;
  /** The last year, oldest week first. Null for organizations. */
  calendar: { total: number; weeks: CalendarWeek[] } | null;
  /** This month so far. Null for organizations. */
  activity: { commits: RepoContributions[]; pulls: RepoContributions[]; issues: RepoContributions[] } | null;
}

export type GithubPage =
  /** `total` counts every match; `repos` holds the first page of them. */
  | { view: "search"; query: string; total: number; repos: ProfileRepo[] }
  /** `extras` is null when signed out, or when GitHub wouldn't give them. */
  | { view: "profile"; profile: ProfileInfo; tab: ProfileTab; repos: ProfileRepo[]; orgs: string[]; people: string[]; extras: ProfileExtras | null }
  /** `starred` is whether the signed-in user has starred the repository; null when signed out, or below its front page. */
  | { view: "tree"; repo: RepoInfo; ref: string; path: string; entries: DirEntry[]; commit: CommitInfo | null; readme: string | null; starred: boolean | null }
  | { view: "blob"; repo: RepoInfo; ref: string; file: FileBody }
  | { view: "issues"; repo: RepoInfo; state: "open" | "closed"; counts: StateCounts; issues: IssueInfo[] }
  | { view: "issue"; repo: RepoInfo; issue: IssueInfo; comments: CommentInfo[] }
  | { view: "pulls"; repo: RepoInfo; state: "open" | "closed"; counts: StateCounts; pulls: IssueInfo[] }
  | { view: "pull"; repo: RepoInfo; pull: IssueInfo; comments: CommentInfo[] }
  | { view: "newIssue"; repo: RepoInfo }
  | { view: "discussions"; repo: RepoInfo; discussions: DiscussionInfo[] }
  | { view: "discussion"; repo: RepoInfo; discussion: DiscussionInfo; comments: CommentInfo[] }
  /** `category` is null until one is chosen from `categories`. */
  | { view: "newDiscussion"; repo: RepoInfo; categories: DiscussionCategory[]; category: DiscussionCategory | null };

/** Pages drawn from the API; the rest (home, signing in and out) need none. */
export type ApiLocation = Exclude<GithubLocation, { kind: "home" | "login" | "logout" }>;

const API = "https://api.github.com";
/** Blobs larger than this are summarized instead of drawn into the window. */
const MAX_TEXT = 48_000;

export async function loadPage(fetch: FetchFunction, token: string, location: ApiLocation): Promise<GithubPage> {
  if (location.kind === "search") {
    const data = asRecord(await gh(fetch, token, `/search/repositories?q=${encodeURIComponent(location.query)}&per_page=30`));
    const repos = Array.isArray(data.items) ? data.items.map(profileRepo) : [];
    return { view: "search", query: location.query, total: numberField(data, "total_count") || repos.length, repos };
  }
  if (location.kind === "profile") return loadProfile(fetch, token, location.login, location.tab);
  const repo = await getRepo(fetch, token, location.owner, location.repo);
  if (location.kind === "tree") return loadTree(fetch, token, repo, location.ref, location.path);
  if (location.kind === "blob") return loadBlob(fetch, token, repo, location.ref, location.path);
  if (location.kind === "issues") {
    const state = location.state ?? "open";
    const [issues, counts] = await Promise.all([listIssues(fetch, token, repo, "issue", state), stateCounts(fetch, token, repo, "issue")]);
    return { view: "issues", repo, state, counts, issues };
  }
  if (location.kind === "pulls") {
    const state = location.state ?? "open";
    const [pulls, counts] = await Promise.all([listIssues(fetch, token, repo, "pull", state), stateCounts(fetch, token, repo, "pr")]);
    return { view: "pulls", repo, state, counts, pulls };
  }
  if (location.kind === "newIssue") return { view: "newIssue", repo };
  if (location.kind === "discussions") return { view: "discussions", repo, discussions: await listDiscussions(fetch, token, repo) };
  if (location.kind === "discussion") {
    const { discussion, comments } = await getDiscussion(fetch, token, repo, location.number);
    return { view: "discussion", repo, discussion, comments };
  }
  if (location.kind === "newDiscussion") {
    const { categories } = await getDiscussionCategories(fetch, token, repo);
    const category = categories.find((item) => item.slug === location.category) ?? null;
    return { view: "newDiscussion", repo, categories, category };
  }
  const [item, comments] = await Promise.all([
    getIssue(fetch, token, repo, location.number),
    getComments(fetch, token, repo, location.number),
  ]);
  return location.kind === "issue"
    ? { view: "issue", repo, issue: item, comments }
    : { view: "pull", repo, pull: item, comments };
}

/** Directories first, then files, case-insensitive — the order on the Code tab. */
export function sortEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    const rank = (entry: DirEntry) => (entry.type === "dir" ? 0 : 1);
    const byKind = rank(a) - rank(b);
    if (byKind !== 0) return byKind;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Decode a contents/readme payload. Null text means GitHub would not render it inline. */
export function fileText(content: string, encoding: string, size: number): { text: string | null; note: string } {
  if (encoding !== "base64" || size > 1_000_000) {
    return { text: null, note: "File is too large to show here." };
  }
  const bytes = decodeBase64(content.replace(/\n/g, ""));
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return { text: null, note: "Binary file not shown." };
  }
  const text = utf8Decode(bytes);
  if (text.length <= MAX_TEXT) return { text, note: "" };
  return { text: text.slice(0, MAX_TEXT), note: "Showing the first part of this file." };
}

/** Repositories the Overview shows when it has no pins: the most starred, as github.com's "Popular repositories". */
const POPULAR = 6;

async function loadProfile(fetch: FetchFunction, token: string, login: string, tab: ProfileTab): Promise<GithubPage> {
  const profile = await getProfile(fetch, token, login);
  const orgs = profile.kind === "User" ? await listLogins(fetch, token, `/users/${encodeURIComponent(login)}/orgs`) : [];
  const page = { view: "profile" as const, profile, orgs, people: [] as string[], extras: null };
  if (profile.kind === "Organization" && tab === "people") {
    const people = await listLogins(fetch, token, `/orgs/${encodeURIComponent(login)}/public_members`);
    return { ...page, tab, repos: [], people };
  }
  if (profile.kind === "User" && tab === "stars") {
    const repos = await listProfileRepos(fetch, token, `/users/${encodeURIComponent(login)}/starred?per_page=30`);
    return { ...page, tab, repos };
  }
  const overview = tab === "overview" || tab === "people" || tab === "stars";
  const reposUrl = profile.kind === "Organization"
    ? `/orgs/${encodeURIComponent(login)}/repos?sort=updated&per_page=${overview ? 100 : 30}`
    : `/users/${encodeURIComponent(login)}/repos?sort=updated&per_page=${overview ? 100 : 30}&type=owner`;
  if (!overview) return { ...page, tab: "repos", repos: await listProfileRepos(fetch, token, reposUrl) };
  const [repos, extras] = await Promise.all([
    listProfileRepos(fetch, token, reposUrl),
    token ? getProfileExtras(fetch, token, login, Date.now()).catch(() => null) : Promise.resolve(null),
  ]);
  const popular = repos.filter((repo) => !repo.fork).sort((a, b) => b.stars - a.stars).slice(0, POPULAR);
  return { ...page, tab: "overview", repos: popular, extras };
}

const PROFILE_REPO_FIELDS = "name owner { login } description primaryLanguage { name } stargazerCount forkCount isFork";
const CONTRIBUTED_REPO = "repository { name owner { login } } contributions { totalCount }";
const LEVELS: Record<string, number> = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

/** Pins, status, the year's contribution calendar and this month's activity, in one request. */
async function getProfileExtras(fetch: FetchFunction, token: string, login: string, now: number): Promise<ProfileExtras> {
  const date = new Date(now);
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
  const data = await graphql(fetch, token, `query($login: String!, $from: DateTime!) {
    repositoryOwner(login: $login) {
      ... on ProfileOwner { pinnedItems(first: 6, types: [REPOSITORY]) { nodes { ... on Repository { ${PROFILE_REPO_FIELDS} } } } }
      ... on User {
        status { message }
        year: contributionsCollection {
          contributionCalendar { totalContributions weeks { firstDay contributionDays { weekday contributionCount contributionLevel } } }
        }
        month: contributionsCollection(from: $from) {
          commitContributionsByRepository(maxRepositories: 5) { ${CONTRIBUTED_REPO} }
          pullRequestContributionsByRepository(maxRepositories: 5) { ${CONTRIBUTED_REPO} }
          issueContributionsByRepository(maxRepositories: 5) { ${CONTRIBUTED_REPO} }
        }
      }
    }
  }`, { login, from: monthStart });
  const owner = asRecord(asRecord(data).repositoryOwner);
  const pins = asRecord(owner.pinnedItems).nodes;
  const pinned = Array.isArray(pins) ? pins.map((node) => graphqlRepo(asRecord(node))) : [];
  const calendar = asRecord(asRecord(owner.year).contributionCalendar);
  const weeks = Array.isArray(calendar.weeks)
    ? calendar.weeks.map((week): CalendarWeek => {
      const levels = Array<number>(7).fill(-1);
      const counts = Array<number>(7).fill(0);
      const list = asRecord(week).contributionDays;
      for (const day of Array.isArray(list) ? list : []) {
        const record = asRecord(day);
        const weekday = numberField(record, "weekday");
        levels[weekday] = LEVELS[stringField(record, "contributionLevel")] ?? 0;
        counts[weekday] = numberField(record, "contributionCount");
      }
      return { firstDay: stringField(asRecord(week), "firstDay"), levels, counts };
    })
    : null;
  const month = asRecord(owner.month);
  const contributed = (key: string): RepoContributions[] => {
    const list = month[key];
    return Array.isArray(list)
      ? list.map((item) => {
        const record = asRecord(item);
        const repo = asRecord(record.repository);
        return { owner: stringField(asRecord(repo.owner), "login"), name: stringField(repo, "name"), count: numberField(asRecord(record.contributions), "totalCount") };
      })
      : [];
  };
  return {
    pinned,
    status: stringField(asRecord(owner.status), "message"),
    calendar: weeks ? { total: numberField(calendar, "totalContributions"), weeks } : null,
    activity: owner.month
      ? { commits: contributed("commitContributionsByRepository"), pulls: contributed("pullRequestContributionsByRepository"), issues: contributed("issueContributionsByRepository") }
      : null,
  };
}

function graphqlRepo(record: Record<string, unknown>): ProfileRepo {
  return {
    owner: stringField(asRecord(record.owner), "login"),
    name: stringField(record, "name"),
    description: stringField(record, "description"),
    language: stringField(asRecord(record.primaryLanguage), "name"),
    stars: numberField(record, "stargazerCount"),
    forks: numberField(record, "forkCount"),
    fork: record.isFork === true,
  };
}

async function getProfile(fetch: FetchFunction, token: string, login: string): Promise<ProfileInfo> {
  const record = asRecord(await gh(fetch, token, `/users/${encodeURIComponent(login)}`));
  return {
    login: stringField(record, "login") || login,
    name: stringField(record, "name"),
    kind: record.type === "Organization" ? "Organization" : "User",
    bio: stringField(record, "bio"),
    company: stringField(record, "company"),
    location: stringField(record, "location"),
    blog: stringField(record, "blog"),
    twitter: stringField(record, "twitter_username"),
    followers: numberField(record, "followers"),
    following: numberField(record, "following"),
    publicRepos: numberField(record, "public_repos"),
    avatarUrl: stringField(record, "avatar_url"),
  };
}

async function listProfileRepos(fetch: FetchFunction, token: string, path: string): Promise<ProfileRepo[]> {
  const data = await gh(fetch, token, path);
  if (!Array.isArray(data)) return [];
  return data.map(profileRepo);
}

function profileRepo(item: unknown): ProfileRepo {
  const record = asRecord(item);
  const owner = asRecord(record.owner);
  return {
    owner: stringField(owner, "login"),
    name: stringField(record, "name"),
    description: stringField(record, "description"),
    language: stringField(record, "language"),
    stars: numberField(record, "stargazers_count"),
    forks: numberField(record, "forks_count"),
    fork: record.fork === true,
  };
}

async function listLogins(fetch: FetchFunction, token: string, path: string): Promise<string[]> {
  try {
    const data = await gh(fetch, token, path);
    if (!Array.isArray(data)) return [];
    return data.map((item) => stringField(asRecord(item), "login")).filter(Boolean);
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return [];
    throw error;
  }
}

async function loadTree(fetch: FetchFunction, token: string, repo: RepoInfo, ref: string, path: string): Promise<GithubPage> {
  const branch = ref || repo.defaultBranch;
  const [entries, commit, starred] = await Promise.all([
    getDirectory(fetch, token, repo, branch, path),
    getLatestCommit(fetch, token, repo, branch, path),
    token && path === "" ? isStarred(fetch, token, repo.owner, repo.name).catch(() => null) : Promise.resolve(null),
  ]);
  const readmeEntry = entries.find((entry) => entry.type === "file" && /^readme(\.|$)/i.test(entry.name));
  const readme = path === ""
    ? await getReadme(fetch, token, repo, branch)
    : readmeEntry
      ? await getFileText(fetch, token, repo, branch, readmeEntry.path)
      : null;
  return { view: "tree", repo, ref: branch, path, entries: sortEntries(entries), commit, readme, starred };
}

async function loadBlob(fetch: FetchFunction, token: string, repo: RepoInfo, ref: string, path: string): Promise<GithubPage> {
  const branch = ref || repo.defaultBranch;
  const file = await getFile(fetch, token, repo, branch, path);
  return { view: "blob", repo, ref: branch, file };
}

async function getRepo(fetch: FetchFunction, token: string, owner: string, repo: string): Promise<RepoInfo> {
  const data = await gh(fetch, token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  const record = asRecord(data);
  const license = asRecord(record.license);
  const topics = Array.isArray(record.topics) ? record.topics.filter((topic): topic is string => typeof topic === "string") : [];
  return {
    owner,
    name: repo,
    description: stringField(record, "description"),
    visibility: record.private === true ? "Private" : "Public",
    defaultBranch: stringField(record, "default_branch") || "HEAD",
    stars: numberField(record, "stargazers_count"),
    forks: numberField(record, "forks_count"),
    watchers: numberField(record, "subscribers_count"),
    language: stringField(record, "language"),
    // NOASSERTION is GitHub's "a license it couldn't identify"; github.com shows nothing to name.
    license: stringField(license, "spdx_id") === "NOASSERTION" ? "" : stringField(license, "spdx_id") || stringField(license, "name"),
    homepage: stringField(record, "homepage"),
    topics,
    hasDiscussions: record.has_discussions === true,
  };
}

async function getDirectory(fetch: FetchFunction, token: string, repo: RepoInfo, ref: string, path: string): Promise<DirEntry[]> {
  const data = await gh(fetch, token, contentsPath(repo, path, ref));
  if (!Array.isArray(data)) throw new GithubError("That path is a file.", 404);
  return data.map(dirEntry);
}

async function getFile(fetch: FetchFunction, token: string, repo: RepoInfo, ref: string, path: string): Promise<FileBody> {
  const data = asRecord(await gh(fetch, token, contentsPath(repo, path, ref)));
  if (Array.isArray(data) || data.type === "dir") throw new GithubError("That path is a directory.", 404);
  const size = numberField(data, "size");
  const decoded = fileText(stringField(data, "content"), stringField(data, "encoding"), size);
  const name = path.split("/").pop() || path;
  return { name, path, size, text: decoded.text, note: decoded.note };
}

async function getFileText(fetch: FetchFunction, token: string, repo: RepoInfo, ref: string, path: string): Promise<string | null> {
  const file = await getFile(fetch, token, repo, ref, path);
  return file.text;
}

async function getReadme(fetch: FetchFunction, token: string, repo: RepoInfo, ref: string): Promise<string | null> {
  try {
    const data = asRecord(await gh(fetch, token, `${repoPath(repo)}/readme?ref=${encodeURIComponent(ref)}`));
    return fileText(stringField(data, "content"), stringField(data, "encoding"), numberField(data, "size")).text;
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return null;
    throw error;
  }
}

async function getLatestCommit(fetch: FetchFunction, token: string, repo: RepoInfo, ref: string, path: string): Promise<CommitInfo | null> {
  const query = `sha=${encodeURIComponent(ref)}&per_page=1${path ? `&path=${encodeURIComponent(path)}` : ""}`;
  const data = await gh(fetch, token, `${repoPath(repo)}/commits?${query}`);
  if (!Array.isArray(data) || data.length === 0) return null;
  return commitInfo(asRecord(data[0]));
}

async function listIssues(fetch: FetchFunction, token: string, repo: RepoInfo, kind: "issue" | "pull", state: "open" | "closed"): Promise<IssueInfo[]> {
  const path = kind === "pull"
    ? `${repoPath(repo)}/pulls?state=${state}&per_page=30`
    : `${repoPath(repo)}/issues?state=${state}&per_page=30`;
  const data = await gh(fetch, token, path);
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => asRecord(item))
    .filter((item) => kind === "pull" || item.pull_request === undefined)
    .map(issueInfo);
}

/** The Open and Closed counts over a list, from GitHub's search; a count it won't give (rate limited, offline) is null. */
async function stateCounts(fetch: FetchFunction, token: string, repo: RepoInfo, kind: "issue" | "pr"): Promise<StateCounts> {
  const count = async (state: "open" | "closed"): Promise<number | null> => {
    const query = encodeURIComponent(`repo:${repo.owner}/${repo.name} is:${kind} is:${state}`);
    try {
      return numberField(asRecord(await gh(fetch, token, `/search/issues?q=${query}&per_page=1`)), "total_count");
    } catch {
      return null;
    }
  };
  const [open, closed] = await Promise.all([count("open"), count("closed")]);
  return { open, closed };
}

async function getIssue(fetch: FetchFunction, token: string, repo: RepoInfo, number: number): Promise<IssueInfo> {
  return issueInfo(asRecord(await gh(fetch, token, `${repoPath(repo)}/issues/${number}`)));
}

async function getComments(fetch: FetchFunction, token: string, repo: RepoInfo, number: number): Promise<CommentInfo[]> {
  const data = await gh(fetch, token, `${repoPath(repo)}/issues/${number}/comments?per_page=30`);
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const record = asRecord(item);
    const user = asRecord(record.user);
    return {
      user: stringField(user, "login") || "ghost",
      body: stringField(record, "body"),
      createdAt: stringField(record, "created_at"),
    };
  });
}

/** The signed-in user's most recently pushed repositories, as github.com's dashboard lists them. */
export async function listViewerRepos(fetch: FetchFunction, token: string): Promise<ProfileRepo[]> {
  return listProfileRepos(fetch, token, "/user/repos?sort=pushed&per_page=10");
}

/** The login the token belongs to. */
/** Who a token signs in as. */
export interface Viewer {
  login: string;
  /** `avatars.githubusercontent.com` URL; empty when the API gave none. */
  avatarUrl: string;
}

export async function getViewer(fetch: FetchFunction, token: string): Promise<Viewer> {
  const user = asRecord(await gh(fetch, token, "/user"));
  return { login: stringField(user, "login"), avatarUrl: stringField(user, "avatar_url") };
}

/** Opens an issue; resolves with its number. */
export async function createIssue(fetch: FetchFunction, token: string, owner: string, repo: string, title: string, body: string): Promise<number> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
  return numberField(asRecord(await gh(fetch, token, path, { title, body })), "number");
}

/** Comments on an issue or pull request. */
export async function addIssueComment(fetch: FetchFunction, token: string, owner: string, repo: string, number: number, body: string): Promise<void> {
  await gh(fetch, token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`, { body });
}

const DISCUSSION_FIELDS = "number title body createdAt author { login } category { name } answerChosenAt comments { totalCount }";

/** Enough of a repository to find it. */
type RepoName = Pick<RepoInfo, "owner" | "name">;

async function listDiscussions(fetch: FetchFunction, token: string, repo: RepoName): Promise<DiscussionInfo[]> {
  const data = await graphql(fetch, token, `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      discussions(first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${DISCUSSION_FIELDS} } }
    }
  }`, { owner: repo.owner, name: repo.name });
  const nodes = asRecord(asRecord(asRecord(data).repository).discussions).nodes;
  return Array.isArray(nodes) ? nodes.map((node) => discussionInfo(asRecord(node))) : [];
}

async function getDiscussion(
  fetch: FetchFunction,
  token: string,
  repo: RepoName,
  number: number,
): Promise<{ id: string; discussion: DiscussionInfo; comments: CommentInfo[] }> {
  const data = await graphql(fetch, token, `query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      discussion(number: $number) {
        id ${DISCUSSION_FIELDS}
        # Renamed: DISCUSSION_FIELDS already asks for comments' count, and GraphQL won't take one field with two sets of arguments.
        thread: comments(first: 30) {
          nodes {
            body createdAt isAnswer author { login }
            replies(first: 10) { nodes { body createdAt author { login } } }
          }
        }
      }
    }
  }`, { owner: repo.owner, name: repo.name, number });
  const record = asRecord(asRecord(asRecord(data).repository).discussion);
  if (!record.id) throw new GithubError("Not found on GitHub.", 404);
  const nodes = asRecord(record.thread).nodes;
  const comments = Array.isArray(nodes)
    ? nodes.map((node) => {
      const comment = asRecord(node);
      const replies = asRecord(comment.replies).nodes;
      return {
        ...discussionComment(comment),
        answer: comment.isAnswer === true,
        replies: Array.isArray(replies) ? replies.map((reply) => discussionComment(asRecord(reply))) : [],
      };
    })
    : [];
  return { id: stringField(record, "id"), discussion: discussionInfo(record), comments };
}

async function getDiscussionCategories(
  fetch: FetchFunction,
  token: string,
  repo: RepoName,
): Promise<{ repositoryId: string; categories: DiscussionCategory[] }> {
  const data = await graphql(fetch, token, `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) { id discussionCategories(first: 25) { nodes { id slug name description } } }
  }`, { owner: repo.owner, name: repo.name });
  const repository = asRecord(asRecord(data).repository);
  const nodes = asRecord(repository.discussionCategories).nodes;
  const categories = Array.isArray(nodes)
    ? nodes.map((node) => {
      const record = asRecord(node);
      return { id: stringField(record, "id"), slug: stringField(record, "slug"), name: stringField(record, "name"), description: stringField(record, "description") };
    })
    : [];
  return { repositoryId: stringField(repository, "id"), categories };
}

/** Starts a discussion in the category with this slug; resolves with its number. */
export async function createDiscussion(
  fetch: FetchFunction,
  token: string,
  owner: string,
  repo: string,
  categorySlug: string,
  title: string,
  body: string,
): Promise<number> {
  const { repositoryId, categories } = await getDiscussionCategories(fetch, token, { owner, name: repo });
  const category = categories.find((item) => item.slug === categorySlug);
  if (!category) throw new GithubError("That discussion category doesn't exist.", 404);
  const data = await graphql(fetch, token, `mutation($repo: ID!, $category: ID!, $title: String!, $body: String!) {
    createDiscussion(input: { repositoryId: $repo, categoryId: $category, title: $title, body: $body }) { discussion { number } }
  }`, { repo: repositoryId, category: category.id, title, body });
  return numberField(asRecord(asRecord(asRecord(data).createDiscussion).discussion), "number");
}

export async function addDiscussionComment(fetch: FetchFunction, token: string, owner: string, repo: string, number: number, body: string): Promise<void> {
  const { id } = await getDiscussion(fetch, token, { owner, name: repo }, number);
  await graphql(fetch, token, `mutation($id: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $id, body: $body }) { comment { id } }
  }`, { id, body });
}

function discussionInfo(record: Record<string, unknown>): DiscussionInfo {
  return {
    ...discussionComment(record),
    number: numberField(record, "number"),
    title: stringField(record, "title"),
    comments: numberField(asRecord(record.comments), "totalCount"),
    state: "open",
    closedAt: "",
    category: stringField(asRecord(record.category), "name"),
    answered: typeof record.answerChosenAt === "string",
  };
}

function discussionComment(record: Record<string, unknown>): CommentInfo {
  return {
    user: stringField(asRecord(record.author), "login") || "ghost",
    body: stringField(record, "body"),
    createdAt: stringField(record, "createdAt"),
  };
}

function dirEntry(value: unknown): DirEntry {
  const record = asRecord(value);
  const type = record.type;
  const kind = type === "dir" || type === "symlink" || type === "submodule" ? type : "file";
  return {
    name: stringField(record, "name"),
    path: stringField(record, "path"),
    type: kind,
    size: numberField(record, "size"),
  };
}

function commitInfo(record: Record<string, unknown>): CommitInfo {
  const commit = asRecord(record.commit);
  const author = asRecord(commit.author);
  const user = asRecord(record.author);
  return {
    sha: stringField(record, "sha").slice(0, 7),
    message: stringField(commit, "message"),
    author: stringField(user, "login") || stringField(author, "name"),
    date: stringField(author, "date"),
  };
}

function issueInfo(record: Record<string, unknown>): IssueInfo {
  const user = asRecord(record.user);
  // A merged pull request is "closed" to the API; github.com says Merged. The issue endpoint nests the date.
  const merged = typeof record.merged_at === "string" || typeof asRecord(record.pull_request).merged_at === "string";
  return {
    number: numberField(record, "number"),
    title: stringField(record, "title"),
    user: stringField(user, "login") || "ghost",
    comments: numberField(record, "comments"),
    state: merged ? "merged" : stringField(record, "state") || "open",
    body: stringField(record, "body"),
    createdAt: stringField(record, "created_at"),
    closedAt: stringField(record, "merged_at") || stringField(asRecord(record.pull_request), "merged_at") || stringField(record, "closed_at"),
  };
}

function repoPath(repo: RepoInfo): string {
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

function contentsPath(repo: RepoInfo, path: string, ref: string): string {
  const encoded = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const suffix = encoded ? `/${encoded}` : "";
  return `${repoPath(repo)}/contents${suffix}?ref=${encodeURIComponent(ref)}`;
}

function restHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mockintosh",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function starredPath(owner: string, repo: string): string {
  return `/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** Has the signed-in user starred the repository? GitHub answers with a status, and no body. */
async function isStarred(fetch: FetchFunction, token: string, owner: string, repo: string): Promise<boolean> {
  const response = await fetch(`${API}${starredPath(owner, repo)}`, { headers: restHeaders(token), cache: "no-cache" });
  if (response.status === 204) return true;
  if (response.status === 404) return false;
  throw new GithubError(`GitHub returned ${response.status}.`, response.status);
}

/** Stars the repository for the signed-in user, or takes the star back. */
export async function setStarred(fetch: FetchFunction, token: string, owner: string, repo: string, starred: boolean): Promise<void> {
  const response = await fetch(`${API}${starredPath(owner, repo)}`, { method: starred ? "PUT" : "DELETE", headers: restHeaders(token) });
  if (response.ok) return;
  const detail = await errorMessage(response);
  throw new GithubError(detail || `GitHub wouldn't ${starred ? "star" : "unstar"} the repository (${response.status}).`, response.status);
}

/** A REST call: GET, or POST with `json`. */
async function gh(fetch: FetchFunction, token: string, path: string, json?: unknown): Promise<unknown> {
  const headers = restHeaders(token);
  if (json !== undefined) headers["Content-Type"] = "application/json";
  // GitHub lets browsers keep its answers for a minute: ask it whether they're current, so a star, an issue or a
  // comment just made shows at once. An unchanged answer costs a 304, which doesn't count against the rate limit.
  const response = await fetch(`${API}${path}`, json === undefined ? { headers, cache: "no-cache" } : { method: "POST", headers, body: JSON.stringify(json) });
  if (response.status === 404) throw new GithubError("Not found on GitHub.", 404);
  if (!response.ok) {
    const detail = await errorMessage(response);
    if (response.status === 401 || response.status === 403) {
      throw new GithubError(detail || "GitHub refused the request. A token raises the rate limit.", response.status);
    }
    throw new GithubError(detail || `GitHub returned ${response.status}.`, response.status);
  }
  return response.json();
}

/** GitHub's GraphQL API, which alone has discussions. It always needs a token. */
async function graphql(fetch: FetchFunction, token: string, query: string, variables: Record<string, unknown>): Promise<unknown> {
  if (!token) throw new GithubError("Sign in to GitHub to see discussions.", 401);
  const data = asRecord(await gh(fetch, token, "/graphql", { query, variables }));
  const errors = Array.isArray(data.errors) ? data.errors.map((error) => stringField(asRecord(error), "message")).filter(Boolean) : [];
  if (errors.length > 0) {
    const missing = Array.isArray(data.errors) && data.errors.some((error) => asRecord(error).type === "NOT_FOUND");
    throw new GithubError(missing ? "Not found on GitHub." : errors.join(" "), missing ? 404 : 422);
  }
  return data.data;
}

async function errorMessage(response: { json(): Promise<unknown> }): Promise<string> {
  try {
    const body = asRecord(await response.json());
    return stringField(body, "message");
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" ? value : 0;
}

function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if (b0 < 0xe0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b0 < 0xf0 && i + 2 < bytes.length) {
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else if (i + 3 < bytes.length) {
      const code = ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const shifted = code - 0x10000;
      out += String.fromCharCode(0xd800 + (shifted >> 10), 0xdc00 + (shifted & 0x3ff));
      i += 4;
    } else {
      i += 1;
    }
  }
  return out;
}
