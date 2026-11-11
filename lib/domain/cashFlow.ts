import { Account } from "@/lib/data/types";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { addMonthsClamped } from "./recurrence";
import { AccountSeries, balanceAt, compareEvents, TimelineEvent } from "./timeline";

/**
 * The money still to move, read three ways. Pure: everything here is derived
 * from the timeline (lib/domain/timeline.ts) and its balances, so the Plan
 * agrees with the Timeline and with every card screen by construction.
 *
 * The question these answer is not "what will I have at the end of the
 * month" — the projection answers that — but "will the account that pays
 * this bill hold enough on the day it leaves". A month that nets out fine
 * can still fail on the 16th, when three statements and a loan instalment
 * land on one account within hours of each other.
 *
 * - paymentRunway: a row per movement from today, in date order, with the
 *   account it moves and that account's balance going in and coming out.
 *   The running balance is walked the way balanceSeries walks it, from the
 *   account's own start, so a row's "after" is the balance the Timeline
 *   would show on that day. A row whose "after" is below zero is short, and
 *   `firstShort` is the first day any account gets there.
 * - dailyBalances: one line per cash account of a currency, day by day, for
 *   a chart; plus their total, which is what actually has to stay positive
 *   when money can be moved between them.
 * - monthlyFlow: in, out and net a month in the display currency, with the
 *   end-of-month total of the cash accounts — the same months the forecast
 *   table shows, on the timeline's own figures.
 *
 * Only cash accounts are walked. What is spent on a card moves money when
 * the card is paid, which the timeline already models as a statement event
 * on the card's payment day, charged to the account that pays it.
 */

/** Overdue rows take effect today, so the walk orders by when money moves. */
const effectiveOf = (e: TimelineEvent) => e.effectiveDate;
const byEffective = (a: TimelineEvent, b: TimelineEvent) =>
  effectiveOf(a).localeCompare(effectiveOf(b)) || compareEvents(a, b);

/** Planned, overdue and completed always move money; the rest only when asked. */
const moves = (e: TimelineEvent, counts?: (e: TimelineEvent) => boolean) =>
  e.status === "completed" || e.status === "planned" || e.status === "overdue" || (counts?.(e) ?? false);

export interface RunwayRow {
  key: string;
  /** when the money moves (an overdue row moves today) */
  date: string;
  /** what it is: the row's description, the card's name, the account's */
  label: string;
  account: Account;
  /** signed, in the account's currency */
  delta: number;
  /** the account's balance before and after it, in the account's currency */
  before: number;
  after: number;
  /** the balance it leaves is below zero */
  short: boolean;
  /** a figure converted at today's rates rather than known exactly */
  approx: boolean;
  kind: TimelineEvent["kind"];
  event: TimelineEvent;
}

export interface PaymentRunway {
  rows: RunwayRow[];
  /** the first day an account's balance would go below zero; null when none does */
  firstShort: string | null;
  /** per account: the lowest it gets over the window, and when */
  lows: Array<{ account: Account; balance: number; date: string }>;
}

/**
 * Every movement from today to `to`, in the order money moves, with the
 * balance each one leaves behind on the account it moves.
 *
 * The walk starts from each account's first known balance and runs through
 * the whole timeline, not just the part on screen, because a balance is the
 * sum of everything before it. Only the rows from today are returned.
 */
export function paymentRunway(params: {
  events: readonly TimelineEvent[];
  series: ReadonlyMap<string, AccountSeries>;
  /** every account, so a statement can be named after its card */
  accounts: readonly Account[];
  today: string;
  to: string;
  /** for kinds that only count when asked (expected VICTVS payouts) */
  counts?: (e: TimelineEvent) => boolean;
  /** only this account's movements; every cash account when left out */
  accountId?: string | null;
}): PaymentRunway {
  const { events, series, accounts, today, to, counts, accountId } = params;
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const running = new Map<string, number>();
  for (const [id, s] of series) running.set(id, s.points[0]?.balance ?? s.now);

  const rows: RunwayRow[] = [];
  const lows = new Map<string, { account: Account; balance: number; date: string }>();
  let firstShort: string | null = null;

  for (const e of [...events].filter((x) => moves(x, counts)).sort(byEffective)) {
    const date = effectiveOf(e);
    for (const leg of e.legs) {
      const s = series.get(leg.accountId);
      if (!s) continue;
      const before = running.get(leg.accountId) ?? s.now;
      const after = Math.round((before + leg.delta) * 1e8) / 1e8;
      running.set(leg.accountId, after);
      if (date < today || date > to) continue;
      if (accountId && leg.accountId !== accountId) continue;
      const low = lows.get(leg.accountId);
      if (!low || after < low.balance - 0.005) lows.set(leg.accountId, { account: s.account, balance: after, date });
      const short = after < -0.005;
      if (short && (firstShort == null || date < firstShort)) firstShort = date;
      rows.push({
        key: `${e.key}:${leg.accountId}`,
        date,
        label: labelOf(e, s.account, byId),
        account: s.account,
        delta: leg.delta,
        before,
        after,
        short,
        approx: leg.approx === true,
        kind: e.kind,
        event: e,
      });
    }
  }

  return {
    rows,
    firstShort,
    lows: [...lows.values()].sort((a, b) => a.balance - b.balance),
  };
}

