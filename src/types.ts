/**
 * Shape of a parsed TokenFence configuration. Everything here is validated by
 * `config.ts` before the proxy starts, so the rest of the code can trust it.
 */

/** Price of a model, in US dollars per one million tokens. */
export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

/** One client credential the proxy will accept, plus the budgets attached to it. */
export interface KeyConfig {
  /** Human label used in reports and the ledger. */
  name: string;
  /** The secret a client sends as its bearer token. */
  key: string;
  /** Rolling 24h (UTC day) ceiling in USD. Omit for no daily cap. */
  dailyUsdBudget?: number;
  /** Calendar month (UTC) ceiling in USD. Omit for no monthly cap. */
  monthlyUsdBudget?: number;
}

/** Which wire dialect the configured upstream speaks. */
export type UpstreamFlavor = "openai" | "anthropic";

/** Where the proxy sends authenticated traffic, and how to authenticate it. */
export interface UpstreamConfig {
  /**
   * Dialect of the upstream. Decides which route this instance serves, how the
   * call is authenticated, and which fields carry the token counts.
   */
  flavor: UpstreamFlavor;
  /** Base URL of the provider API, e.g. https://api.anthropic.com/v1 */
  baseUrl: string;
  /** Environment variable holding the real provider key. Never the key itself. */
  apiKeyEnv: string;
  timeoutMs: number;
  /** Sent as `anthropic-version`. Only used when `flavor` is `"anthropic"`. */
  anthropicVersion: string;
}

/** Which guardrails are switched on. */
export interface EnforceConfig {
  /**
   * When true, a request whose `max_tokens` the remaining budget cannot
   * possibly cover is rejected before any money is spent.
   */
  preflightMaxTokens: boolean;
}

export interface ListenConfig {
  host: string;
  port: number;
}

export interface TokenFenceConfig {
  listen: ListenConfig;
  upstream: UpstreamConfig;
  keys: KeyConfig[];
  /** Per-model prices. Falls back to `defaultPrice` for anything unlisted. */
  models: Record<string, ModelPrice>;
  defaultPrice: ModelPrice;
  enforce: EnforceConfig;
  /** JSON ledger of every billed call. Resolved relative to the config file. */
  usageFile: string;
  maxBodyBytes: number;
}

/** One billed call. `costUsd` is computed from the price table at record time. */
export interface UsageEntry {
  at: string;
  key: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}
