import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { budgetStatus } from "./budget.ts";
import type { BudgetStatus } from "./budget.ts";
import { dialectFor, foreignRoutes } from "./dialect.ts";
import type { Dialect } from "./dialect.ts";
import { costOf, formatUsd, maxOutputTokensAffordable, priceFor } from "./pricing.ts";
import type { UsageStore } from "./store.ts";
import type { KeyConfig, TokenFenceConfig } from "./types.ts";
import { SERVICE, VERSION } from "./version.ts";

export interface ProxyDeps {
  config: TokenFenceConfig;
  store: UsageStore;
  now: () => Date;
  fetchImpl: typeof fetch;
  /** Environment the upstream API key is read from. Injected so tests stay hermetic. */
  env: Record<string, string | undefined>;
}

/** An error that is safe to hand back to the client as a JSON body. */
class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

/**
 * Errors take the shape of the dialect that is configured, so a client built for
 * either provider renders a refusal from this proxy the way it renders the
 * provider's own errors.
 */
function sendError(req: IncomingMessage, res: ServerResponse, error: HttpError, dialect: Dialect): void {
  sendJson(res, error.status, dialect.errorBody(error.status, error.code, error.message));
  if (error.status === 413) {
    res.once("finish", () => req.destroy());
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      throw new HttpError(413, "payload_too_large", `request body exceeds the ${limit} byte limit (maxBodyBytes)`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function presentedKey(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    const value = header.slice("bearer ".length).trim();
    if (value !== "") return value;
  }
  const direct = req.headers["x-tokenfence-key"];
  if (typeof direct === "string" && direct.trim() !== "") return direct.trim();
  return null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Look up the key a request presented, comparing against every configured key
 * with a constant-time digest comparison so neither timing nor an early return
 * reveals which secrets exist.
 */
function findKey(config: TokenFenceConfig, presented: string): KeyConfig | null {
  const candidate = digest(presented);
  let match: KeyConfig | null = null;
  for (const key of config.keys) {
    if (timingSafeEqual(candidate, digest(key.key))) match = key;
  }
  return match;
}

function authenticate(req: IncomingMessage, deps: ProxyDeps): KeyConfig {
  const presented = presentedKey(req);
  if (presented === null) {
    throw new HttpError(
      401,
      "missing_key",
      'no key presented. Send "Authorization: Bearer <key>" or an "x-tokenfence-key" header.',
    );
  }
  const key = findKey(deps.config, presented);
  if (key === null) {
    throw new HttpError(401, "invalid_key", "that key is not configured on this TokenFence instance.");
  }
  return key;
}

function exhaustedMessage(key: KeyConfig, status: BudgetStatus): string {
  const parts: string[] = [];
  if (status.dailyBudgetUsd !== null) {
    parts.push(`daily budget ${formatUsd(status.dailyBudgetUsd)}, spent today ${formatUsd(status.spendTodayUsd)}`);
  }
  if (status.monthlyBudgetUsd !== null) {
    parts.push(`monthly budget ${formatUsd(status.monthlyBudgetUsd)}, spent this month ${formatUsd(status.spendMonthUsd)}`);
  }
  return `key "${key.name}" is out of budget (${parts.join("; ")}). The cap resets at the next UTC day or month boundary.`;
}

function numericField(payload: Record<string, unknown>, name: string): number | null {
  const value = payload[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProxyDeps,
): Promise<void> {
  const dialect = dialectFor(deps.config);
  try {
    await route(req, res, deps);
  } catch (error) {
    if (error instanceof HttpError) {
      sendError(req, res, error, dialect);
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    sendError(req, res, new HttpError(500, "internal_error", reason), dialect);
  }
}

async function route(req: IncomingMessage, res: ServerResponse, deps: ProxyDeps): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const dialect = dialectFor(deps.config);

  if (req.method === "GET" && path === "/healthz") {
    sendJson(res, 200, { ok: true, service: SERVICE, version: VERSION });
    return;
  }

  if (path === "/v1/usage") {
    if (req.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "use GET /v1/usage");
    }
    const key = authenticate(req, deps);
    sendJson(res, 200, budgetStatus(deps.config, deps.store, key, deps.now()));
    return;
  }

  // A request aimed at the other dialect is a configuration mismatch rather
  // than a stray path, so name the flavor instead of returning a bare 404.
  if (foreignRoutes(dialect).includes(path)) {
    throw new HttpError(
      404,
      "wrong_dialect",
      `this instance is configured for upstream.flavor "${deps.config.upstream.flavor}", which serves ${dialect.route}. Send the request there instead.`,
    );
  }

  if (path === dialect.route) {
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", `use POST ${dialect.route}`);
    }
    await proxyCompletion(req, res, deps, dialect);
    return;
  }

  throw new HttpError(
    404,
    "not_found",
    `no route for ${req.method} ${path}. This instance proxies POST ${dialect.route} and serves GET /v1/usage and GET /healthz.`,
  );
}

async function proxyCompletion(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProxyDeps,
  dialect: Dialect,
): Promise<void> {
  const key = authenticate(req, deps);
  const text = await readBody(req, deps.config.maxBodyBytes);

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error("body is not a JSON object");
    payload = parsed;
  } catch {
    throw new HttpError(400, "invalid_json", "request body must be a JSON object");
  }

  if (payload.stream === true) {
    throw new HttpError(
      400,
      "streaming_unsupported",
      'TokenFence cannot meter a streamed response, so it refuses the request rather than let unmetered spend through. Send "stream": false.',
    );
  }

  const model = typeof payload.model === "string" ? payload.model : null;
  if (model === null || model.trim() === "") {
    throw new HttpError(400, "invalid_request", 'request body must include a non-empty "model"');
  }

  const status = budgetStatus(deps.config, deps.store, key, deps.now());
  if (status.remainingUsd <= 0) {
    throw new HttpError(429, "budget_exhausted", exhaustedMessage(key, status));
  }

  const price = priceFor(deps.config, model);
  const requestedMax = numericField(payload, "max_tokens") ?? numericField(payload, "max_completion_tokens");
  if (deps.config.enforce.preflightMaxTokens && requestedMax !== null && Number.isFinite(status.remainingUsd)) {
    const affordable = maxOutputTokensAffordable(price, status.remainingUsd);
    if (requestedMax > affordable) {
      throw new HttpError(
        429,
        "budget_exhausted",
        `remaining budget of ${formatUsd(status.remainingUsd)} covers at most ${affordable} output token(s) for "${model}", but the request asked for ${requestedMax}. Lower max_tokens or raise the budget.`,
      );
    }
  }

  const upstreamKey = deps.env[deps.config.upstream.apiKeyEnv];
  if (upstreamKey === undefined || upstreamKey === "") {
    throw new HttpError(
      500,
      "upstream_key_missing",
      `${deps.config.upstream.apiKeyEnv} is not set, so there is nothing to authenticate the upstream call with.`,
    );
  }

  const target = `${deps.config.upstream.baseUrl}${dialect.upstreamPath}`;

  let upstream: Response;
  try {
    upstream = await deps.fetchImpl(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...dialect.authHeaders(upstreamKey, deps.config.upstream),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(deps.config.upstream.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(502, "upstream_unreachable", `could not reach ${target}: ${reason}`);
  }

  const responseText = await upstream.text();
  const contentType = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";

  if (!upstream.ok) {
    // The provider rejected the call, so nothing was billed. Pass the error
    // through untouched and record nothing.
    res.writeHead(upstream.status, { "content-type": contentType });
    res.end(responseText);
    return;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = null;
  }

  const usage = dialect.reportedUsage(parsed);
  const { promptTokens, completionTokens } = usage;
  const cost = costOf(price, promptTokens, completionTokens);

  deps.store.record({
    at: deps.now().toISOString(),
    key: key.name,
    model,
    promptTokens,
    completionTokens,
    costUsd: cost,
  });

  const after = budgetStatus(deps.config, deps.store, key, deps.now());
  const headers: Record<string, string> = {
    "content-type": contentType,
    "x-tokenfence-cost-usd": cost.toFixed(6),
    "x-tokenfence-prompt-tokens": String(promptTokens),
    "x-tokenfence-completion-tokens": String(completionTokens),
  };
  if (Number.isFinite(after.remainingUsd)) {
    headers["x-tokenfence-remaining-usd"] = after.remainingUsd.toFixed(6);
  }
  if (usage.cacheTokens > 0) {
    // Part of the prompt came from the provider's cache, where the rate differs
    // from the listed input price. Surface the split rather than fold it in
    // silently. See the README for what is and is not modelled here.
    headers["x-tokenfence-cache-tokens"] = String(usage.cacheTokens);
  }
  if (!usage.reported) {
    // The call was recorded at zero cost because nothing told us what it spent.
    // Flag it rather than let an unmetered call look free.
    headers["x-tokenfence-usage"] = "unavailable";
  }

  res.writeHead(200, headers);
  res.end(responseText);
}
