import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  EnforceConfig,
  KeyConfig,
  ListenConfig,
  ModelPrice,
  TokenFenceConfig,
  UpstreamConfig,
  UpstreamFlavor,
} from "./types.ts";

/** Raised for anything wrong with the config file, with a pointer to the field. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_PRICE: ModelPrice = { inputPer1M: 1, outputPer1M: 3 };
const DEFAULT_FLAVOR: UpstreamFlavor = "openai";
/** Long-standing Anthropic API version. Required header, not a date we choose. */
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(where: string, message: string): never {
  throw new ConfigError(`${where}: ${message}`);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) fail(where, "expected an object");
  return value;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(where, "expected a non-empty string");
  }
  return value.trim();
}

function asNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(where, "expected a finite number");
  }
  return value;
}

function asPositiveInt(value: unknown, where: string): number {
  const n = asNumber(value, where);
  if (!Number.isInteger(n) || n <= 0) fail(where, "expected a positive integer");
  return n;
}

/** Optional non-negative number; `undefined` when the field is absent. */
function optionalNonNegative(value: unknown, where: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = asNumber(value, where);
  if (n < 0) fail(where, "expected a number >= 0");
  return n;
}

function optionalPositiveNumber(value: unknown, where: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = asNumber(value, where);
  if (n <= 0) fail(where, "expected a number > 0");
  return n;
}

function asFlavor(value: unknown, where: string): UpstreamFlavor {
  const flavor = asString(value, where);
  if (flavor !== "openai" && flavor !== "anthropic") {
    fail(where, `expected "openai" or "anthropic", got "${flavor}"`);
  }
  return flavor;
}

function asPrice(value: unknown, where: string): ModelPrice {
  const raw = asRecord(value, where);
  const input = optionalNonNegative(raw.inputPer1M, `${where}.inputPer1M`);
  const output = optionalNonNegative(raw.outputPer1M, `${where}.outputPer1M`);
  if (input === undefined || output === undefined) {
    fail(where, "expected inputPer1M and outputPer1M, both in USD per million tokens");
  }
  return { inputPer1M: input, outputPer1M: output };
}

function asKey(value: unknown, index: number): KeyConfig {
  const where = `keys[${index}]`;
  const raw = asRecord(value, where);
  const key: KeyConfig = {
    name: asString(raw.name, `${where}.name`),
    key: asString(raw.key, `${where}.key`),
  };
  const daily = optionalPositiveNumber(raw.dailyUsdBudget, `${where}.dailyUsdBudget`);
  const monthly = optionalPositiveNumber(raw.monthlyUsdBudget, `${where}.monthlyUsdBudget`);
  if (daily !== undefined) key.dailyUsdBudget = daily;
  if (monthly !== undefined) key.monthlyUsdBudget = monthly;
  return key;
}

function asListen(value: unknown): ListenConfig {
  if (value === undefined) return { host: DEFAULT_HOST, port: DEFAULT_PORT };
  const raw = asRecord(value, "listen");
  const host = raw.host === undefined ? DEFAULT_HOST : asString(raw.host, "listen.host");
  const port = raw.port === undefined ? DEFAULT_PORT : asPositiveInt(raw.port, "listen.port");
  return { host, port };
}

function asUpstream(value: unknown): UpstreamConfig {
  const raw = asRecord(value, "upstream");
  const baseUrl = asString(raw.baseUrl, "upstream.baseUrl");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    fail("upstream.baseUrl", `not a valid URL: ${baseUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("upstream.baseUrl", `expected an http(s) URL, got ${parsed.protocol}`);
  }
  // Cross-field check: a version header on a non-Anthropic upstream is a
  // config mistake worth naming, not something to silently ignore.
  if (raw.anthropicVersion !== undefined && raw.flavor !== undefined && raw.flavor !== "anthropic") {
    fail("upstream.anthropicVersion", 'only applies when upstream.flavor is "anthropic"');
  }

  return {
    flavor: raw.flavor === undefined ? DEFAULT_FLAVOR : asFlavor(raw.flavor, "upstream.flavor"),
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKeyEnv: asString(raw.apiKeyEnv, "upstream.apiKeyEnv"),
    timeoutMs: raw.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : asPositiveInt(raw.timeoutMs, "upstream.timeoutMs"),
    anthropicVersion:
      raw.anthropicVersion === undefined
        ? DEFAULT_ANTHROPIC_VERSION
        : asString(raw.anthropicVersion, "upstream.anthropicVersion"),
  };
}

function asModels(value: unknown): Record<string, ModelPrice> {
  if (value === undefined) return {};
  const raw = asRecord(value, "models");
  const models: Record<string, ModelPrice> = {};
  for (const [name, price] of Object.entries(raw)) {
    models[name] = asPrice(price, `models.${name}`);
  }
  return models;
}

function asEnforce(value: unknown): EnforceConfig {
  if (value === undefined) return { preflightMaxTokens: true };
  const raw = asRecord(value, "enforce");
  if (raw.preflightMaxTokens === undefined) return { preflightMaxTokens: true };
  if (typeof raw.preflightMaxTokens !== "boolean") {
    fail("enforce.preflightMaxTokens", "expected a boolean");
  }
  return { preflightMaxTokens: raw.preflightMaxTokens };
}

/** Validate an already-parsed config object. `sourcePath` anchors relative paths. */
export function parseConfig(raw: unknown, sourcePath: string): TokenFenceConfig {
  const root = asRecord(raw, "config");
  const upstream = asUpstream(root.upstream);

  if (!Array.isArray(root.keys)) fail("keys", "expected an array of key objects");
  if (root.keys.length === 0) fail("keys", "configure at least one key, or nothing can authenticate");

  const keys = root.keys.map(asKey);
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key.key)) fail("keys", `duplicate secret for key "${key.name}"`);
    seen.add(key.key);
  }

  const usageFile =
    root.usageFile === undefined
      ? resolve(dirname(sourcePath), "tokenfence-usage.json")
      : resolve(dirname(sourcePath), asString(root.usageFile, "usageFile"));

  return {
    listen: asListen(root.listen),
    upstream,
    keys,
    models: asModels(root.models),
    defaultPrice: root.defaultPrice === undefined ? DEFAULT_PRICE : asPrice(root.defaultPrice, "defaultPrice"),
    enforce: asEnforce(root.enforce),
    usageFile,
    maxBodyBytes:
      root.maxBodyBytes === undefined
        ? DEFAULT_MAX_BODY_BYTES
        : asPositiveInt(root.maxBodyBytes, "maxBodyBytes"),
  };
}

/** Read and validate a config file from disk. */
export function loadConfig(path: string): TokenFenceConfig {
  const absolute = resolve(path);

  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`could not read ${absolute}: ${reason}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${absolute} is not valid JSON: ${reason}`);
  }

  return parseConfig(parsed, absolute);
}
