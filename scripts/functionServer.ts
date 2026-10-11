/**
 * Serves Vercel-style functions (`(req: Request) => Promise<Response>`) on a
 * local port: the OS's `api/` (`scripts/dev-api.ts`) and the Computer
 * Club's (`sites/club/scripts/dev.ts`).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export type FunctionHandler = (req: Request) => Promise<Response>;

export interface FunctionRoutes {
  /** Handlers by exact path. */
  exact: Record<string, FunctionHandler>;
  /** Catch-all functions (`api/auth/[...all].ts`), by path prefix. */
  prefix?: Array<[string, FunctionHandler]>;
}

/**
 * Sets each variable in the first of `paths` that exists and has it, unless
 * the environment already does (an empty value counts). `vercel env pull`
 * quotes values; parseEnv reads them as dotenv does. True when any loaded.
 */
export function loadEnvFiles(paths: readonly string[]): boolean {
  let loaded = false;
  for (const path of paths) {
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    loaded = true;
    for (const [key, value] of Object.entries(parseEnv(content))) process.env[key] ??= value;
  }
  return loaded;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

function toWebRequest(req: IncomingMessage, body: string, port: number): Request {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  return new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
  });
}

async function sendWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string | string[]> = Object.fromEntries(webRes.headers.entries());
  // Better Auth sets more than one cookie; fromEntries would keep the last.
  const cookies = webRes.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(webRes.status, headers);
  if (!webRes.body) {
    res.end();
    return;
  }
  const reader = webRes.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

export function serveFunctions(options: {
  port: number;
  routes: FunctionRoutes;
  /** Answer every preflight here instead of passing it to the function. */
  answerPreflights?: boolean;
  onListen?: () => void;
}): void {
  const { port, routes } = options;
  const server = createServer(async (req, res) => {
    if (options.answerPreflights && req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }
    const path = new URL(req.url ?? "/", `http://localhost:${port}`).pathname;
    const handler = routes.exact[path] ?? routes.prefix?.find(([prefix]) => path.startsWith(prefix))?.[1];
    if (!handler) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    try {
      await sendWebResponse(await handler(toWebRequest(req, await readBody(req), port)), res);
    } catch (err) {
      console.error("Handler error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
  server.listen(port, options.onListen);
}
