import { Account } from "@/lib/data/types";
import { TUIK_CPI_INDEX } from "@/lib/data/inflation";
import { Currency } from "./currencies";
import { TimelineEvent } from "./timeline";

/**
 * What the months ahead cost in today's money.
 *
 * A twelve-month taksit at 0% is not a loan at 0%: in a currency losing a
 * quarter of its value a year, the twelfth instalment is paid in lira worth
 * a fifth less than today's. The nominal tail — what every screen adds up —
 * is therefore the most expensive way to read it, and the gap is not small
 * enough to wave away.
 *
 * So: take what is still to be paid, discount each payment by how far away
 * it is, and show both figures side by side. The point isn't to make the
 * debt look smaller; it's to show which debts are cheap to carry and which
 * are worth clearing early, which the nominal total cannot distinguish.
 *
 * - Only one currency at a time, and only the lira by default: inflation is
 *   a property of a currency, and discounting dollars by Turkish CPI would
 *   be nonsense dressed as arithmetic.
 * - The rate is an assumption and is shown as one. It defaults to the last
 *   twelve months of TÜİK CPI actually on record (recentAnnualInflationPct)
 *   and is meant to be argued with.
 * - Payments are discounted by whole days, not whole months, so two bills a
 *   fortnight apart don't read as the same money.
 */

/** Days in an average month, for discounting by date rather than by month boundary. */
const DAYS_PER_MONTH = 30.436875;

export type RealTermsGroup = "card" | "debt" | "other";

export interface RealTermsRow {
  key: string;
  date: string;
  label: string;
  group: RealTermsGroup;
  /** what you will hand over, in the currency's own nominal lira */
  nominal: number;
  /** what that is worth in today's money */
  real: number;
  /** how far ahead it is, in months */
  monthsAhead: number;
}

export interface RealTermsTotals {
  nominal: number;
  real: number;
  /** nominal − real: what the currency's slide takes off the bill */
  saved: number;
}

export interface RealTerms {
  currency: Currency;
  /** the assumption, per year, as a percentage */
  annualPct: number;
  rows: RealTermsRow[];
  totals: RealTermsTotals;
  byGroup: Record<RealTermsGroup, RealTermsTotals>;
}

const empty = (): RealTermsTotals => ({ nominal: 0, real: 0, saved: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The yearly rise over the last twelve months the CPI table actually holds.
 * Null when it holds fewer than thirteen months, so a caller can say it
 * doesn't know rather than invent a rate.
 */
export function recentAnnualInflationPct(index: Record<string, number> = TUIK_CPI_INDEX): number | null {
  const months = Object.keys(index).sort();
  if (months.length < 13) return null;
  const latest = months[months.length - 1];
  const yearAgo = months[months.length - 13];
  const from = index[yearAgo];
  const to = index[latest];
  if (!(from > 0) || !(to > 0)) return null;
  return round2((to / from - 1) * 100);
}

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/** What `label` an event goes under, and which of the three groups it belongs to. */
function classify(e: TimelineEvent, byId: ReadonlyMap<string, Account>): { label: string; group: RealTermsGroup } {
  if (e.kind === "statement") {
    const card = e.cardId ? byId.get(e.cardId) : undefined;
    return { label: card?.name ?? "—", group: "card" };
  }
  const label = e.tx?.description || (e.accountId ? (byId.get(e.accountId)?.name ?? "—") : "—");
  // an instalment on a debt is a debt payment wherever it is booked
  return { label, group: e.tx?.loanId != null ? "debt" : "other" };
}

/**
 * Everything still to be paid out of accounts in `currency`, between today
 * and `to`, in nominal lira and in today's.
 *
 * Only outflows: money arriving is worth discounting too, but the question
 * this answers is what the debt costs, and an income line in the middle of
 * it would only confuse the totals.
 */
export function realTerms(params: {
  events: readonly TimelineEvent[];
  accounts: readonly Account[];
  today: string;
  to: string;
  /** the assumption, per year, as a percentage (28.8 = prices rise 28.8% a year) */
  annualPct: number;
  currency?: Currency;
  /** for kinds that only count when asked (expected VICTVS payouts) */
  counts?: (e: TimelineEvent) => boolean;
}): RealTerms {
  const { events, accounts, today, to, annualPct, currency = "TRY", counts } = params;
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const monthly = Math.pow(1 + annualPct / 100, 1 / 12) - 1;

  const rows: RealTermsRow[] = [];
  const byGroup: Record<RealTermsGroup, RealTermsTotals> = { card: empty(), debt: empty(), other: empty() };
  const totals = empty();

  for (const e of events) {
    const real = e.status === "completed" || e.status === "planned" || e.status === "overdue" || (counts?.(e) ?? false);
    if (!real) continue;
    const date = e.effectiveDate;
    if (date < today || date > to) continue;
    for (const leg of e.legs) {
      const account = byId.get(leg.accountId);
      if (!account || account.currency !== currency) continue;
      // outflows only: this is about what the months ahead cost
      if (leg.delta >= -0.005) continue;
      const nominal = -leg.delta;
      const monthsAhead = daysBetween(today, date) / DAYS_PER_MONTH;
      const discounted = nominal / Math.pow(1 + monthly, monthsAhead);
      const { label, group } = classify(e, byId);
      rows.push({ key: `${e.key}:${leg.accountId}`, date, label, group, nominal, real: round2(discounted), monthsAhead });
      byGroup[group].nominal += nominal;
      byGroup[group].real += discounted;
      totals.nominal += nominal;
      totals.real += discounted;
    }
  }

  const close = (t: RealTermsTotals) => {
    t.nominal = round2(t.nominal);
    t.real = round2(t.real);
    t.saved = round2(t.nominal - t.real);
  };
  for (const g of Object.values(byGroup)) close(g);
  close(totals);
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  return { currency, annualPct, rows, totals, byGroup };
}

export interface RealTermsLine {
  label: string;
  group: RealTermsGroup;
  totals: RealTermsTotals;
  /** the first and last payment counted */
  from: string;
  to: string;
  count: number;
}

/**
 * The same, gathered by what it is: one line a card, a debt or a bill, so
 * the view reads as "this is what each commitment really costs" rather than
 * as a list of two hundred payments. Biggest real cost first.
 */
export function realTermsByLabel(result: RealTerms): RealTermsLine[] {
  const lines = new Map<string, RealTermsLine>();
  for (const row of result.rows) {
    const key = `${row.group}:${row.label}`;
    const line =
      lines.get(key) ?? { label: row.label, group: row.group, totals: empty(), from: row.date, to: row.date, count: 0 };
    line.totals.nominal += row.nominal;
    line.totals.real += row.real;
    line.count += 1;
    if (row.date < line.from) line.from = row.date;
    if (row.date > line.to) line.to = row.date;
    lines.set(key, line);
  }
  return [...lines.values()]
    .map((l) => ({
      ...l,
      totals: { nominal: round2(l.totals.nominal), real: round2(l.totals.real), saved: round2(l.totals.nominal - l.totals.real) },
    }))
    .sort((a, b) => b.totals.real - a.totals.real || a.label.localeCompare(b.label));
}
