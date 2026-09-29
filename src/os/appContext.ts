/**
 * The SDK's `AppContext` as the shell provides it: everything an app can do
 * that does not need a window. `onOpen` receives one; `WindowContent`
 * extends one with the window a component is mounted in (`AppServices`).
 */

import type { AppContext, KernelClient, WindowSpec } from "@mockintosh/sdk";
import type { OSServices, IconScreenRect } from "./context";
import { createAppStorage } from "./appStorage";
import { getApp } from "./apps";
import { openersForFileType } from "./openers";
import { Cancellation } from "./kernel/cancellation";

export interface AppContextOptions {
  /**
   * Where the user opened the app from (its icon). The first window the app
   * opens zooms out of this rect; the animation belongs to that one window,
   * so the rect is consumed by the first `openWindow` call.
   */
  fromRect?: IconScreenRect;
  instanceId?: string;
}

function cancellationFromSignal(signal?: AbortSignal): Cancellation {
  const token = new Cancellation();
  if (!signal) return token;
  if (signal.aborted) token.cancel();
  else signal.addEventListener("abort", () => token.cancel());
  return token;
}

function kernelClientFor(os: OSServices, appId: string, instanceId?: string): KernelClient | undefined {
  const app = getApp(appId);
  const permissions = app?.permissions;
  if (!permissions?.length || !os.kernel) return undefined;
  const operations = permissions.includes("kernel:*")
    ? undefined
    : permissions.filter((p) => p.startsWith("kernel:")).map((p) => p.slice("kernel:".length));
  let session = instanceId ? os.instances?.kernelCaller(instanceId) : undefined;
  if (!session) {
    session = os.kernel.createSession({ operations });
    if (instanceId && os.instances) {
      os.instances.setKernelCaller(instanceId, session);
      os.instances.own(instanceId, () => os.kernel?.revokeSession(session.id));
    }
  }
  const kernel = os.kernel;
  return {
    invoke(name, args = {}, options) {
      return kernel.invoke(
        session,
        name,
        args,
        cancellationFromSignal(options?.signal),
        options?.stdout || options?.stderr ? { stdout: options.stdout, stderr: options.stderr } : undefined,
      );
    },
    describe: () => kernel.describe(session),
  };
}

export function createAppContext(
  os: OSServices,
  appId: string,
  options: AppContextOptions = {}
): AppContext {
  let pendingFromRect = options.fromRect;
  return {
    keepAlive: () => options.instanceId && os.instances ? os.instances.retain(options.instanceId) : () => {},
    quit: () => { if (options.instanceId) os.instances?.stop(options.instanceId); },
    onCleanup: cleanup => { if (options.instanceId) os.instances?.own(options.instanceId, cleanup); },
    getSprite: (name) => os.sprites.get(name),
    storage: createAppStorage(os.fs, appId),
    fs: os.fs,
    os: {
      openApp: (id, props) => os.openApp(id, props),
      openWindow: (id, props) => os.openApp(id, props),
      openersFor: (type) => openersForFileType(type),
      closeWindow: (id) => os.closeWindow(id),
      showDialog: (opts) => os.showDialog(opts),
      busy: (work) => os.busy(work),
    },
    openWindow<P extends Record<string, unknown>>(spec?: WindowSpec<P>): string {
      const fromRect = pendingFromRect;
      pendingFromRect = undefined;
      return os.openWindow(appId, spec, fromRect, options.instanceId);
    },
    env: { origin: os.env.origin, config: os.env.config ?? {} },
    crypto: os.crypto,
    browser: os.browser,
    capabilities: os.capabilities,
    fetch: os.fetch,
    print: os.printers,
    download: os.download,
    images: os.images,
    video: os.video,
    camera: os.camera,
    kernel: kernelClientFor(os, appId, options.instanceId),
    scheduler: {
      now: () => os.scheduler.now(),
      requestFrame(callback) {
        let settled = false;
        let disown = () => {};
        const stop = os.scheduler.requestFrame((timeMs) => {
          if (settled) return;
          settled = true;
          disown();
          callback(timeMs);
        });
        const cancel = () => {
          if (settled) return;
          settled = true;
          disown();
          stop();
        };
        if (options.instanceId && os.instances) disown = os.instances.own(options.instanceId, cancel);
        return cancel;
      },
    },
  };
}
