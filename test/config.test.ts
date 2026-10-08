import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { ConfigError, loadConfig, parseConfig } from "../src/config.ts";

const SOURCE = join(tmpdir(), "tokenfence-config", "tokenfence.config.json");

function minimal(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    upstream: { baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
    keys: [{ name: "dev", key: "tf_dev" }],
    ...extra,
  };
}

test("fills in every optional field with a safe default", () => {
  const config = parseConfig(minimal(), SOURCE);

  assert.deepEqual(config.listen, { host: "127.0.0.1", port: 8787 });
  assert.equal(config.upstream.timeoutMs, 60_000);
  assert.deepEqual(config.defaultPrice, { inputPer1M: 1, outputPer1M: 3 });
  assert.deepEqual(config.models, {});
  assert.equal(config.enforce.preflightMaxTokens, true);
  assert.equal(config.maxBodyBytes, 1024 * 1024);
  assert.equal(config.usageFile, join(dirname(SOURCE), "tokenfence-usage.json"));
});

test("resolves a relative usageFile next to the config file", () => {
  const config = parseConfig(minimal({ usageFile: "ledger.json" }), SOURCE);
  assert.equal(config.usageFile, join(dirname(SOURCE), "ledger.json"));
});

test("normalises the upstream base URL and keeps budgets off the key", () => {
  const config = parseConfig(
    minimal({
      upstream: { baseUrl: "https://api.openai.com/v1/", apiKeyEnv: "OPENAI_API_KEY" },
      keys: [{ name: "dev", key: "tf_dev", dailyUsdBudget: 2, monthlyUsdBudget: 20 }],
      models: { "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 } },
    }),
    SOURCE,
  );

  assert.equal(config.upstream.baseUrl, "https://api.openai.com/v1");
  assert.equal(config.keys[0]!.dailyUsdBudget, 2);
  assert.equal(config.keys[0]!.monthlyUsdBudget, 20);
  assert.deepEqual(config.models["gpt-4o-mini"], { inputPer1M: 0.15, outputPer1M: 0.6 });
});

test("rejects a config with no keys", () => {
  assert.throws(() => parseConfig(minimal({ keys: [] }), SOURCE), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match((error as Error).message, /keys: configure at least one key/);
    return true;
  });
});

test("rejects two keys sharing the same secret", () => {
  assert.throws(
    () =>
      parseConfig(
        minimal({
          keys: [
            { name: "a", key: "same" },
            { name: "b", key: "same" },
          ],
        }),
        SOURCE,
      ),
    /duplicate secret/,
  );
});

test("points at the offending field when a price is malformed", () => {
  assert.throws(
    () => parseConfig(minimal({ models: { "gpt-4o": { inputPer1M: "cheap" } } }), SOURCE),
    /models\.gpt-4o\.inputPer1M: expected a finite number/,
  );
  assert.throws(
    () => parseConfig(minimal({ models: { "gpt-4o": { inputPer1M: 1 } } }), SOURCE),
    /models\.gpt-4o: expected inputPer1M and outputPer1M/,
  );
});

test("rejects a non-http upstream and a missing key variable name", () => {
  assert.throws(
    () => parseConfig(minimal({ upstream: { baseUrl: "ftp://example.com", apiKeyEnv: "K" } }), SOURCE),
    /upstream\.baseUrl: expected an http\(s\) URL/,
  );
  assert.throws(
    () => parseConfig(minimal({ upstream: { baseUrl: "https://example.com/v1" } }), SOURCE),
    /upstream\.apiKeyEnv: expected a non-empty string/,
  );
});

test("rejects a negative budget", () => {
  assert.throws(
    () => parseConfig(minimal({ keys: [{ name: "dev", key: "tf_dev", dailyUsdBudget: -1 }] }), SOURCE),
    /keys\[0\]\.dailyUsdBudget: expected a number > 0/,
  );
});

test("reports invalid JSON along with the file it read", () => {
  const dir = mkdtempSync(join(tmpdir(), "tokenfence-bad-config-"));
  try {
    const file = join(dir, "tokenfence.config.json");
    writeFileSync(file, "{ not json", "utf8");
    assert.throws(() => loadConfig(file), /is not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reports a missing config file instead of throwing ENOENT at the caller", () => {
  const missing = join(tmpdir(), "tokenfence-definitely-missing", "tokenfence.config.json");
  assert.throws(() => loadConfig(missing), /could not read .*tokenfence\.config\.json/);
});
