import { describe, expect, it } from "vitest";
import "@/src/systemApps";
import { bundledApps } from "./bundledApps";
import { validateModule } from "./installedApps";

describe("bundled app listings", () => {
  it("matches each app's defineApp export", async () => {
    const listings = bundledApps();
    expect(listings.map((listing) => listing.id)).toEqual([
      "dither",
      "trace",
      "chatgippity",
      "fx",
      "spotify",
      "macpaint",
      "canvas",
      "surface",
      "synth",
      "chord",
      "op1",
      "tp7",
    ]);
    const apps = await Promise.all(
      listings.map(async (listing) => validateModule(listing.id, await listing.load()).default),
    );
    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i]!;
      const app = apps[i]!;
      expect(app.id).toBe(listing.id);
      expect(app.title).toBe(listing.title);
      expect(app.icon).toBe(listing.icon);
      expect(app.requires ?? []).toEqual(listing.requires ?? []);
    }
  });
});
