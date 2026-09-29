import {describe, expect, it} from "vitest";
import {AppInstances} from "../instances";

describe("app instance ownership", () => {
  it("keeps explicitly owned background work and releases all windows/resources on restart", () => {
    const closed: string[] = [], cleanup: string[] = [];
    const instances = new AppInstances(id => closed.push(id));
    const first = instances.create("app", "build-one");
    const release = instances.retain(first);
    instances.own(first, () => cleanup.push("timer"));
    instances.addWindow(first, "window-one");
    instances.removeWindow("window-one");
    expect(instances.list()).toHaveLength(1);
    release(); release();
    expect(instances.list()).toHaveLength(0);
    expect(cleanup).toEqual(["timer"]);
    const next = instances.create("app", "build-two");
    instances.addWindow(next, "a"); instances.addWindow(next, "b");
    instances.own(next, () => cleanup.push("subscription"));
    instances.stopApp("app");
    expect(closed).toEqual(["a", "b"]);
    expect(cleanup).toEqual(["timer", "subscription"]);
    expect(() => instances.addWindow(next, "late")).toThrow("ended");
  });

  it("forgets cleanup for a resource that ended before its instance", () => {
    const cleanup: string[] = [];
    const instances = new AppInstances(() => {});
    const id = instances.create("app");
    const disown = instances.own(id, () => cleanup.push("frame"));
    instances.own(id, () => cleanup.push("stream"));
    disown();
    instances.stop(id);
    expect(cleanup).toEqual(["stream"]);
  });
});
