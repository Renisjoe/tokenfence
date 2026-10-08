import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { UsageLedgerError, UsageStore } from "../src/store.ts";
import type { UsageEntry } from "../src/types.ts";

const NOW = new Date("2026-05-10T12:00:00.000Z");

function entry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    at: NOW.toISOString(),
    key: "dev",
    model: "gpt-4o-mini",
    promptTokens: 1000,
    completionTokens: 500,
    costUsd: 0.0025,
    ...overrides,
  };
}

function tempStore(): { dir: string; file: string; store: UsageStore } {
  const dir = mkdtempSync(join(tmpdir(), "tokenfence-store-"));
  const file = join(dir, "usage.json");
  return { dir, file, store: new UsageStore(file, () => NOW) };
}

function daysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

test("starts empty when no ledger exists yet", () => {
  const { dir, file, store } = tempStore();
  try {
    assert.deepEqual(store.entries(), []);
    assert.equal(store.file, file);
    assert.equal(store.spendSince("dev", new Date(0)), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writes a record through to disk and reads it back in a fresh store", () => {
  const { dir, file, store } = tempStore();
  try {
    store.record(entry());

    const reloaded = new UsageStore(file, () => NOW);
    assert.equal(reloaded.entries().length, 1);
    assert.equal(reloaded.entries()[0]!.key, "dev");
    assert.equal(reloaded.entries()[0]!.model, "gpt-4o-mini");

    const onDisk = JSON.parse(readFileSync(file, "utf8")) as { version: number; entries: unknown[] };
    assert.equal(onDisk.version, 1);
    assert.equal(onDisk.entries.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("leaves no temp file behind after writing", () => {
  const { dir, store } = tempStore();
  try {
    store.record(entry());
    store.record(entry());
    assert.deepEqual(readdirSync(dir), ["usage.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only counts spend and requests inside the requested window", () => {
  const { dir, file, store } = tempStore();
  try {
    store.record(entry({ at: NOW.toISOString(), costUsd: 0.01 }));
    store.record(entry({ at: daysBefore(1), costUsd: 0.02 }));
    store.record(entry({ at: daysBefore(40), costUsd: 0.04 }));

    assert.ok(Math.abs(store.spendSince("dev", new Date(NOW.getTime() - 3_600_000)) - 0.01) < 1e-12);
    assert.ok(Math.abs(store.spendSince("dev", new Date(NOW.getTime() - 2 * 86_400_000)) - 0.03) < 1e-12);
    assert.ok(Math.abs(store.spendSince("dev", new Date(0)) - 0.07) < 1e-12);

    assert.equal(store.requestsSince("dev", new Date(NOW.getTime() - 3_600_000)), 1);
    assert.equal(store.requestsSince("dev", new Date(0)), 3);

    const reloaded = new UsageStore(file, () => NOW);
    assert.equal(reloaded.entries().length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps different keys apart", () => {
  const { dir, store } = tempStore();
  try {
    store.record(entry({ key: "dev", costUsd: 0.01 }));
    store.record(entry({ key: "ci", costUsd: 0.99 }));

    assert.ok(Math.abs(store.spendSince("dev", new Date(0)) - 0.01) < 1e-12);
    assert.ok(Math.abs(store.spendSince("ci", new Date(0)) - 0.99) < 1e-12);
    assert.equal(store.requestsSince("dev", new Date(0)), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("drops entries past the retention window so the ledger cannot grow forever", () => {
  const { dir, file, store } = tempStore();
  try {
    store.record(entry());
    store.record(entry({ at: daysBefore(200) }));

    assert.equal(store.entries().length, 1);
    const reloaded = new UsageStore(file, () => NOW);
    assert.equal(reloaded.entries().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to start on a ledger it cannot trust", () => {
  const dir = mkdtempSync(join(tmpdir(), "tokenfence-store-bad-"));
  try {
    const truncated = join(dir, "truncated.json");
    writeFileSync(truncated, '{"version":1,"entries":[', "utf8");
    assert.throws(() => new UsageStore(truncated), (error: unknown) => {
      assert.ok(error instanceof UsageLedgerError);
      assert.match((error as Error).message, /not valid JSON/);
      return true;
    });

    const missingFields = join(dir, "missing.json");
    writeFileSync(
      missingFields,
      JSON.stringify({ version: 1, entries: [{ at: "not-a-date", key: "dev", model: "m", promptTokens: 0, completionTokens: 0, costUsd: 0 }] }),
      "utf8",
    );
    assert.throws(() => new UsageStore(missingFields), /unusable "at" timestamp/);

    const notANumber = join(dir, "not-a-number.json");
    writeFileSync(
      notANumber,
      JSON.stringify({
        version: 1,
        entries: [{ at: NOW.toISOString(), key: "dev", model: "m", promptTokens: 0, completionTokens: 0, costUsd: "free" }],
      }),
      "utf8",
    );
    assert.throws(() => new UsageStore(notANumber), /non-numeric "costUsd"/);

    const noEntries = join(dir, "no-entries.json");
    writeFileSync(noEntries, JSON.stringify({ version: 1 }), "utf8");
    assert.throws(() => new UsageStore(noEntries), /missing an "entries" array/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
