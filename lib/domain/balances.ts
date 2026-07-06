import { Account, Transaction } from "@/lib/data/types";
import { Currency } from "./currencies";
import { fromMinor, toMinor } from "./money";
import { convert, UsdPerMap } from "./fx";

/**
 * Balances are always derived from completed transactions — never stored —
 * so every device computes the same number from the same server data.
 */
export function computeBalances(
  accounts: Account[],
  transactions: Transaction[]
): Map<string, number> {
  const minor = new Map<string, number>();
  const currencyOf = new Map<string, Currency>();
  for (const a of accounts) {
    minor.set(a.id, toMinor(a.openingBalance, a.currency));
    currencyOf.set(a.id, a.currency);
  }
  for (const t of transactions) {
    if (t.status !== "completed" || t.legacy) continue;
    const cur = currencyOf.get(t.accountId);
    if (cur == null) continue;
    const sign = t.direction === "income" ? 1 : -1;
    minor.set(t.accountId, (minor.get(t.accountId) ?? 0) + sign * toMinor(t.amount, cur));
  }
  const result = new Map<string, number>();
  for (const [id, m] of minor) result.set(id, fromMinor(m, currencyOf.get(id)!));
  return result;
}

/** Net worth in the display currency. Accounts whose rate is unavailable are skipped and reported. */
export function computeNetWorth(
  accounts: Account[],
  balances: Map<string, number>,
  usdPer: UsdPerMap,
  display: Currency
): { total: number; skippedAccountIds: string[] } {
  let total = 0;
  const skipped: string[] = [];
  for (const a of accounts) {
    if (a.archived) continue;
    const balance = balances.get(a.id) ?? 0;
    const converted = convert(balance, a.currency, display, usdPer);
    if (converted == null) {
      skipped.push(a.id);
      continue;
    }
    total += converted;
  }
  return { total, skippedAccountIds: skipped };
}
