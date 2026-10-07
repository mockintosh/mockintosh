import { describe, expect, it } from "vitest";
import type { FetchFunction, ImageService } from "@mockintosh/sdk";
import { PageError } from "./page";
import { loadRemotePage, remoteImageLoader } from "./remote";

const images: ImageService = {
  decode: async (bytes) => ({ width: bytes.length, height: 1, rgba: new Uint8ClampedArray(bytes.length * 4) }),
};

function recording(fail: (url: string) => boolean) {
  const asked: string[] = [];
  const fetch = (async (url: string) => {
    asked.push(url);
    if (fail(url)) throw new TypeError("Failed to fetch");
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
  }) as FetchFunction;
  return { asked, fetch };
}

describe("remoteImageLoader", () => {
  it("reads GitHub's images directly, and everything else through the server", async () => {
    const { asked, fetch } = recording(() => false);
    const load = remoteImageLoader(fetch, images, 1024);
    expect(await load("https://avatars.githubusercontent.com/u/1?v=4&s=96")).toMatchObject({ width: 3 });
    await load("https://example.com/a.png");
    expect(asked).toEqual([
      "https://avatars.githubusercontent.com/u/1?v=4&s=96",
      `/api/web-image?url=${encodeURIComponent("https://example.com/a.png")}`,
    ]);
  });

  it("falls back to the server when a direct read fails", async () => {
    const { asked, fetch } = recording((url) => !url.startsWith("/api/"));
    const load = remoteImageLoader(fetch, images, 1024);
    expect(await load("https://raw.githubusercontent.com/o/r/main/logo.png")).toMatchObject({ width: 3 });
    expect(asked[1]).toBe(`/api/web-image?url=${encodeURIComponent("https://raw.githubusercontent.com/o/r/main/logo.png")}`);
  });
});

describe("loadRemotePage", () => {
  const request = { url: "https://example.com", reader: false, method: "get" as const };
  const answering = (response: Response) => (async () => response) as FetchFunction;

  it("explains the firewall's rate limit, which has no JSON body", async () => {
    const fetch = answering(new Response("Too Many Requests", { status: 429 }));
    await expect(loadRemotePage(fetch, request)).rejects.toThrow(new PageError("Safari is opening pages too quickly. Wait a minute, then try again."));
  });

  it("gives the status when the server fails without JSON", async () => {
    const fetch = answering(new Response("A server error has occurred", { status: 500 }));
    await expect(loadRemotePage(fetch, request)).rejects.toThrow(new PageError("Could not load the page (500)."));
  });

  it("says it can't reach the server only when the request itself fails", async () => {
    const fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as FetchFunction;
    await expect(loadRemotePage(fetch, request)).rejects.toThrow(new PageError("Safari can't reach the server."));
  });
});
