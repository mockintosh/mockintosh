import { describe, expect, it } from "vitest";
import { parseUrl, type LayoutNode } from "@mockintosh/sdk";
import { hnText, parseHackerNewsUrl } from "./hackernews";
import { scaled } from "../icons";
import { microDesktopError, mockintoshSite } from "./mockintosh";
import { avatarSrc, contributionCalendar, contributionGraph, githubPage, githubUrl, resolveRelative } from "./github/page";
import { adapterFor } from "./index";
import { docsPage, docsSite } from "./docs/site";
import { DOCS_PAGES } from "./docs/pages";
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
  hasDiscussions: false,
};

function links(nodes: readonly LayoutNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === "heading") return node.href ? [node.href] : [];
    if (node.type === "paragraph" || node.type === "listItem") {
      return node.segments.flatMap((segment) => (segment.kind === "link" ? [segment.href] : []));
    }
    if (node.type === "box") return links(node.nodes);
    if (node.type === "tabs") return node.items.map((tab) => tab.href);
    if (node.type === "columns") return node.columns.flatMap((column) => links(column.nodes));
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
        starred: null,
        watching: null,
      },
      0,
    );
    expect(page.url).toBe("https://github.com/octocat/Hello-World/tree/main");
    // The tabs go in the header, with "owner / repo" beside the mark.
    expect(links(page.nav ? [page.nav] : [])).toContain("https://github.com/octocat/Hello-World/issues");
    expect(links(page.nodes)).toEqual(expect.arrayContaining([
      "https://github.com/octocat/Hello-World/tree/main/src",
      "https://github.com/octocat/Hello-World/blob/main/README.md",
      "https://github.com/octocat/Hello-World/blob/main/docs/guide.md",
    ]));
  });

  it("points relative README images at raw files in the README's folder", () => {
    const nodes = resolveRelative([{ type: "image", src: "img/a.png", alt: "", align: "left" }], REPO, "main", "docs");
    expect(nodes[0]).toMatchObject({ src: "https://raw.githubusercontent.com/octocat/Hello-World/main/docs/img/a.png" });
  });

  it("lays a profile out like github.com: a round avatar sidebar beside repository cards", () => {
    const page = githubPage(
      {
        view: "profile",
        profile: {
          login: "octocat",
          name: "The Octocat",
          kind: "User",
          bio: "",
          company: "",
          location: "San Francisco",
          blog: "github.blog",
          twitter: "",
          followers: 1,
          following: 0,
          publicRepos: 8,
          avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
        },
        tab: "repos",
        repos: [{ owner: "octocat", name: "Spoon-Knife", description: "", language: "HTML", stars: 13000, forks: 150000, fork: false }],
        orgs: [],
        people: [],
        extras: null,
      },
      0,
    );
    const columns = page.nodes.find((node) => node.type === "columns");
    if (columns?.type !== "columns") throw new Error("no columns");
    const [sidebar, main] = columns.columns;
    expect(sidebar!.width).toBe(150);
    expect(sidebar!.nodes[0]).toEqual({
      type: "image",
      src: "https://avatars.githubusercontent.com/u/583231?v=4&s=150",
      alt: "octocat",
      align: "left",
      width: 150,
      height: 150,
      borderRadius: 75,
    });
    expect(sidebar!.nodes[1]).toMatchObject({ type: "heading", text: "The Octocat" });
    expect(links(sidebar!.nodes)).toContain("https://github.blog");
    expect(main!.nodes[1]).toMatchObject({ type: "box" });
    expect(links((main!.nodes[1] as { nodes: LayoutNode[] }).nodes)).toEqual(["https://github.com/octocat/Spoon-Knife"]);
  });

  it("draws the contribution graph a week per column, Sunday on top: empty days dotted, the rest outlined and filled deeper", () => {
    const week = (levels: number[]) => ({ firstDay: "2026-10-04", levels, counts: levels.map((level) => Math.max(0, level)) });
    const graph = contributionGraph([week([-1, -1, 0, 1, 2, 3, 4]), week([4, -1, -1, -1, -1, -1, -1])]);
    if (graph.type !== "bitmap") throw new Error("not a bitmap");
    expect([graph.width, graph.height]).toEqual([18, 68]);
    const ink = (column: number, row: number) => {
      let count = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) count += graph.data[(row * 10 + y) * graph.width + column * 10 + x];
      return count;
    };
    const levels = [0, 1, 2, 3, 4, 5, 6].map((row) => ink(0, row));
    expect(levels.slice(0, 3)).toEqual([0, 0, 14]);
    expect(levels[3]).toBeGreaterThan(28);
    expect(levels[3]).toBeLessThan(levels[4]);
    expect(levels[4]).toBeLessThan(levels[5]);
    expect(levels[6]).toBe(64);
    expect(ink(1, 0)).toBe(64);
  });

  it("puts the whole year under month names in a pane scrolled to the latest weeks", () => {
    const weeks = Array.from({ length: 53 }, (_, index) => {
      const day = new Date(Date.UTC(2025, 9, 5 + index * 7)).toISOString().slice(0, 10);
      return { firstDay: day, levels: [1, 0, 0, 0, 0, 0, 0], counts: [1, 0, 0, 0, 0, 0, 0] };
    });
    const [title, box] = contributionCalendar(677, weeks);
    expect(title).toMatchObject({ type: "heading", text: "677 contributions in the last year" });
    const scroller = box!.type === "box" ? box.nodes[0] : null;
    if (scroller?.type !== "scroller") throw new Error("no scroller");
    expect(scroller).toMatchObject({ width: 528, start: "end" });
    const [months, graph] = scroller.nodes;
    expect(graph).toMatchObject({ type: "bitmap", width: 528 });
    if (months?.type !== "columns") throw new Error("no month row");
    const names = months.columns.flatMap((column) => column.nodes.map((node) => (node.type === "paragraph" ? node.segments[0]!.text : "")));
    expect(names).toEqual(["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"]);
  });

  it("leaves out avatars it can't load", () => {
    expect(avatarSrc("")).toBe("");
    expect(avatarSrc("http://avatars.githubusercontent.com/u/1")).toBe("");
    expect(avatarSrc("https://avatars.githubusercontent.com/u/1?s=460&v=4")).toBe("https://avatars.githubusercontent.com/u/1?v=4&s=150");
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

describe("docs.mockintosh.com", () => {
  const url = (href: string) => parseUrl(href)!;
  const context = { fetch: async () => { throw new Error("no network"); }, settings: { githubToken: "" } };
  const columnsOf = (page: { nodes: readonly LayoutNode[] }) => {
    const node = page.nodes[0];
    if (node?.type !== "columns") throw new Error("no columns");
    return node.columns;
  };

  it("is drawn without the network, contents beside the page", async () => {
    expect(adapterFor(url("https://docs.mockintosh.com/"))?.id).toBe("docs");
    expect(adapterFor(url("https://mockintosh.com/"))?.id).toBe("mockintosh");
    const page = await docsSite.load(url("https://docs.mockintosh.com/fonts/"), context);
    if (page.kind !== "document") throw new Error("not a document");
    expect(page.url).toBe("https://docs.mockintosh.com/fonts");
    expect(page.title).toBe("Fonts — Mockintosh Docs");
    const [contents, body] = columnsOf(page);
    expect(contents!.nodes).toContainEqual({ type: "paragraph", align: "left", segments: [{ kind: "bold", text: "Fonts" }] });
    expect(body!.nodes[0]).toMatchObject({ type: "heading", level: 1, text: "Fonts" });
  });

  it("links every page to real pages, on the docs site", () => {
    const paths = new Set(DOCS_PAGES.map((page) => page.path));
    for (const page of DOCS_PAGES) {
      for (const href of links(columnsOf(docsPage(page.path))[1]!.nodes)) {
        const target = parseUrl(href)!;
        if (target.hostname !== "docs.mockintosh.com") continue;
        expect(paths, `${page.path} → ${href}`).toContain(target.path || "/");
      }
    }
  });

  it("says so for a page that doesn't exist", () => {
    expect(docsPage("/nope").title).toBe("Page not found — Mockintosh Docs");
  });
});