/**
 * What a movement is called: the row's own words, else the card whose
 * statement it is, else the account it moves. A statement is named after the
 * card, not the account paying it — the account is its own column.
 */
function labelOf(e: TimelineEvent, account: Account, byId: ReadonlyMap<string, Account>): string {
  if (e.tx?.description) return e.tx.description;
  if (e.kind === "statement" && e.cardId) return byId.get(e.cardId)?.name ?? account.name;
  if (e.milestone) return e.milestone.name;
  return account.name;
}

export interface BalanceLine {
  account: Account;
  /** end-of-day balance on each day in `dates` */
  values: number[];
}

export interface DailyBalances {
  currency: Currency;
  /** every day from today to the horizon on which anything moves, today first */
  dates: string[];
  lines: BalanceLine[];
  /** the lines added together: what has to stay positive when money can be moved */
  total: number[];
  /** the lowest the total gets, and when */
  low: { balance: number; date: string } | null;
}

/**
 * One line per cash account of `currency`, day by day, plus their total.
 *
 * Only the days something moves are kept: a chart of 365 identical points
 * says no more than a chart of the twenty days a balance actually changes,
 * and the steps are what you are looking for. Currencies are never mixed:
 * a sum of lira and dollars at today's rate is a guess dressed as a
 * balance, and the point of this view is the days it must not be one.
 */
export function dailyBalances(params: {
  series: ReadonlyMap<string, AccountSeries>;
  currency: Currency;
  today: string;
  to: string;
}): DailyBalances {
  const { series, currency, today, to } = params;
  const accounts = [...series.values()].filter((s) => s.account.currency === currency && s.account.kind === "fiat");
  const dates = new Set<string>([today]);
  for (const s of accounts) for (const p of s.points) if (p.date > today && p.date <= to) dates.add(p.date);
  const days = [...dates].sort();

  const lines = accounts.map((s) => ({
    account: s.account,
    values: days.map((d) => balanceAt(s.points, d) ?? s.now),
  }));
  const total = days.map((_, i) => Math.round(lines.reduce((sum, l) => sum + l.values[i], 0) * 100) / 100);
  let low: { balance: number; date: string } | null = null;
  total.forEach((balance, i) => {
    if (!low || balance < low.balance - 0.005) low = { balance, date: days[i] };
  });

  // the biggest holding first, so the legend reads top-down like the chart
  lines.sort((a, b) => (b.values[0] ?? 0) - (a.values[0] ?? 0) || a.account.name.localeCompare(b.account.name));
  return { currency, dates: days, lines, total, low };
}

export interface FlowMonth {
  /** yyyy-mm */
  month: string;
  /** display currency */
  income: number;
  expense: number;
  net: number;
  /** every cash account at the end of the month, display currency at today's rates */
  endBalance: number;
}

/**
 * In, out and net a month over the window, in the display currency, with
 * what the cash accounts hold at the end of each one.
 *
 * A transfer between your own accounts is neither in nor out: its legs
 * cancel, which is what the timeline's legs already do. The end balance
 * converts at today's rates, so it is a planning figure, not a valuation.
 */
export function monthlyFlow(params: {
  events: readonly TimelineEvent[];
  series: ReadonlyMap<string, AccountSeries>;
  today: string;
  months: number;
  usdPer: UsdPerMap;
  display: Currency;
  counts?: (e: TimelineEvent) => boolean;
}): FlowMonth[] {
  const { events, series, today, months, usdPer, display, counts } = params;
  const first = today.slice(0, 7);
  const keys = Array.from({ length: Math.max(1, months) }, (_, i) => addMonthsClamped(`${first}-01`, i).slice(0, 7));
  const index = new Map(keys.map((m, i) => [m, i] as const));
  const out: FlowMonth[] = keys.map((month) => ({ month, income: 0, expense: 0, net: 0, endBalance: 0 }));

  for (const e of events) {
    if (!moves(e, counts)) continue;
    const i = index.get(effectiveOf(e).slice(0, 7));
    if (i == null) continue;
    for (const leg of e.legs) {
      const s = series.get(leg.accountId);
      if (!s) continue;
      const value = convert(leg.delta, s.account.currency, display, usdPer);
      if (value == null) continue;
      if (value >= 0) out[i].income += value;
      else out[i].expense += -value;
    }
  }

  for (const [i, month] of keys.entries()) {
    // the last day of that month, so the balance is what it closes on
    const [y, m] = month.split("-").map(Number);
    const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    let end = 0;
    for (const s of series.values()) {
      if (s.account.kind !== "fiat") continue;
      const balance = last < today ? s.now : (balanceAt(s.points, last) ?? s.now);
      const value = convert(balance, s.account.currency, display, usdPer);
      if (value != null) end += value;
    }
    out[i].endBalance = Math.round(end * 100) / 100;
    out[i].income = Math.round(out[i].income * 100) / 100;
    out[i].expense = Math.round(out[i].expense * 100) / 100;
    out[i].net = Math.round((out[i].income - out[i].expense) * 100) / 100;
  }
  return out;
}
