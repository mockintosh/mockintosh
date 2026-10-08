import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayModel, gatewayToken } from "./_gateway";

const request = (headers: Record<string, string> = {}) => new Request("https://example.test/api/chat", { headers });

describe("gatewayToken", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers an API key over the request's OIDC token", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck_key");
    expect(gatewayToken(request({ "x-vercel-oidc-token": "oidc" }))).toBe("vck_key");
  });

  it("uses the OIDC token Vercel puts on the request", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "pulled");
    expect(gatewayToken(request({ "x-vercel-oidc-token": "oidc" }))).toBe("oidc");
  });

  it("falls back to the pulled token, then to nothing", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "pulled");
    expect(gatewayToken(request())).toBe("pulled");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    expect(gatewayToken(request())).toBeNull();
  });
});

describe("gatewayModel", () => {
  it("keeps a provider-prefixed id and reads a bare one as OpenAI's", () => {
    expect(gatewayModel("anthropic/claude-sonnet-5")).toBe("anthropic/claude-sonnet-5");
    expect(gatewayModel("gpt-4o-mini")).toBe("openai/gpt-4o-mini");
  });
});
