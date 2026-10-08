import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { UsageEntry } from "./types.ts";

const LEDGER_VERSION = 1;
const RETAIN_DAYS = 120;

interface Ledger {
  version: number;
  entries: UsageEntry[];
}

/** Raised when the ledger on disk cannot be trusted. Budgets fail closed. */
export class UsageLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageLedgerError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(value: unknown, index: number): UsageEntry {
  const where = `${index}`;
  if (!isRecord(value)) throw new UsageLedgerError(`entry ${where} is not an object`);
  const { at, key, model, promptTokens, completionTokens, costUsd } = value;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
    throw new UsageLedgerError(`entry ${where} has an unusable "at" timestamp`);
  }
  if (typeof key !== "string" || typeof model !== "string") {
    throw new UsageLedgerError(`entry ${where} is missing "key" or "model"`);
  }
  for (const [name, field] of [
    ["promptTokens", promptTokens],
    ["completionTokens", completionTokens],
    ["costUsd", costUsd],
  ] as const) {
    if (typeof field !== "number" || !Number.isFinite(field)) {
      throw new UsageLedgerError(`entry ${where} has a non-numeric "${name}"`);
    }
  }
  return {
    at,
    key,
    model,
    promptTokens: promptTokens as number,
    completionTokens: completionTokens as number,
    costUsd: costUsd as number,
  };
}

function loadLedger(file: string): UsageEntry[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw new UsageLedgerError(`could not read usage ledger ${file}: ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UsageLedgerError(`usage ledger ${file} is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new UsageLedgerError(`usage ledger ${file} is missing an "entries" array`);
  }
  return parsed.entries.map(parseEntry);
}

/**
 * The spend ledger. Appends are written through to disk immediately and
 * atomically (temp file + rename), so a crash mid-write cannot leave a
 * half-file that would under-count spend on the next start.
 */
export class UsageStore {
  #file: string;
  #now: () => Date;
  #entries: UsageEntry[];

  constructor(file: string, now: () => Date = () => new Date()) {
    this.#file = file;
    this.#now = now;
    this.#entries = loadLedger(file);
  }

  get file(): string {
    return this.#file;
  }

  entries(): readonly UsageEntry[] {
    return this.#entries;
  }

  /** Append a billed call and persist. */
  record(entry: UsageEntry): void {
    this.#entries.push(entry);
    this.#save();
  }

  /** Total dollars spent by a key since `since` (inclusive). */
  spendSince(keyName: string, since: Date): number {
    const cutoff = since.getTime();
    let total = 0;
    for (const entry of this.#entries) {
      if (entry.key !== keyName) continue;
      if (Date.parse(entry.at) >= cutoff) total += entry.costUsd;
    }
    return total;
  }

  /** Number of calls billed to a key since `since` (inclusive). */
  requestsSince(keyName: string, since: Date): number {
    const cutoff = since.getTime();
    let count = 0;
    for (const entry of this.#entries) {
      if (entry.key !== keyName) continue;
      if (Date.parse(entry.at) >= cutoff) count += 1;
    }
    return count;
  }

  #save(): void {
    const cutoff = this.#now().getTime() - RETAIN_DAYS * 86_400_000;
    this.#entries = this.#entries.filter((entry) => Date.parse(entry.at) >= cutoff);

    const ledger: Ledger = { version: LEDGER_VERSION, entries: this.#entries };
    const dir = dirname(this.#file);
    mkdirSync(dir, { recursive: true });

    const tmp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    try {
      renameSync(tmp, this.#file);
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {
        // The temp file is already gone or unremovable; the rename error is the useful one.
      }
      throw error;
    }
  }
}
