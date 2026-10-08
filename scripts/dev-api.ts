import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 3001;

function loadEnvLocal() {
  try {
    const envPath = resolve(import.meta.dirname!, "..", ".env.local");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    console.warn(
      "No .env.local found — run `vercel env pull`, or set AI_GATEWAY_API_KEY in the environment"
    );
  }
}

loadEnvLocal();

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

async function nodeToWebRequest(
  req: IncomingMessage,
  body: string
): Promise<Request> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  return new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
  });
}

async function webToNodeResponse(webRes: Response, res: ServerResponse) {
  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));

  if (!webRes.body) {
    res.end();
    return;
  }

  const reader = webRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

const { default: chatHandler } = await import("../api/chat.js");
const { default: generateImageHandler } = await import(
  "../api/generate-image.js"
);
const { default: oauthStartHandler } = await import("../api/oauth/start.js");
const { default: oauthPairHandler } = await import("../api/oauth/pair.js");
const { default: oauthCallbackHandler } = await import(
  "../api/oauth/callback.js"
);
const { default: oauthPollHandler } = await import("../api/oauth/poll.js");
const { default: browseHandler } = await import("../api/browse.js");
const { default: webImageHandler } = await import("../api/web-image.js");
const { default: githubTokenHandler } = await import("../api/github/token.js");

const routes: Record<string, (req: Request) => Promise<Response>> = {
  "/api/chat": chatHandler,
  "/api/generate-image": generateImageHandler,
  "/api/oauth/start": oauthStartHandler,
  "/api/oauth/pair": oauthPairHandler,
  "/api/oauth/callback": oauthCallbackHandler,
  "/api/oauth/poll": oauthPollHandler,
  "/api/browse": browseHandler,
  "/api/web-image": webImageHandler,
  "/api/github/token": githubTokenHandler,
};

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const path = new URL(req.url ?? "/", `http://localhost:${PORT}`).pathname;
  const handler = routes[path];

  if (!handler) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const body = await readBody(req);
    const webReq = await nodeToWebRequest(req, body);
    const webRes = await handler(webReq);
    await webToNodeResponse(webRes, res);
  } catch (err) {
    console.error("Handler error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, () => {
  const auth = process.env.AI_GATEWAY_API_KEY
    ? "AI_GATEWAY_API_KEY"
    : process.env.VERCEL_OIDC_TOKEN
      ? "VERCEL_OIDC_TOKEN (expires 12 hours after `vercel env pull`)"
      : null;
  console.log(`API server listening on http://localhost:${PORT}`);
  console.log(`  LLM_MODEL: ${process.env.LLM_MODEL || "openai/gpt-5.6-sol"}`);
  console.log(`  AI Gateway: ${auth ?? "NOT CONFIGURED — Assistant will return errors"}`);
  if (!auth) {
    console.log("\n  Link the project and pull its OIDC token:");
    console.log("    vercel link && vercel env pull");
    console.log("  or set AI_GATEWAY_API_KEY in .env.local.");
  }
});
