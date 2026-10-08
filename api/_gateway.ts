/**
 * Every model call goes through Vercel AI Gateway, so spend shows up (and
 * can be capped with a budget) on the Vercel team instead of a provider
 * account. On a deployment there is no key to manage: Vercel puts a
 * short-lived OIDC token on each function request. Locally, `vercel env
 * pull` writes `VERCEL_OIDC_TOKEN` to `.env.local` (valid for 12 hours), or
 * set `AI_GATEWAY_API_KEY`, which wins over OIDC when both are present.
 */

export const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1";

export function gatewayToken(req: Request): string | null {
  return (
    process.env.AI_GATEWAY_API_KEY ||
    req.headers.get("x-vercel-oidc-token") ||
    process.env.VERCEL_OIDC_TOKEN ||
    null
  );
}

/** Gateway ids are `provider/model`; a bare id (an older `LLM_MODEL`) is OpenAI's. */
export function gatewayModel(id: string): string {
  return id.includes("/") ? id : `openai/${id}`;
}
