import { decodeBase64 } from "@mockintosh/ui";
import type { FetchFunction } from "@mockintosh/sdk";
import type { GithubLocation } from "./location";

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
}

export interface CommentInfo {
  user: string;
  body: string;
  createdAt: string;
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

export type GithubPage =
  | { view: "search"; query: string; repos: ProfileRepo[] }
  | { view: "profile"; profile: ProfileInfo; tab: "repos" | "stars" | "people"; repos: ProfileRepo[]; orgs: string[]; people: string[] }
  | { view: "tree"; repo: RepoInfo; ref: string; path: string; entries: DirEntry[]; commit: CommitInfo | null; readme: string | null }
  | { view: "blob"; repo: RepoInfo; ref: string; file: FileBody }
  | { view: "issues"; repo: RepoInfo; issues: IssueInfo[] }
  | { view: "issue"; repo: RepoInfo; issue: IssueInfo; comments: CommentInfo[] }
  | { view: "pulls"; repo: RepoInfo; pulls: IssueInfo[] }
  | { view: "pull"; repo: RepoInfo; pull: IssueInfo; comments: CommentInfo[] };

const API = "https://api.github.com";
/** Blobs larger than this are summarized instead of drawn into the window. */
const MAX_TEXT = 48_000;

export async function loadPage(fetch: FetchFunction, token: string, location: Exclude<GithubLocation, { kind: "home" }>): Promise<GithubPage> {
  if (location.kind === "search") {
    const data = asRecord(await gh(fetch, token, `/search/repositories?q=${encodeURIComponent(location.query)}&per_page=30`));
    return { view: "search", query: location.query, repos: Array.isArray(data.items) ? data.items.map(profileRepo) : [] };
  }
  if (location.kind === "profile") return loadProfile(fetch, token, location.login, location.tab);
  const repo = await getRepo(fetch, token, location.owner, location.repo);
  if (location.kind === "tree") return loadTree(fetch, token, repo, location.ref, location.path);
  if (location.kind === "blob") return loadBlob(fetch, token, repo, location.ref, location.path);
  if (location.kind === "issues") {
    const issues = await listIssues(fetch, token, repo, "issue");
    return { view: "issues", repo, issues };
  }
  if (location.kind === "pulls") {
    const pulls = await listIssues(fetch, token, repo, "pull");
    return { view: "pulls", repo, pulls };
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

async function loadProfile(
  fetch: FetchFunction,
  token: string,
  login: string,
  tab: "repos" | "stars" | "people",
): Promise<GithubPage> {
  const profile = await getProfile(fetch, token, login);
  const orgs = profile.kind === "User" ? await listLogins(fetch, token, `/users/${encodeURIComponent(login)}/orgs`) : [];
  if (profile.kind === "Organization" && tab === "people") {
    const people = await listLogins(fetch, token, `/orgs/${encodeURIComponent(login)}/public_members`);
    return { view: "profile", profile, tab, repos: [], orgs, people };
  }
  if (profile.kind === "User" && tab === "stars") {
    const repos = await listProfileRepos(fetch, token, `/users/${encodeURIComponent(login)}/starred?per_page=30`);
    return { view: "profile", profile, tab, repos, orgs, people: [] };
  }
  const reposUrl = profile.kind === "Organization"
    ? `/orgs/${encodeURIComponent(login)}/repos?sort=updated&per_page=30`
    : `/users/${encodeURIComponent(login)}/repos?sort=updated&per_page=30&type=owner`;
  const repos = await listProfileRepos(fetch, token, reposUrl);
  return { view: "profile", profile, tab: "repos", repos, orgs, people: [] };
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
  const [entries, commit] = await Promise.all([
    getDirectory(fetch, token, repo, branch, path),
    getLatestCommit(fetch, token, repo, branch, path),
  ]);
  const readmeEntry = entries.find((entry) => entry.type === "file" && /^readme(\.|$)/i.test(entry.name));
  const readme = path === ""
    ? await getReadme(fetch, token, repo, branch)
    : readmeEntry
      ? await getFileText(fetch, token, repo, branch, readmeEntry.path)
      : null;
  return { view: "tree", repo, ref: branch, path, entries: sortEntries(entries), commit, readme };
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
    license: stringField(license, "spdx_id") || stringField(license, "name"),
    homepage: stringField(record, "homepage"),
    topics,
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

async function listIssues(fetch: FetchFunction, token: string, repo: RepoInfo, kind: "issue" | "pull"): Promise<IssueInfo[]> {
  const path = kind === "pull"
    ? `${repoPath(repo)}/pulls?state=open&per_page=30`
    : `${repoPath(repo)}/issues?state=open&per_page=30`;
  const data = await gh(fetch, token, path);
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => asRecord(item))
    .filter((item) => kind === "pull" || item.pull_request === undefined)
    .map(issueInfo);
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
  return {
    number: numberField(record, "number"),
    title: stringField(record, "title"),
    user: stringField(user, "login") || "ghost",
    comments: numberField(record, "comments"),
    state: stringField(record, "state") || "open",
    body: stringField(record, "body"),
    createdAt: stringField(record, "created_at"),
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

async function gh(fetch: FetchFunction, token: string, path: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mockintosh",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { headers });
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
