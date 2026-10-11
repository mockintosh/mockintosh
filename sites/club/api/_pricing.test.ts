import { describe, expect, it } from "vitest";
import { chatUsage, creditsFor, imageUsage } from "./_pricing";

describe("pricing", () => {
  it("charges twice the cost in tenths of a cent, rounding up, and never nothing", () => {
    expect(creditsFor(1_000_000)).toBe(2000);
    expect(creditsFor(144)).toBe(1);
    expect(creditsFor(0)).toBe(1);
    expect(creditsFor(13_057)).toBe(27);
  });

  it("reads a chat completion's cost from the gateway's usage", () => {
    // A real AI Gateway response's usage, October 2026.
    const response = {
      usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16, cost: 0.000144, market_cost: 0.000144 },
    };
    expect(chatUsage("openai/gpt-5.6-sol", response)).toEqual({
      model: "openai/gpt-5.6-sol",
      costMicroUsd: 144,
      inputTokens: 11,
      outputTokens: 5,
    });
  });

  it("prices a chat completion from its tokens when the gateway doesn't say", () => {
    const usage = chatUsage("other/model", { usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000 } });
    expect(usage.costMicroUsd).toBe(4_000_000 + 2_000_000);
    expect(chatUsage("other/model", {}).costMicroUsd).toBe(0);
  });

  it("reads an image's cost from the gateway's provider metadata", () => {
    const response = {
      usage: { input_tokens: 13, output_tokens: 406 },
      providerMetadata: { gateway: { cost: "0.013057" } },
    };
    expect(imageUsage("openai/gpt-image-1.5", response)).toEqual({
      model: "openai/gpt-image-1.5",
      costMicroUsd: 13_057,
      inputTokens: 13,
      outputTokens: 406,
    });
    expect(imageUsage("openai/gpt-image-1.5", {}).costMicroUsd).toBe(20_000);
  });
});
