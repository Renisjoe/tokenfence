# Pitch

Written to be pasted, not paraphrased. Every claim below is something the code in
this repository actually does — see `README.md`, `src/`, and the 41 passing tests.

## The two-sentence pitch

> TokenFence is an open-source budget guardian for LLM applications: an
> OpenAI-compatible proxy you run in front of a provider, which prices every call
> from the token usage the provider reports, keeps the running total in a local
> ledger, and returns HTTP 429 instead of forwarding the next request once a
> key's daily or monthly dollar budget is spent.
>
> It calls model APIs over the standard OpenAI `/chat/completions` protocol — so
> the same binary fronts OpenAI, Groq, Together, Fireworks, DeepSeek, OpenRouter,
> a local Ollama or vLLM, or a private gateway by changing one base URL — holding
> no credentials of its own, reading the real `usage.prompt_tokens` and
> `usage.completion_tokens` the provider returns rather than estimating them, and
> refusing to stream at all, because a streamed response cannot be metered and
> unmetered spend is the exact failure it exists to prevent.

## One sentence, for the tightest form

> TokenFence is an open-source, self-hosted proxy for OpenAI-compatible LLM APIs
> that meters every call against a per-key dollar budget and returns 429 rather
> than let a runaway loop turn into an invoice.

## Longer form, if the form gives you room

> Prompts and retries behave like code but are billed like a metered utility, and
> a provider dashboard only tells you what you already spent. TokenFence is an
> open-source proxy that sits in the request path and enforces the ceiling:
> each API key carries optional daily and monthly budgets, every forwarded call is
> priced from the `usage` block the provider returns, and once a key is out of
> budget the next request is rejected with a 429 before it reaches the provider.
> It supports any OpenAI-compatible `/chat/completions` endpoint — OpenAI, Groq,
> Together, Fireworks, DeepSeek, OpenRouter, a local Ollama or vLLM, or a private
> gateway — and deliberately refuses `stream: true`, because a streamed response
> cannot be metered. There is no account, no telemetry, and no hosted component:
> the ledger is a JSON file next to your config, and the provider key stays in the
> TokenFence process's environment.

## If asked how it uses LLMs specifically

- **Protocol:** `POST {baseUrl}/chat/completions`, request and response bodies
  forwarded unmodified, authenticated with `Authorization: Bearer` from the
  environment variable named in `upstream.apiKeyEnv`.
- **Token accounting:** the provider's own `usage.prompt_tokens` and
  `usage.completion_tokens`, multiplied by a per-million-token price table you
  configure per model, with a `defaultPrice` fallback so an unlisted model is
  still priced.
- **Guardrail before spend:** if the remaining budget cannot cover the
  `max_tokens` a request asks for, the request is refused before it is sent.
- **Honest gaps:** a provider that reports no usage is recorded at zero cost and
  the response is flagged `x-tokenfence-usage: unavailable`, so an unmetered call
  never looks like a free one.

## Do not claim these — they are not true yet

- Streaming support. It is refused on purpose.
- Anthropic `/v1/messages`. Not implemented.
- Any hosted service, dashboard, account system, or uptime.
- Users, adoption, funding, a company, or revenue. There are none.
- A published package: `npx tokenfence` does not work, because it is not on npm.

See `docs/application-answers.md` for the same guardrail list written out as
answers to the questions an application usually asks.
