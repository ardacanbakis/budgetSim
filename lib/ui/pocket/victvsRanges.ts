import { VictvsSession } from "@/lib/data/types";
import { sumAmounts } from "@/lib/domain/money";

/**
 * VICTVS sessions as Pocket lists and selects them. Pure, over the sessions
 * the queries return, so the figures are the Classic page's own (sumAmounts
 * in USD, latest first, the 1st/2nd half day bounds).
 *
 * - halfMonthRanges(sessions, month) → { first, second, all }: the unpaid
 *   sessions of a month by the page's 1st half (days 1–15) and 2nd half
 *   (16 to the end) buttons, and every unpaid one. Only unpaid sessions can be
 *   selected in Pocket: a paid row opens its own sheet instead.
 * - toggleRange(selected, ids): the page's selectRange rule — adds the ids,
 *   or takes them all away when every one is already selected.
 * - victvsYears(sessions, filter): year → month groups, latest first, each
 *   with its USD total and its unpaid count, as the page groups them.
 * - unpaidSummary(sessions): how many are unpaid and what they come to.
 * - lastDayOfMonth(month): 28–31, for "16–30 Sep".
 */

export type VictvsFilter = "unpaid" | "paid" | "all";
export const VICTVS_FILTERS: readonly VictvsFilter[] = ["unpaid", "paid", "all"];

export interface HalfMonthRanges {
  /** unpaid, days 1–15 */
  first: string[];
  /** unpaid, day 16 to the end of the month */
  second: string[];
  /** every unpaid session of the month */
  all: string[];
}

/** The day a session falls on (1–31), from its yyyy-mm-dd date. */
const dayOf = (s: VictvsSession) => Number(s.date.slice(8, 10));

/** Latest first; a stable order for sessions on the same day. */
function latestFirst(a: VictvsSession, b: VictvsSession): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function lastDayOfMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function halfMonthRanges(sessions: readonly VictvsSession[], month: string): HalfMonthRanges {
  const unpaid = sessions.filter((s) => s.status === "unpaid" && s.date.slice(0, 7) === month).sort(latestFirst);
  return {
    first: unpaid.filter((s) => dayOf(s) >= 1 && dayOf(s) <= 15).map((s) => s.id),
    second: unpaid.filter((s) => dayOf(s) >= 16).map((s) => s.id),
    all: unpaid.map((s) => s.id),
  };
}

export function toggleRange(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(selected);
  if (ids.length === 0) return next;
  const allIn = ids.every((id) => next.has(id));
  for (const id of ids) {
    if (allIn) next.delete(id);
    else next.add(id);
  }
  return next;
}

export interface VictvsMonth {
  /** yyyy-mm */
  month: string;
  /** latest first */
  items: VictvsSession[];
  /** every listed session, USD */
  total: number;
  unpaidCount: number;
}

export interface VictvsYear {
  year: string;
  count: number;
  /** USD */
  total: number;
  months: VictvsMonth[];
}

export function victvsYears(sessions: readonly VictvsSession[], filter: VictvsFilter): VictvsYear[] {
  const listed = filter === "all" ? [...sessions] : sessions.filter((s) => s.status === filter);
  const byMonth = new Map<string, VictvsSession[]>();
  for (const s of listed) {
    const key = s.date.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), s]);
  }
  const months: VictvsMonth[] = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([month, items]) => ({
      month,
      items: items.sort(latestFirst),
      total: sumAmounts("USD", items.map((s) => s.amount)),
      unpaidCount: items.filter((s) => s.status === "unpaid").length,
    }));
  const byYear = new Map<string, VictvsMonth[]>();
  for (const m of months) {
    const year = m.month.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), m]);
  }
  return [...byYear.entries()].map(([year, ms]) => ({
    year,
    count: ms.reduce((n, m) => n + m.items.length, 0),
    total: sumAmounts("USD", ms.flatMap((m) => m.items.map((s) => s.amount))),
    months: ms,
  }));
}

/**
 * Unpaid sessions split by whether they've happened: what you're owed now,
 * and sessions booked ahead that aren't owed until they're held.
 */
export function unpaidSplit(
  sessions: readonly VictvsSession[],
  today: string
): { now: { count: number; total: number }; scheduled: { count: number; total: number } } {
  const unpaid = sessions.filter((s) => s.status === "unpaid");
  const held = unpaid.filter((s) => s.date <= today);
  const ahead = unpaid.filter((s) => s.date > today);
  return {
    now: { count: held.length, total: sumAmounts("USD", held.map((s) => s.amount)) },
    scheduled: { count: ahead.length, total: sumAmounts("USD", ahead.map((s) => s.amount)) },
  };
}

export function unpaidSummary(sessions: readonly VictvsSession[]): { count: number; total: number; ids: string[] } {
  const unpaid = sessions.filter((s) => s.status === "unpaid");
  return {
    count: unpaid.length,
    total: sumAmounts("USD", unpaid.map((s) => s.amount)),
    ids: [...unpaid].sort(latestFirst).map((s) => s.id),
  };
}
