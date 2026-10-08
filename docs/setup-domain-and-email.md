# Domain, DNS, hosting and email — the free route

The goal: a real domain pointing at the landing page, and a real mailbox on that
domain so an application is not sent from a consumer address.

Everything below is $0. It is also the slow route, and one step has an
unpredictable delay. Read **Before you start** first — two things that look
obvious do not work.

---

## Before you start: two things that do not work

**1. Cloudflare Email Routing cannot be your From address.** It is free and it is
genuinely useful, but it is **inbound only**: it receives and forwards to an
existing inbox. It cannot send. So it cannot be the address you apply from. Use
it only if you want `anything@tokenfence.eu.org` to land in a Gmail inbox you
already read; do not use it as your identity.

> Sending from a custom address requires a real mailbox. On Cloudflare that is
> the paid Workers plan. **Zoho Mail's free tier is the only free option that can
> actually send**, which is why it is step 4.

**2. Cloudflare will not host `tokenfence.eu.org` as a DNS zone.** A `eu.org`
name is a *subdomain* of the `eu.org` zone, and Cloudflare rejects subdomain
zones under `eu.org`. This matters because Email Routing lives inside Cloudflare
DNS — so the usual "point nameservers at Cloudflare" advice does not apply here.
Use **deSEC** (step 2) instead. It is free, run by a German non-profit, and
supports `eu.org` domains.

Get these two straight and the rest is mechanical.

---

## What you end up with

| Piece | Choice | Cost |
| --- | --- | --- |
| Domain | `tokenfence.eu.org` via nic.eu.org | $0 |
| Authoritative DNS | deSEC (free, DNSSEC-capable) | $0 |
| Repo + hosting | GitHub + GitHub Pages, publishing `site/` | $0 |
| Mailbox | Zoho Mail Forever Free — 5 users, 5 GB, one domain | $0 |
| HTTPS | GitHub-managed certificate for the custom domain | $0 |

---

## Step 1 — Register the domain at nic.eu.org

Read the two policy pages before filing, because they change what you can ask
for:

- <https://nic.eu.org/register.html> (the process)
- <https://nic.eu.org/opendomains.html> (what is open)

Two things to decide first:

- **Direct under `eu.org`, or a subdomain of an open domain?** The register page
  says to avoid registering directly under `EU.org` and to prefer one of its
  subdomains, because direct registrations "intentionally" carry more
  constraints. `tokenfence.net.eu.org` (`NET.eu.org`, for network-related
  projects) is the natural fallback if `tokenfence.eu.org` is refused.
- **Nameservers, before you apply.** Registration requires nameservers already
  configured for the name you are requesting. Do step 2 first, then come back.

Then:

1. Create an account at <https://nic.eu.org/> and request the domain, supplying
   the deSEC nameservers from step 2.
2. Wait for the validation email. **This is the unpredictable part**: it needs a
   human, and reports range from a couple of days to several months. Nothing else
   in this document is blocked on it — do steps 3 and 4 meanwhile.

## Step 2 — DNS at deSEC

1. Sign up at <https://desec.io/>. Free, and your zone gets DNSSEC.
2. Create the zone for the name you asked eu.org for.
3. Copy the **nameservers** it gives you and put them in the eu.org request.
4. Leave the records empty for now; steps 3 and 4 add them.

Notes: deSEC requires a small dynamic-DNS-style token for API use, but the web
interface is enough here. If deSEC is unavailable in your region, Hurricane
Electric's free DNS (<https://dns.he.net/>) is the equivalent fallback — it also
lets you set arbitrary MX and TXT records, which is what Zoho needs.

## Step 3 — GitHub repo and Pages

```bash
cd tokenfence
git init -b main
git add .
git commit -m "TokenFence: budget enforcement for OpenAI-compatible LLM calls"

# create an EMPTY repo named "tokenfence" on GitHub first, then:
git remote add origin https://github.com/YOUR-USER/tokenfence.git
git push -u origin main
```

