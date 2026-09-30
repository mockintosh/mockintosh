/**
 * The bundled apps' declarations, as data the page reads instead of loading
 * their code (`src/os/appDeclaration.ts`). Regenerate after changing an app's
 * `defineApp`: `npm run apps:declarations`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { APP_MODULES } from "@/src/appModules";
import { declarationOf } from "@/src/os/appDeclaration";

const file = fileURLToPath(new URL("./declarations.generated.json", import.meta.url));

it("apps/declarations.generated.json matches the apps' own declarations", async () => {
  const declarations: Record<string, unknown> = {};
  for (const [id, load] of Object.entries(APP_MODULES)) {
    const app = (await load()).default;
    expect(app.id, `APP_MODULES["${id}"] loads the app "${app.id}"`).toBe(id);
    declarations[id] = declarationOf(app);
  }
  const text = JSON.stringify(declarations, null, 1) + "\n";
  if (process.env.UPDATE_DECLARATIONS) writeFileSync(file, text);
  expect(readFileSync(file, "utf8"), "Out of date: run npm run apps:declarations").toBe(text);
}, 120_000);
