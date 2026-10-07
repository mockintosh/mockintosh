/**
 * `fx` in a Terminal: fx's own terminal interface, run like any program on
 * the tty, with its shell tool working in bash from the current directory.
 * Quitting fx drops back to the prompt. The key comes from the environment
 * (`export AI_GATEWAY_API_KEY=…`, kept in ~/.bashrc), as the fx CLI's does.
 */
import type { AgentRuntime, AgentStorage } from "@mockintosh/sdk";
import type { TtyProgram } from "./runner";
import type { KernelLike } from "./kernelFs";
import { bashWorkspace } from "./workspace";
import { shellAgentInstructions } from "./brief";
import type { Termios } from "../pty";
import type { TerminalSize } from "../screen";

export interface FxProgramOptions {
  /** The host's agent runtime, when it has one (it needs JSPI). */
  runtime: AgentRuntime | undefined;
  kernel: KernelLike;
  /** Where fx keeps its sessions, settings and history. */
  storage?: AgentStorage;
  openUrl?(url: string): Promise<boolean>;
  clipboard?: { writeText(text: string): Promise<void> };
}

/** fx draws everything itself: no echo, no line editing, no signals, no newline translation. */
const FX_MODE: Termios = { canonical: false, echo: false, signals: false, crToNl: false, nlToCrNl: false };

export const KEY_VARIABLE = "AI_GATEWAY_API_KEY";

/** fx's own variables (FX_MODEL, FX_PERMISSION_MODE, …) from the shell's environment. */
export function fxEnvironment(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (name.startsWith("FX_")) out[name] = value;
  return out;
}

export function fxProgram(options: FxProgramOptions): TtyProgram {
  return {
    name: "fx",
    description: "the fx coding agent",
    async attached({ argv, cwd, env, job, fs }) {
      const say = (text: string) => job.write(text);
      if (!options.runtime?.createTerminal) {
        say("fx: this Macintosh can't run fx (its engine needs WebAssembly JSPI, in Chrome or Edge).\n");
        return 1;
      }
      const apiKey = env[KEY_VARIABLE];
      if (!apiKey) {
        say(`fx: set ${KEY_VARIABLE} to your Vercel AI Gateway key first:\n\n  export ${KEY_VARIABLE}=vck_…\n\nPut that line in ~/.bashrc to keep it for every Terminal window.\n`);
        return 1;
      }
      const fxEnv = fxEnvironment(env);
      const tty = job.tty;
      const saved = tty.getAttr();
      tty.setAttr(FX_MODE);
      const dataHandlers = new Set<(data: string) => void>();
      const resizeHandlers = new Set<(size: TerminalSize) => void>();
      const offSignal = job.onSignal((signal) => {
        if (signal === "SIGWINCH") for (const handler of resizeHandlers) handler(tty.size);
      });
      // Keys go to fx as they arrive, until it exits.
      const reading = new AbortController();
      void (async () => {
        while (!reading.signal.aborted) {
          const data = await tty.read(reading.signal);
          if (data === null) return;
          for (const handler of dataHandlers) handler(data);
        }
      })();
      try {
        const fx = await options.runtime.createTerminal({
          apiKey,
          args: argv.slice(1),
          env: fxEnv,
          instructions: await shellAgentInstructions(fs, cwd),
          screen: {
            write: (data) => tty.write(data),
            onData: (handler) => {
              dataHandlers.add(handler);
              return () => dataHandlers.delete(handler);
            },
            get cols() {
              return tty.size.cols;
            },
            get rows() {
              return tty.size.rows;
            },
            onResize: (handler) => {
              resizeHandlers.add(handler);
              return () => resizeHandlers.delete(handler);
            },
          },
          // The workspace is the sandbox (bash on this Macintosh, never the host), so fx
          // runs its commands without review; see libfx-findings.md.
          workspace: bashWorkspace(options.kernel, { root: cwd }),
          ...(options.storage ? { storage: options.storage } : {}),
          ...(options.openUrl ? { openUrl: options.openUrl } : {}),
          ...(options.clipboard ? { clipboard: options.clipboard } : {}),
        });
        // `kill` (or closing the window) stops fx; ⌃C is fx's own key.
        const onAbort = () => fx.abort();
        job.signal.addEventListener("abort", onAbort, { once: true });
        try {
          return await fx.exited;
        } finally {
          job.signal.removeEventListener("abort", onAbort);
        }
      } catch (error) {
        say(`\nfx: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      } finally {
        reading.abort();
        offSignal();
        tty.setAttr(saved);
        // fx may leave the cursor mid-line or hidden; give the prompt a clean line.
        tty.write("\x1b[?25h\r\n");
      }
    },
  };
}
