import { describe, expect, it } from "vitest";
import type { FetchFunction, FetchRequest, FetchResponse, LayoutNode, WebForm } from "@mockintosh/sdk";
import { pageRequest, type DocumentPage, type GithubAccount, type SiteContext } from "../../page";
import { loadPage } from "../../router";

function reply(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

interface Call {
  method: string;
  url: string;
  auth: string;
  body: Record<string, unknown> | null;
  cache?: FetchRequest["cache"];
}

const ISSUE = { number: 5, title: "It broke", user: { login: "octocat" }, comments: 0, state: "open", body: "Steps", created_at: "2026-10-01T00:00:00Z" };
const DISCUSSION = {
  id: "D_1", number: 9, title: "Ideas", body: "Let's talk", createdAt: "2026-10-01T00:00:00Z", author: { login: "octocat" },
  category: { name: "Ideas" }, answerChosenAt: null,
  comments: { totalCount: 1 },
  thread: { nodes: [{ body: "Yes", createdAt: "2026-10-02T00:00:00Z", isAnswer: false, author: { login: "hubot" }, replies: { nodes: [{ body: "Agreed", createdAt: "2026-10-03T00:00:00Z", author: { login: "monalisa" } }] } }] },
};
const CATEGORIES = { repository: { id: "R_1", discussionCategories: { nodes: [{ id: "C_1", slug: "ideas", name: "Ideas", description: "Share ideas" }] } } };

/** api.github.com for one repository, recording every call. */
function fakeGithub(overrides: (call: Call) => FetchResponse | undefined = () => undefined) {
  const calls: Call[] = [];
  const fetch: FetchFunction = async (url: string, options?: FetchRequest) => {
    const call: Call = {
      method: options?.method ?? "GET",
      url,
      auth: (options?.headers as Record<string, string> | undefined)?.Authorization ?? "",
      body: options?.body ? (JSON.parse(String(options.body)) as Record<string, unknown>) : null,
      cache: options?.cache,
    };
    calls.push(call);
    const custom = overrides(call);
    if (custom) return custom;
    const path = url.replace("https://api.github.com", "");
    if (path === "/repos/octocat/hello") return reply({ default_branch: "main", has_discussions: true });
    if (path === "/repos/octocat/hello/issues" && call.method === "POST") return reply({ number: 5 }, 201);
    if (path === "/repos/octocat/hello/issues/5") return reply(ISSUE);
    if (path.startsWith("/repos/octocat/hello/issues/5/comments")) return reply(call.method === "POST" ? {} : [], call.method === "POST" ? 201 : 200);
    if (path === "/user") return reply({ login: "octocat" });
    if (path === "/user/starred/octocat/hello") return reply(null, call.method === "GET" ? 404 : 204);
    if (path === "/users/octocat") return reply({ login: "octocat", name: "The Octocat", type: "User", public_repos: 2 });
    if (path.startsWith("/users/octocat/orgs")) return reply([]);
    if (path.startsWith("/users/octocat/repos")) {
      return reply([
        { name: "small", owner: { login: "octocat" }, stargazers_count: 1 },
        { name: "hello", owner: { login: "octocat" }, stargazers_count: 3 },
      ]);
    }
    if (path.startsWith("/repos/octocat/hello/contents") || path.startsWith("/repos/octocat/hello/commits")) return reply([]);
    if (path.startsWith("/user/repos")) return reply([{ name: "hello", owner: { login: "octocat" }, stargazers_count: 3 }]);
    if (path === "/repos/octocat/hello/pulls/8" || path === "/repos/octocat/hello/issues/8") {
      return reply({ ...ISSUE, number: 8, state: "closed", pull_request: { merged_at: "2026-10-02T00:00:00Z" } });
    }
    if (path.startsWith("/repos/octocat/hello/issues/8/comments")) return reply([]);
    if (path === "/graphql") {
      const query = String(call.body?.query);
      if (query.includes("pinnedItems")) {
        return reply({ data: { repositoryOwner: {
          pinnedItems: { nodes: [{ name: "hello", owner: { login: "octocat" }, stargazerCount: 3, forkCount: 0, isFork: false }] },
          status: { message: "Shipping" },
          year: { contributionCalendar: { totalContributions: 699, weeks: [{ firstDay: "2026-10-04", contributionDays: [{ weekday: 0, contributionCount: 12, contributionLevel: "FOURTH_QUARTILE" }] }] } },
          month: {
            commitContributionsByRepository: [{ repository: { name: "hello", owner: { login: "octocat" } }, contributions: { totalCount: 39 } }],
            pullRequestContributionsByRepository: [],
            issueContributionsByRepository: [],
          },
        } } });
      }
      if (query.includes("createDiscussion")) return reply({ data: { createDiscussion: { discussion: { number: 9 } } } });
      if (query.includes("addDiscussionComment")) return reply({ data: { addDiscussionComment: { comment: { id: "DC_2" } } } });
      if (query.includes("discussionCategories")) return reply({ data: CATEGORIES });
      if (query.includes("discussion(number")) return reply({ data: { repository: { discussion: DISCUSSION } } });
    }
    return reply({ message: "Not Found" }, 404);
  };
  return { fetch, calls };
}

function context(fetch: FetchFunction, githubToken: string, github?: GithubAccount): SiteContext {
  return { fetch, settings: { githubToken }, github };
}

function post(url: string, fields: Record<string, string>) {
  return pageRequest(url, { method: "post", body: new URLSearchParams(fields).toString() });
}

async function page(result: Awaited<ReturnType<typeof loadPage>>): Promise<DocumentPage> {
  if (result.kind !== "page" || result.page.kind !== "document") throw new Error(`no page: ${JSON.stringify(result)}`);
  return result.page;
}

function forms(nodes: readonly LayoutNode[]): WebForm[] {
  return nodes.flatMap((node) => {
    if (node.type === "form") return [node.form];
    if (node.type === "columns") return node.columns.flatMap((column) => forms(column.nodes));
    if (node.type === "box") return forms(node.nodes);
    return [];
  });
}

function texts(nodes: readonly LayoutNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "heading") return node.text;
      if (node.type === "paragraph" || node.type === "listItem") return node.segments.map((segment) => segment.text).join("");
      if (node.type === "columns") return node.columns.map((column) => texts(column.nodes)).join("\n");
      if (node.type === "box") return texts(node.nodes);
      if (node.type === "scroller") return texts(node.nodes);
      if (node.type === "tabs") return node.items.map((tab) => tab.label).join("\n");
      return "";
    })
    .join("\n");
}