Then:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   `.github/workflows/pages.yml` publishes `site/` on every push to `main`.
2. **Settings → Pages → Custom domain:** enter your eu.org name. GitHub writes it
   into `site/CNAME` (already committed — keep the two in sync).
3. At deSEC, add the record GitHub shows. For a subdomain such as
   `tokenfence.eu.org` that is a **`CNAME` to `YOUR-USER.github.io`** — the four
   `A` records are only for apex domains, which does not apply to a `eu.org`
   name.
4. Wait for the certificate, then tick **Enforce HTTPS**.

Alternative host, if you would rather not use Pages: `site/` drops straight into
Cloudflare Pages, Netlify or Vercel as a static site with no build command. On
Cloudflare Pages the custom domain is added as a `CNAME` to
`<project>.pages.dev` at deSEC — the zone still does not need to be on
Cloudflare.

## Step 4 — Mailbox at Zoho

1. Sign up for **Zoho Mail Forever Free** (<https://www.zoho.com/mail/>). Check
   the current plan terms at signup: it is one domain, up to 5 users, 5 GB each,
   **web and mobile only** on the free tier (no IMAP/POP), and signup has been
   limited to accounts in the US, IN and EU. If it is not offered to you, the
   honest fallback is a cheap paid mailbox or applying with an address you
   already own and saying so.
2. Add `tokenfence.eu.org` as your domain and verify ownership with the TXT
   record Zoho gives you — add it at deSEC.
3. Add the mail records Zoho lists: **MX** for receiving, plus **SPF** and
   **DKIM** TXT records for sending. Add DMARC too (`v=DMARC1; p=none;` is enough
   to start) — a domain address that fails DMARC looks worse than a Gmail one.
4. Create `hello@tokenfence.eu.org` (and `you@...` if you want a personal one).

## Step 5 — Make it real before you rely on it

Three checks, in this order. Each one catches a different failure:

1. **Receive.** Send a message *from* an unrelated account *to*
   `hello@tokenfence.eu.org`. It must arrive in Zoho.
2. **Send.** Send from `hello@tokenfence.eu.org` to that unrelated account, and
   **reply** to it. Watch that the reply lands and does not bounce.
3. **Authenticate.** Send to a Gmail address and open *Show original*. You want
   `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. If any says FAIL, fix the records
   before you use this address on an application — mail that lands in spam is
   indistinguishable from a dead project.

## Step 6 — Point the project at your real account

The GitHub username is the only placeholder left in this project, and it is
deliberately the same string everywhere so it can be swapped in one command:

```bash
node scripts/configure.mjs YOUR-GITHUB-USERNAME
```

That rewrites the GitHub links in `site/index.html`, `README.md` and this file,
and exits non-zero if it finds one it could not replace. Pass a domain as a
second argument to move everything off the default domain at the same time:

```bash
node scripts/configure.mjs YOUR-GITHUB-USERNAME tokenfence.dev
```

---

## If eu.org takes too long

Do not let the application sit behind a volunteer queue. Buy
`tokenfence.dev` (about $5–10/year at Porkbun or Namecheap) and drop eu.org
entirely — with a bought domain you use the registrar's DNS, Cloudflare Email
Routing *does* become available for forwarding, and Zoho works the same way.
Change two things if you switch:

1. `site/CNAME` → `tokenfence.dev`
2. the domain and `mailto:` in `site/index.html`

A `.dev` also simply looks more like a product than a `eu.org` name, which is
worth something on an application — which is presumably why the plan you were
following recommended it.

---

## What is verified here, and what is not

**Verified in this repository:** the tool runs, `npm run typecheck` is clean, 41
tests pass, and `scripts/e2e-check.sh` boots the real CLI against a stand-in
provider and asserts forward → meter → block → report. The landing page is a
single static file with no external requests, so it cannot break on a CDN.

**Not verified — it needs your accounts, and I cannot create them:** the eu.org
registration and its approval, the deSEC zone, the GitHub Pages deploy, the
custom-domain DNS record, the Zoho mailbox and its mail records, and Zoho's
current availability in your region. Treat each step as yours to check rather
than assuming it worked, and do step 5 before the address appears on anything.
