import { describe, expect, it } from "vitest";
import { parseUrl, type LayoutNode } from "@mockintosh/sdk";
import { hnText, parseHackerNewsUrl } from "./hackernews";
import { scaled } from "../icons";
import { microDesktopError, mockintoshSite } from "./mockintosh";
import { githubPage, githubUrl, resolveRelative } from "./github/page";
import type { RepoInfo } from "./github/api";

const REPO: RepoInfo = {
  owner: "octocat",
  name: "Hello-World",
  description: "My first repository",
  visibility: "Public",
  defaultBranch: "main",
  stars: 2500,
  forks: 10,
  watchers: 3,
  language: "C",
  license: "MIT",
  homepage: "",
  topics: [],
};

function links(nodes: readonly LayoutNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === "heading") return node.href ? [node.href] : [];
    if (node.type === "paragraph" || node.type === "listItem") {
      return node.segments.flatMap((segment) => (segment.kind === "link" ? [segment.href] : []));
    }
    return [];
  });
}

describe("GitHub pages", () => {
  it("draws a directory as github.com links Safari can follow", () => {
    const page = githubPage(
      {
        view: "tree",
        repo: REPO,
        ref: "main",
        path: "",
        entries: [
          { name: "src", path: "src", type: "dir", size: 0 },
          { name: "README.md", path: "README.md", type: "file", size: 12 },
        ],
        commit: null,
        readme: "See [the guide](docs/guide.md) and ![logo](logo.png).",
      },
      0,
    );
    expect(page.url).toBe("https://github.com/octocat/Hello-World/tree/main");
    expect(links(page.nodes)).toEqual(expect.arrayContaining([
      "https://github.com/octocat/Hello-World",
      "https://github.com/octocat",
      "https://github.com/octocat/Hello-World/issues",
      "https://github.com/octocat/Hello-World/tree/main/src",
      "https://github.com/octocat/Hello-World/blob/main/README.md",
      "https://github.com/octocat/Hello-World/blob/main/docs/guide.md",
    ]));
  });

  it("points relative README images at raw files in the README's folder", () => {
    const nodes = resolveRelative([{ type: "image", src: "img/a.png", alt: "", align: "left" }], REPO, "main", "docs");
    expect(nodes[0]).toMatchObject({ src: "https://raw.githubusercontent.com/octocat/Hello-World/main/docs/img/a.png" });
  });

  it("round-trips search URLs", () => {
    expect(githubUrl({ kind: "search", query: "mac os" })).toBe("https://github.com/search?q=mac%20os");
  });
});

describe("Hacker News", () => {
  it("reads the pages the adapter draws, and leaves the rest to the HTML path", () => {
    expect(parseHackerNewsUrl(parseUrl("https://news.ycombinator.com/")!)).toEqual({ kind: "listing", listing: "top" });
    expect(parseHackerNewsUrl(parseUrl("https://news.ycombinator.com/newest")!)).toEqual({ kind: "listing", listing: "new" });
    expect(parseHackerNewsUrl(parseUrl("https://news.ycombinator.com/item?id=42")!)).toEqual({ kind: "item", id: 42 });
    expect(parseHackerNewsUrl(parseUrl("https://news.ycombinator.com/user?id=pg")!)).toEqual({ kind: "user", id: "pg" });
    expect(parseHackerNewsUrl(parseUrl("https://news.ycombinator.com/submit")!)).toBeNull();
  });

  it("turns comment HTML into paragraphs, links and code", () => {
    expect(hnText(`It&#x27;s <i>fine</i>.<p>See <a href="https:&#x2F;&#x2F;example.com&#x2F;">this</a><pre><code>  x = 1\n</code></pre>`)).toEqual([
      { type: "paragraph", align: "left", segments: [{ kind: "text", text: "It's " }, { kind: "italic", text: "fine" }, { kind: "text", text: "." }] },
      { type: "paragraph", align: "left", segments: [{ kind: "text", text: "See " }, { kind: "link", text: "this", href: "https://example.com/" }] },
      { type: "code", text: "  x = 1" },
    ]);
  });
});

describe("mockintosh.com", () => {
  const url = (href: string) => parseUrl(href)!;
  const context = { fetch: async () => { throw new Error("no network"); }, settings: { githubToken: "" } };

  it("is the micro desktop picture, whatever the path, without the network", async () => {
    expect(mockintoshSite.handles(url("https://www.mockintosh.com/anything"))).toBe(true);
    expect(mockintoshSite.handles(url("https://ui.mockintosh.com/"))).toBe(false);
    expect(await mockintoshSite.load(url("https://mockintosh.com/about"), context)).toEqual({
      kind: "picture",
      url: "https://mockintosh.com/",
      title: "Mockintosh",
      picture: scaled(microDesktopError, 2),
      background: 1,
    });
    expect([microDesktopError.width, microDesktopError.height]).toEqual([51, 34]);
  });
});
