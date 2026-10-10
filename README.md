# TokenFence

**A budget guardian for LLM calls.** TokenFence is a proxy you run in front of a
provider. Every call that passes through it is priced and written to a local
ledger, and a key that has spent its budget gets a `429` instead of a surprise
invoice. It speaks both OpenAI's `chat/completions` dialect and Anthropic's
`messages` dialect, so one binary guards GPT and Claude traffic.

Nothing about your traffic is stored anywhere but your own disk: no account, no
telemetry, no hosted component in this version.

```
$ OPENAI_API_KEY=sk-... tokenfence serve --config tokenfence.config.json
tokenfence 0.1.0 listening on http://127.0.0.1:8787
  upstream    https://api.openai.com/v1  (openai, key from OPENAI_API_KEY)
  ledger      ./tokenfence-usage.json
  keys        ci ($2/day, $20/month), local ($0.5/day)
  guardrails  max_tokens pre-flight on
```

Point your app at `http://127.0.0.1:8787/v1` instead of the provider, and use one
of the configured keys as the bearer token.

## The problem it solves

A retry loop, a bad `while` condition, or an eval harness left running overnight
all look the same from the provider's side: a lot of completed requests and a
bill that arrives later. Provider dashboards show you the damage; they do not
stop it. TokenFence sits in the request path, so the *next* call is refused once
the budget is gone.

## What it actually does

| Behaviour | Detail |
| --- | --- |
| Per-key budgets | Each key carries an optional daily and monthly ceiling in USD. Whichever runs out first binds. |
| Refuse instead of warn | Over budget → `429 budget_exhausted`, and the call is never forwarded. |
| Pre-flight on `max_tokens` | If the remaining budget cannot cover the `max_tokens` the request asked for, it is refused **before** anything is spent. |
| Two dialects | `upstream.flavor` picks OpenAI `chat/completions` or Anthropic `messages`. Each dialect carries its own route, auth header and usage fields, so one code path guards both. |
| Prices the call | Reads the provider's own counts — `usage.prompt_tokens` / `usage.completion_tokens` on OpenAI, `usage.input_tokens` / `usage.output_tokens` on Anthropic — and prices them from your table. An unlisted model falls back to `defaultPrice` rather than being metered as free. |
| Counts Anthropic cache tokens | Anthropic reports cache writes and reads outside `input_tokens`. They are added to the prompt total and surfaced as `x-tokenfence-cache-tokens`, so a cached call is not recorded as nearly free. |
| Refuses to stream | A streamed response cannot be metered, so `"stream": true` is rejected rather than allowed to spend invisibly. |
| Honest about gaps | If the provider reports no usage, the call is recorded at zero cost **and** the response carries `x-tokenfence-usage: unavailable`. |
| Local ledger | Append-only JSON, written atomically (temp file + rename) so a crash cannot leave a half-file that under-counts spend. |
| Fails closed | A ledger that cannot be parsed stops the process. A budget guardian that boots on a corrupt ledger is worse than one that does not boot. |

## What a refusal looks like

Real output from a local run against a stand-in provider, with the key's daily
budget set to `$0.001` and a call that cost `$0.0025`:

```
HTTP/1.1 200 OK
x-tokenfence-cost-usd: 0.002500
x-tokenfence-prompt-tokens: 1000
x-tokenfence-completion-tokens: 500
x-tokenfence-remaining-usd: -0.001500
```

The next call on that key, before it ever reaches the provider:

```json
{"error":{"message":"key \"ci\" is out of budget (daily budget $0.001000, spent today $0.002500; monthly budget $20.000000, spent this month $0.002500). The cap resets at the next UTC day or month boundary.","type":"rate_limit_error","code":"budget_exhausted"}}
```

```
HTTP 429
```

And the ledger view, from `tokenfence report`:

