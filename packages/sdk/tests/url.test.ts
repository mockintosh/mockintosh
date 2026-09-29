import { describe, expect, it } from "vitest";
import { encodeQuery, formatUrl, parseUrl, queryParam, queryParams } from "../src/url";

function resolved(input: string, base?: string): string | null {
  const url = parseUrl(input, base);
  return url ? formatUrl(url) : null;
}

describe("parseUrl", () => {
  it("normalizes absolute addresses the way a browser shows them", () => {
    for (const input of [
      "https://Example.COM",
      "http://example.com:80/a",
      "https://example.com:8443/a/./b/../c?x=1#top",
      "https://user:pw@example.com/",
      "https://example.com/with space/é",
      "https://en.wikipedia.org/wiki/Macintosh_(1984)",
    ]) {
      expect(resolved(input), input).toBe(new URL(input).href);
    }
    expect(parseUrl("https://example.com:8443/a?x=1#top")).toEqual({
      scheme: "https", userinfo: "", hostname: "example.com", port: "8443", path: "/a", query: "x=1", fragment: "top",
    });
  });

  it("resolves relative references like a browser", () => {
    const base = "https://example.com/docs/guide/intro.html?page=1#top";
    for (const href of [
      "next.html", "./next.html", "../index.html", "../../../../up.html", "/root", "//cdn.example.com/x.png",
      "?page=2", "#section", "", "sub/", "..", ".", "http://other.example/", "a b.html",
    ]) {
      expect(resolved(href, base), href).toBe(new URL(href, base).href);
    }
    expect(resolved("x", "https://example.com")).toBe("https://example.com/x");
  });

  it("rejects what isn't an address", () => {
    expect(parseUrl("relative/path")).toBeNull();
    expect(parseUrl("https://")).toBeNull();
    expect(parseUrl("next.html", "not a url")).toBeNull();
    expect(resolved("about:start")).toBe("about:start");
    expect(parseUrl("mailto:hi@example.com")).toMatchObject({ scheme: "mailto", hostname: "", path: "hi@example.com" });
  });
});

describe("query strings", () => {
  it("decodes form-encoded pairs and encodes them back", () => {
    expect(queryParams("q=mac+plus&lang=en%2Dus&flag&=x")).toEqual([
      { name: "q", value: "mac plus" },
      { name: "lang", value: "en-us" },
      { name: "flag", value: "" },
      { name: "", value: "x" },
    ]);
    expect(queryParam("id=42&id=43", "id")).toBe("42");
    expect(queryParam("", "id")).toBeNull();
    expect(encodeQuery([{ name: "q", value: "a&b c" }])).toBe("q=a%26b%20c");
  });
});
