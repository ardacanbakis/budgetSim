import { Account, NetWorthSnapshot, Transaction } from "@/lib/data/types";
import { CardBook, cardSchedule, cardStatements, isIncome, isSpending, paymentDateIn } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { CardStanding, DueCardPayment } from "@/lib/domain/purchases";
import { Pace, pace } from "./pocket/pace";
import { VictvsCashMonth } from "@/lib/domain/victvsForecast";
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
 * - monthItems(…): every income and expense of a month (today's unless
 *   another is given), one line each, done or still to come, on the same
 *   cash basis, plus a card's statement due that month that no payment is
 *   recorded for yet ("expected"); with `victvs`, the VICTVS forecast's
 *   payout for that month too ("forecast"), this month or one ahead.
 * - topItems(items, limit): the biggest of those lines, by what they're
 *   worth in the display currency, and what the rest add up to.
 * - monthStatements(…): every card's statement for one month, past or
 *   ahead: the payments recorded for it ("paid", or "planned" while not
 *   made), else what the card expects it to be; and their total.
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
  /**
   * done: completed · planned: a row still to come · expected: a card
   * statement with no payment recorded yet · forecast: VICTVS income the
   * forecast expects, not yet booked
   */
  status: "done" | "planned" | "expected" | "forecast";
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
  /** yyyy-mm; today's month when left out */
  month?: string;
  /**
   * the VICTVS forecast's payouts (forecastVictvs().cash, in USD), counted
   * as income; payoutDay is the day of the month they usually land
   * (typicalPayoutDay). Leave out to count only what's booked.
   */
  victvs?: { cash: readonly VictvsCashMonth[]; payoutDay: number; label: string } | null;
}): MonthItems {
  const { transactions, accounts, book, today, usdPer, display, includeLegacy = true } = params;
  const thisMonth = today.slice(0, 7);
  const month = params.month ?? thisMonth;
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

  // a statement due this month (or one ahead) that no payment says anything
  // about yet; one left unpaid in an earlier month is still owed, so it
  // folds into this month's (cardSchedule) rather than staying behind
  for (const card of accounts) {
    if (month < thisMonth) break;
    if (card.kind !== "credit_card" || card.archived) continue;
    if (book.payments(card.id).some((p) => p.date.slice(0, 7) === month)) continue;
    const due = cardSchedule(book, card.id, thisMonth).find((s) => s.month === month);
    if (!due || due.total <= 0.005) continue;
    const payer = card.paymentAccountId ? byId.get(card.paymentAccountId) : undefined;
    add({
      key: `stmt:${card.id}`,
      date: paymentDateIn(month, card.paymentDay) ?? (month === thisMonth ? today : `${month}-01`),
      label: card.name,
      accountName: payer?.name ?? card.name,
      direction: "expense",
      amount: due.total,
      currency: card.currency,
      value: convert(due.total, card.currency, display, usdPer),
      status: "expected",
    });
  }

  // what the VICTVS forecast expects to land this month: what's left of the
  // work still to come, and sessions worked and not yet paid. A payout, once
  // recorded, is a completed income above and its sessions are paid, so the
  // two never count the same money
  const victvs = params.victvs ? params.victvs.cash.find((c) => c.month === month) : undefined;
  if (params.victvs && victvs && month >= thisMonth && victvs.expected > 0.005) {
    const onDay = paymentDateIn(month, params.victvs.payoutDay) ?? `${month}-15`;
    add({
      key: `victvs:${month}`,
      date: onDay < today ? today : onDay,
      label: params.victvs.label,
      accountName: params.victvs.label,
      direction: "income",
      amount: victvs.expected,
      currency: "USD",
      value: convert(victvs.expected, "USD", display, usdPer),
      status: "forecast",
    });
  }

  const byDate = (a: MonthItem, b: MonthItem) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label);
  out.income.sort(byDate);
  out.expense.sort(byDate);
  for (const k of Object.keys(out.totals) as (keyof MonthItems["totals"])[]) out.totals[k] = Math.round(out.totals[k] * 100) / 100;
  return out;
}

export interface TopItems {
  top: MonthItem[];
  /** the lines left out, and what they add up to in the display currency */
  rest: { count: number; value: number };
}

/**
 * The `limit` biggest lines by what they're worth in the display currency;
 * a line without a rate goes last. Ties read by date.
 */
export function topItems(items: readonly MonthItem[], limit = 10): TopItems {
  const sorted = [...items].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.date.localeCompare(b.date));
  const rest = sorted.slice(limit);
  return {
    top: sorted.slice(0, limit),
    rest: { count: rest.length, value: Math.round(rest.reduce((sum, i) => sum + (i.value ?? 0), 0) * 100) / 100 },
  };
}

export interface MonthStatement {
  account: Account;
  /** the payment's date, else the card's payment day that month */
  date: string | null;
  /** in the card's currency */
  amount: number;
  /** in the display currency: a paid statement at the rates it was paid at, else today's; null without a rate */
  value: number | null;
  /** paid: every payment recorded for it made · planned: recorded, not all made · expected: nothing recorded yet */
  status: "paid" | "planned" | "expected";
}

export interface MonthStatements {
  rows: MonthStatement[];
  /** display currency */
  totals: { all: number; paid: number; toPay: number };
}

/**
 * Every card's statement for `month` (yyyy-mm), from cardStatements: what
 * the payments recorded for it add up to, else (this month or one ahead)
 * what it'll be, charges tracked or the expectation, whichever is more. An
 * archived card shows only for what was recorded on it. Soonest due first.
 */
export function monthStatements(params: {
  accounts: readonly Account[];
  book: CardBook;
  today: string;
  month: string;
  usdPer: UsdPerMap;
  display: Currency;
}): MonthStatements {
  const { accounts, book, today, month, usdPer, display } = params;
  const rows: MonthStatement[] = [];
  const totals = { all: 0, paid: 0, toPay: 0 };
  for (const card of accounts) {
    if (card.kind !== "credit_card") continue;
    const s = cardStatements(book, card, today).find((x) => x.month === month);
    if (!s || s.amount <= 0.005) continue;
    if (card.archived && s.payments.length === 0) continue;
    const status = s.status === "paid" ? "paid" : s.status === "recorded" ? "planned" : "expected";
    // what's paid reads at the rates it was paid at, so a closed month doesn't drift
    const rates = status === "paid" ? (s.payments[0].paying.fxSnapshot?.usdPer ?? usdPer) : usdPer;
    const value = convert(s.amount, card.currency, display, rates);
    rows.push({ account: card, date: s.date, amount: s.amount, value, status });
    totals.all += value ?? 0;
    totals[status === "paid" ? "paid" : "toPay"] += value ?? 0;
  }
  rows.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.account.name.localeCompare(b.account.name));
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = Math.round(totals[k] * 100) / 100;
  return { rows, totals };
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
