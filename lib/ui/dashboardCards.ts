import { Account, NetWorthSnapshot, Transaction } from "@/lib/data/types";
import { CardBook, cardSchedule, isIncome, isSpending, paymentDateIn } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { CardStanding, DueCardPayment } from "@/lib/domain/purchases";
import { Pace, pace } from "./pocket/pace";
import { statementFigure, StatementFigure } from "./pocket/attention";
import { loanHref } from "./portfolioUrl";

/**
 * The arithmetic behind the dashboards' optional cards (off until turned on
 * in Settings → Dashboard), pure so it can be checked without a screen. The
 * cards themselves are components/dashboardCards.tsx, drawn by Classic,
 * version 2 and, as sections, Pocket's Home.
 *
 * - thisMonthSummary(flow, today): this month's in, out and net from the
 *   dashboard's flow (cash basis: a card counts when it's paid), the share
 *   of income kept, the same against the mean of the earlier months, and
 *   the month's spending pace against that mean (lib/ui/pocket/pace.ts).
 * - monthItems(…): every income and expense of this month, one line each,
 *   done or still to come, on the same cash basis, plus a card's statement
 *   due this month that no payment is recorded for yet ("expected").
 * - trendPoints(snapshots, …): one point a month from the net-worth
 *   snapshots, the last 12 months, plus "now" from the live figure; both
 *   are what you hold less what the cards owe, so the line doesn't jump.
 * - statementRows(…): each open card's statement (statementFigure), its
 *   standing and its next three months to pay (cardSchedule); idle cards
 *   (nothing owed, nothing coming) apart.
 * - debtHref(loanId): where a loan opens: the Portfolio's Debts view with
 *   that loan (loanHref).
 */

export interface FlowMonth {
  month: string;
  income: number;
  expense: number;
}

export interface ThisMonth {
  month: string;
  income: number;
  expense: number;
  net: number;
  /** net ÷ income; null with no income */
  savingsRate: number | null;
  /** the mean of the earlier months in `flow`; null when there are none */
  usual: { income: number; expense: number; net: number } | null;
  /** spending against the usual month's; null without one */
  pace: Pace | null;
}

export function thisMonthSummary(flow: readonly FlowMonth[], today: string): ThisMonth | null {
  const month = today.slice(0, 7);
  const current = flow.find((f) => f.month === month);
  if (!current) return null;
  const earlier = flow.filter((f) => f.month < month);
  const mean = (pick: (f: FlowMonth) => number) => earlier.reduce((sum, f) => sum + pick(f), 0) / earlier.length;
  const usual = earlier.length
    ? { income: mean((f) => f.income), expense: mean((f) => f.expense), net: mean((f) => f.income - f.expense) }
    : null;
  const net = current.income - current.expense;
  return {
    month,
    income: current.income,
    expense: current.expense,
    net,
    savingsRate: current.income > 0.005 ? net / current.income : null,
    usual,
    pace: usual && usual.expense > 0.005 ? pace({ spent: current.expense, limit: usual.expense, today }) : null,
  };
}

export interface MonthItem {
  key: string;
  date: string;
  label: string;
  /** the account it moves (the paying account for a card's statement) */
  accountName: string;
  direction: "income" | "expense";
  /** in its own currency */
  amount: number;
  currency: Currency;
  /** in the display currency: the rates it was completed at, else today's; null without a rate */
  value: number | null;
  /** done: completed · planned: a row still to come · expected: a card statement with no payment recorded yet */
  status: "done" | "planned" | "expected";
}

export interface MonthItems {
  income: MonthItem[];
  expense: MonthItem[];
  /** display currency */
  totals: { incomeDone: number; incomeAhead: number; expenseDone: number; expenseAhead: number };
}

/**
 * Every income and expense of today's month, on the dashboard's cash basis
 * (lib/domain/cards.ts isIncome / isSpending): ordinary incomes and
 * expenses, and card payments, never the charges a payment covers or a
 * transfer between your accounts. Rows done and still planned both count;
 * a card's statement due this month with no payment recorded is one more
 * line, from what the card expects (cardSchedule, estimates included).
 * Legacy rows count when `includeLegacy`, as the month's totals do.
 */
