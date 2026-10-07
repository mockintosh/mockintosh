import {describe, expect, it} from "vitest";
import {InMemoryBackend} from "@mockintosh/fs";
import {withHeadless} from "../companion/headless";
import {counterSource, jobSchema, sortArtifactsNewestFirst} from "../../src/os/projects";
import {parse} from "../../src/shared/schema";

describe("complete M2 project workflow", () => {
  it("builds, launches, restarts, restores, and reopens a persisted Counter", async () => {
    const storage = new InMemoryBackend();
    const path = "/disk/Applications/Counter.app";
    let selected: string;
    await withHeadless(async os => {
      const caller = os.kernel.createSession();
      const invoke = (name: string, args = {}) => os.kernel.invoke(caller, name, args);
      const build = async () => {
        let job = parse(jobSchema, await invoke("build_submit", {path}));
        while (job.state === "building") { await new Promise(resolve => setTimeout(resolve, 10)); job = parse(jobSchema, await invoke("build_status", {id: job.id})); }
        return job;
      };
      const count = async () => (await invoke("inspect") as {name?: string; text: string}[]).find(node => node.name === "counter-value")?.text;
      await invoke("project_create", {path, id: "counter", title: "Counter"});
      const first = await build();
      expect(first.state, JSON.stringify(first.diagnostics)).toBe("succeeded");
      await invoke("app_install", {path, build: first.id});
      await invoke("click", {name: "counter-increment"});
      expect(await count()).toBe("1");
      await invoke("app_restart", {app: "counter"});
      expect(await count()).toBe("0");
      await invoke("write", {path: path + "/src/index.tsx", body: counterSource("counter", "Counter").replace("count() + 1", "count() + 5")});
      const second = await build();
      expect(second.state).toBe("succeeded");
      await invoke("app_install", {path, build: second.id});
      await invoke("click", {name: "counter-increment"});
      expect(await count()).toBe("5");
      await invoke("app_restore", {app: "counter"});
      await invoke("click", {name: "counter-increment"});
      expect(await count()).toBe("1");
      selected = first.id;
      expect(os.services.instances!.list().filter(i => i.app === "counter")).toHaveLength(1);
      const desktop = os.services.fs.locate("desktop")!;
      expect(os.services.fs.children(desktop.id).filter(node => os.services.fs.attributes(node.id).projectApp === "counter")).toHaveLength(1);
    }, storage);
    await withHeadless(async os => {
      expect(os.services.projects!.selectedBuild("counter")).toBe(selected);
      const caller = os.kernel.createSession();
      await os.kernel.invoke(caller, "open", {app: "counter"});
      await os.kernel.invoke(caller, "click", {name: "counter-increment"});
      expect((await os.kernel.invoke(caller, "inspect", {}) as {name?: string; text: string}[]).find(n => n.name === "counter-value")?.text).toBe("1");
      await os.kernel.invoke(caller, "write", {path: `${path}/dist/${selected}/index.js`, body: "edited artifact"});
    }, storage);
    await withHeadless(async os => {
      expect(os.services.projects!.installed().find(app => app.app === "counter")?.error).toContain("edited");
      const caller = os.kernel.createSession();
      await os.kernel.invoke(caller, "app_restore", {app: "counter"});
      await os.kernel.invoke(caller, "click", {name: "counter-increment"});
      expect((await os.kernel.invoke(caller, "inspect", {}) as {name?: string; text: string}[]).find(n => n.name === "counter-value")?.text).toBe("5");
    }, storage);
  }, 90_000);

  it("preserves the working build on compile errors, stale sources, and initialization failure", async () => {
    await withHeadless(async os => {
      const path = "/disk/Applications/Recovery.app";
      const caller = os.kernel.createSession();
      const invoke = (name: string, args = {}) => os.kernel.invoke(caller, name, args);
      const source = counterSource("recovery", "Recovery");
      const write = (body: string) => invoke("write", {path: path + "/src/index.tsx", body});
      const build = async () => {
        let job = parse(jobSchema, await invoke("build_submit", {path}));
        while (job.state === "building") { await new Promise(resolve => setTimeout(resolve, 10)); job = parse(jobSchema, await invoke("build_status", {id: job.id})); }
        return job;
      };
      await invoke("project_create", {path, id: "recovery", title: "Recovery"});
      const good = await build();
      await invoke("app_install", {path, build: good.id});
      await write(source + '\nconst bad: number = "wrong";');
      expect((await build()).state).toBe("failed");
      expect(os.services.projects!.selectedBuild("recovery")).toBe(good.id);
      await write(source);
      const stale = await build();
      await write(source + "\n// newer source\n");
      await expect(invoke("app_install", {path, build: stale.id})).rejects.toMatchObject({code: "conflict"});
      await write(source.replace("function Counter() {", 'function Counter() { throw new Error("initialization failed");'));
      const broken = await build();
      expect(broken.state, JSON.stringify(broken.diagnostics)).toBe("succeeded");
      await expect(invoke("app_install", {path, build: broken.id})).rejects.toThrow("initialization failed");
      expect(os.services.projects!.selectedBuild("recovery")).toBe(good.id);
      await invoke("click", {name: "counter-increment"});
    });
  }, 90_000);

  it("orders artifacts by creation time, then by trailing sequence, never lexically", () => {
    const id = (seq: number) => `build-os-abc-1-${seq}`;
    expect(sortArtifactsNewestFirst([
      { id: id(9), createdAt: 100 },
      { id: id(12), createdAt: 200 },
      { id: id(10), createdAt: 150 },
    ]).map(a => a.id)).toEqual([id(12), id(10), id(9)]);
    // Same creation time (coarse clocks): "-12" beats "-9" even though "-9" sorts later as a string.
    expect(sortArtifactsNewestFirst([
      { id: id(9), createdAt: 100 },
      { id: id(12), createdAt: 100 },
    ]).map(a => a.id)).toEqual([id(12), id(9)]);
    // A newer boot with a lower sequence still wins on time.
    expect(sortArtifactsNewestFirst([
      { id: "build-os-old-1-40", createdAt: 100 },
      { id: "build-os-new-1-1", createdAt: 500 },
    ])[0].id).toBe("build-os-new-1-1");
  });

  it("installs the latest build when build is omitted and names the exact id on a miss", async () => {
    await withHeadless(async os => {
      const caller = os.kernel.createSession();
      const invoke = (name: string, args = {}) => os.kernel.invoke(caller, name, args);
      const path = "/disk/Applications/Latest.app";
      await invoke("project_create", {path, id: "latest_app", title: "Latest"});
      let job = parse(jobSchema, await invoke("build_submit", {path}));
      while (job.state === "building") {
        await new Promise(resolve => setTimeout(resolve, 10));
        job = parse(jobSchema, await invoke("build_status", {id: job.id}));
      }
      expect(job.state).toBe("succeeded");
      const truncated = job.id.replace(/^build-/, "");
      await expect(invoke("app_install", {path, build: truncated})).rejects.toMatchObject({
        code: "missing-resource",
        message: expect.stringContaining(job.id),
      });
      await invoke("app_install", {path});
      expect(os.services.projects!.selectedBuild("latest_app")).toBe(job.id);
    });
  }, 90_000);
});
