/** Companion-free browser integration: real Web Workers, UI input, and OPFS.
 * npm run test:browser-build (install Chromium with npx playwright install chromium).
 */
import {strict as assert} from "node:assert";
import {createServer, preview} from "vite";
import {chromium} from "playwright";
import {readFile, readdir} from "node:fs/promises";
import type {BuildResult} from "../../src/shared/buildContract";
import {counterSource} from "../../src/os/projects";

const server = await createServer({server: {port: 0, hmr: false, ws: false}, plugins: [{
  name: "browser-build-test-harness",
  configureServer(server) {
    server.middlewares.use("/__build_test", async (_req, res, next) => {
      try {
        const html = (await readFile("index.html", "utf8")).replace('<script type="module" src="/src/solidMain.ts"></script>', `<script type="module">
          import "/src/systemApps.ts";
          import {createWebPlatform} from "/src/platform/web/index.ts";
          import {bootOS} from "/src/os/boot.ts";
          const os = await bootOS(createWebPlatform({root: document.getElementById("root"), width: 512, height: 342}));
          const caller = os.kernel.createSession();
          window.invoke = (name, args = {}) => os.kernel.invoke(caller, name, args);
        </script>`);
        res.setHeader("Content-Type", "text/html"); res.end(await server.transformIndexHtml("/__build_test", html));
      } catch (error) { next(error); }
    });
  },
}]});
await server.listen();
const browser = await chromium.launch({headless: true});
const page = await browser.newPage();
const url = server.resolvedUrls!.local[0] + "__build_test";
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
// This harness is isolated from the user's disk and never installs the bridge.
async function invoke(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return page.evaluate(({name, args}) => (window as any).invoke(name, args), {name, args});
}
async function ready() {
  await page.waitForFunction(() => typeof (window as any).invoke === "function");
  await invoke("render");
}
async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Browser build did not finish");
}
const path = "/disk/Applications/BrowserCounter.app", id = "browser_counter";
try {
  await page.goto(url); await ready();
  assert.equal(await page.locator("[aria-label='Companion token']").count(), 0);
  await invoke("project_create", {path, id, title: "Browser Counter"});
  await invoke("source_open", {path});
  await waitFor(async () => (await invoke("inspect")).some((n: any) => n.name === "source-code" && n.value));
  await invoke("click", {name: "source-build"});
  await waitFor(async () => (await invoke("windows")).some((w: any) => w.app === id));
  await invoke("click", {name: "counter-increment"});
  assert.equal((await invoke("inspect")).find((n: any) => n.name === "counter-value").text, "1");
  const editor = (await invoke("windows")).find((w: any) => w.app === "source_editor");
  await invoke("activate", {window: editor.id});
  await invoke("click", {name: "source-code"});
  await invoke("key", {key: "a", meta: true});
  await invoke("type", {name: "source-code", text: counterSource(id, "Browser Counter").replace("count() + 1", "count() + 5")});
  await invoke("click", {name: "source-build"});
  await waitFor(async () => (await invoke("windows")).some((w: any) => w.app === id && w.active));
  await invoke("click", {name: "counter-increment"});
  assert.equal((await invoke("inspect")).find((n: any) => n.name === "counter-value").text, "5");
  await page.screenshot({path: "/tmp/mockintosh-browser-build.png"});
  await invoke("app_restore", {app: id});
  await invoke("click", {name: "counter-increment"});
  assert.equal((await invoke("inspect")).find((n: any) => n.name === "counter-value").text, "1");
  await page.reload(); await ready();
  await invoke("open", {app: id});
  await invoke("click", {name: "counter-increment"});
  assert.equal((await invoke("inspect")).find((n: any) => n.name === "counter-value").text, "1");

  const useAppPath = "/disk/Applications/UseAppProbe.app", useAppId = "useapp_probe";
  const useAppSource = `import { defineApp, useApp } from "@mockintosh/sdk";
function Probe() {
  const title = useApp().window ? "ok" : "missing";
  return <text semantic={{name: "useapp-probe"}}>{title}</text>;
}
export default defineApp({ id: ${JSON.stringify(useAppId)}, title: "UseApp Probe", icon: "icon/computer",
  defaultSize: {width: 180, height: 80}, Component: Probe });
`;
  await invoke("project_create", {path: useAppPath, id: useAppId, title: "UseApp Probe", template: "blank"});
  await invoke("write", {path: `${useAppPath}/src/index.tsx`, body: useAppSource});
  const job = await invoke("build_submit", {path: useAppPath});
  await waitFor(async () => ["succeeded", "failed", "cancelled"].includes((await invoke("build_status", {id: job.id})).state));
  const build = await invoke("build_status", {id: job.id});
  assert.equal(build.state, "succeeded", JSON.stringify(build.diagnostics));
  await invoke("app_install", {path: useAppPath});
  await waitFor(async () => (await invoke("inspect")).some((n: any) => n.name === "useapp-probe"));
  assert.equal((await invoke("inspect")).find((n: any) => n.name === "useapp-probe").text, "ok");

  // Exercise diagnostics, relative bundling, and hard cancellation at the same
  // provider seam the project service uses, with actual module workers.
  const checks = await page.evaluate<{badType: BuildResult; badSDK: BuildResult; relative: BuildResult; forbidden: BuildResult; cancelled: boolean}>(`(async () => {
    const {browserBuilder} = await import(/* @vite-ignore */ "/src/platform/web/builder/index.ts");
    const make = (text, extra = []) => ({requestId: "check", sourceRevision: "1", entry: "src/index.tsx", sdkVersion: "3", files: [{path: "src/index.tsx", text}, ...extra]});
    const cancellation = {check() {}, subscribe() { return () => {}; }};
    const badType = await browserBuilder.build(make('const n: number = "wrong"; export default n'), cancellation);
    const badSDK = await browserBuilder.build(make('import {Button} from "@mockintosh/ui"; export default <Button unknown={true}/>'), cancellation);
    const relative = await browserBuilder.build(make('import {n} from "./helper"; export default n', [{path: "src/helper.ts", text: "export const n = 7"}]), cancellation);
    const forbidden = await browserBuilder.build(make('import "node:fs"'), cancellation);
    let cancel = () => {};
    const pending = browserBuilder.build(make("export default 1"), {check() {}, subscribe(fn) {cancel = fn; return () => {}; }});
    cancel();
    let cancelled = false; try { await pending; } catch { cancelled = true; }
    return {badType, badSDK, relative, forbidden, cancelled};
  })()`);
  assert.match(checks.badType.diagnostics[0].message, /not assignable/);
  assert.match(checks.badSDK.diagnostics[0].message, /unknown/);
  assert.deepEqual(checks.relative.diagnostics, []);
  assert.match(checks.relative.code!, /7/);
  assert.match(checks.forbidden.diagnostics[0].message, /Unsupported import/);
  assert(checks.cancelled);
  // Exercise the emitted worker and its WASM/type assets from an ordinary
  // production page, with no development imports or test globals.
  const production = await preview({preview: {port: 0}});
  try {
    const productionPage = await browser.newPage();
    await productionPage.goto(production.resolvedUrls!.local[0]);
    const workerFile = (await readdir("dist/assets")).find(file => /^worker-.*\.js$/.test(file));
    assert(workerFile, "Run npm run build before the browser test");
    const built = await productionPage.evaluate(async ({workerFile, source}) => {
      const result: any = await new Promise((resolve, reject) => {
        const worker = new Worker(`/assets/${workerFile}`, {type: "module"});
        const timeout = setTimeout(() => {worker.terminate(); reject(new Error("Production worker timed out"));}, 60000);
        worker.onmessage = event => {clearTimeout(timeout); worker.terminate(); resolve(event.data);};
        worker.onerror = event => {clearTimeout(timeout); worker.terminate(); reject(new Error(event.message));};
        worker.postMessage({requestId: "production", sourceRevision: "1", entry: "src/index.tsx", sdkVersion: "3", files: [{path: "src/index.tsx", text: source}]});
      });
      if (result.diagnostics.length) return result;
      const url = URL.createObjectURL(new Blob([result.code], {type: "text/javascript"}));
      try { return {...result, appId: (await import(/* @vite-ignore */ url)).default.id}; }
      finally { URL.revokeObjectURL(url); }
    }, {workerFile, source: counterSource("production_counter", "Counter")});
    assert.deepEqual(built.diagnostics, []);
    assert.equal(built.appId, "production_counter");
    await productionPage.close();
  } finally { await new Promise<void>((resolve, reject) => production.httpServer.close(error => error ? reject(error) : resolve())); }
  assert.deepEqual(errors, []);
  console.log("PASS: no companion; Source Editor build, click, edit, rebuild, restore, reload; useApp artifact context; SDK diagnostics, relative modules, cancellation, and production worker/artifact loading.");
} finally { await browser.close(); await server.close(); }
