import { Account } from "@/lib/data/types";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { addMonthsClamped } from "@/lib/domain/recurrence";
import { AccountSeries, balanceAt, compareEvents, TimelineEvent } from "@/lib/domain/timeline";

/**
 * The timeline (lib/domain/timeline.ts) as the screens list it: filtered,
 * then grouped into months and days with the same nets the Ledger tab shows.
 * Pure, so the Timeline and Ledger tabs can be checked against each other.
 *
 * - filterTimeline(events, filters): one account (an event reaches it when
 *   it is shown there or moves money on it), milestones on or off, imported
 *   history (legacy rows) on or off.
 * - contributionOf(event, options): what an event adds to its day and month,
 *   [income, expense], or null when it isn't counted. Without an account,
 *   the Ledger month header's rule (lib/ui/pocket/dayGroups.ts): income and
 *   spending only (a transfer between your own accounts is neither, a card
 *   payment is spending), converted to `display` at the rates captured on
 *   the row, else today's; a card statement is spending at today's rates;
 *   legacy rows and markers aren't counted. With an account, its own legs,
 *   in its currency.
 * - bucketTimeline(events, options): months, then days, oldest first. With
 *   an account and its series, each day carries its end-of-day balance.
 * - monthSummaries(events, options): each month's in / out / net, and for a
 *   month up to this one the average net of the six months before it (the
 *   months since the first one with anything in it).
 * - flowBetween(events, from, to, options): in / out / net of the events
 *   that take effect in [from, to], overdue ones included (they take effect
 *   today).
 * - balancesAfter(events, accountId, series): the balance after each event
 *   on one account, walked in the order the series walks them.
 * - monthHighlights(month): for the Month zoom, the three biggest outflows,
 *   the statements and the markers.
 */

export interface TimelineFilters {
  accountId: string | null;
  milestones: boolean;
  /** imported history (legacy rows) */
  legacy: boolean;
}

export interface BucketOptions {
  accountsById: ReadonlyMap<string, Account>;
  /** today's rates, when they've arrived */
  usdPer: UsdPerMap | null | undefined;
  display: Currency;
  /** one account's view: nets in its currency */
  accountId?: string | null;
  /** that account's balance series, for end-of-day balances */
  series?: AccountSeries | null;
}

export interface TimelineDay {
  date: string;
  net: number;
  count: number;
  events: TimelineEvent[];
  /** one account's view: its balance at the end of the day */
  endBalance?: number | null;
}

export interface TimelineMonth {
  /** yyyy-mm */
  month: string;
  income: number;
  expense: number;
  net: number;
  days: TimelineDay[];
}

export function touchesAccount(event: TimelineEvent, accountId: string): boolean {
  return event.accountId === accountId || event.legs.some((l) => l.accountId === accountId);
}

export function filterTimeline(events: readonly TimelineEvent[], filters: TimelineFilters): TimelineEvent[] {
  return events.filter((e) => {
    if (!filters.milestones && e.kind === "milestone") return false;
    if (!filters.legacy && e.legacy) return false;
    if (filters.accountId != null && !touchesAccount(e, filters.accountId)) return false;
    return true;
  });
}

export function contributionOf(event: TimelineEvent, options: BucketOptions): [number, number] | null {
  if (event.legacy || event.kind === "milestone") return null;
  if (options.accountId != null) {
    let delta = 0;
    for (const leg of event.legs) if (leg.accountId === options.accountId) delta += leg.delta;
    if (delta === 0) return null;
    return delta > 0 ? [delta, 0] : [0, -delta];
  }
  if (event.direction === "none" || event.currency == null) return null;
  const rates = event.tx?.fxSnapshot?.usdPer ?? options.usdPer;
  if (!rates) return null;
  const converted = convert(event.amount, event.currency, options.display, rates);
  if (converted == null) return null;
  return event.direction === "income" ? [converted, 0] : [0, converted];
}

