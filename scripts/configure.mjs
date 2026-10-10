#!/usr/bin/env node
/**
 * Point the project at a real GitHub account.
 *
 *   node scripts/configure.mjs <github-username> [domain]
 *
 * Replaces REPLACE-GITHUB-USER across the site, README and docs, and optionally
 * the default domain/contact address. The username is the only placeholder in
 * this repository, and it is deliberately the same string everywhere so this
 * script can find all of it.
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

const [username, domain] = process.argv.slice(2);

if (!username) {
  console.error("usage: node scripts/configure.mjs <github-username> [domain]");
  console.error("example: node scripts/configure.mjs shank-dev tokenfence.eu.org");
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

let changed = 0;
for (const file of walk(ROOT)) {
  const before = readFileSync(file, "utf8");
  let after = before.split(PLACEHOLDER).join(username);

  if (domain && domain !== DEFAULT_DOMAIN) {
    after = after.split(DEFAULT_DOMAIN).join(domain);
    after = after.split(DEFAULT_EMAIL).join(DEFAULT_EMAIL.replace(DEFAULT_DOMAIN, domain));
  }

  if (after !== before) {
    writeFileSync(file, after, "utf8");
    console.log(`updated ${file.slice(ROOT.length + 1)}`);
    changed += 1;
  }
}

const leftovers = walk(ROOT).filter((file) => readFileSync(file, "utf8").includes(PLACEHOLDER));

console.log(
  changed === 0
    ? `\nNothing to do — no ${PLACEHOLDER} left.`
    : `\nRewrote ${changed} file(s) for github.com/${username}.`,
);

if (domain && domain !== DEFAULT_DOMAIN) {
  console.log(`Domain set to ${domain}.`);
  console.log("Reminder: set this as the custom domain in Settings -> Pages, and point its DNS at GitHub Pages.");
}

if (leftovers.length > 0) {
  console.error(`\nStill contains ${PLACEHOLDER}:`);
  for (const file of leftovers) console.error(`  ${file.slice(ROOT.length + 1)}`);
  process.exit(1);
}

console.log("Done. Review the diff before committing.");