describe("GitHub pages", () => {
  it("jumps from Search or jump to… straight to an owner/repo", async () => {
    const { fetch } = fakeGithub();
    const shown = await page(await loadPage(pageRequest("https://github.com/search?q=octocat%2Fhello"), context(fetch, "")));
    expect(shown.url).toBe("https://github.com/octocat/hello/tree/main");
  });

  it("says a merged pull request is Merged, not Closed", async () => {
    const { fetch } = fakeGithub();
    const shown = await page(await loadPage(pageRequest("https://github.com/octocat/hello/pull/8"), context(fetch, "")));
    expect(texts(shown.nodes)).toContain("Merged");
  });

  it("lists the signed-in user's top repositories on the home page", async () => {
    const { fetch } = fakeGithub();
    const home = await page(await loadPage(pageRequest("https://github.com/"), context(fetch, "home-token")));
    expect(texts(home.nodes)).toContain("Top repositories");
    expect(texts(home.nodes)).toContain("octocat / hello");
    // Only the repository's name is bold; both parts go to it.
    expect(JSON.stringify(home.nodes)).toContain(JSON.stringify([
      { kind: "link", text: "octocat / ", href: "https://github.com/octocat/hello" },
      { kind: "link", text: "hello", href: "https://github.com/octocat/hello", bold: true },
    ]));
    // The header says where this is: GitHub itself.
    const [header] = home.nodes;
    expect(header?.type === "columns" && header.columns[1]!.nodes[0]).toMatchObject({ segments: [{ kind: "link", text: "GitHub", href: "https://github.com/", bold: true }] });
  });
});

describe("GitHub repositories", () => {
  it("heads a repository with where it is, then its tabs over a rule, and puts About beside the files", async () => {
    const { fetch } = fakeGithub();
    const shown = await page(await loadPage(pageRequest("https://github.com/octocat/hello"), context(fetch, "")));
    const [header, space, nav] = shown.nodes;
    expect(space).toEqual({ type: "spacer", height: 0 });
    if (header?.type !== "columns") throw new Error("no header");
    expect(header.columns[1]!.nodes).toEqual([
      {
        type: "paragraph",
        align: "left",
        segments: [
          { kind: "link", text: "octocat", href: "https://github.com/octocat", underline: "hover" },
          { kind: "text", text: " / " },
          { kind: "link", text: "hello", href: "https://github.com/octocat/hello", bold: true, underline: "hover" },
        ],
      },
    ]);
    // The tabs draw the rule under them themselves, the current one marked on it.
    expect(nav).toEqual({
      type: "tabs",
      items: [
        { label: "Code", href: "https://github.com/octocat/hello/tree/main", current: true },
        { label: "Issues", href: "https://github.com/octocat/hello/issues", current: false },
        { label: "Pull requests", href: "https://github.com/octocat/hello/pulls", current: false },
        { label: "Discussions", href: "https://github.com/octocat/hello/discussions", current: false },
      ],
    });
    expect(shown.nodes.some((node) => node.type === "hr")).toBe(false);
    // The name and its Star button, then the files beside About.
    const columns = shown.nodes.filter((node) => node.type === "columns" && node !== header);
    const [title, body] = columns;
    if (title?.type !== "columns" || body?.type !== "columns") throw new Error("no columns");
    expect(title.columns[0]!.nodes[0]).toMatchObject({ type: "heading", text: "hello" });
    expect(body.columns[1]!.nodes[0]).toMatchObject({ type: "heading", text: "About" });
  });
});

