import assert from "node:assert/strict";
import { test } from "node:test";

import { completion, message } from "./support/fake-upstream.ts";
import { CLIENT_KEY, setup, UPSTREAM_KEY } from "./support/harness.ts";

const CHAT = "/v1/chat/completions";
const MESSAGES = "/v1/messages";

function close(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 1e-12;
}

test("forwards a completion, meters the reported usage, and returns the body", async () => {
  const h = await setup();
  try {
    const res = await h.post(CHAT, { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] });
    assert.equal(res.status, 200);

    const body = (await res.json()) as { usage: { prompt_tokens: number; completion_tokens: number } };
    assert.equal(body.usage.prompt_tokens, 1000);
    assert.equal(body.usage.completion_tokens, 500);

    // 1000/1e6 * $1 + 500/1e6 * $3 = $0.0025
    assert.equal(res.headers.get("x-tokenfence-cost-usd"), "0.002500");
    assert.equal(res.headers.get("x-tokenfence-prompt-tokens"), "1000");
    assert.equal(res.headers.get("x-tokenfence-completion-tokens"), "500");
    assert.equal(res.headers.get("x-tokenfence-remaining-usd"), "4.997500");
    assert.equal(res.headers.get("x-tokenfence-usage"), null);

    assert.equal(h.upstream.requests.length, 1);
    assert.equal(h.upstream.requests[0]!.path, "/v1/chat/completions");
    assert.equal(h.upstream.requests[0]!.authorization, `Bearer ${UPSTREAM_KEY}`);
    assert.deepEqual(h.upstream.requests[0]!.body, {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });

    assert.equal(h.store.entries().length, 1);
    assert.ok(close(h.store.entries()[0]!.costUsd, 0.0025));
    assert.equal(h.store.entries()[0]!.key, "dev");
  } finally {
    await h.close();
  }
});

test("rejects a request that presents no key", async () => {
  const h = await setup();
  try {
    const res = await h.post(CHAT, { model: "gpt-4o-mini" }, { authorization: "" });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "missing_key");
    assert.equal(h.upstream.requests.length, 0);
    assert.equal(h.store.entries().length, 0);
  } finally {
    await h.close();
  }
});

