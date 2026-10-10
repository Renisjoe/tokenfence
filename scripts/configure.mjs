#!/usr/bin/env node
/**
 * Point the project at a real GitHub account and, optionally, a real domain.
 *
 *   node scripts/configure.mjs <github-username> [domain]
 *
 * Replaces REPLACE-GITHUB-USER across the site, README and docs, and optionally
 * the default domain/contact address. The username is the only placeholder in
 * this repository, and it is deliberately the same string everywhere so this
 * script can find all of it — including in prose that quotes the token, so
 * write about it rather than quoting it. This script is the one file it leaves
 * untouched, because it holds the token as a constant and the leftover check
 * depends on that constant surviving.
 *
 * Once the placeholder has been substituted there is no placeholder left to
 * find, so a later move is done by reading the account the project currently
 * names out of its own links and rewriting that. Two moves are supported and
 * both have to rewrite more than one kind of string:
 *
 *   Account: github.com/<owner>, and the Pages URL <owner>.github.io/<repo>.
 *   Domain:  the default domain, the contact address built from it, and every
 *            Pages URL — which is what `canonical` and `og:url` point at while
 *            the custom domain does not resolve yet.
 *
 * The canonical case is the one that bit once: the domain moved, the canonical
 * did not, and the page went on telling crawlers its real address was a host it
 * had just been moved off. A canonical pointing at something that does not
 * answer is worse than no canonical at all, so a github.io URL that survives a
 * move is reported and the run fails rather than passing quietly.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "REPLACE-GITHUB-USER";
const DEFAULT_DOMAIN = "tokenfence.eu.org";
const DEFAULT_EMAIL = "hello@tokenfence.eu.org";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist"]);
const TEXT_EXTENSIONS = new Set([".html", ".md", ".json", ".yml", ".yaml", ".mjs", ".ts", ".txt", ""]);

/** The repository name, which is the last path segment of a GitHub Pages URL. */
const REPO = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name;

const [username, domain] = process.argv.slice(2);

if (!username) {
  console.error("usage: node scripts/configure.mjs <github-username> [domain]");
  console.error("example: node scripts/configure.mjs shank-dev tokenfence.dpdns.org");
  process.exit(2);
}

if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username)) {
  console.error(`"${username}" does not look like a GitHub username.`);
  process.exit(2);
}

/** Every text file in the repository, excluding vendored and generated trees. */
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    // Never rewrite this script: it contains the placeholder as a constant, and
    // rewriting it would replace the very string the leftover check looks for.
    if (full === SELF) continue;
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (TEXT_EXTENSIONS.has(extname(entry))) {
      found.push(full);
    }
  }
  return found;
}

const files = walk(ROOT);
const bodies = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

/** This repository's Pages URL under some account, with or without a slash. */
const repoPagesUrl = (owner) => new RegExp(`https?://${owner}\\.github\\.io/${REPO}/?`, "gi");

/** Any github.io URL at all, whoever owns it — the tripwire below. */
const ANY_GITHUB_IO = /https?:\/\/[A-Za-z0-9-]+\.github\.io\//g;

/**
 * The account the project already points at, read from its own links. Only
 * returned when every github.com link agrees, so an ambiguous tree is left
 * alone rather than guessed at.
 */
function currentOwner() {
  const seen = new Set();
  const pattern = new RegExp(`github\\.com/([A-Za-z0-9-]+)/${REPO}`, "gi");
  for (const body of bodies.values()) {
    // GitHub treats account names as case-insensitive, and a tree that spells
    // the same account two ways is one account, not an ambiguous one.
    for (const match of body.matchAll(pattern)) seen.add(match[1].toLowerCase());
  }
  return seen.size === 1 ? [...seen][0] : null;
}

const owner = currentOwner();
// GitHub account names are case-insensitive, so Renisjoe and renisjoe are the
// same account and passing either is not a move.
const movingAccount = Boolean(owner) && owner !== username.toLowerCase();
const movingDomain = Boolean(domain) && domain !== DEFAULT_DOMAIN;

let changed = 0;
for (const [file, before] of bodies) {
  let after = before.split(PLACEHOLDER).join(username);

  if (movingAccount) {
    after = after.replace(
      new RegExp(`github\\.com/${owner}/${REPO}`, "gi"),
      `github.com/${username}/${REPO}`,
    );
    // Without a new domain, the Pages URL follows the account.
    after = after.replace(
      repoPagesUrl(owner),
      movingDomain ? `https://${domain}/` : `https://${username}.github.io/${REPO}/`,
    );
  }

  if (movingDomain) {
    after = after.replace(repoPagesUrl("[A-Za-z0-9-]+"), `https://${domain}/`);
    after = after.split(DEFAULT_DOMAIN).join(domain);
    after = after.split(DEFAULT_EMAIL).join(DEFAULT_EMAIL.replace(DEFAULT_DOMAIN, domain));
  }

  if (after !== before) {
    writeFileSync(file, after, "utf8");
    console.log(`updated ${file.slice(ROOT.length + 1)}`);
    changed += 1;
  }
}

const leftovers = files.filter((file) => readFileSync(file, "utf8").includes(PLACEHOLDER));
// Only a domain move should empty the tree of github.io URLs. An account move
// leaves the Pages URL in place under the new account, which is correct.
const staleGithubIo = movingDomain
  ? files.filter((file) => new RegExp(ANY_GITHUB_IO.source).test(readFileSync(file, "utf8")))
  : [];

console.log(
  changed === 0
    ? `\nNothing to do — no ${PLACEHOLDER} left.`
    : `\nRewrote ${changed} file(s) for github.com/${username}.`,
);

if (movingAccount) console.log(`Account moved from ${owner} to ${username}.`);
if (movingDomain) {
  console.log(`Domain set to ${domain}.`);
  console.log("Reminder: set this as the custom domain in Settings -> Pages, and point its DNS at GitHub Pages.");
}

let failed = false;

if (leftovers.length > 0) {
  console.error(`\nStill contains ${PLACEHOLDER}:`);
  for (const file of leftovers) console.error(`  ${file.slice(ROOT.length + 1)}`);
  failed = true;
}

if (staleGithubIo.length > 0) {
  console.error("\nStill names a github.io URL after a move. If any of these is this page's");
  console.error("own canonical or og:url, it now points at a host you just moved off:");
  for (const file of staleGithubIo) console.error(`  ${file.slice(ROOT.length + 1)}`);
  failed = true;
}

if (failed) process.exit(1);

console.log("Done. Review the diff before committing.");
