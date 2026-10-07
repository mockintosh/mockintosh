/**
 * A workspace for an agent's shell tool (fx's `workspace.exec`): each
 * command runs in bash on this Macintosh's disk, in the workspace's root,
 * bounded in time and output. Never the host's shell.
 */
import { BashSession, HOME } from "./session";
import type { KernelLike } from "./kernelFs";

export interface WorkspaceRequest {
  command: string;
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface BashWorkspace {
  root: string;
  permission: "allow" | "prompt";
  exec(request: WorkspaceRequest): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

const encoder = new TextEncoder();

function limit(text: string, bytes: number): string {
  const encoded = encoder.encode(text);
  if (encoded.length <= bytes) return text;
  return new TextDecoder().decode(encoded.subarray(0, bytes)) + "\n[output truncated]\n";
}

/**
 * `permission` "allow" (the default) tells the agent the workspace is its
 * sandbox, so it runs commands without asking or review; access is limited
 * here instead, to bash on this Macintosh. "prompt" has the agent apply its
 * own permission mode, which in fx's browser build can't run a command
 * (libfx-findings.md).
 */
export function bashWorkspace(kernel: KernelLike, options: { root?: string; permission?: "allow" | "prompt" } = {}): BashWorkspace {
  const root = options.root ?? HOME;
  return {
    root,
    permission: options.permission ?? "allow",
    async exec(request) {
      // A fresh shell per command, as an agent's tool expects: no state leaks between calls.
      const session = new BashSession({ kernel, cwd: request.cwd || root });
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), request.timeoutMs);
      const abort = () => timeout.abort();
      request.signal.addEventListener("abort", abort, { once: true });
      try {
        const result = await session.exec(request.command, { signal: timeout.signal });
        return {
          exitCode: result.exitCode,
          stdout: limit(result.stdout, request.outputLimitBytes),
          stderr: limit(result.stderr, request.outputLimitBytes),
        };
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
      }
    },
  };
}
