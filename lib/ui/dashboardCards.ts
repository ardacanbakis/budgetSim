import { Account, NetWorthSnapshot } from "@/lib/data/types";
import { CardBook, cardSchedule } from "@/lib/domain/cards";
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
