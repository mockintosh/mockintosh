/**
 * What AI use costs a Computer Club member. The gateway reports what each
 * call cost us; a member pays twice that, in credits of a tenth of a cent
 * ($10 buys 10,000). Twice covers Polar's fees (about 12% of a $10 pack
 * on a non-US card), the welcome credits, and calls that fail after
 * spending. See docs/computer-club-plan.md.
 */

/** What a member pays for each dollar the gateway charges us. */
export const MARKUP = 2;
/** One credit, in millionths of a dollar. */
export const CREDIT_MICROUSD = 1000;

/**
 * Prices to fall back on when a response doesn't say what it cost, per
 * million tokens, in dollars: the default model's (`openai/gpt-5.6-sol`),
 * on the high side for the cheaper ones.
 */
const FALLBACK_INPUT_PER_MTOK = 4;
const FALLBACK_OUTPUT_PER_MTOK = 20;
/** A low-quality 1024×1024 image cost about $0.013 in October 2026. */
const FALLBACK_IMAGE_USD = 0.02;

export interface Usage {
  model: string;
  /** What the call cost us, in millionths of a dollar. */
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/** Credits for a call that cost us `costMicroUsd`; never free. */
export function creditsFor(costMicroUsd: number): number {
  return Math.max(1, Math.ceil((costMicroUsd * MARKUP) / CREDIT_MICROUSD));
}

const microUsd = (dollars: number) => Math.round(dollars * 1_000_000);

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A chat completion's cost, from the `usage` the gateway adds (`usage.cost`, in dollars). */
export function chatUsage(model: string, response: unknown): Usage {
  const usage = (response as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  const inputTokens = count(usage.prompt_tokens);
  const outputTokens = count(usage.completion_tokens);
  const reported = Number(usage.cost);
  const dollars = Number.isFinite(reported) && reported >= 0
    ? reported
    : (inputTokens * FALLBACK_INPUT_PER_MTOK + outputTokens * FALLBACK_OUTPUT_PER_MTOK) / 1_000_000;
  return { model, costMicroUsd: microUsd(dollars), inputTokens, outputTokens };
}

/** An image generation's cost, from `providerMetadata.gateway.cost` (dollars, as a string). */
export function imageUsage(model: string, response: unknown): Usage {
  const body = response as {
    usage?: Record<string, unknown>;
    providerMetadata?: { gateway?: { cost?: unknown } };
  } | null;
  const reported = Number(body?.providerMetadata?.gateway?.cost);
  const dollars = Number.isFinite(reported) && reported >= 0 ? reported : FALLBACK_IMAGE_USD;
  return {
    model,
    costMicroUsd: microUsd(dollars),
    inputTokens: count(body?.usage?.input_tokens),
    outputTokens: count(body?.usage?.output_tokens),
  };
}