```
$ tokenfence report --config tokenfence.config.json
TokenFence usage report
ledger   ./tokenfence-usage.json
as of    2026-10-08T17:23:01.670Z (UTC)

key  spent today            spent this month        requests today
---  ---------------------  ----------------------  --------------
ci   $0.002500 / $0.001000  $0.002500 / $20.000000  1

month to date across all keys: $0.002500 · 1 request(s) today
```

Budgets use **UTC** day and month boundaries so the reset is the same moment
wherever the process runs.

## Quickstart

Requires **Node 22.18+** — it runs the TypeScript sources directly, so there is
no build step. Developed and verified on Node 24.

```bash
git clone https://github.com/renisjoe/tokenfence
cd tokenfence
npm install

npm run typecheck && npm test        # 58 tests, no API key, no network
bash scripts/e2e-check.sh            # boots the CLI against a stand-in provider

cp examples/tokenfence.config.json tokenfence.config.json   # then edit it
export OPENAI_API_KEY=sk-...
npm start
```

Then drive it:

```bash
curl -sD - -o /dev/null \
  -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer tf_ci_replace_me' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

Swap `tf_ci_replace_me` for a real key before you use this anywhere. The example
keys are placeholders committed to the repo.

### Guarding Claude instead

`examples/tokenfence.anthropic.config.json` is the same tool pointed at
Anthropic's Messages API, with model IDs and prices taken from Anthropic's
published pricing page. The route, the auth header and the usage fields all
change; nothing else does.

```bash
cp examples/tokenfence.anthropic.config.json tokenfence.config.json
export ANTHROPIC_API_KEY=sk-ant-...
npm start

curl -sD - -o /dev/null \
  -X POST http://127.0.0.1:8787/v1/messages \
  -H 'content-type: application/json' \
  -H 'x-tokenfence-key: tf_ci_replace_me' \
  -d '{"model":"claude-sonnet-5-5","max_tokens":256,"messages":[{"role":"user","content":"hello"}]}'
