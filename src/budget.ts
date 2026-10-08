import type { KeyConfig, TokenFenceConfig } from "./types.ts";
import type { UsageStore } from "./store.ts";

/** Midnight UTC of the current day. Windows are UTC so runs are reproducible. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** First instant of the current month, UTC. */
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface BudgetStatus {
  key: string;
  spendTodayUsd: number;
  spendMonthUsd: number;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  /**
   * Dollars left before the *nearest* configured ceiling is hit — whichever of
   * the daily or monthly budget runs out first. `Infinity` when the key has no
   * budget at all.
   */
  remainingUsd: number;
  requestsToday: number;
}

/** Current spend and headroom for one key. */
export function budgetStatus(
  config: TokenFenceConfig,
  store: UsageStore,
  key: KeyConfig,
  now: Date,
): BudgetStatus {
  const existing = config.keys.find((candidate) => candidate.name === key.name);

  const spendTodayUsd = store.spendSince(key.name, startOfUtcDay(now));
  const spendMonthUsd = store.spendSince(key.name, startOfUtcMonth(now));

  let remainingUsd = Number.POSITIVE_INFINITY;
  if (existing?.dailyUsdBudget !== undefined) {
    remainingUsd = Math.min(remainingUsd, existing.dailyUsdBudget - spendTodayUsd);
  }
  if (existing?.monthlyUsdBudget !== undefined) {
    remainingUsd = Math.min(remainingUsd, existing.monthlyUsdBudget - spendMonthUsd);
  }

  return {
    key: key.name,
    spendTodayUsd,
    spendMonthUsd,
    dailyBudgetUsd: existing?.dailyUsdBudget ?? null,
    monthlyBudgetUsd: existing?.monthlyUsdBudget ?? null,
    remainingUsd,
    requestsToday: store.requestsSince(key.name, startOfUtcDay(now)),
  };
}
