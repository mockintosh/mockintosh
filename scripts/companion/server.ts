import {localBuilder} from "../builder/provider";
import { encodeMessage, type WireMessage, type WireError, decodeHello, decodeHostRequest, decodeBrowserReply, type Hello, type HostRequest, type BrowserReply, type LiveSession } from "../../src/shared/companionProtocol";
import { parse } from "../../src/shared/schema";
import { frame as frameSchema } from "../../src/os/kernel/schema";
import { RetainedResults, type RetentionLimits } from "../../src/shared/retainedResults";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type WebSocket from "ws";
import { WebSocketServer, WebSocket as Socket } from "./socket";
import sharp from "sharp";
export interface CompanionOptions {
  port?: number;
  retention?: RetentionLimits;
  origin: string;
  token?: string;
}
export function startCompanion(options: CompanionOptions) {
  const token = options.token ?? randomBytes(32).toString("hex");
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: options.port ?? 4318,
    maxPayload: 4 * 1024 * 1024
  });
  const builds = new Map<WebSocket, Map<string, AbortController>>();
  const browsers = new Map<string, {
    socket: WebSocket;
    instance: string;
    generation: number;
    operations: LiveSession["operations"];
  }>();
  const peers = new Map<WebSocket, {
    role: "host" | "browser";
    id: string;
  }>();
  const actions = new Map<string, {
    target: string;
    host: WebSocket;
    request: string;
    browser: WebSocket;
    status: string;
    result?: unknown;
    error?: WireError;
    operation: string;
  }>();
  type Outcome = { target: string; operation: string; status: string; result?: unknown; error?: WireError };
  const outcomes = new RetainedResults<Outcome>(options.retention);
  const pruneTimer = setInterval(() => outcomes.prune(), 30000);
  pruneTimer.unref();
  const retain = (id: string, action: Outcome) => outcomes.set(id, { target: action.target, operation: action.operation, status: action.status, result: action.result, error: action.error });
  const send = (socket: WebSocket, value: WireMessage) => {
    if (socket.readyState === Socket.OPEN) socket.send(encodeMessage(value));
  };
  const fail = (socket: WebSocket, id: string, code: string, message: string) => send(socket, {
    id,
    error: {
      code,
      message
    }
  });
  server.on("connection", (socket, request) => {
    const origin = request.headers.origin;
    if (origin && origin !== options.origin) {
      socket.close(1008, "Origin rejected");
      return;
    }
    const authTimer = setTimeout(() => socket.close(1008, "Authentication required"), 5000);
    socket.on("message", async bytes => {
      const peer = peers.get(socket);
      let message: Hello | HostRequest | BrowserReply;
      try {
        message = !peer ? decodeHello(bytes.toString()) : peer.role === "browser" ? decodeBrowserReply(bytes.toString()) : decodeHostRequest(bytes.toString());
      } catch {
        socket.close(1008, "Invalid message");
        return;
      }
      if (message.type === "hello") {
        const supplied = Buffer.from(message.token);
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(new Uint8Array(supplied), new Uint8Array(expected)) || message.role === "browser" && origin !== options.origin) {
          socket.close(1008, "Authentication rejected");
          return;
        }
        clearTimeout(authTimer);
        const id = randomUUID();
        if (message.role === "browser") {
          const target = `${message.instance}:${message.generation}`;
          if (browsers.has(target)) {
            socket.close(1008, "Boot already connected");
            return;
          }
          browsers.set(target, {
            socket,
            instance: message.instance,
            generation: message.generation,
            operations: message.operations
          });
        }
        peers.set(socket, {
          role: message.role,
          id
        });
        send(socket, {
          type: "ready",
          id
        });
        if (message.role === "browser") {
          const target = `${message.instance}:${message.generation}`;
          for (const [actionId, action] of outcomes.entries()) if (action.target === target && action.status === "unknown") {
            send(socket, { type: "reconcile", action: actionId });
          }
        }
        return;
      }
      // Only a hello can arrive before the socket is a known peer.
      if (!peer) return;
      if (message.type === "build_request" || message.type === "build_cancel") {
        const pending = builds.get(socket) ?? new Map<string, AbortController>();
        builds.set(socket, pending);
        if (message.type === "build_cancel") { pending.get(message.id)?.abort(); return; }
        if (pending.has(message.id) || pending.size >= 4) {
          send(socket, {type: "build_result", id: message.id, error: {code: "conflict", message: "Too many builds or duplicate request"}});
          return;
        }
        const controller = new AbortController();
        pending.set(message.id, controller);
        try {
          const result = await localBuilder.build(message.request, {
            check: () => controller.signal.throwIfAborted(),
            subscribe: cleanup => { controller.signal.addEventListener("abort", cleanup); return () => controller.signal.removeEventListener("abort", cleanup); },
          });
          send(socket, {type: "build_result", id: message.id, result});
        } catch (error) { send(socket, {type: "build_result", id: message.id, error: {code: controller.signal.aborted ? "cancellation" : "invalid-argument", message: String(error)}}); }
        finally { pending.delete(message.id); }
        return;
      }
      if (message.type === "result" || message.type === "stream") {
        const action = actions.get(message.action);
        if (!action) {
          const prior = outcomes.get(message.action);
          const browser = prior && browsers.get(prior.target);
          if (message.type === "result" && prior?.status === "unknown" && browser?.socket === socket) {
            retain(message.action, { ...prior, status: "complete", result: message.result, error: message.error });
          }
          return;
        }
        if (action.browser !== socket) return;
        if (message.type === "stream") {
          send(action.host, { id: action.request, type: "stream", channel: message.channel, bytes: message.bytes });
          return;
        }
        if (message.type === "result") {
          action.status = "complete";
          action.result = message.result;
          action.error = message.error;
          if (!message.error && action.operation === "screenshot") {
            try {
              const frame = parse(frameSchema, message.result);
              if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.width * frame.height > 4000000) throw new Error("Invalid framebuffer dimensions");
              const pixels = Buffer.alloc(frame.width * frame.height);
              for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) pixels[y * frame.width + x] = frame.bytes[y * frame.rowBytes + (x >> 3)] & 128 >> (x & 7) ? 0 : 255;
              action.result = {
                ...frame,
                png: (await sharp(pixels, {
                  raw: {
                    width: frame.width,
                    height: frame.height,
                    channels: 1
                  }
                }).png().toBuffer()).toString("base64")
              };
            } catch (e) {
              action.error = {
                code: "invalid-argument",
                message: String(e)
              };
            }
          }
          send(action.host, {
            id: action.request,
            action: message.action,
            result: action.result,
            error: action.error
          });
          actions.delete(message.action);
          retain(message.action, action);
        }
        return;
      }

      if (message.type === "list") return send(socket, {
        id: message.id,
        result: [...browsers.entries()].map(([session, b]) => ({
          session,
          instance: b.instance,
          generation: b.generation,
          operations: b.operations
        }))
      });
      if (message.type === "outcome") {
        const action = actions.get(message.action) ?? outcomes.get(message.action);
        return send(socket, {
          id: message.id,
          result: action ? {
            status: action.status,
            result: action.result,
            error: action.error
          } : {
            status: "missing"
          }
        });
      }
      if (message.type === "cancel") {
        const action = actions.get(message.action);
        if (action && action.host === socket) send(action.browser, {
          type: "cancel",
          action: message.action
        });
        return send(socket, {
          id: message.id,
          result: {
            cancelled: !!action
          }
        });
      }
      if (message.type !== "invoke") return fail(socket, message.id, "invalid-argument", "Invalid operation request");
      if (actions.has(message.action) || outcomes.has(message.action)) return fail(socket, message.id, "conflict", "Action already dispatched; query its outcome instead of replaying");
      if (actions.size >= 128) return fail(socket, message.id, "conflict", "Too many active requests");
      const browser = browsers.get(message.target);
      if (!browser) return fail(socket, message.id, "disconnect", "Selected browser boot is not connected; select a current session");
      if (message.instance !== browser.instance || message.generation !== browser.generation) return fail(socket, message.id, "stale-reference", "Instance or boot generation does not match");
      actions.set(message.action, {
        target: message.target,
        host: socket,
        request: message.id,
        browser: browser.socket,
        status: "dispatched",
        operation: message.operation
      });
      send(browser.socket, {
        type: "invoke",
        action: message.action,
        caller: peer.id,
        instance: message.instance,
        generation: message.generation,
        operation: message.operation,
        args: message.args
      });
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      for (const controller of builds.get(socket)?.values() ?? []) controller.abort();
      builds.delete(socket);
      const peer = peers.get(socket);
      peers.delete(socket);
      for (const [target, browser] of browsers) if (browser.socket === socket) browsers.delete(target);
      for (const [id, action] of actions) {
        if (action.browser === socket && action.status === "dispatched") {
          action.status = "unknown";
          action.error = {
            code: "disconnect",
            message: "Browser disconnected after dispatch; mutation outcome is unknown. Inspect state before retrying."
          };
          send(action.host, {
            id: action.request,
            action: id,
            error: action.error
          });
          actions.delete(id);
          retain(id, action);
        }
        if (action.host === socket) {
          send(action.browser, { type: "cancel", action: id });
          actions.delete(id);
          retain(id, { ...action, status: "unknown" });
        }
      }
      if (peer?.role === "host") for (const browser of browsers.values()) send(browser.socket, {
        type: "revoke",
        caller: peer.id
      });
    });
    socket.on("error", () => { });
  });
  return {
    server,
    token,
    close: async () => {
      clearInterval(pruneTimer);
      outcomes.clear();
      actions.clear();
      for (const client of server.clients) client.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}
