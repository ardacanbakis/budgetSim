"use client";

import { useAccounts, useCardEstimates, useRates, useTransactions, useVictvsSessions } from "@/lib/data/queries";
import { Account, Transaction } from "@/lib/data/types";
import { computeBalances, computeNetWorth } from "@/lib/domain/balances";
import { safeToSpend } from "@/lib/domain/budgets";
import { buildCardBook, CardBook, isIncome, isSpending, totalOwed } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { convert } from "@/lib/domain/fx";
import { findDueCardPayments } from "@/lib/domain/purchases";
import { goldRatiosOf } from "@/lib/domain/gold";
import { addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { unpaidSplit } from "@/lib/ui/pocket/victvsRanges";
import { REPORT_LEGACY_KEY, useLocalToggle } from "@/lib/prefs";

export interface DashboardData {
  balances: Map<string, number>;
  /** what you hold, less what every card is owed */
  netWorth: ReturnType<typeof computeNetWorth>;
  /** what every card is owed, display currency (see lib/domain/cards.ts) */
  cardsOwed: number;
  book: CardBook;
  duePayments: ReturnType<typeof findDueCardPayments>;
  safe: ReturnType<typeof safeToSpend>;
  flow: Array<{ month: string; income: number; expense: number }>;
  /** VICTVS sessions held and not yet paid, USD */
  unpaidVictvs: number;
  /** unpaid sessions booked ahead: not owed until they're held, USD */
  scheduledVictvs: { count: number; total: number };
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
  const estimates = useCardEstimates();
  const includeLegacy = useLocalToggle(REPORT_LEGACY_KEY, true).value;
  const today = todayISO();

  // owed now is what's been held; a session booked for next week isn't owed yet
  const victvsSplit = unpaidSplit(victvs.data ?? [], today);
  const unpaidVictvs = victvsSplit.now.total;

  if (!accounts.data || !transactions.data || !rates.data) return null;

  const balances = computeBalances(accounts.data, transactions.data, goldRatiosOf(rates.data));
  const book = buildCardBook(accounts.data, transactions.data, estimates.data);
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

  // last 6 completed months of income/expense in display currency: transfers
  // excluded, a card counted when it's paid (lib/domain/cards.ts)
  const byMonth = new Map<string, { income: number; expense: number }>();
  for (let i = 5; i >= 0; i--) {
    byMonth.set(addMonthsClamped(today, -i).slice(0, 7), { income: 0, expense: 0 });
  }
  const currencyOf = new Map(accounts.data.map((a) => [a.id, a.currency] as const));
  for (const tx of transactions.data) {
    // legacy rows stay out of balances but are real money in and out on their
    // own dates, so the monthly figures count them unless Reports turns it off
    if (tx.status !== "completed" || (tx.legacy && !includeLegacy)) continue;
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
    flow,
    unpaidVictvs,
    scheduledVictvs: victvsSplit.scheduled,
    accounts: accounts.data,
    transactions: transactions.data,
    today,
  };
}
