/**
 * Directions in Maps on a headless Macintosh, with the search and routing
 * servers faked: directions go to the pin, the typed start is looked up, and
 * the route's steps are listed and can be picked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectionNode } from "@mockintosh/ui";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import Maps from "../Maps";

const PLACES: Record<string, unknown[]> = {
  "san francisco": [{ name: "San Francisco", display_name: "San Francisco, California, United States", lat: "37.7793", lon: "-122.4193", addresstype: "city" }],
  cupertino: [{ name: "Cupertino", display_name: "Cupertino, California, United States", lat: "37.3230", lon: "-122.0322", addresstype: "city" }],
  hello: [
    { name: "Dello", display_name: "Dello, Brescia, Italy", lat: "45.4167", lon: "10.0833", addresstype: "village" },
    { name: "Hello", display_name: "Hello, Gao, Mali", lat: "16.2667", lon: "-0.0500", addresstype: "village" },
    { name: "Hello", display_name: "Hello, Vestland, Norway", lat: "60.8000", lon: "5.5000", addresstype: "hamlet" },
  ],
};

const FASTEST = {
  distance: 69896,
  duration: 3304,
  geometry: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
  legs: [
    {
      steps: [
        { name: "Stevens Creek Boulevard", distance: 2000, maneuver: { type: "depart", bearing_after: 90, location: [-122.0322, 37.323] } },
        { name: "", ref: "I 280", distance: 67896, maneuver: { type: "on ramp", modifier: "left", location: [-122.01, 37.32] } },
        { name: "Market Street", distance: 0, maneuver: { type: "arrive", location: [-122.4193, 37.7793] } },
      ],
    },
  ],
};

const ROUTE = { code: "Ok", routes: [{ ...FASTEST, duration: 3720, legs: [{ ...FASTEST.legs[0]!, summary: "US 101" }] }, FASTEST] };

describe("Maps › Directions", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;
  const asked: string[] = [];

  beforeEach(async () => {
    vi.useFakeTimers();
    asked.length = 0;
    platform = createHeadlessPlatform({ width: 640, height: 480 });
    platform.fetch = async (url: string) => {
      asked.push(url);
      if (url.includes("nominatim")) {
        const q = new URL(url).searchParams.get("q")!.toLowerCase();
        return new Response(JSON.stringify(PLACES[q] ?? []), { status: 200 });
      }
      if (url.includes("routing.openstreetmap.de")) return new Response(JSON.stringify(ROUTE), { status: 200 });
      throw new Error("offline");
    };
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Maps);
    os.services.openApp("maps");
    await settle();
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      platform.tick();
      await vi.advanceTimersByTimeAsync(50);
    }
    platform.tick();
  }

  async function nodes(): Promise<InspectionNode[]> {
    return (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
  }

  async function node(name: string): Promise<InspectionNode | undefined> {
    return (await nodes()).find((n) => n.name === name);
  }

  async function click(name: string): Promise<void> {
    const target = await node(name);
    expect(target, name).toBeDefined();
    const { x, y, width, height } = target!.bounds;
    platform.click(x + Math.floor(width / 2), y + Math.floor(height / 2));
    await settle();
  }

  /** Type `text` into the focused field and press Return. */
  async function enter(text: string): Promise<void> {
    const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
    for (const key of [...text, "Enter"]) {
      platform.key({ type: "down", key, modifiers });
      platform.key({ type: "up", key, modifiers });
    }
    await settle();
    await settle();
  }

  it("letters a search's results on the map, all in view, and opens the one whose letter is clicked", async () => {
    await click("maps-search");
    await enter("hello");
    const rows = (await nodes()).filter((n) => /^maps-result-\d$/.test(n.name ?? ""));
    expect(rows.map((n) => n.value)).toEqual(["A: Dello", "B: Hello", "C: Hello"]);

    // Zoomed out to show them all, from Mali to Norway.
    const map = (await node("map"))!;
    const [, zoomText, latText, lonText] = /^zoom (\d+), (-?[\d.]+), (-?[\d.]+)/.exec(String(map.value))!;
    const zoom = Number(zoomText);
    expect(zoom).toBeLessThanOrEqual(5);
    // Where Mali's Hello is on the map: its letter is there.
    const world = (lat: number, lon: number) => {
      const size = 256 * 2 ** zoom;
      const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      return [((lon + 180) / 360) * size, (0.5 - y / (2 * Math.PI)) * size] as const;
    };
    const [cx, cy] = world(Number(latText), Number(lonText));
    const [bx, by] = world(16.2667, -0.05);
    const at = { x: Math.round(map.bounds.x + map.bounds.width / 2 + bx - cx), y: Math.round(map.bounds.y + map.bounds.height / 2 + by - cy) };
    expect(at.x).toBeGreaterThan(map.bounds.x);
    expect(at.x).toBeLessThan(map.bounds.x + map.bounds.width);
    // Its badge, drawn by QuickDraw over the map: a black disc in a white ring.
    const screen = platform.lastFrame()!;
    const pixel = (x: number, y: number) => screen[y * 640 + x];
    expect(pixel(at.x - 7, at.y)).toBe(1);
    expect(pixel(at.x - 10, at.y)).toBe(0);
    platform.click(at.x, at.y);
    await settle();

    expect(await node("maps-result-0"), "the list closed").toBeUndefined();
    expect(await node("maps-place"), "the place's info opened").toBeDefined();
    // Mali's Hello, by where it is.
    const texts = (await nodes()).filter((n) => n.role === "text").map((n) => (n as { text?: string }).text);
    expect(texts).toContain("16.26670, -0.05000");
  });

  it("keeps the search field narrow until it's clicked, then opens it out", async () => {
    const width = async () => (await node("maps-search"))!.bounds.width;
    const narrow = await width();
    const { x, y, width: w, height } = (await node("maps-search"))!.bounds;
    platform.click(x + (w >> 1), y + (height >> 1));
    // Partway: it opens over a few frames, not at once.
    const widths: number[] = [];
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(16);
      platform.tick();
      widths.push(await width());
    }
    await settle();
    const wide = await width();
    expect(narrow).toBeLessThan(60);
    expect(wide).toBeGreaterThan(narrow + 80);
    expect(widths.some((between) => between > narrow && between < wide)).toBe(true);
  });

  it("opens a searched place's info, and directions to it from there", async () => {
    await click("maps-search");
    await enter("San Francisco");
    expect(await node("maps-place"), "the place's info opened").toBeDefined();
    // In the search field's place: the field is gone until the info closes.
    expect(await node("maps-search")).toBeUndefined();
    expect(asked.find((u) => u.includes("nominatim"))).toContain("extratags=1");

    await click("maps-place-directions");
    expect(await node("maps-place")).toBeUndefined();
    expect((await node("maps-to"))?.value).toBe("San Francisco");

    await click("maps-from");
    await enter("Cupertino");

    // The start is looked for around the end.
    expect(asked.find((u) => u.includes("q=Cupertino"))).toContain("viewbox=-122.91930%2C38.27930%2C-121.91930%2C37.27930");
    const route = asked.find((u) => u.includes("routing.openstreetmap.de"));
    expect(route).toContain("/routed-car/route/v1/driving/-122.032200,37.323000;-122.419300,37.779300");
    expect(route).toContain("alternatives=2");
    // The ways there, fastest first.
    expect((await node("maps-route-0"))?.value).toBe("55 min");
    expect((await node("maps-route-1"))?.value).toBe("1 h 2 min");

    await click("maps-route-0-steps");
    expect((await node("maps-step-0"))?.value).toBe("Head east on Stevens Creek Boulevard");
    expect((await node("maps-step-1"))?.value).toBe("Take the ramp onto I 280");
    expect((await node("maps-step-2"))?.value).toBe("Arrive at San Francisco");

    await click("maps-step-1");
    expect(String((await node("map"))!.value)).toMatch(/^zoom 16, 37\.32/);

    // Closing the directions brings the place's info back.
    await click("maps-directions-close");
    expect(await node("maps-directions-panel")).toBeUndefined();
    expect(await node("maps-place")).toBeDefined();

    await click("maps-place-close");
    expect(await node("maps-place")).toBeUndefined();
    // Back, emptied, and narrow again.
    expect((await node("maps-search"))?.value).toBe("");
    expect((await node("maps-search"))!.bounds.width).toBeLessThan(60);
  });
});
