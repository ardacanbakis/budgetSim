import { Account } from "@/lib/data/types";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { roundTo } from "./money";
import { addDays, parseISODate } from "./recurrence";
import { AccountSeries, balanceAt, lowestAhead } from "./timeline";

/**
 * How long the lira lasts: the TRY cash accounts together, walked through
 * what is planned (lib/domain/timeline.ts balanceSeries), and what to
 * convert, and by when, when they would run short.
 *
 * - The walk is the balance series of every TRY cash account summed day by
 *   day from today to the horizon. It inherits the series' rules: overdue
 *   rows count today, card statements paid from a TRY account count on their
 *   payment day, legacy rows never count, and a transfer between two TRY
 *   accounts nets out (its two legs land on the same day).
 * - Short: the first day the total would go below zero, the lowest it gets,
 *   and what covers that low plus a buffer (BUFFER_SHARE of it, at least
 *   BUFFER_MIN_TRY), converted at today's rates from the biggest non-TRY
 *   cash account (USD first, then by its value in lira), rounded up to a
 *   whole ten. Convert by the business day before going short (never before
 *   today); the money goes to the TRY account that goes lowest.
 * - Covered: no day below zero before the horizon.
 */

/** On top of the shortfall, so a bill a little bigger than planned doesn't undo it. */
export const BUFFER_SHARE = 0.05;
export const BUFFER_MIN_TRY = 500;

export interface ConversionHint {
  fromAccount: Account;
  /** what to send, in the source account's currency, rounded up */
  amount: number;
  /** what that brings in lira at today's rate */
  toAmount: number;
  toAccount: Account;
  /** the business day before the lira runs short, or today */
  convertBy: string;
}

export interface Runway {
  /** the TRY cash accounts walked */
  accounts: Account[];
  /** their total today */
  now: number;
  /** the lowest the total gets before the horizon, and the first day it does */
  low: { balance: number; date: string };
  /** the first day the total would be below zero; null when it never is */
  shortOn: string | null;
  /** lira short at the lowest point, 0 when covered */
  shortfall: number;
  /** null when covered, or when there's nothing to convert from (or no rates) */
  hint: ConversionHint | null;
  horizon: string;
}

/** The weekday before `date` (Mon–Fri), not before `today`. */
export function businessDayBefore(date: string, today: string): string {
  let d = addDays(date, -1);
  for (;;) {
    const { y, m, d: day } = parseISODate(d);
    const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) break;
    d = addDays(d, -1);
  }
  return d < today ? today : d;
}

const roundUpTo10 = (n: number) => Math.ceil(n / 10) * 10;

export function tryRunway(params: {
  /** balanceSeries over the whole timeline */
  series: ReadonlyMap<string, AccountSeries>;
  today: string;
  /** how far the walk looks */
  to: string;
  usdPer?: UsdPerMap | null;
}): Runway | null {
  const { series, today, to, usdPer } = params;
  const lira = [...series.values()].filter((s) => s.account.currency === "TRY" && s.account.kind === "fiat");
  if (lira.length === 0) return null;

  const dates = new Set<string>([today]);
  for (const s of lira) for (const p of s.points) if (p.date > today && p.date <= to) dates.add(p.date);
  const total = (date: string) => roundTo(lira.reduce((sum, s) => sum + (balanceAt(s.points, date) ?? s.now), 0), "TRY");

  let low = { balance: total(today), date: today };
  let shortOn: string | null = null;
  for (const date of [...dates].sort()) {
    const balance = total(date);
    if (shortOn == null && balance < -0.005) shortOn = date;
    if (balance < low.balance - 0.005) low = { balance, date };
  }
  const shortfall = low.balance < -0.005 ? -low.balance : 0;
  const runway: Runway = {
    accounts: lira.map((s) => s.account),
    now: roundTo(lira.reduce((sum, s) => sum + s.now, 0), "TRY"),
    low,
    shortOn,
    shortfall,
    hint: null,
    horizon: to,
  };
  if (shortOn == null || !usdPer) return runway;

  // the TRY account that goes lowest takes the money
  let toAccount = lira[0].account;
  let lowest = Infinity;
  for (const s of lira) {
    const l = lowestAhead(s.points, today, to);
    if (l && l.balance < lowest) {
      lowest = l.balance;
      toAccount = s.account;
    }
  }

  // the biggest non-TRY cash account, USD first
  const others = [...series.values()].filter((s) => s.account.kind === "fiat" && s.account.currency !== "TRY" && s.now > 0);
  const inLira = (s: AccountSeries) => convert(s.now, s.account.currency, "TRY", usdPer) ?? 0;
  const pick = (list: AccountSeries[]) => list.sort((a, b) => inLira(b) - inLira(a))[0];
  const source = pick(others.filter((s) => s.account.currency === "USD")) ?? pick(others);
  if (!source) return runway;

  const need = shortfall + Math.max(shortfall * BUFFER_SHARE, BUFFER_MIN_TRY);
  const fromCurrency: Currency = source.account.currency;
  const raw = convert(need, "TRY", fromCurrency, usdPer);
  if (raw == null) return runway;
  const amount = roundUpTo10(raw);
  const toAmount = roundTo(convert(amount, fromCurrency, "TRY", usdPer) ?? need, "TRY");
  runway.hint = { fromAccount: source.account, amount, toAmount, toAccount, convertBy: businessDayBefore(shortOn, today) };
  return runway;
}
