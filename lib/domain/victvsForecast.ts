import { VictvsPayout, VictvsSession } from "@/lib/data/types";
import { addMonthKey, monthsBetween } from "./planner";
import type { ExtraFlow } from "./projector";

/**
 * VICTVS income ahead, read from the sessions behind you.
 *
 * Invigilation work is seasonal: exam months are busy, summer and the turn of
 * the year are quiet, and the pattern comes back each year. So each month
 * ahead is forecast from the same calendar month in the years before: the
 * average of what those months earned, with the lowest and highest as its
 * range. A month with no earlier year behind it falls back to the average of
 * the last six complete months; with no history at all there is no forecast.
 *
 * Sessions count in the month they were worked, whatever their status: an
 * unpaid session is still work done. History runs from the first session's
 * month to the last complete month, so a quiet month inside it counts as a
 * zero instead of being skipped. This month, still under way, never counts as
 * history; it shows what has been worked so far against what it should earn.
 *
 * The money arrives later than the work, because VICTVS pays in batches. The
 * lag is the median from a paid session's date to its payout's date (a month
 * when no payout links its sessions yet), and the cash forecast moves each
 * month's earnings that far ahead. Sessions already worked but not yet paid
 * land at their own month plus the lag, or this month if that has passed.
 *
 * Every amount is in USD, as sessions are.
 */

export type VictvsBasis = "seasonal" | "recent" | "none";

export interface VictvsMonthForecast {
  /** yyyy-MM */
  month: string;
  /** what the month's work should earn */
  expected: number;
  low: number;
  high: number;
  basis: VictvsBasis;
  /** the months the forecast stands on: the same month in earlier years, or the recent ones */
  samples: Array<{ month: string; amount: number }>;
  /** worked so far: this month only, 0 for the months after it */
  soFar: number;
}

export interface VictvsCashMonth {
  /** yyyy-MM */
  month: string;
  /** expected to be paid out in this month */
  expected: number;
  low: number;
  high: number;
  /** of which: sessions already worked, waiting for their payout */
  earned: number;
}

export interface VictvsForecast {
  /** this month and the ones after it, by the month the work is done */
  earnings: VictvsMonthForecast[];
  /** the same months, by the month the money lands */
  cash: VictvsCashMonth[];
  /** median days from a session to its payout; null until a payout links its sessions */
  lagDays: number | null;
  /** how many months the cash forecast trails the work */
  lagMonths: number;
  /** complete months of history behind the forecast */
  historyMonths: number;
  /** worked and not yet paid */
  unpaid: number;
}

/** The fallback for months with no earlier year: this many recent months. */
const RECENT_MONTHS = 6;
/** A lag longer than this is a backlog, not a payment rhythm. */
const MAX_LAG_MONTHS = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median days from a session to the payout that paid it, or null when no payout links sessions. */
export function payoutLagDays(sessions: readonly VictvsSession[], payouts: readonly VictvsPayout[]): number | null {
  const paidOn = new Map(payouts.map((p) => [p.id, p.paymentDate] as const));
  const lags: number[] = [];
  for (const s of sessions) {
    const date = s.payoutId ? paidOn.get(s.payoutId) : undefined;
    if (date) lags.push(Math.max(0, daysBetween(s.date, date)));
  }
  return lags.length ? median(lags) : null;
}

export function forecastVictvs(input: {
  sessions: readonly VictvsSession[];
  payouts: readonly VictvsPayout[];
  /** yyyy-mm-dd */
  today: string;
  /** how many months to forecast, this one included */
  months: number;
}): VictvsForecast {
  const { sessions, payouts, today, months } = input;
  const thisMonth = today.slice(0, 7);

  const workedIn = new Map<string, number>();
  for (const s of sessions) {
    const month = s.date.slice(0, 7);
    workedIn.set(month, (workedIn.get(month) ?? 0) + s.amount);
  }
  const earned = (month: string) => round2(workedIn.get(month) ?? 0);

  // every complete month from the first session on, quiet ones included
  const history: string[] = [];
  const first = [...workedIn.keys()].sort()[0];
  const lastComplete = addMonthKey(thisMonth, -1);
  if (first && first <= lastComplete) {
    for (let m = first; m <= lastComplete; m = addMonthKey(m, 1)) history.push(m);
  }
  const recent = history.slice(-RECENT_MONTHS);

  const earnings: VictvsMonthForecast[] = [];
  for (let i = 0; i < months; i++) {
    const month = addMonthKey(thisMonth, i);
    const sameMonth = history.filter((m) => m.slice(5) === month.slice(5));
    const basis: VictvsBasis = sameMonth.length ? "seasonal" : recent.length ? "recent" : "none";
    const samples = (basis === "seasonal" ? sameMonth : basis === "recent" ? recent : []).map((m) => ({
      month: m,
      amount: earned(m),
    }));
    const amounts = samples.map((s) => s.amount);
    earnings.push({
      month,
      expected: amounts.length ? round2(amounts.reduce((a, b) => a + b, 0) / amounts.length) : 0,
      low: amounts.length ? Math.min(...amounts) : 0,
      high: amounts.length ? Math.max(...amounts) : 0,
      basis,
      samples,
      soFar: i === 0 ? earned(month) : 0,
    });
  }

  const lagDays = payoutLagDays(sessions, payouts);
  const lagMonths = lagDays == null ? 1 : Math.min(MAX_LAG_MONTHS, Math.max(0, Math.round(lagDays / 30.4)));

  const cash: VictvsCashMonth[] = earnings.map((e) => ({ month: e.month, expected: 0, low: 0, high: 0, earned: 0 }));
  const at = (month: string) => cash[monthsBetween(thisMonth, month)];

  // the work still to come lands lagMonths later; this month only what's left to earn
  for (const e of earnings) {
    const lands = at(addMonthKey(e.month, lagMonths));
    if (!lands) continue;
    lands.expected += Math.max(0, e.expected - e.soFar);
    lands.low += Math.max(0, e.low - e.soFar);
    lands.high += Math.max(0, e.high - e.soFar);
  }

  // work already done and waiting: its own month plus the lag, never in the past
  let unpaid = 0;
  for (const s of sessions) {
    if (s.status !== "unpaid") continue;
    unpaid += s.amount;
    const due = addMonthKey(s.date.slice(0, 7), lagMonths);
    const lands = at(due < thisMonth ? thisMonth : due);
    if (!lands) continue;
    lands.expected += s.amount;
    lands.low += s.amount;
    lands.high += s.amount;
    lands.earned += s.amount;
  }
  for (const c of cash) {
    c.expected = round2(c.expected);
    c.low = round2(c.low);
    c.high = round2(c.high);
    c.earned = round2(c.earned);
  }

  return { earnings, cash, lagDays, lagMonths, historyMonths: history.length, unpaid: round2(unpaid) };
}

/**
 * The cash forecast as the planner's extra income flows: one a month, in
 * USD, into the account VICTVS pays (or wherever the projection puts income
 * when none is set), under the VICTVS category. `firstMonth` is the
 * projection's first month; months before it are left out.
 */
export function victvsForecastFlows(
  forecast: VictvsForecast,
  firstMonth: string,
  into: { accountId: string | null; categoryId: string; label: string }
): ExtraFlow[] {
  const flows: ExtraFlow[] = [];
  for (const c of forecast.cash) {
    const monthOffset = monthsBetween(firstMonth, c.month);
    if (monthOffset < 0 || c.expected <= 0) continue;
    flows.push({ monthOffset, direction: "income", amount: c.expected, currency: "USD", ...into });
  }
  return flows;
}
