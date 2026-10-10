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
| Authoritative DNS | deSEC (free; eu.org delegates NS only, so no validated DNSSEC) | $0 |
| Repo + hosting | GitHub + GitHub Pages, publishing `site/` | $0 |
| Mailbox | Zoho Mail Forever Free — 5 users, 5 GB, one domain | $0 |
| HTTPS | GitHub-managed certificate for the custom domain | $0 |

---

## Step 0 — A non-Gmail address to register with
eu.org will not accept a Gmail address as its contact, and its own form says so
in as many words:

> *"gmail.com refuses contact validation emails from EU.org as 'spam'. There is
> nothing we can do about this. Don't use Gmail addresses here, you will not be
> able to valide your contact."*

An unvalidated contact cannot request a domain, so this comes before everything
else. Gmail is the **only** provider eu.org flags — the form names no other, so
Outlook, Yahoo, Proton, iCloud and Zoho are all fine.

Neither of your obvious options can fill this role:

- Your **custom-domain mailbox** needs the domain approved first — that is the
  loop this step exists to break.
- **Cloudflare has no mailbox product.** Email Routing only forwards into an
  inbox you already have, and it will not host a `eu.org` zone either.

Create a free **personal** Zoho account instead — no domain required:

- <https://mail.zoho.com/signup> → choose **personal**, not business
- You get `yourname@zohomail.com`, or a regional variant (`.in`, `.eu`)
  depending on where you sign up from
- **A mobile number is required** for personal signup
- India, the EU and the US are all covered by Zoho's Forever Free plan, which is
  what step 4 depends on

Use it as the eu.org contact. It is a bootstrap tool only — the address that goes
on an application is `hello@tokenfence.eu.org`, created in step 4.

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
- **Direct registrations get NS records only.** The direct-eu.org policy states
  that only domain delegation is provided, so *every* MX, TXT and CNAME record
  for Zoho and GitHub lives at the nameserver you supply. That is what makes
  step 2 mandatory rather than optional.

Then:

1. Create the contact at <https://nic.eu.org/arf/en/contact/create/> using the
   non-Gmail address from step 0. Required: name, e-mail, address lines 1 and 2,
   country, password, the *policy* tickbox. Leave *private* ticked so your
   address stays out of public WHOIS.
2. Click the validation link in the email eu.org sends. Without it you cannot
   log in or request anything — and if you used Gmail, that email never arrives.
3. Request `tokenfence.eu.org` at <https://nic.eu.org/arf/>, supplying the
   nameservers from step 2. `tokenfence` is 10 characters, so it clears the
   four-character threshold for automatic registration, but the policy reserves
   the right to refuse direct names — `tokenfence.net.eu.org` is the fallback.
4. Wait for approval. **This is the unpredictable part**: it needs a human, and
   reports range from a couple of days to several months. Nothing else in this
   document is blocked on it — do steps 3 and 4 meanwhile.

**Filed:** request `20261008205443-arf-55753`. EU.org's own checker accepted it,
reporting matching `SOA` serials and `NS` replies from both `ns1.desec.io` and
`ns2.desec.org`, over IPv4 and IPv6. Approval is a human queue and nothing on
this page shortens it.

Checked against the public resolver at filing time: neither `tokenfence.eu.org`
nor `tokenfence.net.eu.org` has NS records, so both are free.

## Step 2 — DNS at deSEC

**Do this before submitting the eu.org request.** eu.org resolves and queries the
nameservers *at submission time*, so a zone that does not exist yet fails there
and then.

1. Sign up at <https://desec.io/> with an address you can actually open.
2. Create the zone for the name you asked eu.org for.
3. Set the eu.org request's nameservers to deSEC's two frontends — note that the
   second one is on `.org`, not `.io`, which is the usual typo:

   | eu.org form field | Value |
   | --- | --- |
   | `Name1` | `ns1.desec.io` |
   | `Name2` | `ns2.desec.org` |
   | `IP1`…`IP9` | **leave blank** — these are glue records only, and deSEC's nameservers are out-of-bailiwick |

4. Keep the checkbox on **server names + replies on SOA + replies on NS**, which
   is the strictest of the three and the one eu.org recommends.
5. Leave deSEC's records empty for now; steps 3 and 4 add them.
6. Set a password for the account if the welcome page asks for one. deSEC calls
   this out as its own step 0, and without it you cannot log back in to add
   records later.
7. Skip deSEC's step 2, *Enable DNSSEC*. It requires placing a `DS` record at the
   parent and eu.org publishes nameservers only, so that step does not apply
   here — it is inapplicable, not merely optional.

**Verify before submitting to eu.org.** eu.org runs its check at submission
time, so confirm for yourself that both frontends already answer:

```sh
nslookup -type=SOA tokenfence.eu.org ns1.desec.io    # expect a serial number
nslookup -type=NS  tokenfence.eu.org ns2.desec.org   # expect ns1.desec.io + ns2.desec.org
```

A zone created seconds earlier can answer `Query refused` from one anycast node
while the other answers correctly. That is replication catching up rather than a
misconfiguration, and it clears within a few minutes. Retry until both respond,
then submit. Filing during that window turns a correct setup into a rejected
request.