```

`max_tokens` is required by Anthropic's API, which makes the pre-flight check
meaningful on every Claude call rather than only on requests that happen to set
it.

## Configuration

```json
{
  "listen": { "host": "127.0.0.1", "port": 8787 },
  "upstream": {
    "flavor": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "timeoutMs": 60000
  },
  "keys": [
    { "name": "ci", "key": "tf_ci_...", "dailyUsdBudget": 2, "monthlyUsdBudget": 20 },
    { "name": "local", "key": "tf_local_...", "dailyUsdBudget": 0.5 }
  ],
  "models": {
    "gpt-4o-mini": { "inputPer1M": 0.15, "outputPer1M": 0.6 },
    "gpt-4o": { "inputPer1M": 2.5, "outputPer1M": 10 }
  },
  "defaultPrice": { "inputPer1M": 1, "outputPer1M": 3 },
  "enforce": { "preflightMaxTokens": true },
  "usageFile": "tokenfence-usage.json"
}
```

| Field | Meaning |
| --- | --- |
| `upstream.flavor` | `"openai"` (default) or `"anthropic"`. Decides which route this instance serves, how the call is authenticated, and which fields carry the token counts. |
| `upstream.baseUrl` | Base URL of the provider API. The dialect's path — `/chat/completions` or `/messages` — is appended. |
| `upstream.anthropicVersion` | Sent as the `anthropic-version` header; defaults to `2023-06-01`. Rejected on a non-Anthropic upstream. |
| `upstream.apiKeyEnv` | **The name of** the environment variable holding the real provider key. The key itself never goes in this file. |
| `keys[].dailyUsdBudget` / `monthlyUsdBudget` | Omit either for no cap on that window. |
| `models` | Prices in USD per million tokens. Set these from your provider's current pricing page. |
| `defaultPrice` | Used for any model not listed. |
| `enforce.preflightMaxTokens` | Set `false` to let requests through even when `max_tokens` exceeds the remaining budget. |
| `usageFile` | Relative paths resolve next to the config file. |
| `maxBodyBytes` | Defaults to 1 MiB; larger request bodies get a `413`. |

Config errors name the exact field — `models.gpt-4o.inputPer1M: expected a finite number`
rather than "invalid config". An unknown `upstream.flavor`, or an
`anthropicVersion` set on a non-Anthropic upstream, is rejected the same way.

Model prices change. The Claude model IDs and prices in
`examples/tokenfence.anthropic.config.json` are transcribed from Anthropic's
published pricing page **as of October 2026** — check them against it before
trusting the ledger.

## Endpoints

| Route | Purpose |
| --- | --- |
| `POST /v1/chat/completions` | Metered, budget-enforced pass-through. Served when `flavor` is `"openai"`. |
| `POST /v1/messages` | The same guardrails over Anthropic's dialect. Served when `flavor` is `"anthropic"`. |
| `GET /v1/usage` | The calling key's own spend and remaining headroom. A key can only see itself. |
| `GET /healthz` | Liveness, plus the version. |

The route belonging to the *other* dialect returns `404 wrong_dialect` naming the
configured flavor, rather than forwarding a request body shaped for a different
API and letting the provider answer with something confusing.

## How it uses LLM APIs

This is a tool *about* calling model APIs, so it is worth being precise:

- It speaks **two dialects**, forwarding the request body unmodified in both. On
  `flavor: "openai"` it posts to `{baseUrl}/chat/completions` with
  `Authorization: Bearer <key from apiKeyEnv>`; on `flavor: "anthropic"` it posts
  to `{baseUrl}/messages` with `x-api-key` and `anthropic-version`. Either way the
  provider's response body comes back unmodified. The OpenAI-compatible surface
  is what makes the first mode a drop-in across OpenAI, Groq, Together,
  Fireworks, DeepSeek, OpenRouter, a local Ollama or vLLM, or a private gateway —
  only `baseUrl` changes.
- It reads the provider's own token counts and multiplies them by the configured
  per-million prices: `usage.prompt_tokens` / `usage.completion_tokens` on OpenAI,
  `usage.input_tokens` / `usage.output_tokens` on Anthropic. Token accounting is
  the provider's, not an estimate from a local tokenizer, so the number is the
  one you were billed for.
- On Anthropic, `input_tokens` covers only the uncached prompt, so cache writes
  (`cache_creation_input_tokens`) and reads (`cache_read_input_tokens`) are added
  to the prompt total and reported separately as `x-tokenfence-cache-tokens`.
  **What is not modelled:** the cache multipliers themselves (1.25× to write,
  0.1× to read). Every token is counted, so nothing is invisible, but a
  cache-heavy workload is metered approximately rather than to the cent. Treat
  the ledger as a guardrail, not an invoice.
- It holds **no model credentials of its own**. The provider key lives in the
  environment of the TokenFence process; client keys only authorize traffic
  through the fence. A caller that leaks its TokenFence key cannot reach the
  provider directly.
- Its own test suite needs none of this: `test/support/fake-upstream.ts` stands
  in for the provider, which is why `npm test` runs with no key and no spend.

Deliberately **not** implemented: streaming (see above), and any
multi-tenant/hosted mode.

## Status

**Early stage, and being upfront about it.** One maintainer, one repository, no
releases, and no package on npm — `npx tokenfence` will not work today, so clone
it. There are no users to report because this was just built.

What is genuinely verified as of this commit: `npm run typecheck` is clean,
`npm test` passes 58 tests, and `scripts/e2e-check.sh` boots the real CLI twice —
once per dialect — against a stand-in provider, checking the whole path:
forward, meter, block, report, and refuse the other dialect's route. It exits
non-zero on any mismatch.

Deliberately not built yet, in rough priority order:

- Streaming, with usage reconciliation after the fact, so `stream: true` can be
  allowed without giving up metering.
- Prompt-cache multipliers in the price table, so cache-heavy Anthropic traffic
  is priced to the cent instead of approximately.
- A per-run cost estimate for a batch of prompts, so a job can be quoted before
  it is sent.
- Threshold warnings and a webhook when a key crosses 80% of its budget.

## License

MIT