test("rejects an unknown key", async () => {
  const h = await setup();
  try {
    const res = await h.post(CHAT, { model: "gpt-4o-mini" }, { authorization: "Bearer not-a-real-key" });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "invalid_key");
    assert.equal(h.upstream.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("accepts the x-tokenfence-key header as well as a bearer token", async () => {
  const h = await setup();
  try {
    const res = await h.post(
      CHAT,
      { model: "gpt-4o-mini" },
      { authorization: "", "x-tokenfence-key": CLIENT_KEY },
    );
    assert.equal(res.status, 200);
  } finally {
    await h.close();
  }
});

test("lets one call through, then blocks the next once the daily budget is gone", async () => {
  const h = await setup({ keyOverrides: { dailyUsdBudget: 0.001, monthlyUsdBudget: undefined } });
  try {
    // No max_tokens, so the pre-flight cannot reject it: the call goes out and
    // costs $0.0025, which is already over the $0.001 daily cap.
    const first = await h.post(CHAT, { model: "gpt-4o-mini" });
    assert.equal(first.status, 200);
    assert.equal(h.store.entries().length, 1);

    const second = await h.post(CHAT, { model: "gpt-4o-mini" });
    assert.equal(second.status, 429);
    const body = (await second.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "budget_exhausted");
    assert.match(body.error.message, /out of budget/);

    // The blocked call never reached the provider.
    assert.equal(h.upstream.requests.length, 1);
  } finally {
    await h.close();
  }
});

test("refuses a max_tokens the remaining budget cannot cover, before spending anything", async () => {
  const h = await setup({ keyOverrides: { dailyUsdBudget: 0.001, monthlyUsdBudget: undefined } });
  try {
    // $0.001 at $3 / 1M output tokens covers 333 tokens; asking for 1000 is refused.
    const res = await h.post(CHAT, { model: "gpt-4o-mini", max_tokens: 1000 });
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "budget_exhausted");
    assert.match(body.error.message, /covers at most 333 output token/);

    assert.equal(h.upstream.requests.length, 0);
    assert.equal(h.store.entries().length, 0);
  } finally {
    await h.close();
  }
});

test("refuses a streamed request rather than let unmetered spend through", async () => {
  const h = await setup();
  try {
    const res = await h.post(CHAT, { model: "gpt-4o-mini", stream: true });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "streaming_unsupported");
    assert.equal(h.upstream.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("passes an upstream error through untouched and records nothing", async () => {
  const h = await setup({
    handler: (_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "that model does not exist", type: "invalid_request_error" } }));
    },
  });
  try {
    const res = await h.post(CHAT, { model: "gpt-4o-mini" });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.equal(body.error.message, "that model does not exist");
    assert.equal(h.store.entries().length, 0);
  } finally {
    await h.close();
  }
});

test("records zero cost and flags the response when the provider reports no usage", async () => {
  const h = await setup({
    handler: (_req, res) => {
      const payload = completion("gpt-4o-mini", 0, 0) as Record<string, unknown>;
      delete payload.usage;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    },
  });
  try {
    const res = await h.post(CHAT, { model: "gpt-4o-mini" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-tokenfence-usage"), "unavailable");
    assert.equal(res.headers.get("x-tokenfence-cost-usd"), "0.000000");
    assert.ok(close(h.store.entries()[0]!.costUsd, 0));
  } finally {
    await h.close();
  }
});

test("GET /v1/usage reports only the caller's own spend", async () => {
  const h = await setup();
  try {
    await h.post(CHAT, { model: "gpt-4o-mini" });

    const res = await h.get("/v1/usage");
    assert.equal(res.status, 200);
    const status = (await res.json()) as {
      key: string;
      spendTodayUsd: number;
      remainingUsd: number;
      requestsToday: number;
      dailyBudgetUsd: number;
    };
    assert.equal(status.key, "dev");
    assert.ok(close(status.spendTodayUsd, 0.0025));
    assert.ok(close(status.remainingUsd, 5 - 0.0025));
    assert.equal(status.requestsToday, 1);
    assert.equal(status.dailyBudgetUsd, 5);
  } finally {
    await h.close();
  }
});

test("rejects a body past maxBodyBytes", async () => {
  const h = await setup({ overrides: { maxBodyBytes: 64 } });
  try {
    const res = await h.post(CHAT, { model: "gpt-4o-mini", messages: [{ role: "user", content: "x".repeat(500) }] });
    assert.equal(res.status, 413);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "payload_too_large");
    assert.equal(h.upstream.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("returns 502 when the upstream cannot be reached", async () => {
  const h = await setup({ upstream: { baseUrl: "http://127.0.0.1:1/v1", timeoutMs: 2000 } });
  try {
    const res = await h.post(CHAT, { model: "gpt-4o-mini" });
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "upstream_unreachable");
    assert.equal(h.store.entries().length, 0);
  } finally {
    await h.close();
  }
});

test("returns 500 when the upstream key is missing from the environment", async () => {
  const h = await setup({ env: {} });
  try {
    const res = await h.post(CHAT, { model: "gpt-4o-mini" });
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "upstream_key_missing");
    assert.equal(h.upstream.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("rejects a non-JSON body and reports the health endpoint", async () => {
  const h = await setup();
  try {
    const bad = await fetch(`${h.baseUrl}${CHAT}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CLIENT_KEY}` },
      body: "definitely not json",
    });
    assert.equal(bad.status, 400);
    const body = (await bad.json()) as { error: { code: string } };
    assert.equal(body.error.code, "invalid_json");

    const health = await h.get("/healthz");
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as { ok: boolean; service: string };
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.service, "tokenfence");

    const missing = await h.get("/v1/not-a-route");
    assert.equal(missing.status, 404);
  } finally {
    await h.close();
  }
});

test("proxies an Anthropic messages call with x-api-key rather than a bearer token", async () => {
  const h = await setup({
    upstream: { flavor: "anthropic" },
    handler: (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(message("claude-sonnet-5-5", 1000, 500)));
    },
  });
  try {
    const res = await h.post(MESSAGES, {
      model: "claude-sonnet-5-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-tokenfence-cost-usd"), "0.002500");
    assert.equal(res.headers.get("x-tokenfence-prompt-tokens"), "1000");
    assert.equal(res.headers.get("x-tokenfence-completion-tokens"), "500");
    assert.equal(res.headers.get("x-tokenfence-cache-tokens"), null);

    const sent = h.upstream.requests[0]!;
    assert.equal(sent.path, "/v1/messages");
    assert.equal(sent.apiKey, UPSTREAM_KEY);
    assert.equal(sent.anthropicVersion, "2023-06-01");
    // Anthropic rejects a bearer token alongside x-api-key, so none must be sent.
    assert.equal(sent.authorization, undefined);

    assert.equal(h.store.entries().length, 1);
    assert.equal(h.store.entries()[0]!.model, "claude-sonnet-5-5");
  } finally {
    await h.close();
  }
});

test("counts Anthropic cache tokens, so a cached call is not recorded as nearly free", async () => {
  const h = await setup({
    upstream: { flavor: "anthropic" },
    handler: (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(message("claude-sonnet-5-5", 400, 100, { creation: 350, read: 1250 })));
    },
  });
  try {
    const res = await h.post(MESSAGES, { model: "claude-sonnet-5-5", max_tokens: 256 });
    assert.equal(res.status, 200);
    // 400 uncached + 350 written + 1250 read = 2000 prompt tokens.
    assert.equal(res.headers.get("x-tokenfence-prompt-tokens"), "2000");
    assert.equal(res.headers.get("x-tokenfence-completion-tokens"), "100");
    assert.equal(res.headers.get("x-tokenfence-cache-tokens"), "1600");
    // 2000/1e6 * $1 + 100/1e6 * $3 = $0.0023
    assert.equal(res.headers.get("x-tokenfence-cost-usd"), "0.002300");
  } finally {
    await h.close();
  }
});

test("flags an Anthropic response that carries no usage block", async () => {
  const h = await setup({
    upstream: { flavor: "anthropic" },
    handler: (_req, res) => {
      const payload = message("claude-sonnet-5-5", 0, 0) as Record<string, unknown>;
      delete payload.usage;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    },
  });
  try {
    const res = await h.post(MESSAGES, { model: "claude-sonnet-5-5", max_tokens: 16 });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-tokenfence-usage"), "unavailable");
    assert.equal(res.headers.get("x-tokenfence-cost-usd"), "0.000000");
  } finally {
    await h.close();
  }
});

test("applies the same budget pre-flight to an Anthropic call", async () => {
  const h = await setup({
    upstream: { flavor: "anthropic" },
    keyOverrides: { dailyUsdBudget: 0.001, monthlyUsdBudget: undefined },
  });
  try {
    // $0.001 at $3 / 1M output tokens covers 333 tokens. Anthropic requires
    // max_tokens, so this is the shape a real guarded call takes.
    const res = await h.post(MESSAGES, { model: "claude-sonnet-5-5", max_tokens: 1000 });
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "budget_exhausted");
    assert.match(body.error.message, /covers at most 333 output token/);
    assert.equal(h.upstream.requests.length, 0);
    assert.equal(h.store.entries().length, 0);
  } finally {
    await h.close();
  }
});

test("names the configured flavor when a request arrives on the other dialect's route", async () => {
  const anthropic = await setup({ upstream: { flavor: "anthropic" } });
  try {
    const res = await anthropic.post(CHAT, { model: "claude-sonnet-5-5" });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "wrong_dialect");
    assert.match(body.error.message, /serves \/v1\/messages/);
    assert.equal(anthropic.upstream.requests.length, 0);
  } finally {
    await anthropic.close();
  }

  const openai = await setup();
  try {
    const res = await openai.post(MESSAGES, { model: "gpt-4o-mini" });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "wrong_dialect");
    assert.equal(openai.upstream.requests.length, 0);
  } finally {
    await openai.close();
  }
});

