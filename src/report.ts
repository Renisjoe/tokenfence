import { budgetStatus } from "./budget.ts";
import type { BudgetStatus } from "./budget.ts";
import { formatUsd } from "./pricing.ts";
import type { UsageStore } from "./store.ts";
import type { TokenFenceConfig } from "./types.ts";

function budgetCell(spend: number, budget: number | null): string {
  return budget === null ? `${formatUsd(spend)} / no cap` : `${formatUsd(spend)} / ${formatUsd(budget)}`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/**
 * A plain-text table, one row per key: spend against each configured ceiling
 * for today and this month. Reads the ledger directly, so it is the admin view
 * and does not need a key.
 */
export function renderReport(config: TokenFenceConfig, store: UsageStore, now: Date): string {
  const statuses: BudgetStatus[] = config.keys.map((key) => budgetStatus(config, store, key, now));

  const header = ["key", "spent today", "spent this month", "requests today"];
  const rows = statuses.map((status) => [
    status.key,
    budgetCell(status.spendTodayUsd, status.dailyBudgetUsd),
    budgetCell(status.spendMonthUsd, status.monthlyBudgetUsd),
    String(status.requestsToday),
  ]);

  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );

  const render = (cells: string[]): string =>
    cells.map((cell, column) => pad(cell, widths[column] ?? 0)).join("  ").trimEnd();

  const lines = [
    `${"TokenFence usage report"}`,
    `ledger   ${store.file}`,
    `as of    ${now.toISOString()} (UTC)`,
    "",
    render(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(render),
  ];

  const totalSpend = statuses.reduce((sum, status) => sum + status.spendMonthUsd, 0);
  const totalRequests = statuses.reduce((sum, status) => sum + status.requestsToday, 0);
  lines.push("", `month to date across all keys: ${formatUsd(totalSpend)} · ${totalRequests} request(s) today`);

  return `${lines.join("\n")}\n`;
}
