"use client";

import { useAccounts, useRates, useTransactions, useVictvsSessions } from "@/lib/data/queries";
import { Account, Transaction } from "@/lib/data/types";
import { computeBalances, computeNetWorth } from "@/lib/domain/balances";
import { safeToSpend } from "@/lib/domain/budgets";
import { buildCardBook, CardBook, isIncome, isSpending, totalOwed } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { convert } from "@/lib/domain/fx";
import { sumAmounts } from "@/lib/domain/money";
import { findDueCardPayments } from "@/lib/domain/purchases";
import { addDays, addMonthsClamped, todayISO } from "@/lib/domain/recurrence";

export interface DashboardData {
  balances: Map<string, number>;
  /** what you hold, less what every card is owed */
  netWorth: ReturnType<typeof computeNetWorth>;
  /** what every card is owed, display currency (see lib/domain/cards.ts) */
  cardsOwed: number;
  book: CardBook;
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
  const book = buildCardBook(accounts.data, transactions.data);
  const rawNetWorth = computeNetWorth(accounts.data, balances, rates.data.usdPer, displayCurrency);
  // what the cards are owed counts as debt now (current stat only — the
  // projector pays it out month by month, so it starts from what you hold)
  const cardsOwed = totalOwed(book, accounts.data, today, rates.data.usdPer, displayCurrency);
  const netWorth = { ...rawNetWorth, total: rawNetWorth.total - cardsOwed };

  const duePayments = findDueCardPayments(accounts.data, book, today);
  const safe = safeToSpend({
    accounts: accounts.data,
    balances,
    transactions: transactions.data,
    usdPer: rates.data.usdPer,
    display: displayCurrency,
    today,
  });

  // a card's charges are paid with its statement, which is listed itself
  const upcoming = transactions.data
    .filter((tx) => tx.status === "planned" && tx.dueDate <= addDays(today, 30))
    .filter((tx) => book.roleOf(tx) !== "charge" && book.roleOf(tx) !== "cardSide")
    .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1))
    .slice(0, 6);

  // last 6 completed months of income/expense in display currency: transfers
  // excluded, a card counted when it's paid (lib/domain/cards.ts)
  const byMonth = new Map<string, { income: number; expense: number }>();
  for (let i = 5; i >= 0; i--) {
    byMonth.set(addMonthsClamped(today, -i).slice(0, 7), { income: 0, expense: 0 });
  }
  const currencyOf = new Map(accounts.data.map((a) => [a.id, a.currency] as const));
  for (const tx of transactions.data) {
    // legacy = imported history, usually stamped with the import date; it
    // would pile onto whichever month you happened to import in
    if (tx.status !== "completed" || tx.legacy) continue;
    const income = isIncome(tx, book);
    if (!income && !isSpending(tx, book)) continue;
    const bucket = byMonth.get(tx.dueDate.slice(0, 7));
    const currency = currencyOf.get(tx.accountId);
    if (!bucket || !currency) continue;
    // historical figures use the snapshot captured at completion, so they never drift
    const usdPer = tx.fxSnapshot?.usdPer ?? rates.data.usdPer;
    const converted = convert(tx.amount, currency, displayCurrency, usdPer);
    if (converted == null) continue;
    if (income) bucket.income += converted;
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
    cardsOwed,
    book,
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
