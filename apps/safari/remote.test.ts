import { describe, expect, it } from "vitest";
import type { FetchFunction, ImageService } from "@mockintosh/sdk";
import { remoteImageLoader } from "./remote";

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
