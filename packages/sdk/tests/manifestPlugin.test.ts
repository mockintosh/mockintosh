import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

it("mockintoshManifest() writes manifest.json with the app's declaration beside the template's bundle", async () => {
  // A copy inside the repo, so the template's imports resolve to the workspace packages.
  const dir = mkdtempSync(join(repo, ".tmp-template-"));
  try {
    cpSync(join(repo, "templates/app"), dir, { recursive: true });
    const { build } = await import("vite");
    await build({ root: dir, configFile: join(dir, "vite.config.ts"), logLevel: "silent" });
    const manifest = JSON.parse(readFileSync(join(dir, "dist/manifest.json"), "utf8"));
    const publisher = JSON.parse(readFileSync(join(dir, "mockintosh.json"), "utf8"));
    expect(manifest).toMatchObject({ ...publisher, entry: "./index.js" });
    expect(manifest.declaration).toMatchObject({ id: publisher.id, icon: publisher.icon, defaultSize: { width: 200, height: 120 } });
    expect(manifest.declaration.sprites[publisher.icon]).toMatchObject({ width: 32, height: 32 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