Notes: deSEC serves the zone before the delegation exists, which is what makes
the eu.org check pass. DNSSEC will not actually be
*validated* here — eu.org delegates nameservers only and publishes no `DS`
record, so the chain of trust stops at `eu.org`. That is harmless for a site and
mailbox, but do not claim a signed zone in the application. deSEC requires a
small dynamic-DNS-style token for API use; the web interface is enough here.
Hurricane Electric's free DNS
(<https://dns.he.net/>) is the other option and is in fact the longest-proven
pairing with eu.org — a decade-old account reports *"set up DNS using he.net and
never had any issues"*. Either host works; both let you set the arbitrary MX and
TXT records that Zoho needs, which is the reason Cloudflare was ruled out.

## Step 3 — GitHub repo and Pages

Already done — no action needed. <https://github.com/Renisjoe/tokenfence>
exists, is public, and `main` is pushed and in sync, with CI green on both
commits. The site is live at
<https://renisjoe.github.io/tokenfence/>. Come back to this step only once the
domain is registered.

Then:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   `.github/workflows/pages.yml` publishes `site/` on every push to `main`.
2. **Settings → Pages → Custom domain:** enter your eu.org name and save.
   Nothing goes in the repository. This repo publishes through a custom Actions
   workflow, and GitHub's documentation is explicit that in that mode no `CNAME`
   file is created, any existing one is **ignored**, and one is not required —
   the custom domain lives in the repository settings, not in a file. (An
   earlier revision of this runbook told you to add `site/CNAME`; that was wrong
   for this layout.)
3. At deSEC, point the name at GitHub Pages with `A` and `AAAA` records, **not**
   a `CNAME`:

   | Type | Name | Value |
   | --- | --- | --- |
   | `A` | `tokenfence.eu.org` | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
   | `AAAA` | `tokenfence.eu.org` | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` |

   Do not use a `CNAME` here, even though GitHub's docs suggest one for
   subdomains. `tokenfence.eu.org` is the **apex of your own zone**, so it
   necessarily carries `SOA` and `NS`, and step 4 puts `MX` and `SPF` at that
   same name. A `CNAME` cannot coexist with any of those records, and deSEC will
   reject it. `A`/`AAAA` are correct precisely because this name is an apex
   rather than a subdomain of someone else's zone. (An apex domain on GitHub
   Pages with `MX` on the same name is the ordinary Google Workspace setup.)
4. Wait for the certificate, then tick **Enforce HTTPS**.

Alternative host, if you would rather not use Pages: `site/` drops straight into
Cloudflare Pages, Netlify or Vercel as a static site with no build command. The
zone still does not need to be on Cloudflare. Note that the apex conflict above
applies to these hosts too — they also hand you a `CNAME` to point at, which
cannot sit alongside the `MX`/`SPF` records at `tokenfence.eu.org`. Either use
their documented `A` records, or host the site on `www.tokenfence.eu.org`,
which really is a subdomain inside the zone and is free to hold a `CNAME`.

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

## Step 6 — Point the project at your real account — already done

The GitHub username is the only placeholder this project ever has, and it is
deliberately the same string everywhere so it can be swapped in one command. It
has already been set to **renisjoe**: all five references (four in
`site/index.html`, one in `README.md`) read `github.com/renisjoe/tokenfence`.

Run it again only to move onto a different account or domain:

```bash
node scripts/configure.mjs <github-username> [domain]
```

It rewrites the GitHub links across the project, moves the default domain if you
pass one, and exits non-zero if it finds a placeholder it could not replace. The
one exception is `scripts/configure.mjs` itself, which holds the placeholder as a
constant and deliberately skips itself.

So, to move everything to a bought domain in one step:

```bash
node scripts/configure.mjs renisjoe tokenfence.dev
```

---

## If eu.org takes too long

Do not let the application sit behind a volunteer queue. Buy
`tokenfence.dev` (about $5–10/year at Porkbun or Namecheap) and drop eu.org
entirely — with a bought domain you use the registrar's DNS, Cloudflare Email
Routing *does* become available for forwarding, and Zoho works the same way.

Switching is one command rather than a manual sweep — it rewrites every domain
and `mailto:` reference in the project together, so they cannot drift apart:

```bash
node scripts/configure.mjs renisjoe tokenfence.dev
```

Commit the result, and remember to change the custom domain in GitHub's Pages
settings to match.

A `.dev` also simply looks more like a product than a `eu.org` name, which is
worth something on an application — which is presumably why the plan you were
following recommended it.

---

## What is verified here, and what is not

**Verified in this repository:** the tool runs, `npm run typecheck` is clean, 41
tests pass, and `scripts/e2e-check.sh` boots the real CLI against a stand-in
provider and asserts forward → meter → block → report. The landing page is a
single static file with no external requests, so it cannot break on a CDN, and
it was rendered and measured rather than assumed — zero horizontal overflow, with
the header responsive down to a 330px viewport. Nothing outside the repository —
the domain, the DNS, the deploy, the mailbox — has been exercised at all.

**Not verified — it needs your accounts, and I cannot create them:** the eu.org
registration and its approval, the deSEC zone, the GitHub Pages deploy, the
custom-domain DNS record, the Zoho mailbox and its mail records, and Zoho's
current availability in your region. Treat each step as yours to check rather
than assuming it worked, and do step 5 before the address appears on anything.
