import type {BuildResult} from "../../shared/buildContract";
import { decodeBrowserRequest, encodeMessage, type BrowserRequest, type BrowserReply } from "../../shared/companionProtocol";
import { RetainedResults } from "../../shared/retainedResults";
import type { BootedOS } from "../../os/boot";
import type { KernelSession } from "../../os/kernel";
import { Cancellation } from "../../os/kernel/cancellation";
/** Opt-in pairing UI belongs to the host, outside the framebuffer. Tokens remain in memory. */
export function installCompanionUI(os: BootedOS): () => void {
  const panel = document.createElement("details");
  panel.style.cssText = "position:fixed;bottom:8px;left:8px;background:white;color:black;padding:6px;font:12px monospace;z-index:10000";
  const summary = document.createElement("summary");
  summary.textContent = "Companion: disconnected";
  panel.append(summary);
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.placeholder = "Pairing token";
  tokenInput.setAttribute("aria-label", "Companion token");
  panel.append(tokenInput);
  const portInput = document.createElement("input");
  portInput.value = "4318";
  portInput.size = 5;
  portInput.setAttribute("aria-label", "Companion port");
  panel.append(portInput);
  const connect = document.createElement("button");
  connect.textContent = "Connect";
  panel.append(connect);
  const disconnect = document.createElement("button");
  disconnect.textContent = "Disconnect";
  panel.append(disconnect);
  document.body.append(panel);
  let socket: WebSocket | undefined;
  const callers = new Map<string, KernelSession>(),
    runs = new Map<string, Cancellation>();
  const outcomes = new RetainedResults<BrowserReply>();
  const pruneTimer = setInterval(() => outcomes.prune(), 30000);
  let disposed = false;
  let offBuilder: (() => void) | undefined;
  const builds = new Map<string, {resolve(result: BuildResult): void; reject(error: unknown): void}>();
  const clear = () => {
    offBuilder?.(); offBuilder = undefined;
    for (const pending of builds.values()) pending.reject(new Error("Companion builder disconnected"));
    builds.clear();
    for (const token of runs.values()) token.cancel();
    for (const caller of callers.values()) os.kernel.revokeSession(caller.id);
    callers.clear();
    runs.clear();
    summary.textContent = "Companion: disconnected";
  };
  connect.onclick = () => {
    if (socket && socket.readyState !== WebSocket.CLOSED) return;
    const port = Number(portInput.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !tokenInput.value) {
      summary.textContent = "Companion: enter token and valid port";
      return;
    }
    const connection = new WebSocket(`ws://127.0.0.1:${port}`);
    socket = connection;
    summary.textContent = "Companion: connecting";
    connection.onopen = () => {
      connection.send(encodeMessage({
        type: "hello",
        role: "browser",
        token: tokenInput.value,
        instance: os.kernel.instance,
        generation: os.kernel.generation,
        operations: os.kernel.describe()
      }));
      tokenInput.value = "";
    };
    connection.onmessage = async event => {
      let message: BrowserRequest;
      try {
        message = decodeBrowserRequest(event.data);
      } catch {
        connection.close();
        return;
      }
      if (message.type === "build_result") {
        const pending = builds.get(message.id);
        builds.delete(message.id);
        if (message.error) pending?.reject(Object.assign(new Error(message.error.message), message.error));
        else if (message.result) pending?.resolve(message.result);
        else pending?.reject(new Error("Builder returned no result"));
        return;
      }
      if (message.type === "ready") {
        offBuilder = os.services.projects?.connectBuilder({
          build(request, cancellation) {
            cancellation.check();
            return new Promise<BuildResult>((resolve, reject) => {
              const release = cancellation.subscribe(() => {
                builds.delete(request.requestId);
                if (connection.readyState === WebSocket.OPEN) connection.send(encodeMessage({type: "build_cancel", id: request.requestId}));
                reject(new Error("Build cancelled"));
              });
              builds.set(request.requestId, {resolve: result => { release(); resolve(result); }, reject: error => { release(); reject(error); }});
              connection.send(encodeMessage({type: "build_request", id: request.requestId, request}));
            });
          },
        });
        summary.textContent = `Companion: ${os.kernel.instance}:${os.kernel.generation}`;
        return;
      }
      if (message.type === "reconcile") {
        const outcome = outcomes.get(message.action);
        if (outcome) connection.send(encodeMessage(outcome));
        return;
      }
      if (message.type === "cancel") {
        runs.get(message.action)?.cancel();
        return;
      }
      if (message.type === "revoke") {
        const caller = callers.get(message.caller);
        if (caller) os.kernel.revokeSession(caller.id);
        callers.delete(message.caller);
        return;
      }
      if (message.type !== "invoke") return;
      const retained = outcomes.get(message.action);
      if (retained) {
        connection.send(encodeMessage(retained));
        return;
      }
      if (runs.has(message.action)) return;
      if (runs.size >= 128) {
        connection.send(encodeMessage({ type: "result", action: message.action, error: { code: "conflict", message: "Too many active requests" } }));
        return;
      }
      let caller = callers.get(message.caller);
      if (!caller) {
        caller = os.kernel.createSession();
        callers.set(message.caller, caller);
      }
      const token = new Cancellation();
      runs.set(message.action, token);
      let outcome: BrowserReply;
      try {
        const result = await os.kernel.invoke({
          ...caller,
          instance: message.instance,
          generation: message.generation
        }, message.operation, message.args, token, {
          stdout: bytes => { if (connection.readyState === WebSocket.OPEN) connection.send(encodeMessage({ type: "stream", action: message.action, channel: "stdout", bytes: Array.from(bytes) })); },
          stderr: bytes => { if (connection.readyState === WebSocket.OPEN) connection.send(encodeMessage({ type: "stream", action: message.action, channel: "stderr", bytes: Array.from(bytes) })); }
        });
        outcome = {
          type: "result",
          action: message.action,
          result
        };
      } catch (error) {
        outcome = {
          type: "result",
          action: message.action,
          error: {
            code: error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "operation-failed",
            message: error instanceof Error ? error.message : String(error)
          }
        };
      } finally {
        runs.delete(message.action);
      }
      if (!disposed) outcomes.set(message.action, outcome);
      if (socket?.readyState === WebSocket.OPEN) socket.send(encodeMessage(outcome));
    };
    connection.onclose = () => { if (socket === connection) clear(); };
    connection.onerror = () => {
      summary.textContent = "Companion: connection failed";
    };
  };
  disconnect.onclick = () => {
    socket?.close();
    clear();
  };
  return () => {
    disposed = true;
    clearInterval(pruneTimer);
    outcomes.clear();
    socket?.close();
    clear();
    panel.remove();
  };
}
