import assert from "node:assert/strict";
import { test } from "node:test";

import { costOf, formatUsd, maxOutputTokensAffordable, priceFor } from "../src/pricing.ts";
import type { TokenFenceConfig } from "../src/types.ts";

function configWith(models: Record<string, { inputPer1M: number; outputPer1M: number }>): TokenFenceConfig {
  return {
    listen: { host: "127.0.0.1", port: 0 },
    upstream: { baseUrl: "https://example.com/v1", apiKeyEnv: "K", timeoutMs: 1000 },
    keys: [{ name: "dev", key: "k" }],
    models,
    defaultPrice: { inputPer1M: 10, outputPer1M: 30 },
    enforce: { preflightMaxTokens: true },
    usageFile: "/tmp/unused.json",
    maxBodyBytes: 1024,
  };
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-12, `expected ${actual} to be within 1e-12 of ${expected}`);
}

test("costOf adds input and output spend", () => {
  close(costOf({ inputPer1M: 1, outputPer1M: 3 }, 1000, 500), 0.0025);
  close(costOf({ inputPer1M: 0.15, outputPer1M: 0.6 }, 1_000_000, 1_000_000), 0.75);
  close(costOf({ inputPer1M: 2, outputPer1M: 8 }, 0, 0), 0);
});

test("priceFor prefers an exact match, then a case-insensitive one, then the default", () => {
  const config = configWith({ "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 } });

  assert.deepEqual(priceFor(config, "gpt-4o-mini"), { inputPer1M: 0.15, outputPer1M: 0.6 });
  assert.deepEqual(priceFor(config, "GPT-4O-MINI"), { inputPer1M: 0.15, outputPer1M: 0.6 });
  assert.deepEqual(priceFor(config, "something-else"), { inputPer1M: 10, outputPer1M: 30 });
});

test("maxOutputTokensAffordable floors to whole tokens and handles the edges", () => {
  assert.equal(maxOutputTokensAffordable({ inputPer1M: 1, outputPer1M: 3 }, 0.001), 333);
  assert.equal(maxOutputTokensAffordable({ inputPer1M: 1, outputPer1M: 3 }, 0), 0);
  assert.equal(maxOutputTokensAffordable({ inputPer1M: 1, outputPer1M: 3 }, -1), 0);
  assert.equal(maxOutputTokensAffordable({ inputPer1M: 1, outputPer1M: 3 }, Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
  assert.equal(maxOutputTokensAffordable({ inputPer1M: 1, outputPer1M: 0 }, 0.5), Number.POSITIVE_INFINITY);
});

test("formatUsd keeps small values readable and names an unbounded budget", () => {
  assert.equal(formatUsd(0.0025), "$0.002500");
  assert.equal(formatUsd(0), "$0.000000");
  assert.equal(formatUsd(Number.POSITIVE_INFINITY), "unlimited");
});