describe("GitHub stars", () => {
  const starForm = (nodes: readonly LayoutNode[]) => forms(nodes).find((form) => form.controls.some((control) => control.kind === "submit" && /^Star/.test(control.label)));

  it("puts a Star button by the repository's name that stars it, signed in", async () => {
    const { fetch, calls } = fakeGithub();
    const shown = await page(await loadPage(pageRequest("https://github.com/octocat/hello"), context(fetch, "tok")));
    expect(starForm(shown.nodes)).toEqual({
      action: "https://github.com/octocat/hello",
      method: "post",
      align: "right",
      controls: [
        { kind: "hidden", name: "star", value: "star" },
        { kind: "submit", name: "", value: "", label: "Star 0", icon: "safari/github-star" },
      ],
    });
    const result = await loadPage(post("https://github.com/octocat/hello", { star: "star" }), context(fetch, "tok"));
    expect(calls.find((call) => call.method === "PUT")).toMatchObject({ url: "https://api.github.com/user/starred/octocat/hello", auth: "Bearer tok" });
    expect((await page(result)).url).toBe("https://github.com/octocat/hello/tree/main");
    // The page after it asks GitHub afresh, not the browser's minute-old copy, so the count and the button are current.
    const after = calls.slice(calls.findIndex((call) => call.method === "PUT") + 1);
    expect(after.find((call) => call.url === "https://api.github.com/repos/octocat/hello")?.cache).toBe("no-cache");
    expect(after.find((call) => call.url.endsWith("/user/starred/octocat/hello"))?.cache).toBe("no-cache");
  });

  it("fills the star once starred, and says what pressing it does", async () => {
    const { fetch, calls } = fakeGithub((call) => (call.url.endsWith("/user/starred/octocat/hello") && call.method === "GET" ? reply(null, 204) : undefined));
    const shown = await page(await loadPage(pageRequest("https://github.com/octocat/hello"), context(fetch, "tok")));
    expect(starForm(shown.nodes)?.controls).toEqual([
      { kind: "hidden", name: "star", value: "unstar" },
      { kind: "submit", name: "", value: "", label: "Starred 0", icon: "safari/github-starred", tooltip: "Unstar octocat/hello" },
    ]);
    await loadPage(post("https://github.com/octocat/hello", { star: "unstar" }), context(fetch, "tok"));
    expect(calls.find((call) => call.method === "DELETE")).toMatchObject({ url: "https://api.github.com/user/starred/octocat/hello" });
  });

  it("signs in from the Star button when signed out, and comes back to the repository", async () => {
    const { fetch } = fakeGithub();
    const shown = await page(await loadPage(pageRequest("https://github.com/octocat/hello"), context(fetch, "")));
    expect(starForm(shown.nodes)).toMatchObject({
      action: "https://github.com/login",
      controls: [{ kind: "hidden", name: "return_to", value: "https://github.com/octocat/hello/tree/main" }, { label: "Star 0", icon: "safari/github-star" }],
    });
  });
});

describe("GitHub profiles", () => {
  it("shows the Overview signed in: pinned repositories, the contribution graph and this month's activity", async () => {
    const { fetch } = fakeGithub();
    const shown = await page(await loadPage(pageRequest("https://github.com/octocat"), context(fetch, "profile-token")));
    const all = texts(shown.nodes);
    const [header] = shown.nodes;
    // The header names whose profile this is, in bold.
    expect(header?.type === "columns" && header.columns[1]!.nodes[0]).toMatchObject({ segments: [{ kind: "link", text: "octocat", bold: true, underline: "hover" }] });
    for (const expected of ["Overview", "Repositories 2", "Stars", "Pinned", "Shipping", "699 contributions in the last year", "Contribution activity", "Created 39 commits in 1 repository"]) {
      expect(all).toContain(expected);
    }
  });

  it("shows popular repositories signed out, most starred first, and asks to sign in for the rest", async () => {
    const { fetch } = fakeGithub();
    const shown = await page(await loadPage(pageRequest("https://github.com/octocat"), context(fetch, "")));
    const all = texts(shown.nodes);
    expect(all).toContain("Popular repositories");
    expect(all.indexOf("hello")).toBeLessThan(all.indexOf("small"));
    expect(all).toContain("Sign in to see pinned repositories and contributions.");
    expect(all).not.toContain("contributions in the last year");
  });
});