export function bucketTimeline(events: readonly TimelineEvent[], options: BucketOptions): TimelineMonth[] {
  const sorted = [...events].sort(compareEvents);
  const months: TimelineMonth[] = [];
  let month: TimelineMonth | null = null;
  let day: TimelineDay | null = null;
  const points = options.accountId != null ? options.series?.points : undefined;
  for (const e of sorted) {
    const key = e.date.slice(0, 7);
    if (!month || month.month !== key) {
      month = { month: key, income: 0, expense: 0, net: 0, days: [] };
      months.push(month);
      day = null;
    }
    if (!day || day.date !== e.date) {
      day = { date: e.date, net: 0, count: 0, events: [] };
      if (points) day.endBalance = balanceAt(points, e.date);
      month.days.push(day);
    }
    day.events.push(e);
    day.count += 1;
    const add = contributionOf(e, options);
    if (add) {
      month.income += add[0];
      month.expense += add[1];
      day.net += add[0] - add[1];
    }
  }
  for (const m of months) m.net = m.income - m.expense;
  return months;
}

export interface MonthSummary {
  month: string;
  income: number;
  expense: number;
  net: number;
  /** the average net of the six months before, for a month up to this one; null with no history */
  avgNet: number | null;
}

/** How many months the average looks back. */
export const AVERAGE_MONTHS = 6;

export function monthSummaries(
  events: readonly TimelineEvent[],
  options: BucketOptions & { today: string }
): Map<string, MonthSummary> {
  const sums = new Map<string, MonthSummary>();
  for (const e of events) {
    const add = contributionOf(e, options);
    if (!add) continue;
    const month = e.date.slice(0, 7);
    const s = sums.get(month) ?? { month, income: 0, expense: 0, net: 0, avgNet: null };
    s.income += add[0];
    s.expense += add[1];
    s.net = s.income - s.expense;
    sums.set(month, s);
  }
  const first = [...sums.keys()].sort()[0];
  const thisMonth = options.today.slice(0, 7);
  for (const s of sums.values()) {
    if (s.month > thisMonth) continue;
    const nets: number[] = [];
    for (let i = 1; i <= AVERAGE_MONTHS; i++) {
      const m = addMonthsClamped(`${s.month}-01`, -i).slice(0, 7);
      if (m < first) break;
      nets.push(sums.get(m)?.net ?? 0);
    }
    s.avgNet = nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : null;
  }
  return sums;
}

export interface Flow {
  income: number;
  expense: number;
  net: number;
}

export function flowBetween(events: readonly TimelineEvent[], from: string, to: string, options: BucketOptions): Flow {
  const flow: Flow = { income: 0, expense: 0, net: 0 };
  for (const e of events) {
    if (e.status === "completed" || e.effectiveDate < from || e.effectiveDate > to) continue;
    const add = contributionOf(e, options);
    if (!add) continue;
    flow.income += add[0];
    flow.expense += add[1];
  }
  flow.net = flow.income - flow.expense;
  return flow;
}

/** The order the balance series takes events in: by the day they move money. */
function compareEffective(a: TimelineEvent, b: TimelineEvent): number {
  if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? -1 : 1;
  // on one day, what has happened before what is still to happen
  const ad = a.status === "completed" ? 0 : 1;
  const bd = b.status === "completed" ? 0 : 1;
  return ad !== bd ? ad - bd : compareEvents(a, b);
}

export function balancesAfter(
  events: readonly TimelineEvent[],
  accountId: string,
  series: AccountSeries,
  counts?: (e: TimelineEvent) => boolean
): Map<string, number> {
  const after = new Map<string, number>();
  let balance = series.points[0]?.balance ?? series.now;
  const moving = events
    .filter((e) => {
      if (!e.legs.some((l) => l.accountId === accountId)) return false;
      const real = e.status === "completed" || e.status === "planned" || e.status === "overdue";
      return real || (counts?.(e) ?? false);
    })
    .sort(compareEffective);
  for (const e of moving) {
    for (const leg of e.legs) if (leg.accountId === accountId) balance += leg.delta;
    after.set(e.key, Math.round(balance * 1e8) / 1e8);
  }
  return after;
}

export interface MonthHighlights {
  /** the three biggest outflows (rows and statements), largest first */
  outflows: TimelineEvent[];
  statements: TimelineEvent[];
  markers: TimelineEvent[];
}

export function monthHighlights(month: TimelineMonth, options: BucketOptions): MonthHighlights {
  const all = month.days.flatMap((d) => d.events);
  const out = all
    .map((e) => ({ e, add: contributionOf(e, options) }))
    .filter((x) => x.add != null && x.add[1] > 0)
    .sort((a, b) => b.add![1] - a.add![1])
    .slice(0, 3)
    .map((x) => x.e);
  return {
    outflows: out,
    statements: all.filter((e) => e.kind === "statement"),
    markers: all.filter((e) => e.kind === "milestone"),
  };
}
