import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../../src/server.ts";
import { UsageStore } from "../../src/store.ts";
import type { KeyConfig, ModelPrice, TokenFenceConfig, UpstreamConfig } from "../../src/types.ts";
import { startFakeUpstream } from "./fake-upstream.ts";
import type { FakeUpstream, UpstreamHandler } from "./fake-upstream.ts";

export const UPSTREAM_KEY_ENV = "TOKENFENCE_TEST_UPSTREAM_KEY";
export const UPSTREAM_KEY = "sk-upstream-test";
export const CLIENT_KEY = "tf_test_client_key";

/** $1 per million input tokens, $3 per million output tokens. Easy to do by hand. */
export const TEST_PRICE: ModelPrice = { inputPer1M: 1, outputPer1M: 3 };

export interface Harness {
  baseUrl: string;
  store: UsageStore;
  config: TokenFenceConfig;
  upstream: FakeUpstream;
  post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
  get: (path: string, headers?: Record<string, string>) => Promise<Response>;
  close: () => Promise<void>;
}

export interface SetupOptions {
  handler?: UpstreamHandler;
  keyOverrides?: Partial<KeyConfig>;
  upstream?: Partial<UpstreamConfig>;
  overrides?: Partial<TokenFenceConfig>;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

export async function setup(options: SetupOptions = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "tokenfence-test-"));
  const upstream = await startFakeUpstream(options.handler);
  const usageFile = join(dir, "tokenfence-usage.json");

  const config: TokenFenceConfig = {
    listen: { host: "127.0.0.1", port: 0 },
    upstream: {
      baseUrl: upstream.baseUrl,
      apiKeyEnv: UPSTREAM_KEY_ENV,
      timeoutMs: 5000,
      ...options.upstream,
    },
    keys: [
      {
        name: "dev",
        key: CLIENT_KEY,
        dailyUsdBudget: 5,
        monthlyUsdBudget: 50,
        ...options.keyOverrides,
      },
    ],
    models: { "gpt-4o-mini": TEST_PRICE },
    defaultPrice: TEST_PRICE,
    enforce: { preflightMaxTokens: true },
    usageFile,
    maxBodyBytes: 1024 * 1024,
    ...options.overrides,
  };

  const store = new UsageStore(usageFile, options.now ?? (() => new Date()));
  const started = await startServer({
    config,
    store,
    now: options.now ?? (() => new Date()),
    fetchImpl: fetch,
    env: options.env ?? { [UPSTREAM_KEY_ENV]: UPSTREAM_KEY },
  });

  const call = (method: string) => (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${started.url}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${CLIENT_KEY}`,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  return {
    baseUrl: started.url,
    store,
    config,
    upstream,
    post: call("POST"),
    get: call("GET"),
    close: async () => {
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
      started.server.closeAllConnections();
      await upstream.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
