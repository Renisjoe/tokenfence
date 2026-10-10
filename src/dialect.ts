import type { TokenFenceConfig, UpstreamConfig, UpstreamFlavor } from "./types.ts";

/**
 * How TokenFence talks to each provider.
 *
 * The guardrails are identical whoever the upstream is — what differs is
 * mechanical: which route we serve, which headers authenticate the call, and
 * which fields carry the token counts. Keeping that in one table means adding a
 * provider is a data change rather than a second copy of the proxy.
 */

/** Token counts a provider reported, and whether it reported any at all. */
export interface ReportedUsage {
  promptTokens: number;
  completionTokens: number;
  /**
   * Portion of `promptTokens` that came from the prompt cache. These are
   * counted rather than dropped, but the cache multipliers are not modelled, so
   * cache-heavy traffic is metered approximately — see the README.
   */
  cacheTokens: number;
  /** False when the payload carried no usable `usage` block at all. */
  reported: boolean;
}

export interface Dialect {
  /** Client-facing route this instance serves. */
  route: string;
  /** Path appended to `upstream.baseUrl` for the proxied call. */
  upstreamPath: string;
  /** Headers that authenticate the proxied call. */
  authHeaders: (apiKey: string, upstream: UpstreamConfig) => Record<string, string>;
  /** Read token counts out of the provider's response body. */
  reportedUsage: (parsed: unknown) => ReportedUsage;
  /**
   * Shape of the errors *we* emit, so each provider's own client can render a
   * refusal from this proxy the same way it renders the provider's.
   */
  errorBody: (status: number, code: string, message: string) => unknown;
}

const UNREPORTED: ReportedUsage = { promptTokens: 0, completionTokens: 0, cacheTokens: 0, reported: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberIn(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The `usage` object, or null when the provider sent none. */
function usageBlock(parsed: unknown): Record<string, unknown> | null {
  if (!isRecord(parsed)) return null;
  const usage = parsed.usage;
  return isRecord(usage) ? usage : null;
}

/** An Anthropic-style error type for an HTTP status. */
function anthropicErrorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "not_found_error";
  if (status === 413) return "request_too_large";
  if (status === 429) return "rate_limit_error";
  return status >= 500 ? "api_error" : "invalid_request_error";
}

/** OpenAI chat completions: POST /v1/chat/completions, bearer auth. */
const openai: Dialect = {
  route: "/v1/chat/completions",
  upstreamPath: "/chat/completions",
  authHeaders: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
  errorBody: (status, code, message) => ({
    error: {
      message,
      type: status === 429 ? "rate_limit_error" : status >= 500 ? "server_error" : "invalid_request_error",
      code,
    },
  }),
  reportedUsage: (parsed) => {
    const usage = usageBlock(parsed);
    if (usage === null) return UNREPORTED;
    return {
      promptTokens: numberIn(usage.prompt_tokens),
      completionTokens: numberIn(usage.completion_tokens),
      cacheTokens: 0,
      reported: true,
    };
  },
};

/**
 * Anthropic messages: POST /v1/messages, authenticated with `x-api-key` rather
 * than a bearer token, and requiring an `anthropic-version` header.
 *
 * `input_tokens` counts only the uncached prompt, so cache writes and reads are
 * added in — otherwise a cached call would look nearly free.
 */
const anthropic: Dialect = {
  route: "/v1/messages",
  upstreamPath: "/messages",
  authHeaders: (apiKey, upstream) => ({
    "x-api-key": apiKey,
    "anthropic-version": upstream.anthropicVersion,
  }),
  errorBody: (status, code, message) => ({
    type: "error",
    // Anthropic reads `type`; `code` is appended so our own refusal codes
    // (budget_exhausted, wrong_dialect) stay visible to whoever is debugging.
    error: { type: anthropicErrorType(status), code, message },
  }),
  reportedUsage: (parsed) => {
    const usage = usageBlock(parsed);
    if (usage === null) return UNREPORTED;
    const cacheTokens =
      numberIn(usage.cache_creation_input_tokens) + numberIn(usage.cache_read_input_tokens);
    return {
      promptTokens: numberIn(usage.input_tokens) + cacheTokens,
      completionTokens: numberIn(usage.output_tokens),
      cacheTokens,
      reported: true,
    };
  },
};

export const DIALECTS: Record<UpstreamFlavor, Dialect> = { openai, anthropic };

/** The dialect this instance speaks, chosen by `upstream.flavor`. */
export function dialectFor(config: TokenFenceConfig): Dialect {
  return DIALECTS[config.upstream.flavor];
}

/** Routes belonging to a dialect other than the configured one. */
export function foreignRoutes(configured: Dialect): string[] {
  return Object.values(DIALECTS)
    .filter((dialect) => dialect.route !== configured.route)
    .map((dialect) => dialect.route);
}
