import { describe, expect, it } from "vitest";
import { reasoningEffortForRequest, staticPromptPrefix } from "./chat";

describe("chat prompt prefix", () => {
  it("is byte-identical across calls for a given mode", () => {
    expect(staticPromptPrefix("build")).toBe(staticPromptPrefix("build"));
    expect(staticPromptPrefix("chat")).toBe(staticPromptPrefix("chat"));
    expect(staticPromptPrefix("build")).toContain("Prefer edit over write");
  });
});

describe("reasoningEffortForRequest", () => {
  const completions = "https://ai-gateway.vercel.sh/v1/chat/completions";

  it("forces none when tools ride on chat completions", () => {
    expect(reasoningEffortForRequest({
      model: "gpt-5.6-sol",
      thinking: "medium",
      toolCount: 3,
      apiUrl: completions,
    })).toBe("none");
  });

  it("recognises a gateway model id", () => {
    expect(reasoningEffortForRequest({
      model: "openai/gpt-5.6-sol",
      thinking: "high",
      toolCount: 0,
      apiUrl: completions,
    })).toBe("high");
  });

  it("keeps the requested effort when there are no tools", () => {
    expect(reasoningEffortForRequest({
      model: "gpt-5.6-sol",
      thinking: "high",
      toolCount: 0,
      apiUrl: completions,
    })).toBe("high");
  });

  it("keeps thinking on a non-completions URL", () => {
    expect(reasoningEffortForRequest({
      model: "gpt-5.6-sol",
      thinking: "medium",
      toolCount: 3,
      apiUrl: "https://api.openai.com/v1/responses",
    })).toBe("medium");
  });
});
