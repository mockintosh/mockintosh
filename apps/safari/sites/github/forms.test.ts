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
}

const ISSUE = { number: 5, title: "It broke", user: { login: "octocat" }, comments: 0, state: "open", body: "Steps", created_at: "2026-10-01T00:00:00Z" };
const DISCUSSION = {
  id: "D_1", number: 9, title: "Ideas", body: "Let's talk", createdAt: "2026-10-01T00:00:00Z", author: { login: "octocat" },
  category: { name: "Ideas" }, answerChosenAt: null,
  comments: { totalCount: 1, nodes: [{ body: "Yes", createdAt: "2026-10-02T00:00:00Z", isAnswer: false, author: { login: "hubot" }, replies: { nodes: [{ body: "Agreed", createdAt: "2026-10-03T00:00:00Z", author: { login: "monalisa" } }] } }] },
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
    if (path === "/graphql") {
      const query = String(call.body?.query);
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
    return [];
  });
}

function texts(nodes: readonly LayoutNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "heading") return node.text;
      if (node.type === "paragraph" || node.type === "listItem") return node.segments.map((segment) => segment.text).join("");
      if (node.type === "columns") return node.columns.map((column) => texts(column.nodes)).join("\n");
      return "";
    })
    .join("\n");
}

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
      controls: [
        { kind: "hidden", name: "return_to", value: "https://github.com/octocat/hello/issues/5" },
        { kind: "submit", name: "", value: "", label: "Sign In to Comment" },
      ],
    });
    const discussions = await page(await loadPage(pageRequest("https://github.com/octocat/hello/discussions"), context(fetch, "")));
    expect(discussions.title).toBe("Sign in to GitHub");
  });

  it("starts a discussion in the chosen category, and comments on one", async () => {
    const { fetch, calls } = fakeGithub();
    const form = await page(await loadPage(pageRequest("https://github.com/octocat/hello/discussions/new?category=ideas"), context(fetch, "tok")));
    expect(forms(form.nodes)[0]).toMatchObject({ action: "https://github.com/octocat/hello/discussions", method: "post" });

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
    expect(forms(home.nodes)[0]).toEqual({
      action: "https://github.com/login",
      method: "post",
      controls: [
        { kind: "hidden", name: "return_to", value: "https://github.com/" },
        { kind: "submit", name: "", value: "", label: "Sign In" },
      ],
    });
  });

  it("heads every page with the account: a Sign In button, or the login, asked of GitHub once", async () => {
    const { fetch, calls } = fakeGithub();
    const signedOut = await page(await loadPage(pageRequest("https://github.com/octocat/hello/issues/5"), context(fetch, "")));
    const header = signedOut.nodes[0];
    expect(header.type === "columns" && header.columns[1].nodes).toEqual([
      expect.objectContaining({ form: expect.objectContaining({ controls: expect.arrayContaining([{ kind: "hidden", name: "return_to", value: "https://github.com/octocat/hello/issues/5" }]) }) }),
    ]);

    const signedIn = await page(await loadPage(pageRequest("https://github.com/octocat/hello/issues/5"), context(fetch, "header-token")));
    await loadPage(pageRequest("https://github.com/octocat/hello"), context(fetch, "header-token"));
    const corner = signedIn.nodes[0].type === "columns" ? signedIn.nodes[0].columns[1].nodes[0] : null;
    expect(corner).toMatchObject({
      type: "paragraph",
      align: "right",
      segments: [{ kind: "link", text: "octocat", href: "https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Foctocat%2Fhello%2Fissues%2F5" }],
    });
    expect(calls.filter((call) => call.url === "https://api.github.com/user")).toHaveLength(1);
  });
});
