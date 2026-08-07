"use client";

import { useAccounts, useRates, useTransactions, useVictvsSessions } from "@/lib/data/queries";
import { Account, Transaction } from "@/lib/data/types";
import { computeBalances, computeNetWorth } from "@/lib/domain/balances";
import { safeToSpend } from "@/lib/domain/budgets";
import { Currency } from "@/lib/domain/currencies";
import { convert } from "@/lib/domain/fx";
import { sumAmounts } from "@/lib/domain/money";
import { computePurchaseLiability, findDueCardPayments } from "@/lib/domain/purchases";
import { addDays, addMonthsClamped, todayISO } from "@/lib/domain/recurrence";

export interface DashboardData {
  balances: Map<string, number>;
  netWorth: ReturnType<typeof computeNetWorth>;
  liability: number;
  ccPostedDebt: number;
  duePayments: ReturnType<typeof findDueCardPayments>;
  safe: ReturnType<typeof safeToSpend>;
  upcoming: Transaction[];
  flow: Array<{ month: string; income: number; expense: number }>;
  unpaidVictvs: number;
  accounts: Account[];
  transactions: Transaction[];
  today: string;
}

/**
 * Everything both dashboards put on screen, derived once. The two layouts
 * disagree about arrangement, not about arithmetic — so the arithmetic lives
 * here and neither of them owns it.
 *
 * Recomputed every render: a few hundred rows, well under a frame at personal
 * scale. Memoize if the ledger ever grows past ~10k rows.
 */
export function useDashboardData(displayCurrency: Currency): DashboardData | null {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const victvs = useVictvsSessions();
  const rates = useRates();
  const today = todayISO();

  const unpaidVictvs = sumAmounts(
    "USD",
    (victvs.data ?? []).filter((s) => s.status === "unpaid").map((s) => s.amount)
  );

  if (!accounts.data || !transactions.data || !rates.data) return null;

  const balances = computeBalances(accounts.data, transactions.data);
  const rawNetWorth = computeNetWorth(accounts.data, balances, rates.data.usdPer, displayCurrency);
  // remaining reflected installments count as debt now (current stat only —
  // the projector spreads them month by month, so it stays unadjusted)
  const liability = computePurchaseLiability(transactions.data, accounts.data, rates.data.usdPer, displayCurrency);
  const netWorth = { ...rawNetWorth, total: rawNetWorth.total - liability };

  let ccPostedDebt = 0;
  for (const a of accounts.data) {
    if (a.kind !== "credit_card" || a.archived) continue;
    const balance = balances.get(a.id) ?? 0;
    if (balance < 0) {
      const converted = convert(-balance, a.currency, displayCurrency, rates.data.usdPer);
      if (converted != null) ccPostedDebt += converted;
    }
  }

  const duePayments = findDueCardPayments(accounts.data, balances, transactions.data, today);
  const safe = safeToSpend({
    accounts: accounts.data,
    balances,
    transactions: transactions.data,
    usdPer: rates.data.usdPer,
    display: displayCurrency,
    today,
  });

  const upcoming = transactions.data
    .filter((tx) => tx.status === "planned" && tx.dueDate <= addDays(today, 30))
    .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1))
    .slice(0, 6);

  // last 6 completed months of income/expense in display currency (transfers excluded)
  const byMonth = new Map<string, { income: number; expense: number }>();
  for (let i = 5; i >= 0; i--) {
    byMonth.set(addMonthsClamped(today, -i).slice(0, 7), { income: 0, expense: 0 });
  }
  const currencyOf = new Map(accounts.data.map((a) => [a.id, a.currency] as const));
  for (const tx of transactions.data) {
    // legacy = imported history, usually stamped with the import date; it
    // would pile onto whichever month you happened to import in
    if (tx.status !== "completed" || tx.transferGroupId || tx.legacy) continue;
    const bucket = byMonth.get(tx.dueDate.slice(0, 7));
    const currency = currencyOf.get(tx.accountId);
    if (!bucket || !currency) continue;
    // historical figures use the snapshot captured at completion, so they never drift
    const usdPer = tx.fxSnapshot?.usdPer ?? rates.data.usdPer;
    const converted = convert(tx.amount, currency, displayCurrency, usdPer);
    if (converted == null) continue;
    if (tx.direction === "income") bucket.income += converted;
    else bucket.expense += converted;
  }
  const flow = [...byMonth.entries()].map(([month, v]) => ({
    month,
    income: Math.round(v.income * 100) / 100,
    expense: Math.round(v.expense * 100) / 100,
  }));

  return {
    balances,
    netWorth,
    liability,
    ccPostedDebt,
    duePayments,
    safe,
    upcoming,
    flow,
    unpaidVictvs,
    accounts: accounts.data,
    transactions: transactions.data,
    today,
  };
}
