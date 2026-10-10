import assert from "node:assert/strict";
import { test } from "node:test";

import { DIALECTS, foreignRoutes } from "../src/dialect.ts";
import type { UpstreamConfig } from "../src/types.ts";
import { completion, message } from "./support/fake-upstream.ts";

function upstream(flavor: UpstreamConfig["flavor"]): UpstreamConfig {
  return {
    flavor,
    baseUrl: "https://example.com/v1",
    apiKeyEnv: "K",
    timeoutMs: 1000,
    anthropicVersion: "2023-06-01",
  };
}

test("openai reads prompt_tokens and completion_tokens", () => {
  const usage = DIALECTS.openai.reportedUsage(completion("gpt-4o-mini", 1200, 300));
  assert.deepEqual(usage, { promptTokens: 1200, completionTokens: 300, cacheTokens: 0, reported: true });
});

test("anthropic reads input_tokens and output_tokens from a different field set", () => {
  const usage = DIALECTS.anthropic.reportedUsage(message("claude-sonnet-5-5", 900, 250));
  assert.deepEqual(usage, { promptTokens: 900, completionTokens: 250, cacheTokens: 0, reported: true });
});

test("anthropic counts cache writes and reads, so a cached call is not nearly free", () => {
  const usage = DIALECTS.anthropic.reportedUsage(
    message("claude-sonnet-5-5", 400, 100, { creation: 350, read: 1250 }),
  );
  assert.equal(usage.promptTokens, 2000);
  assert.equal(usage.cacheTokens, 1600);
  assert.equal(usage.completionTokens, 100);
  assert.equal(usage.reported, true);
});

test("a response with no usage block is reported as unreported, never as free", () => {
  for (const dialect of [DIALECTS.openai, DIALECTS.anthropic]) {
    for (const payload of [{}, null, { usage: null }, { usage: "nonsense" }, "not an object"]) {
      const usage = dialect.reportedUsage(payload);
      assert.equal(usage.reported, false);
      assert.equal(usage.promptTokens, 0);
      assert.equal(usage.completionTokens, 0);
    }
  }
});

test("each dialect serves its own route and authenticates its own way", () => {
  assert.equal(DIALECTS.openai.route, "/v1/chat/completions");
  assert.equal(DIALECTS.openai.upstreamPath, "/chat/completions");
  assert.deepEqual(DIALECTS.openai.authHeaders("sk-x", upstream("openai")), {
    authorization: "Bearer sk-x",
  });

  assert.equal(DIALECTS.anthropic.route, "/v1/messages");
  assert.equal(DIALECTS.anthropic.upstreamPath, "/messages");
  assert.deepEqual(DIALECTS.anthropic.authHeaders("sk-x", upstream("anthropic")), {
    "x-api-key": "sk-x",
    "anthropic-version": "2023-06-01",
  });
});

test("foreignRoutes lists only the dialect that is not configured", () => {
  assert.deepEqual(foreignRoutes(DIALECTS.openai), ["/v1/messages"]);
  assert.deepEqual(foreignRoutes(DIALECTS.anthropic), ["/v1/chat/completions"]);
});

function errorTypeOf(body: unknown): string {
  return (body as { error: { type: string } }).error.type;
}

test("each dialect shapes its own errors so its own client can parse them", () => {
  assert.deepEqual(DIALECTS.openai.errorBody(429, "budget_exhausted", "out of budget"), {
    error: { message: "out of budget", type: "rate_limit_error", code: "budget_exhausted" },
  });
  assert.deepEqual(DIALECTS.openai.errorBody(500, "internal_error", "boom"), {
    error: { message: "boom", type: "server_error", code: "internal_error" },
  });

  // Anthropic wraps errors in a top-level type and has no "server_error".
  assert.deepEqual(DIALECTS.anthropic.errorBody(429, "budget_exhausted", "out of budget"), {
    type: "error",
    error: { type: "rate_limit_error", code: "budget_exhausted", message: "out of budget" },
  });
  assert.equal(errorTypeOf(DIALECTS.anthropic.errorBody(500, "internal_error", "boom")), "api_error");
  assert.equal(errorTypeOf(DIALECTS.anthropic.errorBody(401, "missing_key", "no key")), "authentication_error");
  assert.equal(errorTypeOf(DIALECTS.anthropic.errorBody(404, "not_found", "nope")), "not_found_error");
  assert.equal(errorTypeOf(DIALECTS.anthropic.errorBody(413, "payload_too_large", "big")), "request_too_large");
  assert.equal(errorTypeOf(DIALECTS.anthropic.errorBody(400, "invalid_json", "bad")), "invalid_request_error");
});
