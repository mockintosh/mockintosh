import { describe, expect, it } from "vitest";
import {
  parseContributors,
  parseLinkNext,
  renderContributorsModule,
  resolveRepo,
  shouldRefresh,
} from "./build-contributors";

describe("resolveRepo", () => {
  it("prefers GITHUB_REPOSITORY, then Vercel, then mockintosh/mockintosh", () => {
    expect(resolveRepo({ GITHUB_REPOSITORY: "acme/os" })).toEqual({ owner: "acme", repo: "os" });
    expect(resolveRepo({ VERCEL_GIT_REPO_OWNER: "org", VERCEL_GIT_REPO_SLUG: "app" })).toEqual({
      owner: "org",
      repo: "app",
    });
    expect(resolveRepo({})).toEqual({ owner: "mockintosh", repo: "mockintosh" });
  });
});

describe("parseContributors", () => {
  it("drops bots and sorts by commit count", () => {
    expect(
      parseContributors([
        { login: "dependabot[bot]", contributions: 9, type: "Bot" },
        { login: "pat", contributions: 3, type: "User" },
        { login: "alex", contributions: 12, type: "User" },
      ]),
    ).toEqual([
      { username: "alex", commits: 12 },
      { username: "pat", commits: 3 },
    ]);
  });
});

describe("parseLinkNext", () => {
  it("reads rel=next from a GitHub Link header", () => {
    expect(
      parseLinkNext(
        '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=4>; rel="last"',
      ),
    ).toBe("https://api.github.com/x?page=2");
    expect(parseLinkNext(null)).toBeUndefined();
  });
});

describe("renderContributorsModule", () => {
  it("emits a typed array the About box can import", () => {
    const source = renderContributorsModule([{ username: "gustavlrsn", commits: 158 }]);
    expect(source).toContain("export const contributors");
    expect(source).toContain('"gustavlrsn"');
    expect(source).toContain("158");
  });
});

describe("shouldRefresh", () => {
  it("refreshes on Vercel or with --refresh, and leaves the committed file alone otherwise", () => {
    expect(shouldRefresh({}, [])).toBe(false);
    expect(shouldRefresh({ VERCEL: "1" }, [])).toBe(true);
    expect(shouldRefresh({}, ["--refresh"])).toBe(true);
  });
});
