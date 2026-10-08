import type { ModelPrice, TokenFenceConfig } from "./types.ts";

const MILLION = 1_000_000;

/**
 * Price to use for a model. Exact match first, then a case-insensitive match,
 * then the configured default — so an unlisted model is still metered rather
 * than silently free.
 */
export function priceFor(config: TokenFenceConfig, model: string): ModelPrice {
  const exact = config.models[model];
  if (exact) return exact;

  const wanted = model.toLowerCase();
  for (const [name, price] of Object.entries(config.models)) {
    if (name.toLowerCase() === wanted) return price;
  }

  return config.defaultPrice;
}

/** Dollar cost of one call, given the token counts the provider reported. */
export function costOf(price: ModelPrice, promptTokens: number, completionTokens: number): number {
  return (promptTokens / MILLION) * price.inputPer1M + (completionTokens / MILLION) * price.outputPer1M;
}

/**
 * How many output tokens a leftover budget can pay for at most, assuming a
 * worst case where every token is an output token. Used to reject a request
 * whose `max_tokens` could blow the budget before it is sent.
 */
export function maxOutputTokensAffordable(price: ModelPrice, budgetUsd: number): number {
  if (!Number.isFinite(budgetUsd)) return Number.POSITIVE_INFINITY;
  if (budgetUsd <= 0) return 0;
  if (price.outputPer1M <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor((budgetUsd * MILLION) / price.outputPer1M);
}

/** Format dollars with enough decimals to stay meaningful at small values. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "unlimited";
  return `$${value.toFixed(6)}`;
}
