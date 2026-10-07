/**
 * Host context for fx's terminal interface. Its terminal core takes no
 * instructions option (the agent surface does), and reads no project files
 * in the browser, where it has no file system. Every model request passes
 * through the host's `fetch`, so the host adds its context there: one more
 * system message after fx's own, as `instructions` would be for an agent.
 */

type FetchInit = { body?: unknown };
type FetchLike = (url: string, init?: never) => Promise<unknown>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * `body` with a system message carrying `text` after the leading system
 * messages, or unchanged when it isn't a model request (no `prompt` array).
 */
export function addSystemMessage<B extends string | Uint8Array>(body: B, text: string): B {
  const raw = typeof body === "string" ? body : decoder.decode(body);
  let request: { prompt?: { role?: string; content?: unknown }[] };
  try {
    request = JSON.parse(raw);
  } catch {
    return body;
  }
  if (!request || !Array.isArray(request.prompt)) return body;
  let at = 0;
  while (at < request.prompt.length && request.prompt[at]?.role === "system") at++;
  request.prompt.splice(at, 0, { role: "system", content: text });
  const json = JSON.stringify(request);
  return (typeof body === "string" ? json : encoder.encode(json)) as B;
}

/** `fetch` that adds `instructions` to every model request's system prompt. */
export function fetchWithInstructions<F extends FetchLike>(fetch: F, instructions: string): F {
  const send = fetch as unknown as (url: string, init?: FetchInit) => Promise<unknown>;
  return ((url: string, init?: FetchInit) => {
    const body = init?.body;
    if (typeof body === "string" || body instanceof Uint8Array) return send(url, { ...init, body: addSystemMessage(body, instructions) });
    return send(url, init);
  }) as unknown as F;
}
