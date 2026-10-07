import { describe, expect, it } from "vitest";
import type { FetchFunction } from "@mockintosh/sdk";
import { TileSource } from "./tiles";

/** A layer named `name` with no features: the smallest real tile. */
function tileBytes(name: string): ArrayBuffer {
  const text = [...new TextEncoder().encode(name)];
  const layer = [0x0a, text.length, ...text];
  return new Uint8Array([0x1a, layer.length, ...layer]).buffer;
}

function response(status: number, body: unknown): Awaited<ReturnType<FetchFunction>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => "",
    json: async () => body,
    arrayBuffer: async () => (body instanceof ArrayBuffer ? body : new ArrayBuffer(0)),
  };
}

const TILEJSON = { tiles: ["https://tiles.example/v1/{z}/{x}/{y}.pbf"], maxzoom: 14 };

function harness(handler?: (url: string) => Awaited<ReturnType<FetchFunction>> | Promise<Awaited<ReturnType<FetchFunction>>>) {
  const asked: string[] = [];
  let now = 0;
  let changes = 0;
  const fetch: FetchFunction = async (url) => {
    asked.push(url);
    if (url.endsWith("/planet")) return response(200, TILEJSON);
    return handler ? handler(url) : response(200, tileBytes(url));
  };
  const source = new TileSource({ fetch, now: () => now, onChange: () => changes++, concurrency: 2 });
  return { source, asked, advance: (ms: number) => (now += ms), changes: () => changes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TileSource", () => {
  it("reads the tile address from the TileJSON, then fetches the tiles asked for", async () => {
    const { source, asked } = harness();
    source.want([{ z: 3, x: 1, y: 2 }]);
    expect(source.pending).toBe(1);
    await settle();
    await settle();
    expect(asked).toEqual(["https://tiles.openfreemap.org/planet", "https://tiles.example/v1/3/1/2.pbf"]);
    expect(source.get(3, 1, 2)?.has("https://tiles.example/v1/3/1/2.pbf")).toBe(true);
    expect(source.pending).toBe(0);
  });

  it("fetches a few at a time, most wanted first, and forgets tiles no longer wanted", async () => {
    const waiting: Array<() => void> = [];
    const { source, asked } = harness((url) => new Promise((resolve) => waiting.push(() => resolve(response(200, tileBytes(url))))));
    source.want([{ z: 1, x: 0, y: 0 }]);
    await settle();
    source.want([{ z: 2, x: 0, y: 0 }, { z: 2, x: 1, y: 0 }, { z: 2, x: 2, y: 0 }]);
    await settle();
    expect(asked.slice(1)).toEqual(["https://tiles.example/v1/1/0/0.pbf", "https://tiles.example/v1/2/0/0.pbf"]);
    source.want([{ z: 2, x: 3, y: 0 }]);
    waiting.shift()!();
    await settle();
    await settle();
    expect(asked.at(-1)).toBe("https://tiles.example/v1/2/3/0.pbf");
    expect(asked).not.toContain("https://tiles.example/v1/2/1/0.pbf");
  });

  it("treats a missing tile as empty, and retries a failed one only after a pause", async () => {
    let fail = true;
    const { source, asked, advance } = harness((url) => {
      if (url.includes("/5/")) return response(404, null);
      if (fail) throw new TypeError("offline");
      return response(200, tileBytes("ok"));
    });
    source.want([{ z: 5, x: 1, y: 1 }, { z: 6, x: 1, y: 1 }]);
    await settle();
    await settle();
    expect(source.get(5, 1, 1)?.size).toBe(0);
    expect(source.get(6, 1, 1)).toBeUndefined();
    expect(source.error).toMatch(/can't reach/);
    const tries = asked.length;
    source.want([{ z: 6, x: 1, y: 1 }]);
    await settle();
    expect(asked.length).toBe(tries);
    fail = false;
    advance(10_000);
    source.want([{ z: 6, x: 1, y: 1 }]);
    await settle();
    await settle();
    expect(source.get(6, 1, 1)?.has("ok")).toBe(true);
    expect(source.error).toBeNull();
  });
});
