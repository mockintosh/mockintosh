import type { ProcessPort } from "../../../os/process/protocol";
import type { AppProcesses } from "../../types";
import { APP_MODULES } from "../../../appModules";

/** App processes as module Workers, for the bundled apps in the module table. */
export function createWebAppProcesses(): AppProcesses | undefined {
  if (typeof Worker === "undefined") return undefined;
  const all = new URLSearchParams(location.search).get("processes") === "all";
  return {
    defaultRuntime: all ? "worker" : "main",
    canRun: (source) => source.kind !== "bundled" || Object.hasOwn(APP_MODULES, source.id),
    spawn: (appId) =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: appId }) as unknown as ProcessPort,
  };
}
