# Pitch

Written to be pasted, not paraphrased. Every claim below is something the code in
this repository actually does — see `README.md`, `src/`, and the 58 passing tests.

## The two-sentence pitch

> TokenFence is an open-source budget guardian for LLM applications: a proxy you
> run in front of a provider, which prices every call from the token usage the
> provider reports, keeps the running total in a local ledger, and returns HTTP 429
> instead of forwarding the next request once a key's daily or monthly dollar
> budget is spent.
>
> It speaks both OpenAI's `/chat/completions` dialect and Anthropic's
> `/v1/messages` dialect — so the same binary fronts OpenAI, Groq, Together,
> Fireworks, DeepSeek, OpenRouter, a local Ollama or vLLM, or a private gateway by
> changing one base URL, and guards Claude traffic alongside it — holding no
> credentials of its own, reading the real token counts the provider returns rather
> than estimating them, and refusing to stream at all, because a streamed response
> cannot be metered and unmetered spend is the exact failure it exists to prevent.

## One sentence, for the tightest form

> TokenFence is an open-source, self-hosted proxy for LLM APIs that meters every
> call against a per-key dollar budget and returns 429 rather than let a runaway
> loop turn into an invoice.

## Longer form, if the form gives you room

> Prompts and retries behave like code but are billed like a metered utility, and
> a provider dashboard only tells you what you already spent. TokenFence is an
> open-source proxy that sits in the request path and enforces the ceiling:
> each API key carries optional daily and monthly budgets, every forwarded call is
> priced from the `usage` block the provider returns, and once a key is out of
> budget the next request is rejected with a 429 before it reaches the provider.
> It supports any OpenAI-compatible `/chat/completions` endpoint — OpenAI, Groq,
> Together, Fireworks, DeepSeek, OpenRouter, a local Ollama or vLLM, or a private
> gateway — and Anthropic's `/v1/messages` alongside them, and deliberately
> refuses `stream: true`, because a streamed response cannot be metered. There is
> no account, no telemetry, and no hosted component:
> the ledger is a JSON file next to your config, and the provider key stays in the
> TokenFence process's environment.

## If asked how it uses LLMs specifically

- **Protocol:** two dialects, request and response bodies forwarded unmodified.
  `upstream.flavor: "openai"` posts to `{baseUrl}/chat/completions` with
  `Authorization: Bearer`; `"anthropic"` posts to `{baseUrl}/messages` with
  `x-api-key` and `anthropic-version`. The key comes from the environment variable
  named in `upstream.apiKeyEnv`, never from the config file.
- **Token accounting:** the provider's own counts — `usage.prompt_tokens` /
  `usage.completion_tokens` on OpenAI, `usage.input_tokens` / `usage.output_tokens`
  on Anthropic — multiplied by a per-million-token price table you configure per
  model, with a `defaultPrice` fallback so an unlisted model is still priced.
  Anthropic cache writes and reads sit outside `input_tokens`, so they are added
  in and surfaced as `x-tokenfence-cache-tokens`; the cache multipliers themselves
  are not modelled, which makes cache-heavy traffic approximate rather than exact.
- **Guardrail before spend:** if the remaining budget cannot cover the
  `max_tokens` a request asks for, the request is refused before it is sent.
- **Honest gaps:** a provider that reports no usage is recorded at zero cost and
  the response is flagged `x-tokenfence-usage: unavailable`, so an unmetered call
  never looks like a free one.

## Do not claim these — they are not true yet

- Streaming support. It is refused on purpose.
- Invoice-accurate numbers on cache-heavy Anthropic traffic. See above.
- Any hosted service, dashboard, account system, or uptime.
- Users, adoption, funding, a company, or revenue. There are none.
- A published package: `npx tokenfence` does not work, because it is not on npm.

See `docs/application-answers.md` for the same guardrail list written out as
answers to the questions an application usually asks.
