# Domain, DNS, hosting and email

The goal: a real domain pointing at the landing page, and a real mailbox on that
domain so an application is not sent from a consumer address.

**The domain does not have to be `eu.org`.** Nothing after step 2 depends on
where it came from — `NS` records, `A` records, `MX` and `TXT` are the same
records whatever the name looks like. Pick a source, then continue at step 2:

| Where the domain comes from | Cost | Time | Step |
| --- | --- | --- | --- |
| Bought at cost — Vercel, Cloudflare Registrar, Porkbun | ~$5–10/year | minutes | [1A](#step-1a--buy-it-and-stop-waiting) |
| DigitalPlat FreeDomain — `.dpdns.org`, `.us.kg`, `.qzz.io`, `.xx.kg`, `.qd.je` | $0 | minutes | [1B](#step-1b--digitalplat-freedomain-free-and-today) |
| `name.eu.org` at nic.eu.org | $0 | days to months, decided by a volunteer | [1C](#step-1c--euorg-free-and-queued) |

Whichever you pick, read **Before you start** first: one of the two traps there
applies to every source, the other only to eu.org.

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

**2. Cloudflare will not host a `eu.org` name as a DNS zone.** A `eu.org` name
is a *subdomain* of the `eu.org` zone, and Cloudflare rejects subdomain zones
under `eu.org`. This matters because Email Routing lives inside Cloudflare DNS —
so the usual "point nameservers at Cloudflare" advice does not apply there. Use
**deSEC** (step 2) instead: free, run by a German non-profit, and it accepts
`eu.org` domains.

A *bought* domain is a different case — you own the apex, so Cloudflare accepts
it as a zone and Cloudflare Email Routing becomes available (still inbound only,
see above). A free subdomain from another registrar, DigitalPlat included, is in
the same position as `eu.org`: whoever owns the parent provides the nameservers,
and **this runbook uses deSEC for all of them** because it is free, it takes
arbitrary `MX` and `TXT` records, and it is the one that has been exercised here.
DigitalPlat's own tutorial reaches for Cloudflare, so Cloudflare evidently works
for some of their suffixes — treat that as unverified rather than wrong, and if
you try Cloudflare, confirm the zone is accepted before you commit to it.

Get these two straight and the rest is mechanical.

---

## What you end up with

| Piece | Choice | Cost |
| --- | --- | --- |
| Domain | any of the three sources above | $0–10/year |
| Authoritative DNS | deSEC — free; a delegated subdomain gets no validated DNSSEC | $0 |
| Repo + hosting | GitHub + GitHub Pages, publishing `site/` | $0 |
| Mailbox | Zoho Mail Forever Free — 5 users, 5 GB, one domain | $0 |
| HTTPS | GitHub-managed certificate for the custom domain | $0 |

Hosting and mailbox are the same five steps whichever name you picked.

---

## Step 0 — A non-Gmail address to register with (eu.org only)

**Skip this step for a bought domain or a DigitalPlat one** — it is a eu.org
constraint, not a general one. eu.org will not accept a Gmail address as its
contact, and its own form says so in as many words:

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

## Step 1A — Buy it and stop waiting

Five to ten dollars a year removes an unbounded human queue from the critical
path, and it is the only source where you own the apex name.

Vercel's own pricing page is explicit that it sells registrations at wholesale:
*"We sell domains at the wholesale price set by each registry for registration,
renewal, and transfer. The price we pay is the price you pay."* Netlify sells
domains too, through a registrar partner — check the number at checkout, since
their pricing carries a markup. Cloudflare Registrar sells at cost as well.

Owning the apex also unlocks Cloudflare as a DNS host and Cloudflare Email
Routing as free inbound forwarding, though neither is required — step 2 onwards
works unchanged on deSEC.

Then continue at **Step 2**.

## Step 1B — DigitalPlat FreeDomain (free, and today)

A free subdomain under `.dpdns.org`, `.us.kg`, `.qzz.io`, `.xx.kg` or `.qd.je`,
registered through a dashboard rather than a queue. Two constraints to know
before you start:

- **One domain per account.** The limit is deliberate, aimed at abuse.
- **DigitalPlat does not host your records.** It delegates the name to
  nameservers *you* supply, so there is no `A`-record editor on their side. You
  create the deSEC zone **first**, then hand them deSEC's nameserver hostnames.

Registration asks for accurate contact data — name, a working phone number and a
postal address — so have those to hand. Steps:

1. **Create the deSEC zone first** — step 2 below, using the name you intend to
   register. It answers for a name that is not delegated yet, which is what
   makes the delegation check pass.
2. Sign up at the DigitalPlat dashboard, confirming the email they send you.
3. **Register** → enter the label (`tokenfence`) → choose the suffix → **check
   availability** → read the resulting name back in full.
4. Paste deSEC's nameservers — the hostnames, not IP addresses — and submit.
5. Read the result in **Domain List**. A pending or rejected status comes with a
   reason: an unavailable name, invalid nameservers, or an incomplete form.
6. Confirm the delegation really happened:

   ```bash
   dig NS tokenfence.dpdns.org
   ```

   The answer has to name the same servers you typed into DigitalPlat. If it is
   empty, fix the external zone before touching anything else.

Then continue at the records in **Step 2** — deSEC holds them, not DigitalPlat.

## Step 1C — eu.org (free, and queued)

Free, and the reason this document exists in its original form. It is also the
only source with no upper bound on the wait. Read the two policy pages before
filing, because they change what you can ask for:

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

**Do this before you hand the name to anyone.** Both eu.org and DigitalPlat check
the nameservers you give them, and eu.org queries them *at submission time*, so a
zone that does not exist yet fails there and then.

1. Sign up at <https://desec.io/> with an address you can actually open.
2. Create the zone for the exact name you are registering, spelled as you will
   register it.
3. Give deSEC's two frontends to whoever delegates the name — the eu.org form or
   the DigitalPlat registration form. The second is on `.org`, not `.io`, which
   is the usual typo:

   | Field | Value |
   | --- | --- |
   | `Name1` | `ns1.desec.io` |
   | `Name2` | `ns2.desec.org` |
   | `IP1`…`IP9` | **leave blank** — these are glue records only, and deSEC's nameservers are out-of-bailiwick |

4. On eu.org's form only, keep the checkbox on **server names + replies on SOA +
   replies on NS** — the strictest of the three, and the one eu.org recommends.
5. Leave deSEC's records empty for now; steps 3 and 4 add them.
6. Set a password for the account if the welcome page asks for one. deSEC calls
   this out as its own step 0, and without it you cannot log back in to add
   records later.
7. Skip deSEC's step 2, *Enable DNSSEC*. It requires placing a `DS` record at the
   parent, and a delegated subdomain gets none — eu.org publishes nameservers
   only. So that step does not apply here: inapplicable, not merely optional.
   (Own the apex, as in step 1A, and it does apply.)

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
exists, is public, and `main` is pushed and in sync. The site is live at
<https://renisjoe.github.io/tokenfence/>, and the Pages workflow has run green
on it. Come back to this step once the domain is registered.

Then:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   `.github/workflows/pages.yml` publishes `site/` on every push to `main`.
2. **Settings → Pages → Custom domain:** enter the domain you registered, and save.
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
   subdomains. The name you registered is the **apex of the zone you created at
   deSEC** — you are running that zone even when its parent belongs to someone
   else — so it necessarily carries `SOA` and `NS`, and step 4 puts `MX` and
   `SPF` at that same name. A `CNAME` cannot coexist with any of those records,
   and deSEC will reject it. `A`/`AAAA` are correct because the name is an apex,
   not a subdomain of your own zone. (An apex domain on GitHub Pages with `MX`
   on the same name is the ordinary Google Workspace setup.)
4. Wait for the certificate, then tick **Enforce HTTPS**.

Alternative host, if you would rather not use Pages: `site/` drops straight into
Cloudflare Pages, Netlify or Vercel as a static site, with no build command.
`netlify.toml` and `vercel.json` in the repository root already point those two
at `site/`, so an import needs no build settings — without them Netlify is the
problem case: it sees a `package.json`, finds no framework and no build script,
and falls back to publishing the repository root, which serves the page at
`/site/` instead of at the root. Cloudflare Pages has no equivalent file; set
its build output directory to `site` in the UI.

The zone still does not need to be on Cloudflare. Note
that the apex conflict above applies to these hosts too — they also hand you a
`CNAME` to point at, which cannot sit alongside the `MX`/`SPF` records at the
zone apex. Either use their documented `A` records, or host the site on
`www.<your-domain>`, which really is a subdomain *inside* the zone and is free
to hold a `CNAME`.

None of these hosts can register a name for you, and none of them can create one
inside a zone they do not run. Choosing a host is not a way to get the domain;
it is what you do once the domain answers.

## Step 4 — Mailbox at Zoho

This is the step that decides whether the application can be sent at all: a
`mailto:` address on a domain with no `MX` record is a hard bounce, which is
worse than no address.

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

## Step 6 — Point the project at your real account and domain

The account and the domain are the only values this project hard-codes, and they
sit in a handful of places: `site/index.html` (its `canonical`, `og:url`, header
comment and GitHub links), `README.md`, and these docs. One script moves them
together so they cannot drift apart:

```bash
node scripts/configure.mjs <github-username> [domain]
```

- **Account move** rewrites every `github.com/<owner>/tokenfence` link, and the
  Pages URL with it. GitHub treats account names as case-insensitive, so passing
  `Renisjoe` for a repo that says `renisjoe` is not a move and changes nothing.
- **Domain move** rewrites the default domain, the `mailto:` address built from
  it, *and* every Pages URL. That last one is the part that was missing once:
  `canonical` and `og:url` name the Pages URL while the custom domain does not
  resolve yet, so a domain move that skips them leaves the page telling crawlers
  its real address is a host it was just moved off.
- It **exits non-zero** if the GitHub-username placeholder could not be
  replaced everywhere, or if a `github.io` URL is still present after a domain
  move. Read that failure rather than ignoring it: it is either the page's own
  canonical (fix it) or a link to somebody else's project (leave it, and the run
  will keep warning you).

The placeholder is substituted in **every** file the script walks, so anything
that spells the token out verbatim — this page included — has that spelling
replaced with the account name. Write about the token; do not quote it. The
script is its own one exception, because it holds the token as a constant and
skipping itself is the only way the leftover check can still work.

So the whole switch is two commands — the script, then a commit:

```bash
node scripts/configure.mjs <your-username> <your-domain>
git commit -am "Point the project at <your-domain>"
```

Then set the same name under **Settings → Pages → Custom domain** and tick
**Enforce HTTPS** once the certificate is issued. Nothing about the domain goes
in a file.

---

## What is verified here, and what is not

**Verified in this repository:** the tool runs, `npm run typecheck` is clean, 58
tests pass, and `scripts/e2e-check.sh` boots the real CLI once per dialect
against a stand-in provider and asserts forward → meter → block → report,
including refusal of the other dialect's route. The landing page is a single
static file with no external requests, so it cannot break on a CDN, and it was
rendered and measured rather than assumed — zero horizontal overflow, with the
header responsive down to a 330px viewport. The Pages deploy is live and its
workflow run went green on the commit that published the current page.

**Not verified — it needs your accounts, and I cannot create them:** the
registration itself (eu.org's approval, DigitalPlat's dashboard, or a purchase),
the deSEC zone, the custom-domain DNS records and its certificate, the Zoho
mailbox and its mail records, and Zoho's current availability in your region.
Nothing about a custom domain has been exercised, because no name is delegated
yet: there is no zone, no certificate, and no mailbox. Treat each step as yours
to check, and do step 5 before the address appears on anything.