test("returns errors in the shape the configured dialect's clients expect", async () => {
  const anthropic = await setup({ upstream: { flavor: "anthropic" } });
  try {
    const wrong = await anthropic.post(CHAT, { model: "claude-sonnet-5-5" });
    assert.equal(wrong.status, 404);
    const wrongBody = (await wrong.json()) as { type: string; error: { type: string; code: string } };
    assert.equal(wrongBody.type, "error");
    assert.equal(wrongBody.error.type, "not_found_error");
    assert.equal(wrongBody.error.code, "wrong_dialect");

    const unauth = await anthropic.post(MESSAGES, { model: "claude-sonnet-5-5" }, { authorization: "" });
    assert.equal(unauth.status, 401);
    const unauthBody = (await unauth.json()) as { type: string; error: { type: string } };
    assert.equal(unauthBody.type, "error");
    assert.equal(unauthBody.error.type, "authentication_error");
  } finally {
    await anthropic.close();
  }

  const openai = await setup();
  try {
    const res = await openai.post(CHAT, { model: "gpt-4o-mini" }, { authorization: "" });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { type: string }; type?: string };
    assert.equal(body.error.type, "invalid_request_error");
    // The OpenAI shape has no top-level `type`; it must not gain one.
    assert.equal(body.type, undefined);
  } finally {
    await openai.close();
  }
});
