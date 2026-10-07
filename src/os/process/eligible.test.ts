import { describe, expect, it } from "vitest";
import type { AppProcesses } from "../../platform/types";
import type { SolidApp } from "../apps";
import { processBlocker } from "./eligible";

const processes: AppProcesses = { defaultRuntime: "main", canRun: (source) => source.kind !== "bundled" || source.id !== "unknown", spawn: () => { throw new Error("not in tests"); } };
const app = (overrides: Partial<SolidApp> = {}): SolidApp =>
  ({ id: "app", title: "App", icon: "x", defaultSize: { width: 10, height: 10 }, Component: () => null, runtime: "worker", ...overrides }) as SolidApp;

describe("processBlocker", () => {
  it("lets an app that asks for a worker and needs only what processes serve run in one", () => {
    expect(processBlocker(app({ requires: ["audio", "network"] }), processes)).toBeNull();
    // A process runs fx's engine itself.
    expect(processBlocker(app({ requires: ["agent-runtime"] }), processes)).toBeNull();
    // The sign-in sheet is the OS's; the process asks for it and waits.
    expect(processBlocker(app({ requires: ["network", "sign-in"], signIn: { hosts: ["github.com"] } }), processes)).toBeNull();
  });

  it("keeps everything else on the OS's thread, and says why", () => {
    expect(processBlocker(app({ runtime: undefined }), processes)).toMatch(/OS's thread/);
    expect(processBlocker(app({ runtime: undefined }), { ...processes, defaultRuntime: "worker" })).toBeNull();
    expect(processBlocker(app({ runtime: "main" }), { ...processes, defaultRuntime: "worker" })).toMatch(/OS's thread/);
    expect(processBlocker(app(), undefined)).toMatch(/no app processes/);
    expect(processBlocker(app({ id: "unknown" }), processes)).toMatch(/can't load/);
    expect(processBlocker(app({ requires: ["browser"] }), processes)).toBe("browser isn't served to processes yet");
  });
});
