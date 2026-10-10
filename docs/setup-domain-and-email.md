# TokenFence website, domain and email setup

Current target: **InfinityFree for the static landing page**, **tokenfence-proxy.dev** for the eventual custom domain, and Zoho Mail for a domain mailbox if its free plan is available for the account's data center. The live free staging URL is **https://tokenfence-proxy.infinityfree.me/**.

## What this setup hosts

InfinityFree will serve the static files in **site/**. It will **not** run the TokenFence Node.js proxy itself; this hosting account is only for the project's landing page and documentation.

The repository includes a guarded GitHub Actions workflow at **.github/workflows/infinityfree.yml**. It uploads **site/** to **/htdocs/** over explicit FTPS on port 21. While this migration is staged, it accepts pushes to **main** and **codex/infinityfree-zoho-migration**. Remove the temporary branch entry after the migration branch is merged. The job stays skipped until the repository variable **INFINITYFREE_DEPLOY_ENABLED** is set to **true**.

## Important DNS correction

Keep the domain's DNS on the registrar or another DNS provider with full record support, such as Cloudflare. Do not move the domain to InfinityFree's free nameservers for this setup: InfinityFree's free DNS panel does not support arbitrary TXT records needed for Zoho verification and DKIM. You can host the website on InfinityFree while leaving authoritative DNS elsewhere.

The .dev TLD is preloaded for HSTS, so browsers require HTTPS. The live InfinityFree subdomain already has automatic HTTPS. When **tokenfence-proxy.dev** is registered and attached to hosting, issue and install its custom-domain SSL certificate before relying on the .dev URL.

## 1. Register the domain and create hosting

1. Register **tokenfence-proxy.dev** with a registrar. The name has been selected, but it is not registered yet; ownership must be completed at the registrar before DNS or email can be activated.
2. Create an InfinityFree account and create a hosting account using one of InfinityFree's free subdomains. InfinityFree requires an existing hosting account before a custom domain can be attached through CNAME verification.
3. In the hosting account's Domains page, choose **Add Domain → Custom Domain** and enter **tokenfence-proxy.dev**.
4. If the panel says the domain cannot be verified, copy the exact CNAME hostname and target that it displays. Add that record at the domain's current DNS provider, wait for it to resolve, then retry adding the domain.
5. After InfinityFree accepts the domain, find the account's **Website IP** in the account details. Keep that value for the next step.

Use the exact record values shown by InfinityFree. Its verification CNAME is generated for the account and is not a fixed value.

## 2. Point the website DNS at InfinityFree

At the domain's authoritative DNS provider, add:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | The Website IP shown in InfinityFree |
| CNAME | www | tokenfence-proxy.dev |

Remove conflicting A, AAAA, or CNAME records for @ and www. Keep unrelated TXT and MX records; those are used by email and certificate verification.

In the InfinityFree client area, use its SSL Certificates tool to request a certificate for the domain. Add the exact DNS challenge records it provides, wait for validation, then install the certificate in the hosting control panel. Do not turn on a DNS proxy until the site certificate is installed and the direct DNS setup works.

## 3. Add the FTP deployment credentials to GitHub

In the InfinityFree client area, open the hosting account and copy its exact FTP server, username, and password from **FTP Details**. Use the host shown for that account; do not assume the server value from another account.

In **Renisjoe/tokenfence** on GitHub, open **Settings → Secrets and variables → Actions** and create these repository secrets:

- **FTP_SERVER**
- **FTP_USERNAME**
- **FTP_PASSWORD**

Then create the repository variable **INFINITYFREE_DEPLOY_ENABLED** with value **true**. Add the secrets before enabling the variable.

The workflow publishes only **site/**, not the source code, test fixtures, or development files. It uses FTPS on port 21 and uploads to **/htdocs/**. Keep these credentials in GitHub Secrets; never commit them or paste them into the repository.

## 4. Set up Zoho Mail

1. Sign up for Zoho Mail and add **tokenfence-proxy.dev** in the Admin Console.
2. Choose a plan only after checking the account's data center. Zoho's free plan currently allows one domain and up to five users with 5 GB per user, but it is web-only and is offered only in selected data centers. Do not continue into a paid checkout if the free plan is unavailable.
3. Verify domain ownership with the TXT or CNAME value Zoho displays. Add it at the same authoritative DNS provider used above, then verify it in Zoho.
4. Replace any existing MX records with the exact MX hostnames and priorities shown in this Zoho organization. Zoho's values can vary by data center; do not copy a generic US value into an India or EU organization.
5. Add the SPF record shown by Zoho. Keep one SPF record total for the domain.
6. Add and enable Zoho's DKIM record. Add a DMARC TXT record at **_dmarc** (start with **v=DMARC1; p=none** while checking mail flow).
7. Create the mailbox you plan to publish, for example **hello@tokenfence-proxy.dev**.

Do not add Zoho TXT or MX records in the InfinityFree control panel. They belong at the domain's authoritative DNS provider.

## 5. Verify before publishing the address

- Confirm Zoho marks the domain, MX, SPF and DKIM records as verified.
- Send a message from an unrelated inbox to the new mailbox and confirm it arrives.
- Send a message from the custom mailbox to an unrelated inbox and reply to it.
- Check a received message's headers for SPF, DKIM and DMARC pass results.
- Only after those checks pass, update the landing page footer to show the verified mailbox and change its canonical and Open Graph URLs to the domain.

## Current transition status

- Netlify auto-publishing is locked and its GitHub repository connection has been removed. Its last published preview may still be reachable, but new GitHub pushes will not build or publish there.
- GitHub Pages remains configured as the existing fallback until InfinityFree and the custom domain are verified.
- The InfinityFree staging account is active; its FTP secrets and deploy-enable variable are configured in GitHub, and the staging page is live over HTTPS. The deployment includes an `.htaccess` rule to redirect HTTP requests to HTTPS.
- The migration branch's latest deployment succeeded. The `.dev` domain **tokenfence-proxy.dev** is not registered yet, so it has no active DNS records and no matching email address can be created.
- No business email is published on the landing page. Do not publish a Gmail or Outlook address as a substitute. Once a domain is owned, Cloudflare Email Routing can forward incoming mail for free; it does not provide outbound sending to arbitrary recipients on the free plan. Zoho Mail's free plan supports up to five users and one domain with web access in selected data centers, so confirm availability before choosing it.

## References

- [InfinityFree: add a custom domain with CNAME verification](https://forum.infinityfree.com/t/how-to-add-your-domain-with-cname-verification/87420)
- [InfinityFree: point a domain to its hosting from external nameservers](https://forum.infinityfree.com/t/how-to-point-your-domain-to-infinityfree-from-other-nameservers/97235)
- [InfinityFree: free hosting TXT record limits](https://forum.infinityfree.com/t/how-create-txt-record/25910)
- [InfinityFree: free SSL for custom domains](https://forum.infinityfree.com/t/how-to-get-free-ssl-https-on-infinityfree/49323)
- [Google Registry: .dev requires HTTPS](https://www.registry.google/domains/dev/)
- [Zoho Mail subscription details](https://www.zoho.com/mail/help/adminconsole/subscription.html)
- [FTP Deploy Action documentation](https://github.com/SamKirkland/FTP-Deploy-Action)
