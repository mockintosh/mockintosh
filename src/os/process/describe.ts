/**
 * Reading an app the OS won't run on its own thread: a process loads the code
 * (an installed bundle, an OS build), reports its declaration, and is
 * terminated. The page never evaluates the app's code.
 */
import type { AppDeclaration } from "../appDeclaration";
import type { AppProcesses } from "../../platform/types";
import type { AppSource, ProcessToHost } from "./protocol";

/** How long a process may take to load an app and describe it. */
const DESCRIBE_TIMEOUT_MS = 15_000;

export function describeApp(processes: AppProcesses, appId: string, source: AppSource): Promise<AppDeclaration> {
  const port = processes.spawn(appId);
  return new Promise<AppDeclaration>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`"${appId}" took too long to load`)), DESCRIBE_TIMEOUT_MS);
    port.onmessage = (event) => {
      const msg = event.data as ProcessToHost;
      if (msg.t === "described") resolve(msg.declaration);
      else if (msg.t === "failed") reject(new Error(msg.error));
      else return;
      clearTimeout(timer);
    };
    port.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error(event.message ?? `"${appId}" couldn't be loaded`));
    };
    port.postMessage({ t: "describe", source, appId });
  }).finally(() => port.terminate());
}
