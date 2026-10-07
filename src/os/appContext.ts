/**
 * The SDK's `AppContext` as the shell provides it: everything an app can do
 * that does not need a window. `onOpen` receives one; `WindowContent`
 * extends one with the window a component is mounted in (`AppServices`).
 */

import type {
  AgentRuntime,
  AppContext,
  AudioMonitor,
  AudioPortOptions,
  AudioPortStream,
  AudioService,
  KernelClient,
  MicrophonePortInput,
  MicrophonePortOptions,
  MicrophoneService,
  SignInService,
  WindowSpec,
} from "@mockintosh/sdk";
import { listFontFamilies, onFontsChanged, registerFont } from "@mockintosh/ui";
import type { OSServices, IconScreenRect } from "./context";
import { createAppSignIn, type SystemSignIn } from "./signIn";
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
    const created = os.kernel.createSession({ operations });
    session = created;
    if (instanceId && os.instances) {
      os.instances.setKernelCaller(instanceId, created);
      os.instances.own(instanceId, () => os.kernel?.revokeSession(created.id));
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

/** The speaker as one launch sees it: its streams and monitors close when the launch ends. */
function instanceAudio(os: OSServices, audio: AudioService, instanceId?: string): AudioService {
  const monitor = audio.monitor?.bind(audio);
  const openPort = audio.openPort?.bind(audio);
  return {
    ...(openPort && {
      async openPort(portOptions: AudioPortOptions): Promise<AudioPortStream> {
        const stream = await openPort(portOptions);
        if (!instanceId || !os.instances) return stream;
        const disown = os.instances.own(instanceId, () => stream.close());
        stream.onStateChange((state) => {
          if (state === "closed") disown();
        });
        return stream;
      },
    }),
    async open(streamOptions) {
      const stream = await audio.open(streamOptions);
      if (!instanceId || !os.instances) return stream;
      const disown = os.instances.own(instanceId, () => stream.close());
      stream.onStateChange((state) => {
        if (state === "closed") disown();
      });
      return stream;
    },
    ...(monitor && {
      async monitor(): Promise<AudioMonitor> {
        const tap = await monitor();
        if (!instanceId || !os.instances) return tap;
        const disown = os.instances.own(instanceId, () => tap.close());
        return {
          sampleRate: tap.sampleRate,
          capacity: tap.capacity,
          read: (left, right) => tap.read(left, right),
          close() {
            disown();
            tap.close();
          },
        };
      },
    }),
  };
}

/** The microphone as one launch sees it: its inputs close when the launch ends, so no app keeps listening after it quits. */
function instanceMicrophone(os: OSServices, microphone: MicrophoneService, instanceId?: string): MicrophoneService {
  const openPort = microphone.openPort?.bind(microphone);
  return {
    ...(openPort && {
      async openPort(portOptions: MicrophonePortOptions): Promise<MicrophonePortInput> {
        const input = await openPort(portOptions);
        if (!instanceId || !os.instances) return input;
        const disown = os.instances.own(instanceId, () => input.close());
        input.onStateChange((state) => {
          if (state === "closed") disown();
        });
        return input;
      },
    }),
    async open(inputOptions) {
      const input = await microphone.open(inputOptions);
      if (!instanceId || !os.instances) return input;
      const disown = os.instances.own(instanceId, () => input.close());
      input.onStateChange((state) => {
        if (state === "closed") disown();
      });
      return input;
    },
  };
}

/** Agents as one launch sees them: its sessions close when the launch ends, cancelling any turn in flight. */
function instanceAgentRuntime(os: OSServices, runtime: AgentRuntime, instanceId?: string): AgentRuntime {
  return {
    engine: runtime.engine,
    async createSession(sessionOptions) {
      const session = await runtime.createSession(sessionOptions);
      if (!instanceId || !os.instances) return session;
      const disown = os.instances.own(instanceId, () => void session.close());
      return {
        prompt: (text, promptOptions) => session.prompt(text, promptOptions),
        checkpoint: () => session.checkpoint(),
        close() {
          disown();
          return session.close();
        },
      };
    },
    ...(runtime.createTerminal
      ? {
          async createTerminal(terminalOptions) {
            const terminal = await runtime.createTerminal!(terminalOptions);
            if (!instanceId || !os.instances) return terminal;
            // The terminal ends with the launch, like a session.
            const disown = os.instances.own(instanceId, () => terminal.abort());
            void terminal.exited.finally(disown);
            return terminal;
          },
        }
      : {}),
  };
}

/** Sign-in as one app sees it: limited to its declared hosts, its sheet closing when the launch ends. */
function appSignIn(os: OSServices, signIn: SystemSignIn, appId: string, instanceId?: string): SignInService {
  const app = getApp(appId);
  return createAppSignIn({
    redirectUri: signIn.redirectUri,
    appTitle: app?.title ?? appId,
    hosts: app?.signIn?.hosts ?? [],
    showSheet: (request) => signIn.show(request, instanceId),
  });
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
    signIn: os.signIn && appSignIn(os, os.signIn, appId, options.instanceId),
    capabilities: os.capabilities,
    fetch: os.fetch,
    print: os.printers,
    download: os.download,
    images: os.images,
    video: os.video,
    camera: os.camera,
    gpu: os.gpu,
    audio: os.audio && instanceAudio(os, os.audio, options.instanceId),
    microphone: os.microphone && instanceMicrophone(os, os.microphone, options.instanceId),
    agentRuntime: os.agentRuntime && instanceAgentRuntime(os, os.agentRuntime, options.instanceId),
    fontRaster: os.fonts,
    fonts: {
      register(name, data, size) {
        registerFont(name, data, size);
      },
      list: () => listFontFamilies(),
      onChange: onFontsChanged,
      install: os.fontFolder && ((suitcase) => os.fontFolder!.install(suitcase)),
    },
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
