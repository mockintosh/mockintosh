import { envLimit, guardRequest, type RouteLimits } from "./_guard";

const IMAGE_API_URL = "https://api.openai.com/v1/images/generations";
const LLM_API_KEY = process.env.LLM_API_KEY || "";

/** Each image costs far more than a chat turn. */
const IMAGE_LIMITS: RouteLimits = {
  route: "image",
  maxBodyBytes: 8_000,
  perClient: { max: envLimit("IMAGE_LIMIT_PER_HOUR", 20), windowSeconds: 3600 },
  global: { max: envLimit("IMAGE_LIMIT_PER_DAY", 300), windowSeconds: 86400 },
};

const MAX_PROMPT_CHARS = 2000;

export default async function handler(req: Request): Promise<Response> {
  const guard = await guardRequest(req, IMAGE_LIMITS);
  if (!guard.ok) return guard.response;

  if (!LLM_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "Image generation requires an LLM_API_KEY to be configured.",
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
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1.5",
        prompt: prompt.trim(),
        n: 1,
        size: "1024x1024",
        quality: "low",
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
    const b64 = data.data?.[0]?.b64_json ?? null;

    if (!b64) {
      return new Response(
        JSON.stringify({ error: "No image returned from API" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ b64 }), {
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

export const config = { runtime: "edge" };
