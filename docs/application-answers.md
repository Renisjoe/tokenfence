# Application answers

Draft text for the questions these forms usually ask, written against what this
repository actually does today. The pitch itself lives in `docs/pitch.md`.

## The description

> TokenFence is an open-source budget guardian for LLM applications: a proxy you
> run in front of a provider, which prices every call from the token usage the
> provider reports, keeps the running total in a local ledger, and returns HTTP 429
> instead of forwarding the next request once a key's daily or monthly dollar
> budget is spent. It speaks both OpenAI's `/chat/completions` dialect — OpenAI,
> Groq, Together, Fireworks, DeepSeek, OpenRouter, a local Ollama or vLLM, or a
> private gateway, by changing one base URL — and Anthropic's `/v1/messages`
> dialect, holding no credentials of its own and refusing to stream, because a
> streamed response cannot be metered.

## How the project uses LLM APIs

- **Two dialects, both forwarded unmodified.** `upstream.flavor: "openai"` posts
  to `{baseUrl}/chat/completions` with `Authorization: Bearer <key>`;
  `"anthropic"` posts to `{baseUrl}/messages` with `x-api-key` and
  `anthropic-version`. The provider's response comes back unmodified either way.
  The OpenAI-compatible surface is the de-facto standard rather than one vendor's,
  so only `baseUrl` changes between those providers.
- **Real provider token counts, not estimates.** `usage.prompt_tokens` /
  `usage.completion_tokens` on OpenAI, `usage.input_tokens` /
  `usage.output_tokens` on Anthropic, multiplied by a configured
  per-million-token price table with a default for unlisted models. On Anthropic,
  cache writes and reads are added to the prompt total because they sit outside
  `input_tokens`.
- **A guardrail that runs before the call.** If the remaining budget cannot cover
  the `max_tokens` a request asks for, the request is refused before it is sent.
- **Nothing leaves the machine.** The ledger is a local JSON file; there is no
  account, no telemetry, and no hosted component. The provider key lives in the
  TokenFence process's environment, never in the config file.
- **The test suite needs no provider at all.** A local stand-in
  (`test/support/fake-upstream.ts`) answers in both dialects, so all 58 tests run
  offline with no key and no spend.

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
| Tests | 58 passing, plus an end-to-end script that boots the CLI once per dialect against a stand-in provider. |
| Hosted service | None. Self-hosted only. |

## Order of operations

The program asks for "a Claude Console account, a company email that matches your
website's domain, and a short description of what you're building". Those depend
on each other, so the sequence matters:

1. Register **tokenfence-proxy.dev** and point the website at that domain.
2. The **mailbox** exists at that domain — see `setup-domain-and-email.md`.
3. Create the **Claude Console account using the domain address**, not a personal
   one. You cannot register with an address that does not exist yet, and changing
   an account's email later is avoidable friction.
4. **Apply** from that address.

Registering the Console account early with an `@gmail.com` or `@outlook.com`
address buys nothing: the company email is a stated requirement, and it has to
match the same domain the website is served from. Both halves point at the
domain, which is why nothing here can be short-circuited before step 1.

**Which address to apply from.** Any local part satisfies the requirement,
because what gets checked is the domain, not the name before the `@`. They differ
only in what they signal:

| Address | Reads as |
| --- | --- |
| `harshit@tokenfence-proxy.dev` | The founder. Use only if this is the address you create and can access. |
| `hello@tokenfence-proxy.dev` | A general project inbox. |
| `contact@tokenfence-proxy.dev` | A business-enquiries inbox. |

Create and verify the actual mailbox before using it. Zoho's free plan may be
limited to selected data centers, offers web-only access, and supports up to
five users when it is available. Do not describe an address as live until it
can send and receive.

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
- Implying streaming support. It is documented as absent, and the refusal is a
  deliberate design decision worth stating as one.
- Implying the ledger is invoice-accurate. Anthropic's prompt-cache multipliers
  (1.25× to write, 0.1× to read) are not modelled: every token is counted, but
  cache-heavy traffic is metered approximately.
- Naming company logos as integrations. The README says "OpenAI-compatible";
  that is a protocol, not a partnership.
- Quoting the example prices in `examples/tokenfence.config.json` as current
  provider pricing. They are examples to be replaced.

If the form asks for a company name and none exists, the accurate answer is your
own name or "not incorporated".
