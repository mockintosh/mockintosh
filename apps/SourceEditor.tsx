import { createEffect, createSignal, onCleanup, onSettled, action } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import {Button, TextInput, TextEditor} from "@mockintosh/ui";
import {defineApp, jobSchema, parse, resource, useApp} from "@mockintosh/sdk";

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Operation cancelled"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function SourceEditor(props: {path?: string}): JSX.Element {
  const app = useApp(), kernel = app.kernel!;
  createEffect(() => true, () => {
    app.setMenus([
      { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => {
        void (async () => {
          if (text() !== saved() && await app.os.showDialog({ message: "Discard unsaved changes and quit?", buttons: ["Cancel", "Discard"] }) !== "Discard") return;
          app.quit();
        })();
      } }] },
    ]);
  });
  const [path, setPath] = createSignal(props.path ?? "/disk/Applications/Counter.app");
  const [text, setText] = createSignal(""), [saved, setSaved] = createSignal("");
  const [status, setStatus] = createSignal("Load a project or create Counter."), [busy, setBusy] = createSignal(false), [line, setLine] = createSignal(1);
  let revision: number | undefined, loadedPath: string | undefined, closed = false;
  let controller = new AbortController();
  const invoke = (name: string, args: Record<string, unknown>) => kernel.invoke(name, args, { signal: controller.signal });
  onCleanup(() => { closed = true; controller.abort(); });
  async function run(work: () => Promise<void>) {
    if (busy()) return;
    setBusy(true); controller.abort(); controller = new AbortController();
    try { await work(); } catch (error) { if (!closed) setStatus(error instanceof Error ? error.message : String(error)); }
    finally { if (!closed) setBusy(false); }
  }
  async function load() {
    if (text() !== saved() && await app.os.showDialog({message: "Discard unsaved changes and reload?", buttons: ["Cancel", "Discard"]}) !== "Discard") return;
    const file = path() + "/src/index.tsx";
    const before = parse(resource, await invoke("stat", {path: file}));
    const body = await invoke("read", {path: file}) as string;
    const after = parse(resource, await invoke("stat", {path: file}));
    if (before.revision !== after.revision) throw new Error("Source changed while loading; reload again");
    if (closed) return;
    revision = after.revision; loadedPath = file; setText(body); setSaved(body); setLine(1); setStatus("Loaded");
  }
  const save = action(function* () {
    if (revision === undefined || loadedPath !== path() + "/src/index.tsx") throw new Error("Load the project before saving");
    const body = text();
    const file = parse(resource, yield invoke("write", {path: loadedPath, body, expectedRevision: revision}));
    revision = file.revision; if (!closed) { setSaved(body); setStatus("Saved"); }
  });
  async function build() {
    if (text() !== saved()) await save();
    let job = parse(jobSchema, await invoke("build_submit", {path: path()}));
    setStatus("Building…");
    while (job.state === "building") { await delay(100, controller.signal); job = parse(jobSchema, await invoke("build_status", {id: job.id})); }
    if (job.state !== "succeeded") {
      const diagnostic = job.diagnostics[0];
      if (diagnostic?.line) setLine(diagnostic.line);
      throw new Error(diagnostic ? `${diagnostic.file ?? "Build"}:${diagnostic.line ?? ""} ${diagnostic.message}` : job.state);
    }
    await invoke("app_install", {path: path(), build: job.id});
    if (!closed) setStatus("Build installed and running");
  }
  onSettled(() => { if (props.path) void run(load); });
  return <box width={app.window.width()} height={app.window.height()} padding={6} gap={5}>
    <TextInput name="source-project-path" value={path()} onChange={setPath} width={app.window.width() - 12} disabled={busy()} />
    <box flexDirection="row" gap={4}>
      <Button name="source-create" label="New Counter" disabled={busy()} onClick={() => void run(async () => { await invoke("project_create", {path: path(), id: "counter", title: "Counter"}); await load(); })} />
      <Button name="source-load" label="Load" disabled={busy()} onClick={() => void run(load)} />
      <Button name="source-save" label="Save" disabled={busy() || text() === saved()} onClick={() => void run(save)} />
      <Button name="source-build" label="Build & Run" disabled={busy() || revision === undefined} onClick={() => void run(build)} />
      <Button name="source-restore" label="Restore" disabled={busy()} onClick={() => void run(async () => {
        const manifest = JSON.parse(await invoke("read", {path: path() + "/mockintosh.json"}) as string);
        await invoke("app_restore", {app: manifest.id}); setStatus("Previous build restored");
      })} />
    </box>
    <TextEditor name="source-code" font="mono" wrap={false} value={text()} onChange={setText} disabled={busy()} line={line()} width={app.window.width() - 12} height={Math.max(40, app.window.height() - 100)} />
    <text wrap>{`${text() !== saved() ? "Modified. " : ""}${status()}`}</text>
  </box>;
}
export default defineApp({
  id: "source_editor",
  title: "Source Editor",
  icon: "icon/computer",
  smallIcon: "icon/computer-16x16",
  defaultSize: {width: 480, height: 260},
  singleInstance: false,
  permissions: [
    "kernel:stat", "kernel:read", "kernel:write",
    "kernel:build_submit", "kernel:build_status",
    "kernel:app_install", "kernel:project_create", "kernel:app_restore",
  ],
  Component: SourceEditor,
});
