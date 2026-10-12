/**
 * Which apps run in a process. An app asks with `runtime: "worker"`; it gets a
 * process only when the platform has them, can load its code, and a process
 * can give it everything it declares. Anything else runs on the OS's thread,
 * as every app did before (docs/worker-apps-plan.md, step 5 closes the gaps).
 */
import type { Capability } from "@mockintosh/sdk";
import type { AppProcesses } from "../../platform/types";
import type { SolidApp } from "../apps";
import { appSource } from "./sources";

/** Capabilities a process serves today. */
const SERVED: ReadonlySet<Capability> = new Set<Capability>(["audio", "microphone", "printer", "download", "network", "clipboard", "fonts", "images", "video", "camera", "gpu", "agent-runtime", "sign-in", "music-kit"]);

/** Why `app` can't run in a process, or `null` when it can. */
export function processBlocker(app: SolidApp, processes: AppProcesses | undefined): string | null {
  if (!processes) return "this Macintosh has no app processes";
  if ((app.runtime ?? processes.defaultRuntime) !== "worker") return "the app runs on the OS's thread";
  if (!processes.canRun(appSource(app.id))) return "a process can't load this app's code";
  const missing = (app.requires ?? []).filter((c) => !SERVED.has(c));
  if (missing.length) return `${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} served to processes yet`;
  return null;
}
