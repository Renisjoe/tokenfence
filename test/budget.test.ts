import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { budgetStatus, startOfUtcDay, startOfUtcMonth } from "../src/budget.ts";
import { UsageStore } from "../src/store.ts";
import type { KeyConfig, TokenFenceConfig } from "../src/types.ts";

const NOW = new Date("2026-05-10T12:34:56.000Z");

function configWith(key: KeyConfig): TokenFenceConfig {
  return {
    listen: { host: "127.0.0.1", port: 0 },
    upstream: { baseUrl: "https://example.com/v1", apiKeyEnv: "K", timeoutMs: 1000 },
    keys: [key],
    models: {},
    defaultPrice: { inputPer1M: 1, outputPer1M: 3 },
    enforce: { preflightMaxTokens: true },
    usageFile: "/tmp/unused.json",
    maxBodyBytes: 1024,
  };
}

function storeWith(entries: Array<{ at: string; key: string; costUsd: number }>): { dir: string; store: UsageStore } {
  const dir = mkdtempSync(join(tmpdir(), "tokenfence-budget-"));
  const store = new UsageStore(join(dir, "usage.json"), () => NOW);
  for (const item of entries) {
    store.record({
      at: item.at,
      key: item.key,
      model: "gpt-4o-mini",
      promptTokens: 1000,
      completionTokens: 500,
      costUsd: item.costUsd,
    });
  }
  return { dir, store };
}

test("day and month windows are UTC", () => {
  assert.equal(startOfUtcDay(NOW).toISOString(), "2026-05-10T00:00:00.000Z");
  assert.equal(startOfUtcMonth(NOW).toISOString(), "2026-05-01T00:00:00.000Z");

  const lateUtc = new Date("2026-05-10T23:59:59.999Z");
  assert.equal(startOfUtcDay(lateUtc).toISOString(), "2026-05-10T00:00:00.000Z");

  const firstOfMonth = new Date("2026-05-01T00:00:00.000Z");
  assert.equal(startOfUtcMonth(firstOfMonth).toISOString(), "2026-05-01T00:00:00.000Z");
});

test("a key with no budgets has unlimited headroom", () => {
  const key: KeyConfig = { name: "dev", key: "k" };
  const { dir, store } = storeWith([{ at: NOW.toISOString(), key: "dev", costUsd: 42 }]);
  try {
    const status = budgetStatus(configWith(key), store, key, NOW);
    assert.equal(status.remainingUsd, Number.POSITIVE_INFINITY);
    assert.equal(status.dailyBudgetUsd, null);
    assert.equal(status.monthlyBudgetUsd, null);
    assert.ok(Math.abs(status.spendTodayUsd - 42) < 1e-12);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("subtracts today's spend from a daily budget", () => {
  const key: KeyConfig = { name: "dev", key: "k", dailyUsdBudget: 2 };
  const { dir, store } = storeWith([
    { at: NOW.toISOString(), key: "dev", costUsd: 0.5 },
    { at: "2026-05-09T23:00:00.000Z", key: "dev", costUsd: 1.5 },
  ]);
  try {
    const status = budgetStatus(configWith(key), store, key, NOW);
    assert.ok(Math.abs(status.spendTodayUsd - 0.5) < 1e-12);
    assert.ok(Math.abs(status.remainingUsd - 1.5) < 1e-12);
    assert.equal(status.requestsToday, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("subtracts the month's spend from a monthly budget across days", () => {
  const key: KeyConfig = { name: "dev", key: "k", monthlyUsdBudget: 10 };
  const { dir, store } = storeWith([
    { at: NOW.toISOString(), key: "dev", costUsd: 1 },
    { at: "2026-05-02T08:00:00.000Z", key: "dev", costUsd: 3 },
    { at: "2026-04-30T08:00:00.000Z", key: "dev", costUsd: 99 },
  ]);
  try {
    const status = budgetStatus(configWith(key), store, key, NOW);
    assert.ok(Math.abs(status.spendMonthUsd - 4) < 1e-12);
    assert.ok(Math.abs(status.remainingUsd - 6) < 1e-12);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("remaining headroom is whichever ceiling runs out first", () => {
  const key: KeyConfig = { name: "dev", key: "k", dailyUsdBudget: 5, monthlyUsdBudget: 3 };
  const { dir, store } = storeWith([{ at: NOW.toISOString(), key: "dev", costUsd: 2.5 }]);
  try {
    const status = budgetStatus(configWith(key), store, key, NOW);
    // Daily leaves 2.5; monthly leaves 0.5. The monthly cap binds.
    assert.ok(Math.abs(status.remainingUsd - 0.5) < 1e-12);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("goes negative once overspent so callers can block on it", () => {
  const key: KeyConfig = { name: "dev", key: "k", dailyUsdBudget: 0.001 };
  const { dir, store } = storeWith([{ at: NOW.toISOString(), key: "dev", costUsd: 0.0025 }]);
  try {
    const status = budgetStatus(configWith(key), store, key, NOW);
    assert.ok(status.remainingUsd < 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