export function monthItems(params: {
  transactions: readonly Transaction[];
  accounts: readonly Account[];
  book: CardBook;
  today: string;
  usdPer: UsdPerMap;
  display: Currency;
  includeLegacy?: boolean;
}): MonthItems {
  const { transactions, accounts, book, today, usdPer, display, includeLegacy = true } = params;
  const month = today.slice(0, 7);
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const out: MonthItems = { income: [], expense: [], totals: { incomeDone: 0, incomeAhead: 0, expenseDone: 0, expenseAhead: 0 } };
  const add = (item: MonthItem) => {
    (item.direction === "income" ? out.income : out.expense).push(item);
    const v = item.value ?? 0;
    const done = item.status === "done";
    if (item.direction === "income") out.totals[done ? "incomeDone" : "incomeAhead"] += v;
    else out.totals[done ? "expenseDone" : "expenseAhead"] += v;
  };

  for (const t of transactions) {
    if (t.dueDate.slice(0, 7) !== month || (t.legacy && !includeLegacy)) continue;
    const income = isIncome(t, book);
    if (!income && !isSpending(t, book)) continue;
    const account = byId.get(t.accountId);
    if (!account) continue;
    const done = t.status === "completed";
    // what's done reads at the rates it was done at, so the month doesn't drift
    const rates = done ? (t.fxSnapshot?.usdPer ?? usdPer) : usdPer;
    add({
      key: t.id,
      date: t.dueDate,
      label: t.description || account.name,
      accountName: account.name,
      direction: income ? "income" : "expense",
      amount: t.amount,
      currency: account.currency,
      value: convert(t.amount, account.currency, display, rates),
      status: done ? "done" : "planned",
    });
  }

  // a statement due this month that no payment says anything about yet
  for (const card of accounts) {
    if (card.kind !== "credit_card" || card.archived) continue;
    if (book.payments(card.id).some((p) => p.date.slice(0, 7) === month)) continue;
    const due = cardSchedule(book, card.id, month).find((s) => s.month === month);
    if (!due || due.total <= 0.005) continue;
    const payer = card.paymentAccountId ? byId.get(card.paymentAccountId) : undefined;
    add({
      key: `stmt:${card.id}`,
      date: paymentDateIn(month, card.paymentDay) ?? today,
      label: card.name,
      accountName: payer?.name ?? card.name,
      direction: "expense",
      amount: due.total,
      currency: card.currency,
      value: convert(due.total, card.currency, display, usdPer),
      status: "expected",
    });
  }

  const byDate = (a: MonthItem, b: MonthItem) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label);
  out.income.sort(byDate);
  out.expense.sort(byDate);
  for (const k of Object.keys(out.totals) as (keyof MonthItems["totals"])[]) out.totals[k] = Math.round(out.totals[k] * 100) / 100;
  return out;
}

export interface TrendPoint {
  /** yyyy-mm, or "now" for the live point */
  month: string;
  value: number;
}

export interface Trend {
  points: TrendPoint[];
  /** now against the latest snapshot; null without one */
  change: number | null;
  /** the same against the first point shown; null with fewer than two */
  overPeriod: number | null;
}

export function trendPoints(params: {
  snapshots: readonly NetWorthSnapshot[];
  /** the live net worth, in `display` */
  now: number;
  usdPer: UsdPerMap;
  display: Currency;
  today: string;
  months?: number;
}): Trend {
  const { snapshots, now, usdPer, display, today, months = 12 } = params;
  // the last snapshot of each month (one a month as recorded, but be safe)
  const byMonth = new Map<string, NetWorthSnapshot>();
  for (const s of [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))) {
    byMonth.set(s.snapshotDate.slice(0, 7), s);
  }
  const from = (() => {
    const [y, m] = today.slice(0, 7).split("-").map(Number);
    const back = y * 12 + (m - 1) - (months - 1);
    return `${Math.floor(back / 12)}-${String((back % 12) + 1).padStart(2, "0")}`;
  })();
  const points: TrendPoint[] = [];
  for (const [month, s] of byMonth) {
    if (month < from || month > today.slice(0, 7)) continue;
    // stored in USD; shown at today's rates, as Reports' history is
    const value = convert(s.totalUsd, "USD", display, usdPer);
    if (value != null) points.push({ month, value });
  }
  const last = points.at(-1)?.value ?? null;
  const first = points[0]?.value ?? null;
  points.push({ month: "now", value: now });
  return {
    points,
    change: last != null ? now - last : null,
    overPeriod: first != null && points.length > 2 ? now - first : null,
  };
}

export interface StatementRow {
  account: Account;
  standing: CardStanding;
  figure: StatementFigure;
  /** the next months with something to pay, this one first */
  next: Array<{ month: string; total: number }>;
}

export function statementRows(params: {
  standings: readonly CardStanding[];
  book: CardBook;
  today: string;
  duePayments: readonly DueCardPayment[];
  months?: number;
}): { active: StatementRow[]; idle: Account[] } {
  const { standings, book, today, duePayments, months = 3 } = params;
  const active: StatementRow[] = [];
  const idle: Account[] = [];
  for (const standing of standings) {
    if (standing.idle) {
      idle.push(standing.account);
      continue;
    }
    active.push({
      account: standing.account,
      standing,
      figure: statementFigure(standing.account, book, today, duePayments),
      next: cardSchedule(book, standing.account.id, today.slice(0, 7)).slice(0, months),
    });
  }
  // the soonest due first; a card with no payment day last
  active.sort((a, b) => (a.standing.daysToDue ?? Infinity) - (b.standing.daysToDue ?? Infinity));
  return { active, idle };
}

/** Where a loan opens: the Portfolio's Debts view with that loan open (lib/ui/portfolioUrl.ts). */
export function debtHref(loanId?: string | null): string {
  return loanHref(loanId);
}
