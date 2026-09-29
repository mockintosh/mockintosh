import { describe, expect, it } from "vitest";
import type { FetchFunction, FetchResponse } from "@mockintosh/sdk";
import { addressToUrl, formRequest, resolveLink, urlToAddress } from "./address";
import { goBack, goForward, startHistory, visit } from "./history";
import { START_URL, pageRequest } from "./page";
import { loadPage, readerApplies } from "./router";

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

describe("address bar", () => {
  it("opens URLs and bare hosts, and searches for anything else", () => {
    expect(addressToUrl("")).toBe(START_URL);
    expect(addressToUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(addressToUrl("example.com/path")).toBe("https://example.com/path");
    expect(addressToUrl("classic mac os")).toBe("https://lite.duckduckgo.com/lite/?q=classic%20mac%20os");
    expect(addressToUrl("macintosh")).toBe("https://lite.duckduckgo.com/lite/?q=macintosh");
    expect(urlToAddress(START_URL)).toBe("");
  });

  it("shows https pages without the scheme, but only when typing that back goes to the same page", () => {
    expect(urlToAddress("https://github.com/")).toBe("github.com");
    expect(urlToAddress("https://en.wikipedia.org/wiki/Macintosh_128K")).toBe("en.wikipedia.org/wiki/Macintosh_128K");
    expect(urlToAddress("http://example.com/")).toBe("http://example.com/");
    expect(urlToAddress("https://127.0.0.1:8080/")).toBe("https://127.0.0.1:8080/");
    expect(urlToAddress("https://localhost/")).toBe("https://localhost/");
    for (const url of ["https://github.com/", "https://news.ycombinator.com/item?id=1"]) {
      expect([url, url.replace(/\/$/, "")]).toContain(addressToUrl(urlToAddress(url)));
    }
  });
});

describe("links", () => {
  it("resolves relative links and stays put for same-page anchors and other schemes", () => {
    const page = "https://example.com/docs/intro.html";
    expect(resolveLink("next.html", page)).toBe("https://example.com/docs/next.html");
    expect(resolveLink("/about#team", page)).toBe("https://example.com/about");
    expect(resolveLink("#section", page)).toBeNull();
    expect(resolveLink("mailto:hi@example.com", page)).toBeNull();
    expect(resolveLink("https://news.ycombinator.com/", START_URL)).toBe("https://news.ycombinator.com/");
  });
});

describe("forms", () => {
  const fields = [{ name: "q", value: "mac plus" }, { name: "kl", value: "us-en" }];

  it("puts GET fields in the query, replacing the action's own", () => {
    const request = formRequest({ action: "https://example.com/search?old=1", method: "get", controls: [] }, fields, "https://example.com/");
    expect(request).toEqual(pageRequest("https://example.com/search?q=mac%20plus&kl=us-en"));
  });

  it("sends POST fields as a urlencoded body, and posts to the page itself without an action", () => {
    const request = formRequest({ action: "", method: "post", controls: [] }, fields, "https://example.com/form");
    expect(request).toEqual(pageRequest("https://example.com/form", { method: "post", body: "q=mac%20plus&kl=us-en" }));
  });
});

describe("history", () => {
  it("goes back and forward, and a new visit drops the forward list", () => {
    const a = pageRequest("https://a.example/");
    const b = pageRequest("https://b.example/");
    const c = pageRequest("https://c.example/");
    let history = visit(visit(startHistory(a), b), c);
    history = goBack(goBack(history));
    expect(history.current).toBe(a);
    history = goForward(history);
    expect(history.current).toBe(b);
    history = visit(history, c);
    expect(history.forward).toEqual([]);
    expect(history.back).toEqual([a, b]);
  });
});

describe("router", () => {
  const settings = { githubToken: "" };

  it("sends ordinary pages and Reader to the server", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetch: FetchFunction = async (url, options) => {
      calls.push({ url, body: JSON.parse(String(options?.body)) });
      return reply({ url: "https://example.com/", title: "Example", nodes: [] });
    };
    const result = await loadPage(pageRequest("https://example.com", { reader: true }), { fetch, settings });
    expect(result).toEqual({ kind: "page", page: { kind: "document", url: "https://example.com/", title: "Example", nodes: [] } });
    expect(calls).toEqual([{ url: "/api/browse", body: { url: "https://example.com", reader: true, method: "get" } }]);
  });

  it("uses a site adapter for its site and shows server errors as the page", async () => {
    const seen: string[] = [];
    const fetch: FetchFunction = async (url) => {
      seen.push(url);
      return url === "/api/browse" ? reply({ error: "404 Not Found (page not found)" }, 502) : reply({ hits: [] });
    };
    await loadPage(pageRequest("https://news.ycombinator.com/"), { fetch, settings });
    expect(seen[0]).toMatch(/^https:\/\/hn\.algolia\.com\/api\/v1\/search\?tags=front_page/);
    expect(await loadPage(pageRequest("https://example.com/missing"), { fetch, settings })).toEqual({
      kind: "error",
      message: "404 Not Found (page not found)",
    });
  });

  it("offers Reader only for pages read from HTML", () => {
    expect(readerApplies(pageRequest("https://example.com/"))).toBe(true);
    expect(readerApplies(pageRequest("https://github.com/octocat"))).toBe(false);
    expect(readerApplies(pageRequest(START_URL))).toBe(false);
  });
});