describe("GitHub forms", () => {
  it("opens an issue and lands on it, in place of the post", async () => {
    const { fetch, calls } = fakeGithub();
    const result = await loadPage(post("https://github.com/octocat/hello/issues", { title: " It broke ", body: "Steps" }), context(fetch, "tok"));
    const created = calls.find((call) => call.method === "POST")!;
    expect(created).toMatchObject({ url: "https://api.github.com/repos/octocat/hello/issues", auth: "Bearer tok", body: { title: "It broke", body: "Steps" } });
    expect((await page(result)).url).toBe("https://github.com/octocat/hello/issues/5");
    expect(result).toMatchObject({ landed: { url: "https://github.com/octocat/hello/issues/5", method: "get" } });
  });

  it("comments on an issue, and on a pull request through its issue", async () => {
    const { fetch, calls } = fakeGithub();
    await loadPage(post("https://github.com/octocat/hello/issues/5", { body: "Me too" }), context(fetch, "tok"));
    await loadPage(post("https://github.com/octocat/hello/pull/5", { body: "LGTM" }), context(fetch, "tok"));
    const posted = calls.filter((call) => call.method === "POST").map((call) => [call.url, call.body]);
    expect(posted).toEqual([
      ["https://api.github.com/repos/octocat/hello/issues/5/comments", { body: "Me too" }],
      ["https://api.github.com/repos/octocat/hello/issues/5/comments", { body: "LGTM" }],
    ]);
  });

  it("puts what was written back in the form, with why GitHub refused it", async () => {
    const { fetch } = fakeGithub((call) =>
      call.method === "POST" ? reply({ message: "You can't comment at this time." }, 403) : undefined,
    );
    const shown = await page(await loadPage(post("https://github.com/octocat/hello/issues/5", { body: "Me too" }), context(fetch, "tok")));
    expect(shown.url).toBe("https://github.com/octocat/hello/issues/5");
    expect(texts(shown.nodes)).toContain("You can't comment at this time.");
    expect(forms(shown.nodes).at(-1)!.controls).toContainEqual({ kind: "textarea", name: "body", value: "Me too", rows: 5 });

    const untitled = await page(await loadPage(post("https://github.com/octocat/hello/issues", { title: "", body: "Body" }), context(fetch, "tok")));
    expect(untitled.url).toBe("https://github.com/octocat/hello/issues/new");
    expect(texts(untitled.nodes)).toContain("An issue needs a title.");
  });

  it("asks to sign in instead of showing comment forms, and discussions, when signed out", async () => {
    const { fetch } = fakeGithub();
    const issue = await page(await loadPage(pageRequest("https://github.com/octocat/hello/issues/5"), context(fetch, "")));
    expect(forms(issue.nodes).at(-1)).toEqual({
      action: "https://github.com/login",
      method: "post",
      align: "left",
      controls: [
        { kind: "hidden", name: "return_to", value: "https://github.com/octocat/hello/issues/5" },
        { kind: "submit", name: "", value: "", label: "Sign In" },
      ],
    });
    const discussions = await page(await loadPage(pageRequest("https://github.com/octocat/hello/discussions"), context(fetch, "")));
    expect(discussions.title).toBe("Sign in to GitHub");
  });

  it("starts a discussion in the chosen category, and comments on one", async () => {
    const { fetch, calls } = fakeGithub();
    const form = await page(await loadPage(pageRequest("https://github.com/octocat/hello/discussions/new?category=ideas"), context(fetch, "tok")));
    expect(forms(form.nodes)).toContainEqual(expect.objectContaining({ action: "https://github.com/octocat/hello/discussions", method: "post" }));

    const started = await loadPage(post("https://github.com/octocat/hello/discussions", { category: "ideas", title: "Ideas", body: "Let's talk" }), context(fetch, "tok"));
    expect((await page(started)).url).toBe("https://github.com/octocat/hello/discussions/9");
    const create = calls.find((call) => String(call.body?.query).includes("createDiscussion"))!;
    expect(create.body?.variables).toEqual({ repo: "R_1", category: "C_1", title: "Ideas", body: "Let's talk" });

    const shown = await page(await loadPage(post("https://github.com/octocat/hello/discussions/9", { body: "Me too" }), context(fetch, "tok")));
    const comment = calls.find((call) => String(call.body?.query).includes("addDiscussionComment"))!;
    expect(comment.body?.variables).toEqual({ id: "D_1", body: "Me too" });
    expect(texts(shown.nodes)).toContain("Agreed");
  });

  it("signs in from the button and goes back where it was, with the new token", async () => {
    const { fetch, calls } = fakeGithub();
    let signedIn = 0;
    const github: GithubAccount = { signIn: async () => (signedIn++, "fresh"), signOut: async () => {} };
    const result = await loadPage(post("https://github.com/login", { return_to: "https://github.com/octocat/hello/issues/5" }), context(fetch, "", github));
    expect(signedIn).toBe(1);
    expect((await page(result)).url).toBe("https://github.com/octocat/hello/issues/5");
    expect(calls.every((call) => call.auth === "Bearer fresh")).toBe(true);

    const cancelled = await loadPage(post("https://github.com/login", { return_to: "" }), context(fetch, "", { ...github, signIn: async () => null }));
    expect((await page(cancelled)).title).toBe("Sign in to GitHub");
  });

  it("says who is signed in, and signs out", async () => {
    const { fetch } = fakeGithub();
    let signedOut = false;
    const github: GithubAccount = { signIn: async () => null, signOut: async () => void (signedOut = true) };
    const account = await page(await loadPage(pageRequest("https://github.com/login"), context(fetch, "tok", github)));
    expect(texts(account.nodes)).toContain("signed in to GitHub as octocat");
    const home = await page(await loadPage(post("https://github.com/logout", { return_to: "" }), context(fetch, "tok", github)));
    expect(signedOut).toBe(true);
    expect(forms(home.nodes)).toContainEqual({
      action: "https://github.com/login",
      method: "post",
      align: "right",
      controls: [
        { kind: "hidden", name: "return_to", value: "https://github.com/" },
        { kind: "submit", name: "", value: "", label: "Sign In" },
      ],
    });
  });

  it("heads every page with the account: a Sign In button, or a menu under the login, asked of GitHub once", async () => {
    const { fetch, calls } = fakeGithub();
    const signedOut = await page(await loadPage(pageRequest("https://github.com/octocat/hello/issues/5"), context(fetch, "")));
    const header = signedOut.nodes[0];
    expect(header.type === "columns" && header.columns[3].nodes).toEqual([
      expect.objectContaining({ form: expect.objectContaining({ controls: expect.arrayContaining([{ kind: "hidden", name: "return_to", value: "https://github.com/octocat/hello/issues/5" }]) }) }),
    ]);

    const signedIn = await page(await loadPage(pageRequest("https://github.com/octocat/hello/issues/5"), context(fetch, "header-token")));
    await loadPage(pageRequest("https://github.com/octocat/hello"), context(fetch, "header-token"));
    const corner = signedIn.nodes[0].type === "columns" ? signedIn.nodes[0].columns[3].nodes[0] : null;
    expect(corner).toMatchObject({
      type: "menu",
      label: "octocat",
      align: "right",
      items: [
        { label: "Your profile", href: "https://github.com/octocat" },
        { label: "Your repositories", href: "https://github.com/octocat?tab=repositories" },
        { label: "Your stars", href: "https://github.com/octocat?tab=stars" },
        {
          label: "Sign out",
          form: {
            action: "https://github.com/logout",
            method: "post",
            controls: expect.arrayContaining([{ kind: "hidden", name: "return_to", value: "https://github.com/octocat/hello/issues/5" }]),
          },
        },
      ],
    });
    expect(calls.filter((call) => call.url === "https://api.github.com/user")).toHaveLength(1);
  });

  it("opens the account menu from the avatar, 16 pixels round, when GitHub gives one", async () => {
    const { fetch } = fakeGithub((call) => (call.url === "https://api.github.com/user" ? reply({ login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4" }) : undefined));
    const shown = await page(await loadPage(pageRequest("https://github.com/octocat/hello"), context(fetch, "avatar-token")));
    const header = shown.nodes[0];
    if (header?.type !== "columns") throw new Error("no header");
    expect(header.columns[3]).toMatchObject({
      width: 16,
      nodes: [{ type: "menu", label: "octocat", image: { src: "https://avatars.githubusercontent.com/u/583231?v=4&s=16", size: 16, border: true } }],
    });
  });
});
