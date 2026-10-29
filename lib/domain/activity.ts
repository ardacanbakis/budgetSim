import { Account, ActivityEntry, Transaction } from "@/lib/data/types";

/**
 * Pure helpers for the change history (ActivityEntry): which fields an edit
 * changed, and an account's money movements with the balance after each.
 * What's shown is worded by the UI; nothing here is language.
 */

export type Changes = ActivityEntry["changes"];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields of `after` that differ from `before`, as { field: [before, after] }. */
export function fieldChanges<T extends object>(before: Partial<T> | null, after: Partial<T> | null, fields: readonly (keyof T)[]): Changes {
  const changes: Changes = {};
  for (const field of fields) {
    const b = before ? before[field] : null;
    const a = after ? after[field] : null;
    if (!same(b, a)) changes[field as string] = [b ?? null, a ?? null];
  }
  return changes;
}

export const ACCOUNT_FIELDS = [
  "name",
  "currency",
  "kind",
  "openingBalance",
  "holdings",
  "creditLimit",
  "paymentDay",
  "paymentAccountId",
  "archived",
] as const satisfies readonly (keyof Account)[];

export const TRANSACTION_FIELDS = [
  "amount",
  "dueDate",
  "description",
  "categoryId",
  "accountId",
  "status",
  "legacy",
] as const satisfies readonly (keyof Transaction)[];

/** Holdings as { type: qty } so a change reads per coin type. */
export function holdingsByType(holdings: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(holdings)) return out;
  for (const h of holdings as { type?: string; qty?: number }[]) {
    if (h?.type) out[h.type] = (out[h.type] ?? 0) + (h.qty ?? 0);
  }
  return out;
}

/** Per coin type: [before, after] for the types whose count changed. */
export function holdingsDiff(before: unknown, after: unknown): Array<{ type: string; before: number; after: number }> {
  const b = holdingsByType(before);
  const a = holdingsByType(after);
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((type) => (b[type] ?? 0) !== (a[type] ?? 0))
    .sort()
    .map((type) => ({ type, before: b[type] ?? 0, after: a[type] ?? 0 }));
}

export interface MoneyRow {
  tx: Transaction;
  /** + in, − out, in the account's currency (0 for legacy history) */
  delta: number;
  /** the account's balance right after this row; null for legacy rows, which never moved it */
  balanceAfter: number | null;
}

/**
 * An account's completed rows, newest first, each with the balance it left.
 * Worked backwards from today's balance, so it agrees with every other screen
 * whatever the opening balance or holdings were. Legacy rows are listed but
 * moved nothing.
 */
export function moneyRows(accountId: string, transactions: readonly Transaction[], balanceNow: number): MoneyRow[] {
  const rows = transactions
    .filter((t) => t.accountId === accountId && t.status === "completed")
    .sort((a, b) =>
      a.dueDate !== b.dueDate ? b.dueDate.localeCompare(a.dueDate) : (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt)
    );
  let balance = balanceNow;
  return rows.map((tx) => {
    if (tx.legacy) return { tx, delta: 0, balanceAfter: null };
    const delta = tx.direction === "income" ? tx.amount : -tx.amount;
    const row = { tx, delta, balanceAfter: balance };
    balance -= delta;
    return row;
  });
}

export type HistoryItem =
  | { kind: "money"; at: string; row: MoneyRow }
  | { kind: "change"; at: string; entry: ActivityEntry };

/**
 * An item's whole story, newest first: money that moved its balance and the
 * edits made to it. A money row is placed by its date; a change by when it
 * was made.
 */
export function mergeHistory(money: readonly MoneyRow[], changes: readonly ActivityEntry[]): HistoryItem[] {
  const items: HistoryItem[] = [
    ...money.map((row) => ({ kind: "money" as const, at: `${row.tx.dueDate}T23:59:59`, row })),
    ...changes.map((entry) => ({ kind: "change" as const, at: entry.at, entry })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** The latest thing that changed an account: a money movement or an edit. */
export function lastChange(money: readonly MoneyRow[], changes: readonly ActivityEntry[]): HistoryItem | null {
  return mergeHistory(money.filter((r) => r.balanceAfter != null).slice(0, 1), changes.slice(0, 1))[0] ?? null;
}
