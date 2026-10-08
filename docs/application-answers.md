# Application answers

Draft text for the questions these forms usually ask, written against what this
repository actually does today. The pitch itself lives in `docs/pitch.md`.

## The description

> TokenFence is an open-source budget guardian for LLM applications: an
> OpenAI-compatible proxy you run in front of a provider, which prices every call
> from the token usage the provider reports, keeps the running total in a local
> ledger, and returns HTTP 429 instead of forwarding the next request once a key's
> daily or monthly dollar budget is spent. It calls any OpenAI-compatible
> `/chat/completions` endpoint — OpenAI, Groq, Together, Fireworks, DeepSeek,
> OpenRouter, a local Ollama or vLLM, or a private gateway — holding no
> credentials of its own and refusing to stream, because a streamed response
> cannot be metered.

## How the project uses LLM APIs

- **OpenAI chat-completions in both directions.** The request body is forwarded
  unmodified to `{baseUrl}/chat/completions` with `Authorization: Bearer <key>`,
  and the provider's response is returned unmodified. Because the surface is the
  de-facto standard rather than one vendor's, only `baseUrl` changes between
  providers.
- **Real provider token counts, not estimates.** `usage.prompt_tokens` and
  `usage.completion_tokens` from the response are multiplied by a configured
  per-million-token price table, with a default for unlisted models.
- **A guardrail that runs before the call.** If the remaining budget cannot cover
  the `max_tokens` a request asks for, the request is refused before it is sent.
- **Nothing leaves the machine.** The ledger is a local JSON file; there is no
  account, no telemetry, and no hosted component. The provider key lives in the
  TokenFence process's environment, never in the config file.
- **The test suite needs no provider at all.** A local stand-in
  (`test/support/fake-upstream.ts`) means all 41 tests run offline with no key and
  no spend.

## What credits would be used for

1. Running the proxy in front of real providers to calibrate the price table
   against actual invoices — the table ships with example prices and should be
   verified against current published rates per model.
2. Differential testing across providers: the same request shape against
   OpenAI, Groq, Together, Fireworks and DeepSeek, to find where token accounting
   and error shapes diverge from the OpenAI reference, since the whole premise is
   "drop-in across compatible endpoints" and that claim should be tested rather
   than assumed.
3. Building the streaming path, which is the largest piece of real model traffic:
   usage arrives differently or not at all in a stream, so it needs probing
   against live endpoints to design reconciliation correctly.

None of these require frontier-model spend; they need ordinary calls against
several providers, plus the error and edge cases that only a real endpoint
produces.

## Current stage — answer these plainly

| Question | Honest answer |
| --- | --- |
| Users / installs | None yet. Not announced. |
| Funding | None. Self-funded, no company formed. |
| Team | One maintainer. |
| Revenue | None. MIT, no paid tier. |
| Published package | No. Not on npm; it runs from a clone. |
| Traction / metrics | None to report. |
| Tests | 41 passing, plus an end-to-end script that boots the CLI against a stand-in provider. |
| Hosted service | None. Self-hosted only. |

## Guardrails — do not inflate these

The application will be read by someone who can check. Claiming users, a
company, or a hosted product gets an application rejected and can get an account
closed later. This is a real, working, tested tool; that is a good thing to apply
with and it does not need decorating.

Concretely, avoid:

- "Our users…" / "teams rely on…" — there are no users.
- "We" when it is one person. Say "I" or "the project".
- Implying a hosted product or a dashboard exists. There is a static landing page
  and a CLI.
- Implying npm distribution. `npx tokenfence` does not work today.
- Implying streaming or Anthropic support. Both are documented as absent, and the
  streaming refusal is a deliberate design decision worth stating as one.
- Naming company logos as integrations. The README says "OpenAI-compatible";
  that is a protocol, not a partnership.
- Quoting the example prices in `examples/tokenfence.config.json` as current
  provider pricing. They are examples to be replaced.

If the form asks for a company name and none exists, the accurate answer is your
own name or "not incorporated".
