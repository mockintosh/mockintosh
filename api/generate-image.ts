import { envLimit, guardRequest, type GuardResult, type RouteLimits } from "./_guard.js";
import { GATEWAY_URL, gatewayToken } from "./_gateway.js";
import type { ChargeCall } from "./chat.js";

const IMAGE_API_URL = `${GATEWAY_URL}/images/generations`;
const IMAGE_MODEL = "openai/gpt-image-1.5";

/** Each image costs far more than a chat turn. */
export const IMAGE_LIMITS: RouteLimits = {
  route: "image",
  maxBodyBytes: 8_000,
  perClient: { max: envLimit("IMAGE_LIMIT_PER_HOUR", 20), windowSeconds: 3600 },
  global: { max: envLimit("IMAGE_LIMIT_PER_DAY", 300), windowSeconds: 86400 },
};

const MAX_PROMPT_CHARS = 2000;

async function handler(req: Request): Promise<Response> {
  const guard = await guardRequest(req, IMAGE_LIMITS);
  if (!guard.ok) return guard.response;
  try {
    return await generateImage(req, guard);
  } finally {
    await guard.done();
  }
}

/** Answers a request the guard has let through; `charge` as for chat (`ChargeCall`). */
export async function generateImage(
  req: Request,
  guard: Extract<GuardResult, { ok: true }>,
  charge?: ChargeCall,
): Promise<Response> {

  const token = gatewayToken(req);
  if (!token) {
    return new Response(
      JSON.stringify({
        error: "Image generation needs AI Gateway: run `vercel env pull` or set AI_GATEWAY_API_KEY.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  let prompt: unknown;
  try {
    prompt = (JSON.parse(guard.body) as { prompt?: unknown } | null)?.prompt;
  } catch {
    prompt = undefined;
  }

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return new Response(JSON.stringify({ error: "Missing prompt" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return new Response(JSON.stringify({ error: "Prompt too long" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const imgResponse = await fetch(IMAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: prompt.trim(),
        n: 1,
        size: "1024x1024",
        quality: "low",
        // Low quality is what keeps an image cheap; say it the gateway's way too.
        providerOptions: { openai: { quality: "low" } },
      }),
    });

    if (!imgResponse.ok) {
      // The provider's body can describe our account; keep it in the logs.
      console.error("Image API error:", imgResponse.status, await imgResponse.text());
      return new Response(
        JSON.stringify({ error: `Image API error (${imgResponse.status})` }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await imgResponse.json();
    const credits = await charge?.(IMAGE_MODEL, data);
    const b64 = data.data?.[0]?.b64_json ?? null;

    if (!b64) {
      return new Response(
        JSON.stringify({ error: "No image returned from API" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(credits === undefined ? { b64 } : { b64, credits }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/** Image generation can take a while; Node functions allow it. */
export const maxDuration = 120;

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
